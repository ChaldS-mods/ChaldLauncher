import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import type { InstalledMod, InstalledModsReport, LoaderType, ModUpdateInfo } from '../shared/types';
import { listContent } from './content';
import { downloadFile, hashFile, runPool } from './download';
import { AppError, isAbort } from './errors';
import {
  INDEX_FILE, loaderFilter, planInstall, readInstalled,
  runInstallPlan, type MrProjectLite, type MrVersionDetail, type ModrinthLike, type PlanItem,
} from './modrinth';
import { resolveInside, safeFileName } from './paths';
import { exists, writeJsonAtomic } from './storage';

/** What the checker needs from Modrinth. `ModrinthApi` implements it; tests pass a fake. */
export interface ModCheckApi extends ModrinthLike {
  identify(hashes: string[], signal?: AbortSignal): Promise<Record<string, MrVersionDetail>>;
  latest(hashes: string[], opts: { mcVersion: string; loaders: string[] }, signal?: AbortSignal): Promise<Record<string, MrVersionDetail>>;
  projectsLite(ids: string[], signal?: AbortSignal): Promise<MrProjectLite[]>;
  versionDetails(projectId: string, opts: { mcVersion?: string | null; loaders?: string[] | null }, signal?: AbortSignal): Promise<MrVersionDetail[]>;
  iconData(url: string | null | undefined, signal?: AbortSignal): Promise<string | null>;
}

export interface ModTarget {
  gameDir: string;
  mcVersion: string;
  loader: LoaderType;
}

const DISABLED = '.disabled';
const MAX_HASH_BYTES = 200 * 1024 * 1024;
const MAX_CHANGELOG_CHARS = 6_000;
const BATCH = 200;
const PROJECT_BATCH = 100;

// ---------------------------------------------------------------- hashes

/** SHA-1 of a file, remembered while the file is unchanged (size + modification time): re-checks must not re-read every jar. */
const hashCache = new Map<string, string>();
const MAX_CACHE = 4000;

export async function sha1Cached(file: string): Promise<string | null> {
  let st;
  try {
    st = await fs.stat(file);
  } catch {
    return null;
  }
  if (!st.isFile() || st.size > MAX_HASH_BYTES) return null;
  const key = `${file}|${st.size}|${st.mtimeMs}`;
  const hit = hashCache.get(key);
  if (hit) return hit;
  const h = await hashFile(file, 'sha1');
  if (hashCache.size >= MAX_CACHE) hashCache.clear();
  hashCache.set(key, h);
  return h;
}

const iconCache = new Map<string, string | null>();

function chunks<T>(list: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
}

async function mergeBatches(
  hashes: string[],
  call: (batch: string[]) => Promise<Record<string, MrVersionDetail>>,
): Promise<Record<string, MrVersionDetail>> {
  const out: Record<string, MrVersionDetail> = {};
  for (const batch of chunks(hashes, BATCH)) Object.assign(out, await call(batch));
  return out;
}

// ---------------------------------------------------------------- choosing the update

const RANK = { release: 0, beta: 1, alpha: 2 } as const;

function primaryOf(v: MrVersionDetail) {
  return v.files.find((f) => f.primary) ?? v.files[0] ?? null;
}

/**
 * `latest` is what Modrinth calls the newest matching version (by date, whatever its stability).
 * A release is never swapped for a beta/alpha: in that case the newest version of the same or better stability is looked up.
 */
export async function findUpdate(
  api: Pick<ModCheckApi, 'versionDetails'>,
  current: MrVersionDetail,
  latest: MrVersionDetail | undefined,
  t: Pick<ModTarget, 'mcVersion' | 'loader'>,
  signal?: AbortSignal,
): Promise<MrVersionDetail | null> {
  if (!latest || latest.id === current.id) return null;
  const accept = (v: MrVersionDetail): MrVersionDetail | null => (primaryOf(v) ? v : null);
  if (RANK[latest.version_type] <= RANK[current.version_type]) return accept(latest);

  const list = await api.versionDetails(current.project_id, { mcVersion: t.mcVersion, loaders: loaderFilter(t.loader) }, signal);
  const candIdx = list.findIndex((v) => RANK[v.version_type] <= RANK[current.version_type]);
  if (candIdx < 0) return null;
  const cand = list[candIdx]!;
  if (cand.id === current.id) return null;
  const curIdx = list.findIndex((v) => v.id === current.id);
  // the list is newest first: a candidate after the current version is older than it
  if (curIdx >= 0 && candIdx > curIdx) return null;
  return accept(cand);
}

