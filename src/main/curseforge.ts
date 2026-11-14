import * as path from 'node:path';
import { z } from 'zod';
import type { LoaderType } from '../shared/types';
import { AppError } from './errors';
import { downloadFile, runPool } from './download';
import { netJson, netRequest } from './net';
import { safeFileName } from './paths';
import { exists, readJson, writeJsonAtomic } from './storage';

/** Public key used by Prism and many third-party launchers. */
const CF_API_KEY = '$2a$10$bL4bIL5pUWqfcO7KQtnMReakwtfHbNKh6v1uTpKlzhwoueEJQnPnm';
const API = 'https://api.curseforge.com';
const GAME_ID = 432;
const PAGE_SIZE = 20;
const MAX_ICON_BYTES = 256 * 1024;

export const CF_LOADER: Record<Exclude<LoaderType, 'vanilla'>, number> = {
  forge: 1,
  fabric: 4,
  quilt: 5,
  neoforge: 6,
};

export type CurseForgeClass = 'mod' | 'modpack' | 'resourcepack' | 'shader' | 'datapack';
const CLASS_ID: Record<CurseForgeClass, number> = {
  mod: 6,
  resourcepack: 12,
  modpack: 4471,
  shader: 6552,
  datapack: 6945,
};

export type CurseForgeSort = 'featured' | 'popularity' | 'lastUpdated' | 'name' | 'totalDownloads';
const SORT_FIELD: Record<CurseForgeSort, number> = {
  featured: 1,
  popularity: 2,
  lastUpdated: 3,
  name: 4,
  totalDownloads: 6,
};

const authorSchema = z.object({
  id: z.number().optional(),
  name: z.string().default(''),
}).passthrough();

const logoSchema = z
  .object({
    thumbnailUrl: z.string().nullish(),
    url: z.string().nullish(),
  })
  .passthrough()
  .nullish();

const modSchema = z
  .object({
    id: z.number(),
    name: z.string(),
    slug: z.string().default(''),
    summary: z.string().default(''),
    downloadCount: z.number().default(0),
    authors: z.array(authorSchema).default([]),
    logo: logoSchema,
    classId: z.number().optional(),
    dateModified: z.string().optional(),
    links: z.object({ websiteUrl: z.string().optional() }).passthrough().optional(),
  })
  .passthrough();

const searchResponseSchema = z
  .object({
    data: z.array(modSchema),
    pagination: z
      .object({
        index: z.number().default(0),
        pageSize: z.number().default(PAGE_SIZE),
        resultCount: z.number().default(0),
        totalCount: z.number().default(0),
      })
      .passthrough(),
  })
  .passthrough();

const hashSchema = z.object({ value: z.string(), algo: z.number() }).passthrough();

const fileSchema = z
  .object({
    id: z.number(),
    displayName: z.string().default(''),
    fileName: z.string(),
    fileDate: z.string().default(''),
    fileLength: z.number().default(0),
    downloadCount: z.number().default(0),
    downloadUrl: z.string().nullish(),
    gameVersions: z.array(z.string()).default([]),
    releaseType: z.number().default(1),
    hashes: z.array(hashSchema).default([]),
    isAvailable: z.boolean().default(true),
  })
  .passthrough();

const filesResponseSchema = z
  .object({
    data: z.array(fileSchema),
    pagination: z
      .object({
        index: z.number().default(0),
        pageSize: z.number().default(50),
        resultCount: z.number().default(0),
        totalCount: z.number().default(0),
      })
      .passthrough(),
  })
  .passthrough();

export interface CfSearchInput {
  query: string;
  classType: CurseForgeClass;
  mcVersion: string | null;
  loader: Exclude<LoaderType, 'vanilla'> | null;
  sort: CurseForgeSort;
  offset: number;
}

export interface CfHit {
  id: number;
  slug: string;
  title: string;
  description: string;
  author: string;
  downloads: number;
  type: CurseForgeClass;
  iconDataUrl: string | null;
  websiteUrl: string | null;
}

