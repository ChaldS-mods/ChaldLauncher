import * as fs from 'node:fs/promises';
import { constants as fsc } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import type { CreateInstanceInput } from '../shared/schemas';
import { LAUNCHER_NAMES, type LauncherId } from '../shared/launchers';
import type { LoaderType } from '../shared/types';
import { AppError } from './errors';
import { runPool } from './download';
import { resolveInside } from './paths';
import { exists, readJson } from './storage';
import { compareVersions, forgeSupportsMc, neoforgePrefix } from './versions';

/**
 * Reads instances of other launchers (Prism / PolyMC / MultiMC, Modrinth App, CurseForge, the official launcher) and
 * copies their game folders. The source is only ever READ: nothing in the other launcher is changed or removed.
 */

export interface RawInstance {
  /** launcher whose format this instance was read from */
  launcher: LauncherId;
  name: string;
  description: string;
  /** the instance folder in the source launcher */
  dir: string;
  /** folder with saves/, mods/, options.txt… */
  gameDir: string;
  mcVersion: string;
  loader: { type: LoaderType; version: string | null };
  /** why it cannot be imported; null = fine */
  problem: string | null;
  settings: { memoryMinMb: number | null; memoryMaxMb: number | null; jvmArgs: string; width: number | null; height: number | null; fullscreen: boolean | null };
  lastPlayedAt: string | null;
  /** image file used as the cover (only .png/.jpg/.webp up to 1 MB is accepted later) */
  iconFile: string | null;
  mods: number;
  worlds: number;
  /** CurseForge only: mod id -> installed file, so «update mods» keeps working after the import */
  cfIndex: Record<string, { file: string; fileId: number }> | null;
}

export interface DetectEnv {
  platform: NodeJS.Platform;
  home: string;
  /** %APPDATA% on Windows, ~/Library/Application Support on macOS, ~/.config on Linux */
  appData: string;
  documents: string;
  /** $XDG_DATA_HOME or ~/.local/share (Linux) */
  xdgData: string;
}

export function defaultEnv(over: Partial<DetectEnv> = {}): DetectEnv {
  const home = over.home ?? os.homedir();
  const platform = over.platform ?? process.platform;
  return {
    platform,
    home,
    appData: over.appData ?? (platform === 'win32' ? (process.env.APPDATA ?? path.join(home, 'AppData', 'Roaming')) : platform === 'darwin' ? path.join(home, 'Library', 'Application Support') : path.join(home, '.config')),
    documents: over.documents ?? path.join(home, 'Documents'),
    xdgData: over.xdgData ?? process.env.XDG_DATA_HOME ?? path.join(home, '.local', 'share'),
  };
}

// ---------------------------------------------------------------- small parsers

/** `[General]` + `key=value` lines, the format of instance.cfg / prismlauncher.cfg. */
export function parseCfg(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const raw of text.replace(/^\uFEFF/, '').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#') || line.startsWith(';') || line.startsWith('[')) continue;
    const eq = line.indexOf('=');
    if (eq <= 0) continue;
    out[line.slice(0, eq).trim()] = line.slice(eq + 1).trim();
  }
  return out;
}

const MC_RE = /^[0-9A-Za-z._+-]{1,40}$/;

/** Path as a comparison key (Windows paths are case-insensitive). */
function norm(p: string): string {
  const r = path.resolve(p);
  return process.platform === 'win32' ? r.toLowerCase() : r;
}

