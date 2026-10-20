import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import AdmZip from 'adm-zip';
import { z } from 'zod';
import type {
  LoaderType, ModrinthHit, ModrinthProjectInfo, ModrinthSearchInput, ModrinthSearchResult, ModrinthType, ModrinthVersionInfo,
} from '../shared/types';
import { AppError } from './errors';
import { downloadFile, isFileValid, runPool } from './download';
import { netJson, netRequest } from './net';
import { resolveInside, safeFileName } from './paths';
import { exists, readJson, writeJsonAtomic } from './storage';

const API = 'https://api.modrinth.com/v2';
const PAGE_SIZE = 20;
const MAX_ICON_BYTES = 256 * 1024;
const MAX_INDEX_BYTES = 8 * 1024 * 1024;
const MAX_OVERRIDE_ENTRY = 256 * 1024 * 1024;
const MAX_OVERRIDE_TOTAL = 2 * 1024 * 1024 * 1024;
const MAX_DEP_DEPTH = 6;
const MAX_BODY_CHARS = 60_000;
const MAX_CHANGELOG_CHARS = 6_000;
const MAX_VERSION_LIST = 150;

// ---------------------------------------------------------------- schemas

const fileSchema = z.object({
  url: z.string().url(),
  filename: z.string().min(1).max(255),
  primary: z.boolean().optional(),
  size: z.number().int().nonnegative().optional(),
  hashes: z.object({ sha1: z.string().regex(/^[0-9a-fA-F]{40}$/).optional() }).passthrough(),
});

const dependencySchema = z.object({
  project_id: z.string().nullable().optional(),
  version_id: z.string().nullable().optional(),
  dependency_type: z.string(),
});

export const mrVersionSchema = z.object({
  id: z.string(),
  project_id: z.string(),
  name: z.string().optional().default(''),
  version_number: z.string().optional().default(''),
  version_type: z.enum(['release', 'beta', 'alpha']),
  game_versions: z.array(z.string()),
  loaders: z.array(z.string()),
  files: z.array(fileSchema),
  dependencies: z.array(dependencySchema).default([]),
});
export type MrVersion = z.infer<typeof mrVersionSchema>;
export type MrFile = z.infer<typeof fileSchema>;

const projectSchema = z.object({
  id: z.string(),
  title: z.string(),
  description: z.string().default(''),
  slug: z.string().optional(),
});
export type MrProject = z.infer<typeof projectSchema>;

const detailSchema = z.object({
  id: z.string(),
  slug: z.string(),
  title: z.string(),
  description: z.string().default(''),
  body: z.string().nullable().optional(),
  project_type: z.string(),
  downloads: z.number().default(0),
  followers: z.number().default(0),
  categories: z.array(z.string()).default([]),
  loaders: z.array(z.string()).default([]),
  game_versions: z.array(z.string()).default([]),
  icon_url: z.string().nullable().optional(),
  license: z.object({ name: z.string().nullable().optional() }).nullable().optional(),
  updated: z.string().nullable().optional(),
});

const versionDetailSchema = mrVersionSchema.extend({
  date_published: z.string().default(''),
  downloads: z.number().default(0),
  changelog: z.string().nullable().optional(),
});

export type MrVersionDetail = z.infer<typeof versionDetailSchema>;

const projectLiteSchema = z.object({
  id: z.string(),
  slug: z.string(),
  title: z.string(),
  icon_url: z.string().nullable().optional(),
});
export type MrProjectLite = z.infer<typeof projectLiteSchema>;

const hitSchema = z.object({
  project_id: z.string(),
  slug: z.string(),
  title: z.string(),
  description: z.string().default(''),
  author: z.string().default(''),
  downloads: z.number().default(0),
  follows: z.number().default(0),
  icon_url: z.string().nullable().optional(),
  display_categories: z.array(z.string()).optional(),
  categories: z.array(z.string()).default([]),
  project_type: z.string(),
});
const searchSchema = z.object({ hits: z.array(hitSchema), total_hits: z.number(), offset: z.number() });

// ---------------------------------------------------------------- pure helpers

/** Loader names to ask Modrinth for. Quilt runs Fabric mods too. */
export function loaderFilter(loader: LoaderType): string[] | null {
  switch (loader) {
    case 'vanilla': return null;
    case 'quilt': return ['quilt', 'fabric'];
    default: return [loader];
  }
}