export interface CfSearchResult {
  hits: CfHit[];
  total: number;
  offset: number;
}

export interface CfFileInfo {
  id: number;
  fileName: string;
  displayName: string;
  size: number;
  downloads: number;
  published: string;
  releaseType: 'release' | 'beta' | 'alpha';
  gameVersions: string[];
  downloadUrl: string | null;
  sha1: string | null;
}

export interface CfProjectInfo {
  id: number;
  slug: string;
  title: string;
  description: string;
  /** HTML body from /description endpoint */
  bodyHtml: string;
  author: string;
  downloads: number;
  type: CurseForgeClass;
  iconDataUrl: string | null;
  websiteUrl: string | null;
  updated: string | null;
  gameVersions: string[];
  loaders: string[];
}

function parse<T>(schema: z.ZodType<T>, data: unknown, label: string): T {
  const r = schema.safeParse(data);
  if (!r.success) throw new AppError('CF_FORMAT', `CurseForge вернул неожиданный ответ (${label})`);
  return r.data;
}


/** CurseForge fingerprint: MurmurHash2 (seed 1) over file bytes with whitespace stripped. */
export function cfFingerprint(buf: Buffer): number {
  const filtered = Buffer.allocUnsafe(buf.length);
  let n = 0;
  for (let i = 0; i < buf.length; i++) {
    const b = buf[i]!;
    if (b !== 0x09 && b !== 0x0a && b !== 0x0d && b !== 0x20) filtered[n++] = b;
  }
  return murmur2(filtered.subarray(0, n), 1);
}

function murmur2(data: Buffer, seed: number): number {
  const m = 0x5bd1e995;
  let len = data.length;
  let h = seed ^ len;
  let i = 0;
  while (len >= 4) {
    let k =
      (data[i]! | (data[i + 1]! << 8) | (data[i + 2]! << 16) | (data[i + 3]! << 24)) >>> 0;
    k = Math.imul(k, m) >>> 0;
    k = (k ^ (k >>> 24)) >>> 0;
    k = Math.imul(k, m) >>> 0;
    h = Math.imul(h, m) >>> 0;
    h = (h ^ k) >>> 0;
    i += 4;
    len -= 4;
  }
  switch (len) {
    case 3:
      h = (h ^ (data[i + 2]! << 16)) >>> 0;
    // fallthrough
    case 2:
      h = (h ^ (data[i + 1]! << 8)) >>> 0;
    // fallthrough
    case 1:
      h = (h ^ data[i]!) >>> 0;
      h = Math.imul(h, m) >>> 0;
  }
  h = (h ^ (h >>> 13)) >>> 0;
  h = Math.imul(h, m) >>> 0;
  h = (h ^ (h >>> 15)) >>> 0;
  return h >>> 0;
}

export interface CfFingerprintMatch {
  modId: number;
  fileId: number;
  fileName: string;
  downloadUrl: string | null;
  size: number;
  sha1: string | null;
  fingerprint: number;
}


export class CurseForgeApi {
  constructor(private userAgent: string) {}

  private headers(): Record<string, string> {
    return {
      'x-api-key': CF_API_KEY,
      Accept: 'application/json',
      'User-Agent': this.userAgent,
    };
  }

  private async getRaw(url: string, signal?: AbortSignal): Promise<unknown> {
    return netJson(url, {
      purpose: 'CurseForge API',
      signal,
      headers: this.headers(),
    });
  }