export function toUpdateInfo(v: MrVersionDetail): ModUpdateInfo | null {
  const f = primaryOf(v);
  if (!f) return null;
  return {
    versionId: v.id,
    versionNumber: v.version_number || v.name,
    name: v.name,
    type: v.version_type,
    published: v.date_published,
    fileName: f.filename,
    size: f.size ?? 0,
    changelog: (v.changelog ?? '').slice(0, MAX_CHANGELOG_CHARS),
    requiredDeps: v.dependencies.filter((d) => d.dependency_type === 'required' && d.project_id).length,
  };
}

// ---------------------------------------------------------------- what is installed

/**
 * Lists the mods of an instance and asks Modrinth which of them it knows (by file hash, so mods added by hand are found too)
 * and which have a newer version for this Minecraft version and loader.
 * When Modrinth cannot be reached the local list is still returned, with `error` set.
 */
export async function checkInstalledMods(api: ModCheckApi, t: ModTarget, signal?: AbortSignal): Promise<InstalledModsReport> {
  const entries = (await listContent(t.gameDir, 'mods', t.loader)).filter((e) => !e.isDir);
  const mods: InstalledMod[] = entries.map((e) => ({
    file: e.file, name: e.name, version: e.version, enabled: e.enabled, size: e.size,
    projectId: null, slug: null, iconDataUrl: null, source: 'unknown', update: null,
  }));
  const report = (error: string | null): InstalledModsReport => ({ mods, checkedAt: new Date().toISOString(), error });

  const loaders = loaderFilter(t.loader);
  if (!mods.length || !loaders) return report(null);

  const dir = path.join(t.gameDir, 'mods');
  const hashOf = new Map<string, string>();
  await runPool(mods, 4, async (m) => {
    const h = await sha1Cached(path.join(dir, m.file));
    if (h) hashOf.set(m.file, h);
  });

  try {
    const known = await mergeBatches([...new Set(hashOf.values())], (b) => api.identify(b, signal));
    const foundHashes = Object.keys(known);
    if (!foundHashes.length) return report(null);

    const latest = await mergeBatches(foundHashes, (b) => api.latest(b, { mcVersion: t.mcVersion, loaders }, signal));

    const projectIds = [...new Set(Object.values(known).map((v) => v.project_id))];
    const lite = new Map<string, MrProjectLite>();
    for (const batch of chunks(projectIds, PROJECT_BATCH)) {
      try {
        for (const p of await api.projectsLite(batch, signal)) lite.set(p.id, p);
      } catch (e) {
        if (isAbort(e)) throw e; // names and icons are a nicety: a failure here must not hide the updates
      }
    }
    const iconUrls = [...new Set([...lite.values()].map((p) => p.icon_url).filter((u): u is string => !!u && !iconCache.has(u)))];
    await runPool(iconUrls, 6, async (u) => {
      iconCache.set(u, await api.iconData(u, signal));
    });

    for (const m of mods) {
      const h = hashOf.get(m.file);
      const current = h ? known[h] : undefined;
      if (!h || !current) continue;
      const p = lite.get(current.project_id);
      m.source = 'modrinth';
      m.projectId = current.project_id;
      m.slug = p?.slug ?? null;
      m.name = p?.title ?? m.name;
      m.version = current.version_number || current.name || m.version;
      m.iconDataUrl = p?.icon_url ? (iconCache.get(p.icon_url) ?? null) : null;
      const next = await findUpdate(api, current, latest[h], t, signal);
      // the very same file under another version id is not an update
      if (next && !next.files.some((f) => f.hashes.sha1?.toLowerCase() === h)) m.update = toUpdateInfo(next);
    }
    return report(null);
  } catch (e) {
    if (isAbort(e)) throw e;
    return report(e instanceof Error ? e.message : String(e));
  }
}

/** Projects that are already in the instance: recognised by hash plus the launcher's own index. */
async function installedProjectIds(api: ModCheckApi, t: ModTarget, signal?: AbortSignal): Promise<Set<string>> {
  const dir = path.join(t.gameDir, 'mods');
  const out = new Set<string>();
  const index = await readInstalled(t.gameDir);
  for (const [pid, v] of Object.entries(index.projects)) if (await exists(path.join(dir, v.file))) out.add(pid);
  let names: string[] = [];
  try {
    names = (await fs.readdir(dir)).filter((n) => /\.jar(\.disabled)?$/i.test(n));
  } catch {
    /* no mods folder yet */
  }
  const hashes: string[] = [];
  await runPool(names, 4, async (n) => {
    const h = await sha1Cached(path.join(dir, n));
    if (h) hashes.push(h);
  });
  const known = await mergeBatches([...new Set(hashes)], (b) => api.identify(b, signal));
  for (const v of Object.values(known)) out.add(v.project_id);
  return out;
}

// ---------------------------------------------------------------- updating one mod

