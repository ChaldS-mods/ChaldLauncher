import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import AdmZip from 'adm-zip';
import type { ArchiveApplyResult, ArchiveGroup } from '../shared/archive';
import { AppError } from './errors';
import { COPY_EXCLUDE } from './launcherImport';
import { resolveInside, safeFileName } from './paths';

/**
 * Looks into an archive dropped on the mods page and decides where its files belong:
 *  - only .jar files (loose, in `mods/`, or inside one wrapper folder) -> the instance's mods folder;
 *  - other folders too (resourcepacks/, config/, saves/…) -> the caller asks the user whether to spread them.
 * Nothing is ever overwritten. Paths come from an untrusted archive: every one is checked.
 */

const MAX_ZIP_BYTES = 2 * 1024 * 1024 * 1024; // AdmZip reads the whole file into memory
const MAX_ENTRIES = 100_000;
const MAX_ENTRY_BYTES = 512 * 1024 * 1024;
const MAX_TOTAL_BYTES = 4 * 1024 * 1024 * 1024;

/** Folder names the game / loaders know: an archive made of these is not just «a folder around the files». */
const GAME_FOLDERS = new Set([
  'mods', 'resourcepacks', 'shaderpacks', 'config', 'saves', 'datapacks', 'defaultconfigs', 'kubejs', 'scripts', 'screenshots',
]);
/** Common spellings people use for the same folder. */
const ALIASES: Record<string, string> = {
  mod: 'mods', resourcepack: 'resourcepacks', resource_packs: 'resourcepacks', 'resource-packs': 'resourcepacks', texturepacks: 'resourcepacks',
  shaders: 'shaderpacks', shader: 'shaderpacks', shaderpack: 'shaderpacks',
};
/** Wrapper folders that only hold the instance's files (a Minecraft folder, a pack's overrides). */
const KNOWN_WRAPPERS = new Set(['.minecraft', 'minecraft', 'overrides']);
/** Single files that belong in the instance root. */
const ROOT_FILES = new Set(['options.txt', 'optionsof.txt', 'optionsshaders.txt', 'servers.dat']);
const JUNK_NAMES = new Set(['.ds_store', 'thumbs.db', 'desktop.ini']);

const isJar = (name: string): boolean => /\.jar(\.disabled)?$/i.test(name);

type Category = 'mod' | 'other' | 'ignored';

interface Item {
  entry: AdmZip.IZipEntry;
  /** where it goes, relative to the game folder */
  dest: string[];
  category: Category;
  size: number;
}

export interface ArchivePlan {
  kind: 'mods' | 'mixed' | 'modpack' | 'empty';
  items: Item[];
  mods: number;
  modBytes: number;
  groups: ArchiveGroup[];
  ignored: number;
}

/** A safe relative path with forward slashes, or null for anything that tries to leave the folder. */
export function cleanEntryName(raw: string): string | null {
  if (!raw || raw.includes('\0')) return null;
  const s = raw.replace(/\\/g, '/');
  if (s.startsWith('/') || /^[A-Za-z]:/.test(s)) return null;
  const parts: string[] = [];
  for (const p of s.split('/')) {
    if (p === '' || p === '.') continue;
    if (p === '..') return null;
    parts.push(p);
  }
  return parts.length ? parts.join('/') : null;
}

function canonicalFolder(name: string): string {
  const lower = name.toLowerCase();
  return ALIASES[lower] ?? (GAME_FOLDERS.has(lower) ? lower : name);
}

function looksLikeInstanceContent(rels: string[][]): boolean {
  if (rels.some((r) => (r.length === 1 ? isJar(r[0]!) : GAME_FOLDERS.has(canonicalFolder(r[0]!))))) return true;
  // another wrapper below: `sborka/.minecraft/mods/…`
  const first = rels[0]?.[0];
  return !!first && KNOWN_WRAPPERS.has(first.toLowerCase()) && rels.every((r) => r.length >= 2 && r[0] === first);
}

