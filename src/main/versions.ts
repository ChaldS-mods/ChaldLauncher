import * as path from 'node:path';
import type { LoaderType, LoaderVersionEntry, McVersionEntry } from '../shared/types';
import { AppError } from './errors';
import { netJson, netText } from './net';
import { readJson, writeJsonAtomic } from './storage';

export const MANIFEST_URL = 'https://piston-meta.mojang.com/mc/game/version_manifest_v2.json';

export interface ManifestVersion {
  id: string;
  type: McVersionEntry['type'];
  url: string;
  sha1: string;
  releaseTime: string;
}
interface Manifest { versions: ManifestVersion[] }

export class VersionCatalog {
  private manifest: Manifest | null = null;

  constructor(private cacheFile: string) {}

  /** Network first; on failure fall back to the last cached copy so the launcher works offline. */
  async getManifest(refresh = false): Promise<Manifest> {
    if (this.manifest && !refresh) return this.manifest;
    try {
      const m = await netJson<Manifest>(MANIFEST_URL, { purpose: 'Список версий Minecraft' });
      this.manifest = m;
      await writeJsonAtomic(this.cacheFile, m).catch(() => undefined);
      return m;
    } catch (e) {
      const cached = await readJson<Manifest>(this.cacheFile).catch(() => null);
      if (cached) {
        this.manifest = cached;
        return cached;
      }
      throw new AppError('VERSIONS_UNAVAILABLE', `Не удалось получить список версий: ${e instanceof Error ? e.message : e}`);
    }
  }

  async minecraft(refresh = false): Promise<McVersionEntry[]> {
    const m = await this.getManifest(refresh);
    return m.versions.map((v) => ({ id: v.id, type: v.type, releaseTime: v.releaseTime }));
  }

  async find(id: string): Promise<ManifestVersion> {
    const v = (await this.getManifest()).versions.find((x) => x.id === id);
    if (!v) throw new AppError('VERSION_UNKNOWN', `Версия Minecraft ${id} не найдена в официальном списке`);
    return v;
  }
}

/** Loaders whose launch profile comes ready-made from a meta API (a small json inheriting the vanilla version). */
const PROFILE_API = {
  fabric: { base: 'https://meta.fabricmc.net/v2/versions/loader', title: 'Fabric' },
  quilt: { base: 'https://meta.quiltmc.org/v3/versions/loader', title: 'Quilt' },
} as const;
export type ProfileLoader = keyof typeof PROFILE_API;

export function isProfileLoader(t: LoaderType): t is ProfileLoader {
  return t === 'fabric' || t === 'quilt';
}

export async function profileLoaders(loader: ProfileLoader, mcVersion: string): Promise<LoaderVersionEntry[]> {
  const { base, title } = PROFILE_API[loader];
  const list = await netJson<{ loader: { version: string; stable?: boolean } }[]>(
    `${base}/${encodeURIComponent(mcVersion)}`,
    { purpose: `Версии ${title}` },
  );
  return list.map((x) => ({
    version: x.loader.version,
    // Quilt has no "stable" flag: pre-releases are recognisable by their suffix
    stable: x.loader.stable ?? !/-(alpha|beta|rc|pre)/i.test(x.loader.version),
  }));
}

export function profileUrl(loader: ProfileLoader, mcVersion: string, loaderVersion: string): string {
  return `${PROFILE_API[loader].base}/${encodeURIComponent(mcVersion)}/${encodeURIComponent(loaderVersion)}/profile/json`;
}

export const fabricLoaders = (mcVersion: string) => profileLoaders('fabric', mcVersion);
export const fabricProfileUrl = (mcVersion: string, loaderVersion: string) => profileUrl('fabric', mcVersion, loaderVersion);

// ---- Forge / NeoForge: versions come from their maven, the install itself is done by forgeInstall.ts

const FORGE_METADATA = 'https://maven.minecraftforge.net/net/minecraftforge/forge/maven-metadata.xml';
const FORGE_PROMOS = 'https://files.minecraftforge.net/net/minecraftforge/forge/promotions_slim.json';
const NEOFORGE_VERSIONS = 'https://maven.neoforged.net/api/maven/versions/releases/net/neoforged/neoforge';

/** Numeric, segment-wise comparison ("52.0.9" < "52.0.40"); a suffix like "-beta" sorts below the plain release. */
export function compareVersions(a: string, b: string): number {
  const split = (v: string) => v.split(/[.-]/).map((x) => (/^\d+$/.test(x) ? Number(x) : x));
  const pa = split(a);
  const pb = split(b);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const x = pa[i];
    const y = pb[i];
    if (x === y) continue;
    if (x === undefined) return typeof y === 'string' ? 1 : -1;
    if (y === undefined) return typeof x === 'string' ? -1 : 1;
    if (typeof x === 'number' && typeof y === 'number') return x - y;
    return String(x).localeCompare(String(y));
  }
  return 0;
}