export function buildFacets(q: Pick<ModrinthSearchInput, 'type' | 'mcVersion' | 'loader'>): string[][] {
  const facets: string[][] = [[`project_type:${q.type}`]];
  if (q.mcVersion) facets.push([`versions:${q.mcVersion}`]);
  if (q.loader && q.type !== 'resourcepack') facets.push((loaderFilter(q.loader) ?? []).map((l) => `categories:${l}`));
  return facets;
}

/** Newest release, otherwise newest beta, otherwise newest alpha. `list` is newest first, as Modrinth returns it. */
export function pickVersion(list: MrVersion[]): MrVersion | undefined {
  return list.find((v) => v.version_type === 'release') ?? list.find((v) => v.version_type === 'beta') ?? list[0];
}

export function primaryFile(v: MrVersion): MrFile {
  const f = v.files.find((x) => x.primary) ?? v.files[0];
  if (!f) throw new AppError('MODRINTH_NO_FILE', 'У этой версии нет файлов для скачивания');
  return f;
}

/** A relative path inside an .mrpack: forward slashes, no `..`, nothing absolute. */
export function safePackPath(raw: string): string {
  if (!raw || raw.includes('\0') || raw.includes('\\') || raw.startsWith('/') || /^[A-Za-z]:/.test(raw)) {
    throw new AppError('PACK_PATH', `Недопустимый путь в сборке: ${raw.slice(0, 80)}`);
  }
  const norm = path.posix.normalize(raw);
  if (norm === '.' || norm === '..' || norm.startsWith('../') || norm.endsWith('/')) {
    throw new AppError('PACK_PATH', `Недопустимый путь в сборке: ${raw.slice(0, 80)}`);
  }
  return norm;
}

const envSchema = z.enum(['required', 'optional', 'unsupported']);
export const mrpackIndexSchema = z.object({
  formatVersion: z.literal(1),
  game: z.literal('minecraft'),
  versionId: z.string().optional().default(''),
  name: z.string().min(1).max(200),
  summary: z.string().max(4000).optional(),
  files: z
    .array(
      z.object({
        path: z.string().min(1).max(512),
        hashes: z.object({ sha1: z.string().regex(/^[0-9a-fA-F]{40}$/) }).passthrough(),
        env: z.object({ client: envSchema.optional(), server: envSchema.optional() }).optional(),
        downloads: z.array(z.string().url()).min(1).max(10),
        fileSize: z.number().int().nonnegative().optional(),
      }),
    )
    .max(5000),
  dependencies: z.record(z.string(), z.string()),
});
export type MrpackIndex = z.infer<typeof mrpackIndexSchema>;

export interface PackPlan {
  name: string;
  mcVersion: string;
  loader: { type: LoaderType; version: string | null };
  files: { rel: string; sha1: string; size: number | undefined; urls: string[] }[];
}

const LOADER_KEYS: [string, Exclude<LoaderType, 'vanilla'>][] = [
  ['neoforge', 'neoforge'], ['forge', 'forge'], ['fabric-loader', 'fabric'], ['quilt-loader', 'quilt'],
];

export function planPack(index: MrpackIndex): PackPlan {
  const mcVersion = index.dependencies.minecraft;
  if (!mcVersion || !/^[0-9A-Za-z._+-]{1,40}$/.test(mcVersion)) {
    throw new AppError('PACK_INVALID', 'В сборке не указана версия Minecraft');
  }
  const found = LOADER_KEYS.filter(([key]) => index.dependencies[key]);
  if (found.length > 1) throw new AppError('PACK_INVALID', 'В сборке указано несколько загрузчиков');
  const loader = found[0]
    ? { type: found[0][1] as LoaderType, version: index.dependencies[found[0][0]]!.slice(0, 64) }
    : { type: 'vanilla' as LoaderType, version: null };
  const seen = new Set<string>();
  const files: PackPlan['files'] = [];
  for (const f of index.files) {
    if (f.env?.client === 'unsupported') continue; // server-only
    const rel = safePackPath(f.path);
    if (seen.has(rel)) throw new AppError('PACK_INVALID', `Файл указан дважды: ${rel}`);
    seen.add(rel);
    files.push({ rel, sha1: f.hashes.sha1, size: f.fileSize, urls: f.downloads });
  }
  return { name: index.name, mcVersion, loader, files };
}