/**
 * Replaces one mod file with the newest version Modrinth offers for the instance.
 * Order of work: find the update and plan the missing required dependencies (nothing is touched if that fails),
 * install the dependencies, download the new jar next to the old one, then swap. The old file is only removed
 * after the new one is in place and verified (SHA-1 and size are checked by the downloader). A disabled mod stays disabled.
 * @returns the new file names: the updated mod first, then the dependencies that were added
 */
export async function updateInstalledMod(
  api: ModCheckApi,
  t: ModTarget,
  file: string,
  report: (label: string, fraction: number | null) => void,
  signal?: AbortSignal,
): Promise<string[]> {
  const loaders = loaderFilter(t.loader);
  if (!loaders) throw new AppError('LOADER_REQUIRED', 'Моды не работают в инстансе Vanilla');
  const oldName = safeFileName(file);
  if (!/\.jar(\.disabled)?$/i.test(oldName)) throw new AppError('CONTENT_TYPE', `Ожидался файл .jar: ${oldName}`);
  const dir = path.join(t.gameDir, 'mods');
  const oldPath = resolveInside(dir, oldName);
  const enabled = !oldName.endsWith(DISABLED);
  const oldBase = enabled ? oldName : oldName.slice(0, -DISABLED.length);

  const sha1 = await sha1Cached(oldPath);
  if (!sha1) throw new AppError('FILE_MISSING', `Файл не найден: ${oldName}`);
  report('Проверяю обновление…', null);
  const current = (await api.identify([sha1], signal))[sha1];
  if (!current) throw new AppError('NOT_ON_MODRINTH', 'Этого мода нет на Modrinth: обновить его отсюда нельзя');
  const latest = (await api.latest([sha1], { mcVersion: t.mcVersion, loaders }, signal))[sha1];
  const update = await findUpdate(api, current, latest, t, signal);
  if (!update) throw new AppError('NO_UPDATE', 'Для этого мода нет обновления');

  const nf = primaryOf(update)!;
  const newBase = safeFileName(nf.filename);
  if (!newBase.toLowerCase().endsWith('.jar')) throw new AppError('CONTENT_TYPE', `Ожидался файл .jar: ${newBase}`);
  const finalName = enabled ? newBase : newBase + DISABLED;
  const finalPath = resolveInside(dir, finalName);
  if (finalPath !== oldPath && (await exists(finalPath))) {
    throw new AppError('CONTENT_EXISTS', `Файл с таким именем уже есть: ${finalName}`);
  }

  // required dependencies that the new version brings and the instance does not have yet
  const have = await installedProjectIds(api, t, signal);
  const depPlan: PlanItem[] = [];
  const asked = new Set<string>([update.project_id]);
  for (const d of update.dependencies) {
    if (d.dependency_type !== 'required' || !d.project_id || have.has(d.project_id) || asked.has(d.project_id)) continue;
    asked.add(d.project_id);
    const items = await planInstall(api, { gameDir: t.gameDir, mcVersion: t.mcVersion, loader: t.loader, kind: 'mod' }, d.project_id, signal, d.version_id ?? null);
    for (const it of items) {
      if (!have.has(it.projectId) && !depPlan.some((x) => x.projectId === it.projectId)) depPlan.push(it);
    }
  }

  let depNames: string[] = [];
  if (depPlan.length) depNames = await runInstallPlan(t.gameDir, 'mod', depPlan, (l, f) => report(l, f * 0.4), signal);

  report(`Скачиваю: ${newBase}`, 0.5);
  const tmp = resolveInside(dir, `${newBase}.chald-update`);
  try {
    await downloadFile(
      { url: nf.url, dest: tmp, sha1: nf.hashes.sha1, size: nf.size, purpose: 'Обновление мода Modrinth' },
      { signal },
    );
    await fs.rename(tmp, finalPath); // same name as the old file: replaces it atomically; another name: nothing is clobbered (checked above)
    if (finalPath !== oldPath) {
      try {
        await fs.rm(oldPath, { force: true });
      } catch {
        await fs.rm(finalPath, { force: true }).catch(() => undefined); // never leave both versions: the game would refuse to start
        throw new AppError('REMOVE_FAILED', `Не удалось удалить старый файл ${oldName}. Закрой программы, которые его используют, и повтори`);
      }
    }
  } finally {
    await fs.rm(tmp, { force: true }).catch(() => undefined);
  }

  const index = await readInstalled(t.gameDir);
  for (const [pid, v] of Object.entries(index.projects)) if (v.file === oldBase) delete index.projects[pid];
  index.projects[update.project_id] = { file: newBase, versionId: update.id };
  await writeJsonAtomic(path.join(t.gameDir, INDEX_FILE), index);

  report('Готово', 1);
  return [newBase, ...depNames];
}