/** Forge's `net.minecraftforge:forge` installers with a `version.json` exist from Minecraft 1.13. */
export function forgeSupportsMc(mc: string): boolean {
  const old = /^1\.(\d+)(?:\.\d+)?$/.exec(mc);
  if (old) return Number(old[1]) >= 13;
  return /^\d{2,}\.\d+(?:\.\d+)?$/.test(mc) && Number(mc.split('.')[0]) >= 26;
}

/**
 * NeoForge versions start with the Minecraft version: 1.21.1 -> "21.1.", 1.21 -> "21.0.",
 * and since the year-based Minecraft versions 26.1 -> "26.1.0.", 26.1.2 -> "26.1.2.".
 * Returns null for versions NeoForge does not publish for (snapshots, 1.20.1 and older).
 */
export function neoforgePrefix(mc: string): string | null {
  const old = /^1\.(\d+)(?:\.(\d+))?$/.exec(mc);
  if (old) {
    const minor = Number(old[1]);
    const patch = Number(old[2] ?? 0);
    // 1.20.1 and older are served by Forge; NeoForge starts with 1.20.2
    return minor >= 21 || (minor === 20 && patch >= 2) ? `${minor}.${patch}.` : null;
  }
  const year = /^(\d{2,})\.(\d+)(?:\.(\d+))?$/.exec(mc);
  if (year && Number(year[1]) >= 26) return year[3] !== undefined ? `${mc}.` : `${mc}.0.`;
  return null;
}

export function parseForgeMetadata(xml: string, mc: string): string[] {
  const out: string[] = [];
  for (const m of xml.matchAll(/<version>([^<]+)<\/version>/g)) {
    const full = m[1]!.trim();
    if (full.startsWith(`${mc}-`)) out.push(full.slice(mc.length + 1));
  }
  return out;
}

export async function forgeLoaders(mcVersion: string): Promise<LoaderVersionEntry[]> {
  if (!forgeSupportsMc(mcVersion)) return [];
  const versions = parseForgeMetadata(await netText(FORGE_METADATA, 'Версии Forge'), mcVersion).sort((a, b) => compareVersions(b, a));
  let recommended: string | undefined;
  try {
    const promos = await netJson<{ promos?: Record<string, string> }>(FORGE_PROMOS, { purpose: 'Рекомендуемые версии Forge' });
    recommended = promos.promos?.[`${mcVersion}-recommended`];
  } catch {
    /* the promotions list is optional */
  }
  return versions.map((version) => ({ version, stable: true, recommended: version === recommended }));
}

export async function neoforgeLoaders(mcVersion: string): Promise<LoaderVersionEntry[]> {
  const prefix = neoforgePrefix(mcVersion);
  if (!prefix) return [];
  const data = await netJson<{ versions?: string[] }>(NEOFORGE_VERSIONS, { purpose: 'Версии NeoForge' });
  return (data.versions ?? [])
    .filter((v) => v.startsWith(prefix))
    .sort((a, b) => compareVersions(b, a))
    .map((version) => ({ version, stable: !/-(alpha|beta|rc|snapshot)/i.test(version) }));
}

export async function loaderVersions(loader: LoaderType, mcVersion: string): Promise<LoaderVersionEntry[]> {
  switch (loader) {
    case 'fabric':
    case 'quilt': return profileLoaders(loader, mcVersion);
    case 'forge': return forgeLoaders(mcVersion);
    case 'neoforge': return neoforgeLoaders(mcVersion);
    default: return [];
  }
}

/** Throws when the loader (or this exact version of it) does not exist for the Minecraft version. */
export async function assertLoaderCompatible(loader: Exclude<LoaderType, 'vanilla'>, mcVersion: string, loaderVersion: string): Promise<void> {
  const title = loader === 'neoforge' ? 'NeoForge' : loader[0]!.toUpperCase() + loader.slice(1);
  if (loader === 'forge' && !forgeSupportsMc(mcVersion)) {
    throw new AppError('LOADER_INCOMPATIBLE', 'Forge поддерживается для Minecraft 1.13 и новее');
  }
  let list: LoaderVersionEntry[];
  try {
    list = await loaderVersions(loader, mcVersion);
  } catch (e) {
    // No connection to the version list is not proof of incompatibility: the download of the loader itself
    // will report a real network problem, and an already cached installation can still work offline.
    if (e instanceof AppError && e.code === 'NET_FAILED') return;
    throw e;
  }
  if (list.length === 0) throw new AppError('LOADER_INCOMPATIBLE', `${title} не поддерживает Minecraft ${mcVersion}`);
  if (!list.some((l) => l.version === loaderVersion)) {
    throw new AppError('LOADER_INCOMPATIBLE', `${title} ${loaderVersion} не подходит для Minecraft ${mcVersion}`);
  }
}

export const assertFabricCompatible = (mcVersion: string, loaderVersion: string) => assertLoaderCompatible('fabric', mcVersion, loaderVersion);

export function versionPaths(versionsDir: string, id: string): { dir: string; json: string; jar: string } {
  const dir = path.join(versionsDir, id);
  return { dir, json: path.join(dir, `${id}.json`), jar: path.join(dir, `${id}.jar`) };
}