export function readMrpackIndex(packFile: string): MrpackIndex {
  let zip: AdmZip;
  try {
    zip = new AdmZip(packFile);
  } catch {
    throw new AppError('PACK_INVALID', 'Файл сборки повреждён');
  }
  const entry = zip.getEntry('modrinth.index.json');
  if (!entry || entry.header.size > MAX_INDEX_BYTES) throw new AppError('PACK_INVALID', 'В сборке нет modrinth.index.json');
  let json: unknown;
  try {
    json = JSON.parse(entry.getData().toString('utf8'));
  } catch {
    throw new AppError('PACK_INVALID', 'modrinth.index.json не читается');
  }
  const parsed = mrpackIndexSchema.safeParse(json);
  if (!parsed.success) throw new AppError('PACK_INVALID', `Неверный формат сборки: ${parsed.error.issues[0]?.message ?? ''}`);
  return parsed.data;
}

/** Copies `overrides/` and then `client-overrides/` into the game directory. Returns the number of files written. */
export async function extractOverrides(packFile: string, gameDir: string, signal?: AbortSignal): Promise<number> {
  const zip = new AdmZip(packFile);
  let total = 0;
  let count = 0;
  for (const prefix of ['overrides/', 'client-overrides/']) {
    for (const e of zip.getEntries()) {
      if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
      if (e.isDirectory || !e.entryName.startsWith(prefix)) continue;
      const rel = safePackPath(e.entryName.slice(prefix.length));
      if (e.header.size > MAX_OVERRIDE_ENTRY) throw new AppError('PACK_TOO_BIG', `Файл слишком большой: ${rel}`);
      total += e.header.size;
      if (total > MAX_OVERRIDE_TOTAL) throw new AppError('PACK_TOO_BIG', 'Сборка распаковывается в слишком большой объём');
      const dest = resolveInside(gameDir, ...rel.split('/'));
      await fs.mkdir(path.dirname(dest), { recursive: true });
      await fs.writeFile(dest, e.getData());
      count++;
    }
  }
  return count;
}

// ---------------------------------------------------------------- API client

export interface ModrinthLike {
  project(id: string, signal?: AbortSignal): Promise<MrProject>;
  version(id: string, signal?: AbortSignal): Promise<MrVersion>;
  /** versions of a project, newest first; filters are optional */
  versions(projectId: string, opts: { mcVersion?: string | null; loaders?: string[] | null }, signal?: AbortSignal): Promise<MrVersion[]>;
}

export class ModrinthApi implements ModrinthLike {
  /** @param userAgent Modrinth asks every client to identify itself */
  constructor(private userAgent: string) {}

