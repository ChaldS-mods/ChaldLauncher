import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import AdmZip from 'adm-zip';
import type { ContentEntry, LoaderType } from '../shared/types';
import { AppError } from './errors';
import { resolveInside, safeFileName } from './paths';

export type ContentKind = 'mods' | 'resourcepacks';
const MAX_SCAN_BYTES = 200 * 1024 * 1024;
const DISABLED = '.disabled';

export function contentDir(gameDir: string, kind: ContentKind): string {
  return path.join(gameDir, kind);
}

function stripDisabled(n: string): string {
  return n.endsWith(DISABLED) ? n.slice(0, -DISABLED.length) : n;
}

function isAllowedName(kind: ContentKind, base: string, isDir: boolean): boolean {
  if (kind === 'mods') return !isDir && base.endsWith('.jar');
  return isDir || base.endsWith('.zip');
}

interface ModInfo { name: string | null; version: string | null; loader: LoaderType | null; iconDataUrl: string | null }

const MAX_ICON_BYTES = 256 * 1024;
const MIME: Record<string, string> = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif' };

/** Reads an image out of a jar/zip. `rel` comes from the mod's own metadata, so it is only ever used as a key into the archive. */
function iconFromZip(zip: AdmZip, rel: unknown): string | null {
  if (typeof rel !== 'string' || !rel || rel.length > 300) return null;
  const mime = MIME[path.posix.extname(rel).toLowerCase()];
  if (!mime) return null;
  const entry = zip.getEntry(rel.replace(/^\/+/, ''));
  if (!entry || entry.isDirectory || entry.header.size > MAX_ICON_BYTES || entry.header.size === 0) return null;
  return `data:${mime};base64,${entry.getData().toString('base64')}`;
}

/** Fabric allows `"icon": "x.png"` or `{ "16": "a.png", "128": "b.png" }`: take the biggest. */
function fabricIconPath(icon: unknown): string | null {
  if (typeof icon === 'string') return icon;
  if (icon && typeof icon === 'object') {
    const sizes = Object.entries(icon as Record<string, unknown>).filter(([, v]) => typeof v === 'string').sort((a, b) => Number(b[0]) - Number(a[0]));
    return (sizes[0]?.[1] as string | undefined) ?? null;
  }
  return null;
}

/** Just enough TOML for mods.toml / neoforge.mods.toml: `key = "value"` lines of the top level and of the first [[mods]] table. */
export function parseModsToml(text: string): { name: string | null; version: string | null; logoFile: string | null } {
  const top: Record<string, string> = {};
  const mod: Record<string, string> = {};
  let section: 'top' | 'mod' | 'other' = 'top';
  let seenMod = false;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    if (line.startsWith('[')) {
      if (/^\[\[\s*mods\s*\]\]/.test(line) && !seenMod) { section = 'mod'; seenMod = true; } else section = 'other';
      continue;
    }
    const m = /^([A-Za-z]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/.exec(line);
    if (!m) continue;
    const value = m[2] ?? m[3] ?? '';
    if (section === 'top') top[m[1]!] = value;
    else if (section === 'mod') mod[m[1]!] = value;
  }
  const clean = (v: string | undefined) => (v && !v.includes('${') ? v : null);
  return { name: clean(mod.displayName), version: clean(mod.version), logoFile: clean(mod.logoFile) ?? clean(top.logoFile) };
}

function readModInfo(file: string): ModInfo {
  const none: ModInfo = { name: null, version: null, loader: null, iconDataUrl: null };
  try {
    const zip = new AdmZip(file);
    const fabric = zip.getEntry('fabric.mod.json');
    if (fabric) {
      const j = JSON.parse(fabric.getData().toString('utf8')) as { name?: string; version?: string; icon?: unknown };
      return { name: j.name ?? null, version: j.version ?? null, loader: 'fabric', iconDataUrl: iconFromZip(zip, fabricIconPath(j.icon)) };
    }
    const quilt = zip.getEntry('quilt.mod.json');
    if (quilt) {
      const j = JSON.parse(quilt.getData().toString('utf8')) as { quilt_loader?: { version?: string; metadata?: { name?: string; icon?: unknown } } };
      return {
        name: j.quilt_loader?.metadata?.name ?? null, version: j.quilt_loader?.version ?? null, loader: 'quilt',
        iconDataUrl: iconFromZip(zip, fabricIconPath(j.quilt_loader?.metadata?.icon)),
      };
    }
    for (const [entryName, loader] of [['META-INF/neoforge.mods.toml', 'neoforge'], ['META-INF/mods.toml', 'forge']] as const) {
      const toml = zip.getEntry(entryName);
      if (!toml || toml.header.size > 512 * 1024) continue;
      const t = parseModsToml(toml.getData().toString('utf8'));
      return { name: t.name, version: t.version, loader, iconDataUrl: iconFromZip(zip, t.logoFile) ?? iconFromZip(zip, 'pack.png') };
    }
  } catch {
    /* unreadable jar: no metadata */
  }
  return none;
}