  private async icon(url: string | null | undefined, signal?: AbortSignal): Promise<string | null> {
    if (!url) return null;
    try {
      const { res, entry } = await netRequest(url, {
        purpose: 'Иконка CurseForge',
        signal,
        headers: { 'User-Agent': this.userAgent, Accept: 'image/webp,image/png,image/jpeg,image/gif,*/*' },
      });
      if (!res.ok) {
        await res.body?.cancel().catch(() => undefined);
        return null;
      }
      const buf = Buffer.from(await res.arrayBuffer());
      entry.bytes = buf.length;
      if (buf.length < 16 || buf.length > MAX_ICON_BYTES) return null;
      let type = (res.headers.get('content-type') ?? '').split(';')[0]!.trim().toLowerCase();
      if (!['image/png', 'image/jpeg', 'image/webp', 'image/gif'].includes(type)) {
        if (buf[0] === 0x89 && buf[1] === 0x50) type = 'image/png';
        else if (buf[0] === 0xff && buf[1] === 0xd8) type = 'image/jpeg';
        else if (buf[0] === 0x47 && buf[1] === 0x49) type = 'image/gif';
        else if (buf[0] === 0x52 && buf[1] === 0x49 && buf[8] === 0x57) type = 'image/webp';
        else return null;
      }
      return `data:${type};base64,${buf.toString('base64')}`;
    } catch {
      return null;
    }
  }

  private classFromId(classId?: number): CurseForgeClass {
    if (classId === 12) return 'resourcepack';
    if (classId === 4471) return 'modpack';
    if (classId === 6552) return 'shader';
    if (classId === 6945) return 'datapack';
    return 'mod';
  }

  async search(input: CfSearchInput, signal?: AbortSignal, opts: { icons?: boolean } = {}): Promise<CfSearchResult> {
    const qs = new URLSearchParams();
    qs.set('gameId', String(GAME_ID));
    qs.set('classId', String(CLASS_ID[input.classType]));
    qs.set('pageSize', String(PAGE_SIZE));
    qs.set('index', String(input.offset));
    qs.set('sortField', String(SORT_FIELD[input.sort]));
    qs.set('sortOrder', 'desc');
    if (input.query.trim()) qs.set('searchFilter', input.query.trim());
    if (input.mcVersion) qs.set('gameVersion', input.mcVersion);
    if (input.loader && input.classType === 'mod') {
      qs.set('modLoaderType', String(CF_LOADER[input.loader]));
    }

    const raw = await this.getRaw(`${API}/v1/mods/search?${qs}`, signal);
    const r = parse(searchResponseSchema, raw, 'search');

    const hits: CfHit[] = r.data.map((m) => ({
      id: m.id,
      slug: m.slug || String(m.id),
      title: m.name,
      description: m.summary,
      author: m.authors[0]?.name ?? '',
      downloads: m.downloadCount,
      type: this.classFromId(m.classId) || input.classType,
      iconDataUrl: null,
      websiteUrl: m.links?.websiteUrl ?? null,
    }));

    if (opts.icons !== false) {
      const icons = r.data.map((m) => m.logo?.thumbnailUrl || m.logo?.url || null);
      await runPool(
        hits.map((_, i) => i),
        6,
        async (i) => {
          hits[i]!.iconDataUrl = await this.icon(icons[i], signal);
        },
      );
    }

    return { hits, total: r.pagination.totalCount, offset: r.pagination.index };
  }

  async getMod(modId: number, signal?: AbortSignal): Promise<CfProjectInfo> {
    const [raw, descRaw] = await Promise.all([
      this.getRaw(`${API}/v1/mods/${modId}`, signal),
      this.getRaw(`${API}/v1/mods/${modId}/description`, signal).catch(() => null),
    ]);
    const body = parse(z.object({ data: modSchema }).passthrough(), raw, 'mod');
    const m = body.data;
    let bodyHtml = '';
    if (descRaw) {
      const d = parse(z.object({ data: z.string() }).passthrough(), descRaw, 'description');
      bodyHtml = d.data;
    }
    const indexes = (m as { latestFilesIndexes?: { gameVersion?: string; modLoader?: number }[] }).latestFilesIndexes ?? [];
    const gameVersions = [...new Set(indexes.map((i) => i.gameVersion).filter(Boolean) as string[])].slice(0, 20);
    const loaderMap: Record<number, string> = { 1: 'Forge', 4: 'Fabric', 5: 'Quilt', 6: 'NeoForge' };
    const loaders = [...new Set(indexes.map((i) => loaderMap[i.modLoader ?? -1]).filter(Boolean) as string[])];
    return {
      id: m.id,
      slug: m.slug || String(m.id),
      title: m.name,
      description: m.summary,
      bodyHtml,
      author: m.authors[0]?.name ?? '',
      downloads: m.downloadCount,
      type: this.classFromId(m.classId),
      iconDataUrl: await this.icon(m.logo?.thumbnailUrl || m.logo?.url, signal),
      websiteUrl: m.links?.websiteUrl ?? null,
      updated: m.dateModified ?? null,
      gameVersions,
      loaders,
    };
  }

