import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import AdmZip from 'adm-zip';
import { z } from 'zod';
import type { ChaldPackExportResult, ChaldPackSummary, InstanceKind, InstanceMeta } from '../shared/types';
import { AppError } from './errors';
import { hashFile, runPool } from './download';
import { type ModrinthLike, type PackPlan, readInstalled, safePackPath } from './modrinth';
import { exists } from './storage';

/**
 * `.chaldlauncher` is a zip with:
 *   chaldlauncher.json   what to download (Modrinth files, with SHA-1) and what the instance is
 *   overrides/...        everything that cannot be downloaded: own mods, configs, options, (optionally) worlds
 */
export const PACK_EXT = '.chaldlauncher';
export const MANIFEST = 'chaldlauncher.json';
const MAX_MANIFEST_BYTES = 8 * 1024 * 1024;
export const MAX_PACK_OVERRIDES_BYTES = 1024 * 1024 * 1024;
const MAX_PACK_FILES = 20_000;

/** Top-level folders of .minecraft that are never exported. */
const SKIP_DIRS = new Set(['logs', 'crash-reports', 'screenshots', '.fabric', '.mixin.out', 'webcache', 'webcache2', 'downloads', 'debug', '.cache']);
const SKIP_FILES = new Set(['.chald-modrinth.json']);

const cdnUrl = z.string().url().max(2048).refine((u) => {
  try {
    const x = new URL(u);
    return x.protocol === 'https:' && x.hostname === 'cdn.modrinth.com';
  } catch {
    return false;
  }
}, 'Ссылка на файл ведёт не на cdn.modrinth.com');

export const chaldPackSchema = z.object({
  format: z.literal('chaldlauncher-instance'),
  formatVersion: z.literal(1),
  name: z.string().trim().min(1).max(48),
  description: z.string().max(120).default(''),
  mcVersion: z.string().regex(/^[0-9A-Za-z._+-]{1,40}$/),
  loader: z.object({ type: z.enum(['vanilla', 'fabric', 'quilt', 'forge', 'neoforge']), version: z.string().max(64).nullable() }),
  kind: z.enum(['official', 'modded', 'custom']),
  coverColor: z.number().int().min(0).max(7).default(0),
  files: z.array(z.object({
    path: z.string().min(1).max(300).regex(/^(mods|resourcepacks)\/[^/]+$/, 'Файлы Modrinth лежат только в mods/ и resourcepacks/'),
    sha1: z.string().regex(/^[0-9a-fA-F]{40}$/),
    size: z.number().int().nonnegative().optional(),
    url: cdnUrl,
    projectId: z.string().regex(/^[A-Za-z0-9]{8}$/),
    versionId: z.string().regex(/^[A-Za-z0-9]{8}$/),
  })).max(5000),
});
export type ChaldPack = z.infer<typeof chaldPackSchema>;

export type PackSummary = ChaldPackSummary;
export type ExportResult = ChaldPackExportResult;

// ---------------------------------------------------------------- export

async function sha1Of(file: string): Promise<string> {
  return hashFile(file, 'sha1');
}

async function walk(root: string, rel: string, out: { rel: string; abs: string; size: number }[], top: boolean): Promise<void> {
  const dirents = await fs.readdir(path.join(root, rel), { withFileTypes: true });
  for (const d of dirents) {
    const childRel = rel ? `${rel}/${d.name}` : d.name;
    if (d.isSymbolicLink()) continue;
    if (d.isDirectory()) {
      if (top && (SKIP_DIRS.has(d.name))) continue;
      await walk(root, childRel, out, false);
    } else if (d.isFile()) {
      if (top && SKIP_FILES.has(d.name)) continue;
      if (d.name.endsWith('.part') || /^hs_err_pid\d+\.log$/.test(d.name)) continue;
      const abs = path.join(root, childRel);
      out.push({ rel: childRel, abs, size: (await fs.stat(abs)).size });
    }
  }
}

export interface ExportOptions {
  gameDir: string;
  meta: InstanceMeta;
  includeWorlds: boolean;
  out: string;
  api: Pick<ModrinthLike, 'version'>;
  report: (label: string, fraction: number) => void;
  signal?: AbortSignal;
}