/** Removes folders that only wrap the content: `sborka/mods/x.jar` -> `mods/x.jar`. At most two levels. */
function stripWrappers(rels: string[][]): string[][] {
  let cur = rels;
  for (let i = 0; i < 2; i++) {
    if (!cur.length || cur.some((r) => r.length < 2)) break;
    const first = cur[0]![0]!;
    if (!cur.every((r) => r[0] === first)) break;
    const inner = cur.map((r) => r.slice(1));
    const known = KNOWN_WRAPPERS.has(first.toLowerCase());
    // a folder that is itself a game folder (mods/, config/…) is content, not a wrapper
    if (GAME_FOLDERS.has(canonicalFolder(first)) && canonicalFolder(first) === first.toLowerCase()) break;
    if (!known && !looksLikeInstanceContent(inner)) break;
    cur = inner;
  }
  return cur;
}

function readManifestType(zip: AdmZip, name: string): string | null {
  try {
    const e = zip.getEntry(name);
    if (!e || e.header.size > 1024 * 1024) return null;
    const j = JSON.parse(e.getData().toString('utf8')) as { manifestType?: unknown };
    return typeof j.manifestType === 'string' ? j.manifestType : null;
  } catch {
    return null;
  }
}

export function openArchive(file: string): AdmZip {
  try {
    return new AdmZip(file);
  } catch {
    throw new AppError('ARCHIVE_INVALID', `Не удалось открыть архив: ${path.basename(file)}. Нужен обычный .zip (для .rar и .7z сначала распакуй файлы).`);
  }
}

export async function planArchive(file: string): Promise<{ zip: AdmZip; plan: ArchivePlan }> {
  const st = await fs.stat(file);
  if (!st.isFile()) throw new AppError('CONTENT_TYPE', `Не файл: ${path.basename(file)}`);
  if (st.size > MAX_ZIP_BYTES) throw new AppError('ARCHIVE_TOO_BIG', 'Архив больше 2 ГБ: распакуй его и добавь файлы по частям.');
  const zip = openArchive(file);
  const entries = zip.getEntries().filter((e) => !e.isDirectory);
  if (entries.length > MAX_ENTRIES) throw new AppError('ARCHIVE_TOO_BIG', 'В архиве слишком много файлов.');

  const raw: { entry: AdmZip.IZipEntry; parts: string[] }[] = [];
  for (const entry of entries) {
    const name = cleanEntryName(entry.entryName);
    if (!name) continue; // unsafe or empty name: dropped, never written
    const parts = name.split('/');
    if (parts[0]!.toLowerCase() === '__macosx' || JUNK_NAMES.has(parts[parts.length - 1]!.toLowerCase())) continue;
    raw.push({ entry, parts });
  }

  // a pack (Modrinth .mrpack / CurseForge) is installed as a whole, not file by file
  const rels = stripWrappers(raw.map((r) => r.parts));
  const rootAt = (name: string): number => rels.findIndex((r) => r.length === 1 && r[0]!.toLowerCase() === name);
  const manifest = rootAt('manifest.json');
  if (rootAt('modrinth.index.json') >= 0 || (manifest >= 0 && readManifestType(zip, raw[manifest]!.entry.entryName) === 'minecraftModpack')) {
    return { zip, plan: { kind: 'modpack', items: [], mods: 0, modBytes: 0, groups: [], ignored: 0 } };
  }

  const items: Item[] = [];
  const groupMap = new Map<string, ArchiveGroup>();
  let mods = 0;
  let modBytes = 0;
  let ignored = 0;
  let total = 0;
  raw.forEach((r, n) => {
    const segs = rels[n]!;
    const size = r.entry.header.size;
    total += size;
    const add = (category: Category, dest: string[]): void => {
      items.push({ entry: r.entry, dest, category, size });
      if (category === 'mod') { mods++; modBytes += size; }
      else if (category === 'ignored') ignored++;
      else {
        const dir = dest.length === 1 ? '' : dest[0]!;
        const g = groupMap.get(dir) ?? { dir, files: 0, bytes: 0 };
        g.files++;
        g.bytes += size;
        groupMap.set(dir, g);
      }
    };
    const last = segs[segs.length - 1]!;
    if (segs.length === 1) {
      if (isJar(last)) add('mod', ['mods', last]);
      else if (ROOT_FILES.has(last.toLowerCase())) add('other', [last]);
      else add('ignored', segs);
      return;
    }
    const top = segs[0]!;
    const folder = canonicalFolder(top);
    if (top.startsWith('.') || COPY_EXCLUDE.has(top.toLowerCase())) { add('ignored', segs); return; }
    if (folder === 'mods') {
      if (isJar(last)) add('mod', ['mods', ...segs.slice(1)]);
      else add('ignored', segs);
      return;
    }
    add('other', [folder, ...segs.slice(1)]);
  });
  if (total > MAX_TOTAL_BYTES) throw new AppError('ARCHIVE_TOO_BIG', 'Архив распаковывается в слишком большой объём.');

  const groups = [...groupMap.values()].sort((a, b) => a.dir.localeCompare(b.dir));
  const kind: ArchivePlan['kind'] = mods === 0 && groups.length === 0 ? 'empty' : groups.length === 0 ? 'mods' : 'mixed';
  return { zip, plan: { kind, items, mods, modBytes, groups, ignored } };
}