  async files(
    modId: number,
    opts: { mcVersion?: string | null; loader?: Exclude<LoaderType, 'vanilla'> | null; pageSize?: number } = {},
    signal?: AbortSignal,
  ): Promise<CfFileInfo[]> {
    const qs = new URLSearchParams();
    qs.set('pageSize', String(opts.pageSize ?? 50));
    qs.set('index', '0');
    if (opts.mcVersion) qs.set('gameVersion', opts.mcVersion);
    if (opts.loader) qs.set('modLoaderType', String(CF_LOADER[opts.loader]));

    const raw = await this.getRaw(`${API}/v1/mods/${modId}/files?${qs}`, signal);
    const body = parse(filesResponseSchema, raw, 'files');

    return body.data
      .filter((f) => f.isAvailable !== false)
      .map((f) => {
        const sha1 = f.hashes.find((h) => h.algo === 1)?.value ?? null;
        const releaseType: CfFileInfo['releaseType'] =
          f.releaseType === 1 ? 'release' : f.releaseType === 2 ? 'beta' : 'alpha';
        return {
          id: f.id,
          fileName: f.fileName,
          displayName: f.displayName || f.fileName,
          size: f.fileLength,
          downloads: f.downloadCount,
          published: f.fileDate,
          releaseType,
          gameVersions: f.gameVersions,
          downloadUrl: f.downloadUrl ?? null,
          sha1,
        };
      });
  }


  /** POST /v1/fingerprints — match local jars to CurseForge files. */
  async identifyByFingerprints(
    fingerprints: number[],
    signal?: AbortSignal,
  ): Promise<Map<number, CfFingerprintMatch>> {
    const out = new Map<number, CfFingerprintMatch>();
    if (!fingerprints.length) return out;
    // API accepts up to ~1000; keep batches modest
    const BATCH = 100;
    for (let i = 0; i < fingerprints.length; i += BATCH) {
      const batch = fingerprints.slice(i, i + BATCH);
      const raw = await netJson(`${API}/v1/fingerprints`, {
        purpose: 'CurseForge fingerprints',
        signal,
        method: 'POST',
        idempotent: true,
        headers: { ...this.headers(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ fingerprints: batch }),
      });
      const parsed = z
        .object({
          data: z
            .object({
              exactMatches: z
                .array(
                  z
                    .object({
                      id: z.number(),
                      file: z
                        .object({
                          id: z.number(),
                          fileName: z.string(),
                          downloadUrl: z.string().nullish(),
                          fileLength: z.number().default(0),
                          hashes: z.array(z.object({ value: z.string(), algo: z.number() }).passthrough()).default([]),
                          fileFingerprint: z.number().optional(),
                          modId: z.number().optional(),
                        })
                        .passthrough(),
                    })
                    .passthrough(),
                )
                .default([]),
            })
            .passthrough(),
        })
        .passthrough()
        .safeParse(raw);
      if (!parsed.success) continue;
      for (const m of parsed.data.data.exactMatches) {
        const f = m.file;
        const sha1 = f.hashes.find((h) => h.algo === 1)?.value?.toLowerCase() ?? null;
        const fp = f.fileFingerprint ?? m.id;
        out.set(fp, {
          modId: f.modId ?? m.id,
          fileId: f.id,
          fileName: f.fileName,
          downloadUrl: f.downloadUrl ?? null,
          size: f.fileLength,
          sha1,
          fingerprint: fp,
        });
      }
    }
    return out;
  }