function cleanText(s: string, max: number): string {
  // eslint-disable-next-line no-control-regex
  return s.replace(/[\x00-\x1f\x7f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
}

function toInt(v: unknown): number | null {
  const n = typeof v === 'number' ? v : typeof v === 'string' && /^\d+$/.test(v.trim()) ? Number(v) : NaN;
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : null;
}

function memoryOrNull(mb: number | null): number | null {
  return mb !== null && mb >= 256 && mb <= 65536 ? mb : null;
}

/** ms or seconds since the epoch (or an ISO string) -> ISO date; null when it is not a sensible time. */
export function toIso(v: unknown): string | null {
  let ms: number;
  if (typeof v === 'number') ms = v < 1e11 ? v * 1000 : v;
  else if (typeof v === 'string' && /^\d+$/.test(v)) ms = Number(v) < 1e11 ? Number(v) * 1000 : Number(v);
  else if (typeof v === 'string') ms = Date.parse(v);
  else return null;
  if (!Number.isFinite(ms) || ms < Date.UTC(2009, 0, 1) || ms > Date.now() + 86_400_000) return null;
  return new Date(ms).toISOString();
}

const LOADER_BY_UID: Record<string, LoaderType> = {
  'net.fabricmc.fabric-loader': 'fabric',
  'org.quiltmc.quilt-loader': 'quilt',
  'net.minecraftforge': 'forge',
  'net.neoforged': 'neoforge',
};

/** Forge/NeoForge sources sometimes write «1.20.1-47.2.0» or «neoforge-20.4.1»: Chald wants the bare version. */
export function bareLoaderVersion(type: LoaderType, mc: string, v: string): string {
  let out = v.trim();
  if (type === 'neoforge') out = out.replace(/^neoforge-/i, '');
  if (type === 'forge') out = out.replace(/^forge-/i, '');
  if (out.startsWith(`${mc}-`)) out = out.slice(mc.length + 1);
  return out;
}

function asLoaderType(v: unknown): LoaderType | null {
  const s = String(v ?? '').toLowerCase().replace(/[\s_-]/g, '');
  if (s === 'vanilla' || s === '') return 'vanilla';
  if (s === 'fabric' || s === 'quilt' || s === 'forge' || s === 'neoforge') return s;
  return null;
}

/** Minecraft + loader from the components of mmc-pack.json (Prism / PolyMC / MultiMC). */
export function parseMmcPack(json: unknown): { mcVersion: string; loader: RawInstance['loader'] } | { problem: string } {
  const comps = (json as { components?: unknown })?.components;
  if (!Array.isArray(comps)) return { problem: 'mmc-pack.json повреждён' };
  let mc = '';
  let loader: RawInstance['loader'] = { type: 'vanilla', version: null };
  for (const c of comps as { uid?: unknown; version?: unknown; cachedVersion?: unknown }[]) {
    const uid = typeof c?.uid === 'string' ? c.uid : '';
    const version = typeof c?.version === 'string' ? c.version : typeof c?.cachedVersion === 'string' ? c.cachedVersion : '';
    if (uid === 'net.minecraft') mc = version;
    else if (uid === 'com.mumfrey.liteloader') return { problem: 'LiteLoader не поддерживается' };
    else if (LOADER_BY_UID[uid]) loader = { type: LOADER_BY_UID[uid]!, version: version || null };
  }
  if (!mc) return { problem: 'В сборке не указана версия Minecraft' };
  if (loader.version) loader = { type: loader.type, version: bareLoaderVersion(loader.type, mc, loader.version) };
  return { mcVersion: mc, loader };
}

/** NeoForge «20.4.237» -> Minecraft 1.20.4, «21.0.5» -> 1.21, «26.1.2.3» -> 26.1.2 (the inverse of neoforgePrefix). */
export function neoforgeToMc(version: string): string | null {
  const m = /^(\d+)\.(\d+)(?:\.(\d+))?/.exec(version);
  if (!m) return null;
  const a = Number(m[1]);
  const b = Number(m[2]);
  if (a >= 26) {
    const c = Number(m[3] ?? 0);
    return c > 0 ? `${a}.${b}.${c}` : `${a}.${b}`;
  }
  return b > 0 ? `1.${a}.${b}` : `1.${a}`;
}

/** Version id of the official launcher («fabric-loader-0.15.7-1.20.1», «1.20.1-forge-47.2.0», «neoforge-20.4.237»…). */
export function parseVersionId(id: string): { mcVersion: string; loader: RawInstance['loader'] } | { problem: string } {
  const s = id.trim();
  if (!s) return { problem: 'Не указана версия' };
  if (/optifine/i.test(s)) return { problem: 'Профили OptiFine не поддерживаются (поставь OptiFine как мод)' };
  let m = /^(fabric|quilt)-loader-(\d[\w.+]*?)-(\d.+|\d{2}w.+)$/i.exec(s);
  if (m) return { mcVersion: m[3]!, loader: { type: m[1]!.toLowerCase() as LoaderType, version: m[2]! } };
  m = /^(.+?)-forge-?(?:\1-)?(\d[\d.]*)$/i.exec(s);
  if (m) return { mcVersion: m[1]!, loader: { type: 'forge', version: m[2]! } };
  m = /^neoforge-(\d[\w.+-]*)$/i.exec(s);
  if (m) {
    const mc = neoforgeToMc(m[1]!);
    return mc ? { mcVersion: mc, loader: { type: 'neoforge', version: m[1]! } } : { problem: `Не удалось определить версию Minecraft для ${s}` };
  }
  if (/^latest-/.test(s)) return { problem: 'Профиль без конкретной версии' };
  if (/forge|fabric|quilt|liteloader|rift/i.test(s)) return { problem: `Неизвестный профиль загрузчика: ${s}` };
  return { mcVersion: s, loader: { type: 'vanilla', version: null } };
}

/** Loader / version of a CurseForge instance (minecraftinstance.json). */
export function parseCfLoader(inst: { gameVersion?: unknown; baseModLoader?: unknown }): { mcVersion: string; loader: RawInstance['loader'] } | { problem: string } {
  const base = (inst.baseModLoader ?? null) as { name?: unknown; minecraftVersion?: unknown; forgeVersion?: unknown; type?: unknown } | null;
  const mc = String(inst.gameVersion || base?.minecraftVersion || '').trim();
  if (!mc) return { problem: 'Не указана версия Minecraft' };
  if (!base || typeof base !== 'object') return { mcVersion: mc, loader: { type: 'vanilla', version: null } };
  const name = typeof base.name === 'string' ? base.name.trim() : '';
  const byName = /^(forge|fabric|quilt|neoforge)-(.+)$/i.exec(name);
  const byType = ({ 1: 'forge', 4: 'fabric', 5: 'quilt', 6: 'neoforge' } as Record<number, LoaderType>)[Number(base.type)];
  const type = (byName ? (byName[1]!.toLowerCase() as LoaderType) : byType) ?? null;
  if (!type) return name ? { problem: `Неизвестный загрузчик: ${name}` } : { mcVersion: mc, loader: { type: 'vanilla', version: null } };
  let version = byName ? byName[2]! : typeof base.forgeVersion === 'string' ? base.forgeVersion : '';
  // «fabric-0.15.7-1.20.1»: the Minecraft version is appended
  if (version.endsWith(`-${mc}`)) version = version.slice(0, -(mc.length + 1));
  return { mcVersion: mc, loader: { type, version: version ? bareLoaderVersion(type, mc, version) : null } };
}

/** Reasons the launcher cannot install this version; null = ok. */
export function checkImportable(r: Pick<RawInstance, 'mcVersion' | 'loader'>): string | null {
  if (!MC_RE.test(r.mcVersion)) return `Некорректная версия Minecraft: ${cleanText(r.mcVersion, 30)}`;
  const { type, version } = r.loader;
  if (type !== 'vanilla' && !version) return 'Не указана версия загрузчика';
  if (type === 'forge' && !forgeSupportsMc(r.mcVersion)) return `Forge для Minecraft ${r.mcVersion} не поддерживается (нужна 1.13 или новее)`;
  if (type === 'neoforge' && !neoforgePrefix(r.mcVersion)) return `NeoForge для Minecraft ${r.mcVersion} недоступен`;
  return null;
}

// ---------------------------------------------------------------- folder helpers

async function listDirs(dir: string): Promise<string[]> {
  try {
    return (await fs.readdir(dir, { withFileTypes: true })).filter((e) => e.isDirectory()).map((e) => e.name);
  } catch {
    return [];
  }
}

async function readJsonSafe<T>(file: string): Promise<T | null> {
  try {
    return await readJson<T>(file);
  } catch {
    return null;
  }
}

async function countContent(gameDir: string): Promise<{ mods: number; worlds: number }> {
  let mods = 0;
  try {
    mods = (await fs.readdir(path.join(gameDir, 'mods'), { withFileTypes: true })).filter((e) => e.isFile() && /\.jar(\.disabled)?$/i.test(e.name)).length;
  } catch { /* no mods folder */ }
  const worlds = (await listDirs(path.join(gameDir, 'saves'))).filter((n) => !n.startsWith('.')).length;
  return { mods, worlds };
}

const IMAGE_EXT = ['.png', '.jpg', '.jpeg', '.webp'];

async function findIcon(dir: string, base: string): Promise<string | null> {
  for (const ext of IMAGE_EXT) {
    const f = path.join(dir, base + ext);
    if (await exists(f)) return f;
  }
  return null;
}

function emptySettings(): RawInstance['settings'] {
  return { memoryMinMb: null, memoryMaxMb: null, jvmArgs: '', width: null, height: null, fullscreen: null };
}

async function finish(r: Omit<RawInstance, 'mods' | 'worlds' | 'problem'> & { problem?: string | null }): Promise<RawInstance> {
  const counts = await countContent(r.gameDir);
  const problem = r.problem ?? checkImportable(r);
  return { ...r, ...counts, problem };
}

/** The folder with the game files inside a MultiMC-style instance. */
async function mmcGameDir(dir: string): Promise<string> {
  for (const n of ['.minecraft', 'minecraft']) {
    if (await exists(path.join(dir, n))) return path.join(dir, n);
  }
  return path.join(dir, '.minecraft');
}

// ---------------------------------------------------------------- Prism / PolyMC / MultiMC

async function mmcInstancesDir(root: string, cfgNames: string[]): Promise<string> {
  for (const n of cfgNames) {
    try {
      const v = parseCfg(await fs.readFile(path.join(root, n), 'utf8')).InstanceDir;
      if (v) return path.resolve(root, v);
    } catch { /* no such config */ }
  }
  return path.join(root, 'instances');
}

/** One instance folder (instance.cfg + mmc-pack.json); null when the folder is not an instance. */
export async function readMmcInstance(launcher: LauncherId, dir: string, iconsDir: string | null): Promise<RawInstance | null> {
  let cfgText: string;
  try {
    cfgText = await fs.readFile(path.join(dir, 'instance.cfg'), 'utf8');
  } catch {
    return null;
  }
  const cfg = parseCfg(cfgText);
  const parsed = parseMmcPack(await readJsonSafe(path.join(dir, 'mmc-pack.json')));
  const pack = 'problem' in parsed ? null : parsed;
  const settings = emptySettings();
  if (cfg.OverrideMemory === 'true') {
    settings.memoryMaxMb = memoryOrNull(toInt(cfg.MaxMemAlloc));
    settings.memoryMinMb = memoryOrNull(toInt(cfg.MinMemAlloc));
    if (settings.memoryMinMb && settings.memoryMaxMb && settings.memoryMinMb > settings.memoryMaxMb) settings.memoryMinMb = null;
  }
  if (cfg.OverrideJavaArgs === 'true' && cfg.JvmArgs) settings.jvmArgs = stripHeapArgs(cfg.JvmArgs);
  if (cfg.OverrideWindow === 'true') {
    settings.fullscreen = cfg.LaunchMaximized === 'true' ? true : null;
    const w = toInt(cfg.MinecraftWinWidth);
    const h = toInt(cfg.MinecraftWinHeight);
    if (w && h && w >= 320 && w <= 7680 && h >= 240 && h <= 4320) { settings.width = w; settings.height = h; }
  }
  const noteLine = (cfg.notes ?? '').split('\\n')[0] ?? '';
  const iconKey = cfg.iconKey && /^[\w.-]{1,64}$/.test(cfg.iconKey) ? cfg.iconKey : null;
  const iconFile = iconKey && iconsDir ? await findIcon(iconsDir, iconKey) : null;
  return finish({
    launcher,
    name: cleanText(cfg.name || path.basename(dir), 48) || path.basename(dir),
    description: cleanText(noteLine, 120),
    dir,
    gameDir: await mmcGameDir(dir),
    mcVersion: pack?.mcVersion ?? '?',
    loader: pack?.loader ?? { type: 'vanilla', version: null },
    problem: pack ? null : (parsed as { problem: string }).problem,
    settings,
    lastPlayedAt: toIso(toInt(cfg.lastLaunchTime)),
    iconFile,
    cfIndex: null,
  });
}

/** Removes -Xmx/-Xms (the memory is its own setting) and keeps the other flags. */
export function stripHeapArgs(args: string): string {
  return args.split(/\s+/).filter((a) => a && !/^-Xm[sx]/i.test(a)).join(' ').slice(0, 2000);
}

export async function scanMmcRoot(launcher: LauncherId, root: string): Promise<RawInstance[]> {
  const cfgNames = launcher === 'multimc' ? ['multimc.cfg'] : launcher === 'polymc' ? ['polymc.cfg'] : ['prismlauncher.cfg', 'polymc.cfg', 'multimc.cfg'];
  return scanMmcInstancesDir(launcher, await mmcInstancesDir(root, cfgNames), path.join(root, 'icons'));
}

export async function scanMmcInstancesDir(launcher: LauncherId, instancesDir: string, iconsDir: string | null): Promise<RawInstance[]> {
  const out: RawInstance[] = [];
  for (const name of await listDirs(instancesDir)) {
    if (name.startsWith('.') || name.startsWith('_')) continue;
    const r = await readMmcInstance(launcher, path.join(instancesDir, name), iconsDir);
    if (r) out.push(r);
  }
  return sortByName(out);
}

// ---------------------------------------------------------------- CurseForge

export async function readCfInstance(dir: string): Promise<RawInstance | null> {
  const j = await readJsonSafe<Record<string, unknown>>(path.join(dir, 'minecraftinstance.json'));
  if (!j || typeof j !== 'object') return null;
  const parsed = parseCfLoader(j);
  const pack = 'problem' in parsed ? null : parsed;

  const cfIndex: Record<string, { file: string; fileId: number }> = {};
  const addons = Array.isArray(j.installedAddons) ? (j.installedAddons as { addonID?: unknown; installedFile?: { id?: unknown; fileName?: unknown } }[]) : [];
  for (const a of addons) {
    const modId = toInt(a?.addonID);
    const fileId = toInt(a?.installedFile?.id);
    const file = a?.installedFile?.fileName;
    if (!modId || !fileId || typeof file !== 'string' || !file || /[\\/]/.test(file)) continue;
    for (const sub of ['mods', 'resourcepacks', 'shaderpacks']) {
      if (await exists(path.join(dir, sub, file)) || await exists(path.join(dir, sub, `${file}.disabled`))) {
        cfIndex[String(modId)] = { file, fileId };
        break;
      }
    }
  }
  const name = typeof j.name === 'string' && j.name.trim() ? j.name : path.basename(dir);
  return finish({
    launcher: 'curseforge',
    name: cleanText(name, 48) || path.basename(dir),
    description: '',
    dir,
    gameDir: dir,
    mcVersion: pack?.mcVersion ?? '?',
    loader: pack?.loader ?? { type: 'vanilla', version: null },
    problem: pack ? null : (parsed as { problem: string }).problem,
    settings: emptySettings(),
    lastPlayedAt: toIso(j.lastPlayed),
    iconFile: await findIcon(dir, 'profileImage'),
    cfIndex: Object.keys(cfIndex).length ? cfIndex : null,
  });
}

export async function scanCurseForgeDir(instancesDir: string): Promise<RawInstance[]> {
  const out: RawInstance[] = [];
  for (const name of await listDirs(instancesDir)) {
    const r = await readCfInstance(path.join(instancesDir, name));
    if (r) out.push(r);
  }
  return sortByName(out);
}

// ---------------------------------------------------------------- Modrinth App

/** Rows of the `profiles` table of app.db (read from a COPY, so the running app is never disturbed). */
async function readModrinthDb(dbFile: string): Promise<Record<string, unknown>[] | null> {
  let sqlite: typeof import('node:sqlite');
  try {
    sqlite = await import('node:sqlite');
  } catch {
    return null;
  }
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'chald-mr-'));
  try {
    const copy = path.join(tmp, 'app.db');
    await fs.copyFile(dbFile, copy);
    for (const ext of ['-wal', '-shm']) {
      if (await exists(dbFile + ext)) await fs.copyFile(dbFile + ext, copy + ext).catch(() => undefined);
    }
    const db = new sqlite.DatabaseSync(copy);
    try {
      return db.prepare('SELECT * FROM profiles').all() as Record<string, unknown>[];
    } finally {
      db.close();
    }
  } catch {
    return null;
  } finally {
    await fs.rm(tmp, { recursive: true, force: true }).catch(() => undefined);
  }
}