export async function exportInstance(o: ExportOptions): Promise<ExportResult> {
  const notices: string[] = [];
  const index = await readInstalled(o.gameDir);
  const downloads: ChaldPack['files'] = [];
  const downloaded = new Set<string>();

  // 1. which files can be fetched from Modrinth again (and are byte-for-byte what Modrinth serves)
  const entries = Object.entries(index.projects);
  let done = 0;
  await runPool(entries, 4, async ([projectId, info]) => {
    if (o.signal?.aborted) throw new DOMException('Aborted', 'AbortError');
    try {
      const name = typeof info?.file === 'string' ? info.file : '';
      if (!name || name.includes('/') || name.includes('\\')) return;
      let found: string | null = null;
      for (const cand of [`mods/${name}`, `mods/${name}.disabled`, `resourcepacks/${name}`, `resourcepacks/${name}.disabled`]) {
        if (await exists(path.join(o.gameDir, cand))) { found = cand; break; }
      }
      if (!found) return;
      const local = await sha1Of(path.join(o.gameDir, found));
      let version;
      try {
        version = await o.api.version(info.versionId, o.signal);
      } catch (e) {
        if (o.signal?.aborted) throw e;
        notices.push(`Не удалось сверить с Modrinth, файл положен в архив: ${name}`);
        return;
      }
      const f = version.files.find((x) => x.filename === name);
      const parsed = f ? cdnUrl.safeParse(f.url) : null;
      if (version.project_id === projectId && f && parsed?.success && f.hashes.sha1?.toLowerCase() === local) {
        downloads.push({ path: found, sha1: local, size: f.size, url: f.url, projectId, versionId: info.versionId });
        downloaded.add(found);
      } else {
        notices.push(`Файл отличается от версии на Modrinth, положен в архив: ${name}`);
      }
    } finally {
      done++;
      o.report(`Сверяю с Modrinth: ${done} из ${entries.length}`, entries.length ? (done / entries.length) * 0.5 : 0.5);
    }
  });
  downloads.sort((a, b) => a.path.localeCompare(b.path));

  // 2. everything else goes into the archive
  o.report('Собираю остальные файлы…', 0.55);
  const all: { rel: string; abs: string; size: number }[] = [];
  const rootDirents = await fs.readdir(o.gameDir, { withFileTypes: true });
  for (const d of rootDirents) {
    if (d.isSymbolicLink()) continue;
    if (d.isDirectory()) {
      if (SKIP_DIRS.has(d.name) || (d.name === 'saves' && !o.includeWorlds)) continue;
      await walk(o.gameDir, d.name, all, false);
    } else if (d.isFile() && !SKIP_FILES.has(d.name) && !d.name.endsWith('.part') && !/^hs_err_pid\d+\.log$/.test(d.name)) {
      const abs = path.join(o.gameDir, d.name);
      all.push({ rel: d.name, abs, size: (await fs.stat(abs)).size });
    }
  }
  const bundle = all.filter((f) => !downloaded.has(f.rel));
  const bytes = bundle.reduce((a, f) => a + f.size, 0);
  if (bundle.length > MAX_PACK_FILES) throw new AppError('PACK_TOO_BIG', `Слишком много файлов для архива (${bundle.length}). Не включай миры или удали лишнее.`);
  if (bytes > MAX_PACK_OVERRIDES_BYTES) {
    throw new AppError('PACK_TOO_BIG', `Файлы, которые нельзя скачать, весят ${(bytes / 1024 / 1024).toFixed(0)} МБ (предел 1024 МБ).${o.includeWorlds ? ' Попробуй экспорт без миров.' : ''}`);
  }

  const manifest: ChaldPack = {
    format: 'chaldlauncher-instance', formatVersion: 1,
    name: o.meta.name, description: o.meta.description, mcVersion: o.meta.mcVersion,
    loader: { type: o.meta.loader.type, version: o.meta.loader.version },
    kind: o.meta.kind as InstanceKind, coverColor: o.meta.coverColor, files: downloads,
  };
  const zip = new AdmZip();
  zip.addFile(MANIFEST, Buffer.from(JSON.stringify(manifest, null, 2), 'utf8'));
  let n = 0;
  for (const f of bundle) {
    if (o.signal?.aborted) throw new DOMException('Aborted', 'AbortError');
    zip.addFile(`overrides/${f.rel}`, await fs.readFile(f.abs));
    n++;
    if (n % 25 === 0) o.report(`Упаковываю файлы: ${n} из ${bundle.length}`, 0.55 + (n / bundle.length) * 0.4);
  }
  o.report('Записываю файл…', 0.97);
  const part = `${o.out}.part`;
  try {
    zip.writeZip(part);
    await fs.rename(part, o.out);
  } catch (e) {
    await fs.rm(part, { force: true });
    throw e;
  }
  return { downloads: downloads.length, bundledFiles: bundle.length, bundledBytes: bytes, notices };
}