  resolveDownloadUrl(file: { id: number; fileName: string; downloadUrl: string | null }): string {
    if (file.downloadUrl) return file.downloadUrl;
    // CurseForge CDN layout: /files/{id/1000}/{id%1000}/{fileName}
    // Some API responses omit downloadUrl (null) even for free files — CDN still works.
    const id = file.id;
    const a = Math.floor(id / 1000);
    const b = id % 1000;
    return `https://edge.forgecdn.net/files/${a}/${b}/${encodeURIComponent(file.fileName)}`;
  }

  /** Single file metadata (needed when downloading pack dependencies by projectID/fileID). */
  async getFile(modId: number, fileId: number, signal?: AbortSignal): Promise<CfFileInfo> {
    const raw = await this.getRaw(`${API}/v1/mods/${modId}/files/${fileId}`, signal);
    const body = parse(z.object({ data: fileSchema }).passthrough(), raw, 'file');
    const f = body.data;
    const sha1 = f.hashes.find((h) => h.algo === 1)?.value ?? null;
    const releaseType: CfFileInfo['releaseType'] =
      f.releaseType === 1 ? 'release' : f.releaseType === 2 ? 'beta' : 'alpha';
    return {
      id: f.id,
      fileName: f.fileName,
      displayName: f.displayName || f.fileName,
      size: f.fileLength,
      downloads: f.downloadCount,
      published: f.fileDate,
      releaseType,
      gameVersions: f.gameVersions,
      downloadUrl: f.downloadUrl ?? null,
      sha1,
    };
  }
}

/** Parsed CurseForge modpack manifest.json (minecraftModpack). */
export interface CfModpackManifest {
  name: string;
  version: string;
  mcVersion: string;
  loader: { type: LoaderType; version: string | null };
  files: { projectID: number; fileID: number; required: boolean }[];
  overrides: string;
}

export function parseCfModpackManifest(raw: string): CfModpackManifest {
  let j: unknown;
  try {
    j = JSON.parse(raw);
  } catch {
    throw new AppError('PACK_INVALID', 'manifest.json сборки CurseForge повреждён');
  }
  const o = z
    .object({
      name: z.string().default('CurseForge pack'),
      version: z.string().default(''),
      manifestType: z.string().optional(),
      overrides: z.string().default('overrides'),
      minecraft: z
        .object({
          version: z.string(),
          modLoaders: z
            .array(z.object({ id: z.string(), primary: z.boolean().optional() }).passthrough())
            .default([]),
        })
        .passthrough(),
      files: z
        .array(
          z
            .object({
              projectID: z.number(),
              fileID: z.number(),
              required: z.boolean().optional(),
            })
            .passthrough(),
        )
        .default([]),
    })
    .passthrough()
    .safeParse(j);
  if (!o.success) throw new AppError('PACK_INVALID', 'Некорректный manifest.json CurseForge');
  if (o.data.manifestType && o.data.manifestType !== 'minecraftModpack') {
    throw new AppError('PACK_INVALID', 'Это не сборка Minecraft (minecraftModpack)');
  }
  const loaders = o.data.minecraft.modLoaders;
  const primary = loaders.find((l) => l.primary) ?? loaders[0];
  let type: LoaderType = 'vanilla';
  let version: string | null = null;
  if (primary?.id) {
    const id = primary.id.toLowerCase();
    // e.g. "forge-47.2.0", "fabric-0.16.5", "neoforge-21.1.1", "quilt-0.26"
    const m = id.match(/^(neoforge|forge|fabric|quilt)-(.+)$/i);
    if (m) {
      type = m[1]!.toLowerCase() as LoaderType;
      version = m[2]!;
    }
  }
  return {
    name: o.data.name || 'CurseForge pack',
    version: o.data.version,
    mcVersion: o.data.minecraft.version,
    loader: { type, version },
    files: o.data.files.map((f) => ({
      projectID: f.projectID,
      fileID: f.fileID,
      required: f.required !== false,
    })),
    overrides: (o.data.overrides || 'overrides').replace(/^\/+|\/+$/g, '') || 'overrides',
  };
}