function jsonArgs(v: unknown): string {
  if (typeof v !== 'string' || !v) return '';
  try {
    const a = JSON.parse(v) as unknown;
    return Array.isArray(a) ? stripHeapArgs(a.filter((x): x is string => typeof x === 'string').join(' ')) : '';
  } catch {
    return '';
  }
}

async function modrinthFromRow(root: string, row: Record<string, unknown>): Promise<RawInstance | null> {
  const folder = typeof row.path === 'string' ? row.path : '';
  if (!folder || /[\\/]/.test(folder) || folder === '.' || folder === '..') return null;
  const dir = path.join(root, 'profiles', folder);
  if (!(await exists(dir))) return null;
  const loaderType = asLoaderType(row.mod_loader);
  const mc = typeof row.game_version === 'string' ? row.game_version : '';
  const settings = emptySettings();
  settings.memoryMaxMb = memoryOrNull(toInt(row.override_mc_memory_max));
  settings.jvmArgs = jsonArgs(row.override_extra_launch_args);
  if (row.override_mc_force_fullscreen === 1) settings.fullscreen = true;
  const w = toInt(row.override_mc_game_resolution_x);
  const h = toInt(row.override_mc_game_resolution_y);
  if (w && h && w >= 320 && w <= 7680 && h >= 240 && h <= 4320) { settings.width = w; settings.height = h; }
  const iconPath = typeof row.icon_path === 'string' && row.icon_path ? row.icon_path : null;
  const loader: RawInstance['loader'] = loaderType
    ? { type: loaderType, version: loaderType === 'vanilla' ? null : typeof row.mod_loader_version === 'string' && row.mod_loader_version ? bareLoaderVersion(loaderType, mc, row.mod_loader_version) : null }
    : { type: 'vanilla', version: null };
  return finish({
    launcher: 'modrinth',
    name: cleanText(typeof row.name === 'string' && row.name ? row.name : folder, 48) || folder,
    description: '',
    dir,
    gameDir: dir,
    mcVersion: mc || '?',
    loader,
    problem: loaderType ? (mc ? null : 'Не указана версия Minecraft') : `Неизвестный загрузчик: ${cleanText(String(row.mod_loader), 20)}`,
    settings,
    lastPlayedAt: toIso(row.last_played),
    iconFile: iconPath && IMAGE_EXT.includes(path.extname(iconPath).toLowerCase()) && (await exists(iconPath)) ? iconPath : null,
    cfIndex: null,
  });
}