// ---------------------------------------------------------------- import

/** Reads and validates a .chaldlauncher file without writing anything. Hostile input is expected. */
export function inspectPack(file: string): { manifest: ChaldPack; summary: PackSummary } {
  let zip: AdmZip;
  try {
    zip = new AdmZip(file);
  } catch {
    throw new AppError('PACK_INVALID', 'Файл повреждён или это не архив .chaldlauncher');
  }
  const entry = zip.getEntry(MANIFEST);
  if (!entry || entry.header.size > MAX_MANIFEST_BYTES) throw new AppError('PACK_INVALID', `В файле нет ${MANIFEST}`);
  let json: unknown;
  try {
    json = JSON.parse(entry.getData().toString('utf8'));
  } catch {
    throw new AppError('PACK_INVALID', `${MANIFEST} не читается`);
  }
  const parsed = chaldPackSchema.safeParse(json);
  if (!parsed.success) throw new AppError('PACK_INVALID', `Неверный формат файла: ${parsed.error.issues[0]?.message ?? ''}`);
  const manifest = parsed.data;
  if (manifest.loader.type !== 'vanilla' && !manifest.loader.version) throw new AppError('PACK_INVALID', 'Не указана версия загрузчика');

  const dl = new Set<string>();
  for (const f of manifest.files) {
    const rel = safePackPath(f.path);
    if (dl.has(rel)) throw new AppError('PACK_INVALID', `Файл указан дважды: ${rel}`);
    dl.add(rel);
  }
  let count = 0;
  let total = 0;
  for (const e of zip.getEntries()) {
    if (e.isDirectory || e.entryName === MANIFEST) continue;
    if (!e.entryName.startsWith('overrides/')) throw new AppError('PACK_INVALID', `Лишний файл в архиве: ${e.entryName.slice(0, 80)}`);
    const rel = safePackPath(e.entryName.slice('overrides/'.length));
    if (dl.has(rel)) throw new AppError('PACK_INVALID', `Файл есть и в списке загрузки, и в архиве: ${rel}`);
    total += e.header.size;
    count++;
    if (count > MAX_PACK_FILES) throw new AppError('PACK_TOO_BIG', 'В архиве слишком много файлов');
    if (total > MAX_PACK_OVERRIDES_BYTES) throw new AppError('PACK_TOO_BIG', 'Архив распаковывается в слишком большой объём');
  }
  return {
    manifest,
    summary: {
      name: manifest.name, description: manifest.description, mcVersion: manifest.mcVersion, loader: manifest.loader,
      downloads: manifest.files.length, overrideFiles: count, overrideBytes: total,
    },
  };
}

export function packToPlan(m: ChaldPack): PackPlan {
  return {
    name: m.name, mcVersion: m.mcVersion, loader: m.loader,
    files: m.files.map((f) => ({ rel: safePackPath(f.path), sha1: f.sha1, size: f.size, urls: [f.url] })),
  };
}

/** The index that makes the Modrinth page show "Установлено" for what the pack brought. */
export function installedIndexFor(m: ChaldPack): { projects: Record<string, { file: string; versionId: string }> } {
  const projects: Record<string, { file: string; versionId: string }> = {};
  for (const f of m.files) {
    projects[f.projectId] = { file: path.posix.basename(f.path).replace(/\.disabled$/, ''), versionId: f.versionId };
  }
  return { projects };
}