export interface CfInstalledIndex {
  projects: Record<string, { file: string; fileId: number }>;
}
export const CF_INDEX_FILE = '.chald-curseforge.json';

export async function readCfInstalled(gameDir: string): Promise<CfInstalledIndex> {
  try {
    const j = await readJson<CfInstalledIndex>(path.join(gameDir, CF_INDEX_FILE));
    return j && typeof j.projects === 'object' && j.projects ? j : { projects: {} };
  } catch {
    return { projects: {} };
  }
}

function cfDirName(kind: 'mod' | 'resourcepack' | 'shader' | 'datapack'): string {
  switch (kind) {
    case 'mod': return 'mods';
    case 'resourcepack': return 'resourcepacks';
    case 'shader': return 'shaderpacks';
    case 'datapack': return 'datapacks';
  }
}

export async function listCfInstalled(gameDir: string, kind: 'mod' | 'resourcepack' | 'shader' | 'datapack'): Promise<number[]> {
  const dir = path.join(gameDir, cfDirName(kind));
  const installed = await readCfInstalled(gameDir);
  const out: number[] = [];
  for (const [projectId, info] of Object.entries(installed.projects)) {
    if (typeof info?.file !== 'string') continue;
    if ((await exists(path.join(dir, info.file))) || (await exists(path.join(dir, `${info.file}.disabled`)))) {
      out.push(Number(projectId));
    }
  }
  return out;
}

export async function installCfFile(opts: {
  api: CurseForgeApi;
  gameDir: string;
  kind: 'mod' | 'resourcepack' | 'shader' | 'datapack';
  modId: number;
  fileId?: number | null;
  mcVersion: string;
  loader: LoaderType;
  /** required for datapack — world folder under saves/ */
  worldName?: string | null;
  signal?: AbortSignal;
}): Promise<string> {
  const { api, gameDir, kind, modId, signal } = opts;
  if (kind === 'mod' && opts.loader === 'vanilla') {
    throw new AppError('LOADER_REQUIRED', 'Моды не работают в инстансе Vanilla. Создай инстанс с Fabric, Quilt, Forge или NeoForge.');
  }

  const loader = opts.loader === 'vanilla' ? null : opts.loader;
  let file: CfFileInfo | undefined;

  if (opts.fileId) {
    const all = await api.files(modId, { pageSize: 50 }, signal);
    file = all.find((f) => f.id === opts.fileId);
  } else {
    const files = await api.files(modId, { mcVersion: opts.mcVersion, loader, pageSize: 50 }, signal);
    file =
      files.find((f) => f.releaseType === 'release') ??
      files.find((f) => f.releaseType === 'beta') ??
      files[0];
  }

  if (!file) throw new AppError('CF_NO_FILE', 'Подходящий файл CurseForge не найден для этой версии / загрузчика');

  let dir: string;
  if (kind === 'datapack') {
    const world = (opts.worldName ?? '').trim();
    if (!world || world.includes('/') || world.includes('\\') || world.includes('..')) {
      throw new AppError('CF_WORLD', 'Выбери мир для установки датапака');
    }
    dir = path.join(gameDir, 'saves', world, 'datapacks');
  } else {
    dir = path.join(gameDir, cfDirName(kind));
  }
  const destName = safeFileName(file.fileName);
  const dest = path.join(dir, destName);
  const url = api.resolveDownloadUrl(file);

  await downloadFile(
    {
      url,
      dest,
      sha1: file.sha1 ?? undefined,
      size: file.size || undefined,
      purpose: kind === 'mod' ? 'Мод CurseForge' : kind === 'shader' ? 'Шейдер CurseForge' : kind === 'datapack' ? 'Датапак CurseForge' : 'Ресурспак CurseForge',
    },
    { signal },
  );

  const index = await readCfInstalled(gameDir);
  index.projects[String(modId)] = { file: destName, fileId: file.id };
  await writeJsonAtomic(path.join(gameDir, CF_INDEX_FILE), index);
  return destName;
}