/** Older Modrinth App versions (before app.db) kept profile.json inside every profile folder. */
async function modrinthFromProfileJson(dir: string): Promise<RawInstance | null> {
  const j = await readJsonSafe<{ metadata?: Record<string, unknown>; memory?: { maximum?: unknown }; fullscreen?: unknown; resolution?: unknown }>(path.join(dir, 'profile.json'));
  const md = j?.metadata;
  if (!j || !md || typeof md !== 'object') return null;
  const type = asLoaderType(md.loader);
  const mc = typeof md.game_version === 'string' ? md.game_version : '';
  const lv = (md.loader_version as { id?: unknown } | null | undefined)?.id;
  const settings = emptySettings();
  settings.memoryMaxMb = memoryOrNull(toInt(j.memory?.maximum));
  const res = Array.isArray(j.resolution) ? (j.resolution as unknown[]) : [];
  const w = toInt(res[0]);
  const h = toInt(res[1]);
  if (w && h && w >= 320 && w <= 7680 && h >= 240 && h <= 4320) { settings.width = w; settings.height = h; }
  if (j.fullscreen === true) settings.fullscreen = true;
  return finish({
    launcher: 'modrinth',
    name: cleanText(typeof md.name === 'string' && md.name ? md.name : path.basename(dir), 48) || path.basename(dir),
    description: '',
    dir,
    gameDir: dir,
    mcVersion: mc || '?',
    loader: type ? { type, version: type === 'vanilla' ? null : typeof lv === 'string' && lv ? bareLoaderVersion(type, mc, lv) : null } : { type: 'vanilla', version: null },
    problem: type ? (mc ? null : 'Не указана версия Minecraft') : `Неизвестный загрузчик: ${cleanText(String(md.loader), 20)}`,
    settings,
    lastPlayedAt: null,
    iconFile: null,
    cfIndex: null,
  });
}