  private post<T>(url: string, body: unknown, schema: z.ZodType<T>, signal?: AbortSignal): Promise<T> {
    return netJson<unknown>(url, {
      purpose: 'Modrinth',
      signal,
      method: 'POST',
      headers: { 'User-Agent': this.userAgent, Accept: 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }).then((j) => {
      const r = schema.safeParse(j);
      if (!r.success) throw new AppError('MODRINTH_FORMAT', 'Modrinth вернул неожиданный ответ');
      return r.data;
    });
  }

  /** Which Modrinth versions do these file hashes (SHA-1) belong to? Unknown files are simply missing from the result. */
  identify(hashes: string[], signal?: AbortSignal): Promise<Record<string, MrVersionDetail>> {
    return this.post(`${API}/version_files`, { hashes, algorithm: 'sha1' }, z.record(z.string(), versionDetailSchema), signal);
  }

  /** The newest version for the given Minecraft version and loaders, for every hash Modrinth knows. */
  latest(hashes: string[], opts: { mcVersion: string; loaders: string[] }, signal?: AbortSignal): Promise<Record<string, MrVersionDetail>> {
    return this.post(
      `${API}/version_files/update`,
      { hashes, algorithm: 'sha1', loaders: opts.loaders, game_versions: [opts.mcVersion] },
      z.record(z.string(), versionDetailSchema), signal,
    );
  }

  projectsLite(ids: string[], signal?: AbortSignal): Promise<MrProjectLite[]> {
    if (!ids.length) return Promise.resolve([]);
    return this.get(`${API}/projects?ids=${encodeURIComponent(JSON.stringify(ids))}`, z.array(projectLiteSchema), signal);
  }

  /** All versions of a project with full details (newest first), unlike the trimmed list of the project page. */
  versionDetails(projectId: string, opts: { mcVersion?: string | null; loaders?: string[] | null }, signal?: AbortSignal): Promise<MrVersionDetail[]> {
    return this.get(this.versionsUrl(projectId, opts), z.array(versionDetailSchema), signal);
  }

  iconData(url: string | null | undefined, signal?: AbortSignal): Promise<string | null> {
    return this.icon(url, signal);
  }

  private get<T>(url: string, schema: z.ZodType<T>, signal?: AbortSignal): Promise<T> {
    return netJson<unknown>(url, {
      purpose: 'Modrinth',
      signal,
      headers: { 'User-Agent': this.userAgent, Accept: 'application/json' },
    }).then((j) => {
      const r = schema.safeParse(j);
      if (!r.success) throw new AppError('MODRINTH_FORMAT', 'Modrinth вернул неожиданный ответ');
      return r.data;
    });
  }

  project(id: string, signal?: AbortSignal): Promise<MrProject> {
    return this.get(`${API}/project/${encodeURIComponent(id)}`, projectSchema, signal);
  }

  version(id: string, signal?: AbortSignal): Promise<MrVersion> {
    return this.get(`${API}/version/${encodeURIComponent(id)}`, mrVersionSchema, signal);
  }

  private versionsUrl(projectId: string, opts: { mcVersion?: string | null; loaders?: string[] | null }): string {
    const qs = new URLSearchParams();
    if (opts.mcVersion) qs.set('game_versions', JSON.stringify([opts.mcVersion]));
    if (opts.loaders?.length) qs.set('loaders', JSON.stringify(opts.loaders));
    const q = qs.toString();
    return `${API}/project/${encodeURIComponent(projectId)}/version${q ? `?${q}` : ''}`;
  }

  versions(projectId: string, opts: { mcVersion?: string | null; loaders?: string[] | null }, signal?: AbortSignal): Promise<MrVersion[]> {
    return this.get(this.versionsUrl(projectId, opts), z.array(mrVersionSchema), signal);
  }

  /** Everything the project page needs: long Markdown description, stats, icon. */
  async projectInfo(id: string, signal?: AbortSignal): Promise<ModrinthProjectInfo> {
    const p = await this.get(`${API}/project/${encodeURIComponent(id)}`, detailSchema, signal);
    const type = (['mod', 'modpack', 'resourcepack'].includes(p.project_type) ? p.project_type : 'mod') as ModrinthType;
    return {
      id: p.id, slug: p.slug, title: p.title, description: p.description, body: (p.body ?? '').slice(0, MAX_BODY_CHARS), type,
      downloads: p.downloads, follows: p.followers, categories: p.categories, loaders: p.loaders, gameVersions: p.game_versions,
      license: p.license?.name ?? null, updated: p.updated ?? null, iconDataUrl: await this.icon(p.icon_url, signal),
    };
  }

  /** Versions list for the project page (newest first). */
  async versionInfos(projectId: string, opts: { mcVersion?: string | null; loaders?: string[] | null }, signal?: AbortSignal): Promise<ModrinthVersionInfo[]> {
    const list = await this.get(this.versionsUrl(projectId, opts), z.array(versionDetailSchema), signal);
    return list.slice(0, MAX_VERSION_LIST).map((v) => {
      const f = v.files.find((x) => x.primary) ?? v.files[0];
      return {
        id: v.id, name: v.name, versionNumber: v.version_number, type: v.version_type,
        gameVersions: v.game_versions, loaders: v.loaders, published: v.date_published, downloads: v.downloads,
        changelog: (v.changelog ?? '').slice(0, MAX_CHANGELOG_CHARS),
        fileName: f?.filename ?? '', size: f?.size ?? 0,
        requiredDeps: v.dependencies.filter((d) => d.dependency_type === 'required' && d.project_id).length,
      };
    });
  }

  private async icon(url: string | null | undefined, signal?: AbortSignal): Promise<string | null> {
    if (!url) return null;
    try {
      const { res, entry } = await netRequest(url, { purpose: 'Иконка проекта', signal, headers: { 'User-Agent': this.userAgent } });
      const type = (res.headers.get('content-type') ?? '').split(';')[0]!.trim();
      if (!res.ok || !['image/png', 'image/jpeg', 'image/webp', 'image/gif'].includes(type)) {
        await res.body?.cancel().catch(() => undefined);
        return null;
      }
      const buf = Buffer.from(await res.arrayBuffer());
      entry.bytes = buf.length;
      if (buf.length > MAX_ICON_BYTES) return null;
      return `data:${type};base64,${buf.toString('base64')}`;
    } catch {
      return null; // a missing icon never breaks search
    }
  }

  async search(input: ModrinthSearchInput, signal?: AbortSignal): Promise<ModrinthSearchResult> {
    const qs = new URLSearchParams({
      query: input.query,
      facets: JSON.stringify(buildFacets(input)),
      index: input.sort,
      offset: String(input.offset),
      limit: String(PAGE_SIZE),
    });
    const r = await this.get(`${API}/search?${qs.toString()}`, searchSchema, signal);
    const hits: ModrinthHit[] = r.hits.map((h) => ({
      id: h.project_id, slug: h.slug, title: h.title, description: h.description, author: h.author,
      downloads: h.downloads, follows: h.follows, categories: h.display_categories ?? h.categories,
      type: (['mod', 'modpack', 'resourcepack'].includes(h.project_type) ? h.project_type : input.type) as ModrinthType,
      iconDataUrl: null,
    }));
    const icons = r.hits.map((h) => h.icon_url);
    await runPool(hits.map((_, i) => i), 6, async (i) => {
      hits[i]!.iconDataUrl = await this.icon(icons[i], signal);
    });
    return { hits, total: r.total_hits, offset: r.offset };
  }
}

// ---------------------------------------------------------------- installing a mod / resource pack

export interface PlanItem {
  projectId: string;
  title: string;
  version: MrVersion;
  file: MrFile;
  dest: string;
  /** the project the user clicked, as opposed to a dependency */
  requested: boolean;
}

export interface InstalledIndex { projects: Record<string, { file: string; versionId: string }> }
export const INDEX_FILE = '.chald-modrinth.json';

export async function readInstalled(gameDir: string): Promise<InstalledIndex> {
  try {
    const j = await readJson<InstalledIndex>(path.join(gameDir, INDEX_FILE));
    return j && typeof j.projects === 'object' && j.projects ? j : { projects: {} };
  } catch {
    return { projects: {} };
  }
}

/** Modrinth project ids installed in this game directory (the file must still exist). Dependencies count too. */
export async function listInstalledProjects(gameDir: string, kind: 'mod' | 'resourcepack'): Promise<string[]> {
  const dir = path.join(gameDir, kind === 'mod' ? 'mods' : 'resourcepacks');
  const installed = await readInstalled(gameDir);
  const out: string[] = [];
  for (const [projectId, info] of Object.entries(installed.projects)) {
    if (typeof info?.file !== 'string' || info.file.includes('/') || info.file.includes('\\')) continue;
    // a disabled mod is renamed to *.disabled, it is still installed
    if ((await exists(path.join(dir, info.file))) || (await exists(path.join(dir, `${info.file}.disabled`)))) out.push(projectId);
  }
  return out;
}

export interface InstallTarget {
  gameDir: string;
  mcVersion: string;
  loader: LoaderType;
  kind: 'mod' | 'resourcepack';
}

/** Works out which files must be downloaded: the project itself plus its required dependencies (mods only). */
/** `versionId` pins the version of the requested project itself; its dependencies are still resolved automatically. */
export async function planInstall(api: ModrinthLike, t: InstallTarget, projectId: string, signal?: AbortSignal, versionId?: string | null): Promise<PlanItem[]> {
  if (t.kind === 'mod' && t.loader === 'vanilla') {
    throw new AppError('LOADER_REQUIRED', 'Моды не работают в инстансе Vanilla. Создай инстанс с Fabric, Quilt, Forge или NeoForge.');
  }
  const dirName = t.kind === 'mod' ? 'mods' : 'resourcepacks';
  const ext = t.kind === 'mod' ? '.jar' : '.zip';
  const dir = path.join(t.gameDir, dirName);
  const installed = await readInstalled(t.gameDir);
  const loaders = t.kind === 'mod' ? loaderFilter(t.loader) : null;

  const plan: PlanItem[] = [];
  const seen = new Set<string>();
  const queue: { projectId: string; versionId: string | null; depth: number }[] = [{ projectId, versionId: versionId ?? null, depth: 0 }];

  while (queue.length) {
    const cur = queue.shift()!;
    if (seen.has(cur.projectId)) continue;
    seen.add(cur.projectId);
    const requested = cur.depth === 0;

    const have = installed.projects[cur.projectId];
    if (have && (await exists(path.join(dir, have.file)))) {
      if (requested) throw new AppError('ALREADY_INSTALLED', 'Этот проект уже установлен в инстансе. Чтобы поставить другую версию, сначала удали старый файл на вкладке «Моды» или «Ресурспаки».');
      continue;
    }

    const project = await api.project(cur.projectId, signal);
    let version: MrVersion | undefined;
    if (cur.versionId) {
      version = await api.version(cur.versionId, signal);
      if (version.project_id !== cur.projectId) throw new AppError('MODRINTH_FORMAT', 'Эта версия относится к другому проекту');
    } else {
      version = pickVersion(await api.versions(cur.projectId, { mcVersion: t.mcVersion, loaders }, signal));
    }
    if (!version) {
      const what = requested ? 'Для этого проекта' : `Для обязательной зависимости «${project.title}»`;
      throw new AppError('NO_COMPATIBLE_VERSION', `${what} нет версии под Minecraft ${t.mcVersion}${loaders ? ` и ${t.loader}` : ''}`);
    }

    const file = primaryFile(version);
    const name = safeFileName(file.filename);
    if (!name.toLowerCase().endsWith(ext)) throw new AppError('CONTENT_TYPE', `Ожидался файл ${ext}: ${name}`);
    plan.push({ projectId: cur.projectId, title: project.title, version, file, dest: resolveInside(dir, name), requested });

    if (t.kind === 'mod' && cur.depth < MAX_DEP_DEPTH) {
      for (const d of version.dependencies) {
        if (d.dependency_type === 'required' && d.project_id) {
          queue.push({ projectId: d.project_id, versionId: d.version_id ?? null, depth: cur.depth + 1 });
        }
      }
    }
  }
  return plan;
}

/** Downloads a plan. Never overwrites a different file that happens to have the same name. Returns the file names. */
export async function runInstallPlan(
  gameDir: string,
  kind: 'mod' | 'resourcepack',
  plan: PlanItem[],
  report: (label: string, fraction: number) => void,
  signal?: AbortSignal,
): Promise<string[]> {
  const index = await readInstalled(gameDir);
  const names: string[] = [];
  let done = 0;
  for (const item of plan) {
    const spec = { sha1: item.file.hashes.sha1, size: item.file.size };
    report(`Скачиваю: ${item.title}`, done / plan.length);
    if (!(await isFileValid(item.dest, spec)) && (await exists(item.dest))) {
      throw new AppError('CONTENT_EXISTS', `Файл с таким именем уже есть и отличается: ${path.basename(item.dest)}`);
    }
    await downloadFile({ url: item.file.url, dest: item.dest, ...spec, purpose: kind === 'mod' ? 'Мод Modrinth' : 'Ресурспак Modrinth' }, { signal });
    index.projects[item.projectId] = { file: path.basename(item.dest), versionId: item.version.id };
    names.push(path.basename(item.dest));
    done++;
  }
  await writeJsonAtomic(path.join(gameDir, INDEX_FILE), index);
  report('Готово', 1);
  return names;
}

// ---------------------------------------------------------------- modpack files

/** Downloads every client file of a pack. Tries the mirrors in order. */
export async function downloadPackFiles(
  plan: PackPlan,
  gameDir: string,
  report: (label: string, fraction: number) => void,
  signal?: AbortSignal,
): Promise<void> {
  const total = plan.files.length;
  let done = 0;
  await runPool(plan.files, 6, async (f) => {
    const dest = resolveInside(gameDir, ...f.rel.split('/'));
    let last: unknown;
    for (const url of f.urls) {
      try {
        await downloadFile({ url, dest, sha1: f.sha1, size: f.size, purpose: 'Файл сборки' }, { signal, retries: 2 });
        last = null;
        break;
      } catch (e) {
        if (signal?.aborted) throw e;
        last = e;
      }
    }
    if (last) throw last;
    done++;
    report(`Файлы сборки: ${done} из ${total}`, total ? done / total : 1);
  });
}