function readPackIcon(file: string, isDir: boolean): string | null {
  try {
    if (isDir) return null;
    const entry = new AdmZip(file).getEntry('pack.png');
    if (!entry || entry.header.size > 256 * 1024) return null;
    return `data:image/png;base64,${entry.getData().toString('base64')}`;
  } catch {
    return null;
  }
}

export async function listContent(gameDir: string, kind: ContentKind, instanceLoader: LoaderType): Promise<ContentEntry[]> {
  const dir = contentDir(gameDir, kind);
  let dirents;
  try {
    dirents = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  const out: ContentEntry[] = [];
  for (const d of dirents) {
    const enabled = !d.name.endsWith(DISABLED);
    const base = stripDisabled(d.name);
    const isDir = d.isDirectory();
    if (!isAllowedName(kind, base, isDir)) continue;
    const full = path.join(dir, d.name);
    const st = await fs.stat(full);
    const entry: ContentEntry = {
      file: d.name, name: base, version: null, size: isDir ? 0 : st.size, enabled, isDir, iconDataUrl: null, warning: null,
    };
    if (kind === 'mods' && st.size <= MAX_SCAN_BYTES) {
      const info = readModInfo(full);
      if (info.name) entry.name = info.name;
      entry.version = info.version;
      entry.iconDataUrl = info.iconDataUrl;
      const compatible = info.loader === instanceLoader || (instanceLoader === 'quilt' && info.loader === 'fabric');
      if (info.loader && instanceLoader !== 'vanilla' && !compatible) {
        entry.warning = `Мод для ${info.loader}, а инстанс на ${instanceLoader}`;
      } else if (info.loader && instanceLoader === 'vanilla') {
        entry.warning = `Мод для ${info.loader}, а инстанс без загрузчика`;
      }
    } else if (kind === 'resourcepacks') {
      entry.iconDataUrl = readPackIcon(full, isDir);
    }
    out.push(entry);
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

function target(gameDir: string, kind: ContentKind, file: string): string {
  return resolveInside(contentDir(gameDir, kind), safeFileName(file));
}

export async function toggleContent(gameDir: string, kind: ContentKind, file: string): Promise<void> {
  const from = target(gameDir, kind, file);
  const to = file.endsWith(DISABLED) ? from.slice(0, -DISABLED.length) : from + DISABLED;
  try {
    await fs.access(to);
    throw new AppError('CONTENT_EXISTS', 'Файл с таким именем уже существует');
  } catch (e) {
    if (e instanceof AppError) throw e;
  }
  await fs.rename(from, to);
}

export async function removeContent(gameDir: string, kind: ContentKind, file: string, confirm: boolean): Promise<void> {
  if (confirm !== true) throw new AppError('CONFIRM_REQUIRED', 'Удаление нужно подтвердить');
  await fs.rm(target(gameDir, kind, file), { recursive: true, force: true });
}

export async function importContent(gameDir: string, kind: ContentKind, sources: string[]): Promise<number> {
  const dir = contentDir(gameDir, kind);
  await fs.mkdir(dir, { recursive: true });
  let n = 0;
  for (const src of sources) {
    const name = safeFileName(path.basename(src));
    const ext = kind === 'mods' ? '.jar' : '.zip';
    if (!name.toLowerCase().endsWith(ext)) throw new AppError('CONTENT_TYPE', `Ожидался файл ${ext}: ${name}`);
    const st = await fs.stat(src);
    if (!st.isFile()) throw new AppError('CONTENT_TYPE', `Не файл: ${name}`);
    const dest = resolveInside(dir, name);
    await fs.copyFile(src, dest, 1 /* COPYFILE_EXCL: never overwrite */).catch((e: NodeJS.ErrnoException) => {
      if (e.code === 'EEXIST') throw new AppError('CONTENT_EXISTS', `Файл уже есть: ${name}`);
      throw e;
    });
    n++;
  }
  return n;
}