export async function scanModrinthRoot(root: string): Promise<RawInstance[]> {
  const out: RawInstance[] = [];
  const seen = new Set<string>();
  const dbFile = path.join(root, 'app.db');
  if (await exists(dbFile)) {
    const rows = await readModrinthDb(dbFile);
    for (const row of rows ?? []) {
      const r = await modrinthFromRow(root, row);
      if (r) { out.push(r); seen.add(norm(r.dir)); }
    }
  }
  for (const name of await listDirs(path.join(root, 'profiles'))) {
    const dir = path.join(root, 'profiles', name);
    if (seen.has(norm(dir))) continue;
    const r = await modrinthFromProfileJson(dir);
    if (r) out.push(r);
  }
  return sortByName(out);
}

// ---------------------------------------------------------------- official launcher

export async function scanOfficialRoot(root: string): Promise<RawInstance[]> {
  const data = await readJsonSafe<{ profiles?: Record<string, Record<string, unknown>> }>(path.join(root, 'launcher_profiles.json'));
  if (!data) return [];
  // «latest release» has no fixed version: use the newest release that is installed
  let newest: string | null = null;
  for (const v of await listDirs(path.join(root, 'versions'))) {
    if (/^\d+\.\d+(\.\d+)?$/.test(v) && (newest === null || compareVersions(v, newest) > 0)) newest = v;
  }
  const out: RawInstance[] = [];
  const seen = new Set<string>();
  const profiles = Object.values(data.profiles ?? {}).sort((a, b) => String(b?.lastUsed ?? '').localeCompare(String(a?.lastUsed ?? '')));
  for (const p of profiles) {
    if (!p || typeof p !== 'object') continue;
    const type = String(p.type ?? 'custom');
    let id = typeof p.lastVersionId === 'string' ? p.lastVersionId : '';
    if (type === 'latest-snapshot') continue;
    if (type === 'latest-release' || id === 'latest-release') {
      if (!newest) continue;
      id = newest;
    }
    if (!id) continue;
    const customDir = typeof p.gameDir === 'string' && p.gameDir && path.isAbsolute(p.gameDir) && (await exists(p.gameDir)) ? p.gameDir : null;
    const gameDir = customDir ?? root;
    const key = `${norm(gameDir)}|${id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const parsed = parseVersionId(id);
    const pack = 'problem' in parsed ? null : parsed;
    const settings = emptySettings();
    const javaArgs = typeof p.javaArgs === 'string' ? p.javaArgs : '';
    settings.memoryMaxMb = memoryOrNull(heapMb(javaArgs, 'x'));
    settings.memoryMinMb = memoryOrNull(heapMb(javaArgs, 's'));
    if (settings.memoryMinMb && settings.memoryMaxMb && settings.memoryMinMb > settings.memoryMaxMb) settings.memoryMinMb = null;
    settings.jvmArgs = stripHeapArgs(javaArgs);
    const res = (p.resolution ?? null) as { width?: unknown; height?: unknown } | null;
    const w = toInt(res?.width);
    const h = toInt(res?.height);
    if (w && h && w >= 320 && w <= 7680 && h >= 240 && h <= 4320) { settings.width = w; settings.height = h; }
    const label = typeof p.name === 'string' && p.name.trim() ? p.name : `Minecraft ${pack?.mcVersion ?? id}`;
    out.push(await finish({
      launcher: 'official',
      name: cleanText(label, 48),
      description: '',
      dir: gameDir,
      gameDir,
      mcVersion: pack?.mcVersion ?? '?',
      loader: pack?.loader ?? { type: 'vanilla', version: null },
      problem: pack ? null : (parsed as { problem: string }).problem,
      settings,
      lastPlayedAt: toIso(p.lastUsed),
      iconFile: null,
      cfIndex: null,
    }));
  }
  return out;
}

/** -Xmx2G / -Xms512M -> megabytes. */
export function heapMb(args: string, kind: 'x' | 's'): number | null {
  const m = new RegExp(`-Xm${kind}(\\d+)([kKmMgG]?)`).exec(args);
  if (!m) return null;
  const n = Number(m[1]);
  const unit = m[2]!.toLowerCase();
  return unit === 'g' ? n * 1024 : unit === 'k' ? Math.round(n / 1024) : n;
}

// ---------------------------------------------------------------- finding launchers

function sortByName(list: RawInstance[]): RawInstance[] {
  return list.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
}

/** Folders where each launcher usually keeps its data, most likely first. */
export function candidateRoots(id: LauncherId, env: DetectEnv): string[] {
  const { platform, home, appData, documents, xdgData } = env;
  const flatpak = (app: string, dir: string) => path.join(home, '.var', 'app', app, 'data', dir);
  const dataBase = platform === 'linux' ? xdgData : appData;
  switch (id) {
    case 'prism': return [path.join(dataBase, 'PrismLauncher'), ...(platform === 'linux' ? [flatpak('org.prismlauncher.PrismLauncher', 'PrismLauncher')] : [])];
    case 'polymc': return [path.join(dataBase, 'PolyMC'), ...(platform === 'linux' ? [flatpak('org.polymc.PolyMC', 'PolyMC')] : [])];
    case 'multimc': return [
      path.join(home, 'MultiMC'), path.join(home, 'Desktop', 'MultiMC'), path.join(home, 'Downloads', 'MultiMC'), path.join(documents, 'MultiMC'),
      path.join(dataBase, platform === 'win32' ? 'MultiMC' : 'multimc'),
      ...(platform === 'win32' ? ['C:\\MultiMC', 'D:\\MultiMC'] : []),
    ];
    case 'modrinth': return [path.join(dataBase, 'ModrinthApp'), path.join(dataBase, 'com.modrinth.theseus'), ...(platform === 'linux' ? [flatpak('com.modrinth.ModrinthApp', 'ModrinthApp')] : [])];
    case 'curseforge': return [path.join(home, 'curseforge', 'minecraft', 'Instances'), path.join(documents, 'curseforge', 'minecraft', 'Instances')];
    case 'official': return [platform === 'win32' ? path.join(appData, '.minecraft') : platform === 'darwin' ? path.join(appData, 'minecraft') : path.join(home, '.minecraft')];
  }
}

async function scanRoot(id: LauncherId, root: string): Promise<RawInstance[]> {
  switch (id) {
    case 'prism': case 'polymc': case 'multimc': return scanMmcRoot(id, root);
    case 'modrinth': return scanModrinthRoot(root);
    case 'curseforge': return scanCurseForgeDir(root);
    case 'official': return scanOfficialRoot(root);
  }
}

/** First existing data folder of the launcher that holds instances. null = the launcher is not installed. */
export async function detectLauncher(id: LauncherId, env: DetectEnv): Promise<{ path: string; instances: RawInstance[] } | null> {
  let firstExisting: string | null = null;
  for (const root of candidateRoots(id, env)) {
    if (!(await exists(root))) continue;
    firstExisting ??= root;
    const instances = await scanRoot(id, root);
    if (instances.length) return { path: root, instances };
  }
  return firstExisting ? { path: firstExisting, instances: [] } : null;
}

/**
 * A folder picked by hand: a launcher's data folder, its instances folder, or a single instance.
 * The format is recognised from the files inside.
 */
export async function inspectFolder(dir: string): Promise<RawInstance[]> {
  const out: RawInstance[] = [];
  const add = (list: RawInstance[]) => {
    for (const r of list) {
      if (!out.some((o) => norm(o.dir) === norm(r.dir) && o.launcher === r.launcher && o.mcVersion === r.mcVersion && o.loader.type === r.loader.type)) out.push(r);
    }
  };

  // a single instance
  const single =
    (await readMmcInstance('prism', dir, path.join(path.dirname(path.dirname(dir)), 'icons'))) ??
    (await readCfInstance(dir)) ??
    (await modrinthFromProfileJson(dir));
  if (single) return [single];

  // Modrinth App: its data folder, or the `profiles` folder inside it
  const mrRoot = path.basename(dir).toLowerCase() === 'profiles' && (await exists(path.join(path.dirname(dir), 'app.db'))) ? path.dirname(dir) : dir;
  if ((await exists(path.join(mrRoot, 'app.db'))) || (await exists(path.join(dir, 'profiles')))) add(await scanModrinthRoot(mrRoot));

  if (await exists(path.join(dir, 'launcher_profiles.json'))) add(await scanOfficialRoot(dir));
  // a launcher data folder: instances live in a subfolder
  add(await scanMmcRoot('prism', dir));
  for (const sub of ['instances', 'Instances']) {
    add(await scanMmcInstancesDir('prism', path.join(dir, sub), path.join(dir, 'icons')));
    add(await scanCurseForgeDir(path.join(dir, sub)));
  }
  // the instances folder itself
  add(await scanMmcInstancesDir('prism', dir, path.join(path.dirname(dir), 'icons')));
  add(await scanCurseForgeDir(dir));
  return out;
}

// ---------------------------------------------------------------- importing

/** Marker saved in the new instance so the same source is not offered twice. */
export function importKey(r: Pick<RawInstance, 'launcher' | 'dir' | 'mcVersion' | 'loader'>): string {
  return `${r.launcher}:${norm(r.dir)}${r.launcher === 'official' ? `#${r.mcVersion}-${r.loader.type}` : ''}`;
}

export function toCreateInput(r: RawInstance): CreateInstanceInput {
  const from = LAUNCHER_NAMES[r.launcher];
  const desc = r.description ? `${r.description} (${from})` : `Импортировано из ${from}`;
  let hash = 0;
  for (const c of r.name) hash = (hash * 31 + c.charCodeAt(0)) % 8;
  return {
    name: cleanText(r.name, 48) || 'Imported',
    description: desc.slice(0, 120),
    mcVersion: r.mcVersion,
    loader: { type: r.loader.type, version: r.loader.type === 'vanilla' ? null : r.loader.version },
    kind: r.loader.type === 'vanilla' ? 'official' : 'modded',
    coverColor: hash,
    settings: { javaPath: '', ...r.settings },
  };
}

/**
 * Top-level names that are not game data: caches, logs, the other launcher's own files and, for the official launcher,
 * the shared libraries / versions / assets that Chald downloads by itself.
 */
export const COPY_EXCLUDE = new Set([
  'logs', 'crash-reports', '.fabric', '.mixin.out', 'webcache', 'webcache2', 'cache', '.cache', 'natives', 'bin',
  'versions', 'libraries', 'assets', 'runtime', 'jarmods', 'patches',
  'usercache.json', 'usernamecache.json', 'realms_persistence.json', 'treatmenttags.json',
  'launcher_profiles.json', 'launcher_accounts.json', 'launcher_accounts_microsoft_store.json', 'launcher_msa_credentials.bin',
  'launcher_log.txt', 'launcher_settings.json', 'launcher_ui_state.json', 'launcher_gamer_pic.png', 'launcher_entitlements.json', 'launcher_cef_log.txt',
  'instance.cfg', 'mmc-pack.json', 'profile.json', 'minecraftinstance.json', 'manifest.json', 'modlist.html', 'profileimage.png',
  '.chald-modrinth.json', '.chald-curseforge.json', 'app.db', 'app.db-wal', 'app.db-shm',
]);

const MAX_FILES = 400_000;

interface FileItem { rel: string[]; size: number }

/** Lists the files to copy. Symlinks and special files are skipped, so a link can never pull in files from elsewhere. */
export async function listGameFiles(src: string, signal?: AbortSignal): Promise<FileItem[]> {
  const files: FileItem[] = [];
  const stack: string[][] = [[]];
  while (stack.length) {
    signal?.throwIfAborted();
    const rel = stack.pop()!;
    let entries;
    try {
      entries = await fs.readdir(path.join(src, ...rel), { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of entries) {
      if (rel.length === 0 && COPY_EXCLUDE.has(e.name.toLowerCase())) continue;
      if (e.isSymbolicLink()) continue;
      if (e.isDirectory()) stack.push([...rel, e.name]);
      else if (e.isFile()) {
        let size = 0;
        try { size = (await fs.stat(path.join(src, ...rel, e.name))).size; } catch { continue; }
        files.push({ rel: [...rel, e.name], size });
        if (files.length > MAX_FILES) throw new AppError('IMPORT_TOO_BIG', 'В инстансе слишком много файлов для импорта');
      }
    }
  }
  return files;
}

export async function copyGameFiles(
  src: string,
  dest: string,
  opts: { signal?: AbortSignal; onProgress?: (fraction: number, file: string) => void } = {},
): Promise<{ files: number; bytes: number }> {
  if (!(await exists(src))) return { files: 0, bytes: 0 };
  const files = await listGameFiles(src, opts.signal);
  const total = files.reduce((a, f) => a + f.size, 0) || 1;
  let done = 0;
  await runPool(files, 4, async (f) => {
    opts.signal?.throwIfAborted();
    const to = resolveInside(dest, ...f.rel);
    await fs.mkdir(path.dirname(to), { recursive: true });
    // copy-on-write where the file system supports it, a plain copy otherwise
    await fs.copyFile(path.join(src, ...f.rel), to, fsc.COPYFILE_FICLONE);
    done += f.size;
    opts.onProgress?.(Math.min(1, done / total), f.rel[f.rel.length - 1]!);
  });
  return { files: files.length, bytes: files.reduce((a, f) => a + f.size, 0) };
}