/** Writes the planned files. `mods`: only the mods; `all`: the other folders as well. Existing files stay as they are. */
export async function applyPlan(zip: AdmZip, plan: ArchivePlan, gameDir: string, mode: 'mods' | 'all', signal?: AbortSignal): Promise<ArchiveApplyResult> {
  const result: ArchiveApplyResult = { mods: 0, other: 0, skipped: 0 };
  const created: string[] = [];
  let total = 0;
  try {
    for (const item of plan.items) {
      if (item.category === 'ignored' || (item.category === 'other' && mode !== 'all')) continue;
      signal?.throwIfAborted();
      if (item.size > MAX_ENTRY_BYTES) throw new AppError('ARCHIVE_TOO_BIG', `Файл слишком большой: ${item.dest[item.dest.length - 1]}`);
      total += item.size;
      if (total > MAX_TOTAL_BYTES) throw new AppError('ARCHIVE_TOO_BIG', 'Архив распаковывается в слишком большой объём.');
      const dest = resolveInside(gameDir, ...item.dest.map((p, i) => (i === item.dest.length - 1 ? safeFileName(p) : p)));
      await fs.mkdir(path.dirname(dest), { recursive: true });
      const data = item.entry.getData();
      if (data.length !== item.size) throw new AppError('ARCHIVE_CORRUPT', `Архив повреждён: ${item.dest[item.dest.length - 1]}`);
      try {
        await fs.writeFile(dest, data, { flag: 'wx' }); // never overwrite
        created.push(dest);
        if (item.category === 'mod') result.mods++;
        else result.other++;
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code === 'EEXIST') result.skipped++;
        else throw e;
      }
    }
  } catch (e) {
    // all or nothing: do not leave half of an archive behind
    await Promise.all(created.map((f) => fs.rm(f, { force: true }).catch(() => undefined)));
    throw e;
  }
  return result;
}

/** Loose .jar files: copied, existing ones are skipped (not an error, so one duplicate does not stop a whole drop). */
export async function importJars(gameDir: string, sources: string[]): Promise<{ imported: number; skipped: number }> {
  const dir = path.join(gameDir, 'mods');
  await fs.mkdir(dir, { recursive: true });
  let imported = 0;
  let skipped = 0;
  for (const src of sources) {
    const name = safeFileName(path.basename(src));
    const st = await fs.stat(src);
    if (!st.isFile()) throw new AppError('CONTENT_TYPE', `Не файл: ${name}`);
    try {
      await fs.copyFile(src, resolveInside(dir, name), 1 /* COPYFILE_EXCL */);
      imported++;
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'EEXIST') skipped++;
      else throw e;
    }
  }
  return { imported, skipped };
}
