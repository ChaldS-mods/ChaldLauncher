import type { DnsMode } from './dns';
import type { SkinVariant } from './skin';

export type LoaderType = 'vanilla' | 'fabric' | 'quilt' | 'forge' | 'neoforge';
export type InstanceKind = 'official' | 'modded' | 'custom';
export type AccountMode = 'microsoft' | 'offline';
export type InstanceState = 'ready' | 'not-installed' | 'installing' | 'broken';

export const LOADERS: { id: LoaderType; label: string; implemented: boolean }[] = [
  { id: 'vanilla', label: 'Vanilla', implemented: true },
  { id: 'fabric', label: 'Fabric', implemented: true },
  { id: 'quilt', label: 'Quilt', implemented: true },
  { id: 'forge', label: 'Forge', implemented: true },
  { id: 'neoforge', label: 'NeoForge', implemented: true },
];

/** null = take the value from global settings */
export interface InstanceSettings {
  javaPath: string;
  memoryMinMb: number | null;
  memoryMaxMb: number | null;
  jvmArgs: string;
  width: number | null;
  height: number | null;
  fullscreen: boolean | null;
}

export interface InstanceMeta {
  schemaVersion: 1;
  id: string;
  name: string;
  description: string;
  mcVersion: string;
  loader: { type: LoaderType; version: string | null };
  kind: InstanceKind;
  /** version id used for launch (vanilla id or the loader's profile id); null until installed */
  versionId: string | null;
  installed: boolean;
  createdAt: string;
  lastPlayedAt: string | null;
  coverColor: number;
  coverFile: string | null;
  settings: InstanceSettings;
  /** set when the instance was imported from another launcher: «<launcher>:<source folder>» */
  importedFrom?: string;
  /** total time the game has run from this instance, in seconds */
  playTimeSec?: number;
}

export interface InstanceView extends InstanceMeta {
  state: InstanceState;
  stateReason: string | null;
  path: string;
  gameDir: string;
  modCount: number;
  packCount: number;
  coverDataUrl: string | null;
  running: boolean;
}

export interface AppSettings {
  instancesDir: string;
  downloadsDir: string;
  javaPath: string;
  memoryMinMb: number;
  memoryMaxMb: number;
  /** true: the launcher picks the heap itself (computer's RAM + instance's mods), memoryMinMb/MaxMb are used only when it is off */
  memoryAuto: boolean;
  jvmArgs: string;
  width: number;
  height: number;
  fullscreen: boolean;
  closeBehavior: 'quit' | 'minimize-while-playing';
  checkUpdates: boolean;
  /** download a found update in the background */
  autoDownloadUpdates: boolean;
  /** install a downloaded update by itself when the launcher is closed (no click needed) */
  autoInstallUpdates: boolean;
  /** empty: the launcher's own repository (DEFAULT_UPDATE_REPO) */
  updateRepo: string;
  /** short sounds when buttons are pressed */
  uiSounds: boolean;
  /** 0..100 */
  soundVolume: number;
  /** show what the user does in the launcher as a Discord status (Rich Presence) */
  discordRpc: boolean;
  /** put the name of the running instance in the Discord status */
  discordShowInstance: boolean;
  /** interface colors, #rrggbb (see shared/theme.ts) */
  themeBg: string;
  themeAccent: string;
  themeSecondary: string;
  themeHighlight: string;
  /** interface scale in percent, 80..130 */
  uiScale: number;
  /** corner style of cards and buttons */
  cornerStyle: 'sharp' | 'normal' | 'round';
  /** strength of the glow around active elements, 0..100 */
  glow: number;
  /** pixel font (ChaldPixel) or a plain readable one (Rubik) */
  fontMode: 'pixel' | 'clean';
  /** transitions and hover animations */
  animations: boolean;
  /** icons-only sidebar */
  compactSidebar: boolean;
  /** sidebar pages the user switched off («settings» can never be hidden) */
  hiddenPages: string[];
  sidebarSide: 'left' | 'right';
  /** where the instance / skin panel sits on pages with a side panel */
  panelSide: 'right' | 'left' | 'bottom' | 'hidden';
  /** width of that panel in px */
  panelWidth: number;
  showStatusBar: boolean;
  /** user stylesheet, applied on top of the launcher's own */
  customCss: string;
  /** user HTML block at the top of the home page (sanitised before it is shown) */
  customHtml: string;
  /** DNS of the launcher's own requests: system | plain servers | DNS-over-HTTPS */
  dnsMode: DnsMode;
  /** plain DNS servers, «1.1.1.1, 8.8.8.8» */
  dnsServers: string;
  /** DoH endpoint, https://… */
  dnsDohUrl: string;
  msClientId: string;
  accountMode: AccountMode;
  offlineName: string;
  lastInstanceId: string | null;
  /** UI language: en | ru | kk | be */
  language: 'en' | 'ru' | 'kk' | 'be';
  /** the first-run offer to import instances from other launchers was shown (or dismissed) */
  launcherImportSeen: boolean;
  /** Chald Friends server base URL (fixed to https://chaldserver.dynmap.xyz) */
  friendsServerUrl: string;
}


export interface AppInfo {
  version: string;
  platform: string;
  arch: string;
  dataDir: string;
  instancesDir: string;
  sharedDir: string;
  encryptionAvailable: boolean;
}

export interface McVersionEntry {
  id: string;
  type: 'release' | 'snapshot' | 'old_beta' | 'old_alpha';
  releaseTime: string;
}

export interface LoaderVersionEntry {
  version: string;
  stable: boolean;
  /** the loader's own "recommended" build (Forge) */
  recommended?: boolean;
}

export interface ContentEntry {
  /** file or directory name on disk (including .disabled suffix) */
  file: string;
  name: string;
  version: string | null;
  size: number;
  enabled: boolean;
  isDir: boolean;
  iconDataUrl: string | null;
  warning: string | null;
}

export type OpKind = 'install' | 'java' | 'launch' | 'modpack' | 'update' | 'export';
export interface OpProgress {
  opId: string;
  kind: OpKind;
  instanceId: string | null;
  label: string;
  /** 0..1, or null when the size of the work is unknown */
  fraction: number | null;
  status: 'running' | 'done' | 'error' | 'cancelled';
  message: string | null;
}

export interface GameStatusEvent {
  instanceId: string;
  status: 'running' | 'exited' | 'crashed';
  exitCode: number | null;
}

/** Something the player should be told about a launch (shown as a toast). */
export interface GameNoticeEvent {
  instanceId: string;
  /** the licence servers were unreachable: the game starts offline under the same name and UUID */
  kind: 'offline-fallback';
  name: string;
}

export interface GameLogEvent {
  instanceId: string;
  line: string;
}

export interface AuthState {
  mode: AccountMode;
  /** microsoft: signed in; offline: a valid nickname is set */
  loggedIn: boolean;
  name: string | null;
  uuid: string | null;
  configured: boolean;
  encryptionAvailable: boolean;
}

export interface DeviceCodeInfo {
  userCode: string;
  verificationUri: string;
  expiresInSec: number;
}

export interface DnsTestResult {
  ok: boolean;
  host: string;
  addresses: string[];
  ms: number;
  error: string | null;
}

export interface NetEntry {
  id: number;
  time: string;
  method: string;
  host: string;
  path: string;
  status: number | null;
  bytes: number | null;
  purpose: string;
  error: string | null;
}

export interface JavaInstall {
  path: string;
  major: number;
  source: 'system' | 'launcher';
}

export interface UpdateInfo {
  configured: boolean;
  current: string;
  latest: string | null;
  url: string | null;
  hasUpdate: boolean;
  /** file of the new version (Windows installer .exe, Linux .AppImage); null: nothing to download for this platform */
  assetName: string | null;
  /** the installer is downloaded and verified, ready to run */
  downloaded: boolean;
  downloading: boolean;
}

export type ModrinthType = 'mod' | 'modpack' | 'resourcepack' | 'shader' | 'datapack';
export type ModrinthSort = 'relevance' | 'downloads' | 'follows' | 'newest' | 'updated';

export interface ModrinthSearchInput {
  query: string;
  type: ModrinthType;
  /** only projects that have a version for this Minecraft version */
  mcVersion: string | null;
  /** only projects for this loader (quilt also accepts Fabric projects) */
  loader: Exclude<LoaderType, 'vanilla'> | null;
  sort: ModrinthSort;
  offset: number;
}

export interface ModrinthHit {
  id: string;
  slug: string;
  title: string;
  description: string;
  author: string;
  downloads: number;
  follows: number;
  categories: string[];
  type: ModrinthType;
  iconDataUrl: string | null;
}

export interface ModrinthProjectInfo {
  id: string;
  slug: string;
  title: string;
  description: string;
  /** long description, Markdown */
  body: string;
  type: ModrinthType;
  downloads: number;
  follows: number;
  categories: string[];
  loaders: string[];
  gameVersions: string[];
  license: string | null;
  updated: string | null;
  iconDataUrl: string | null;
}

export interface ModrinthVersionInfo {
  id: string;
  name: string;
  versionNumber: string;
  type: 'release' | 'beta' | 'alpha';
  gameVersions: string[];
  loaders: string[];
  /** ISO date */
  published: string;
  downloads: number;
  /** Markdown */
  changelog: string;
  fileName: string;
  size: number;
  /** number of required dependencies that will be installed together with it */
  requiredDeps: number;
}

export interface ModrinthVersionsInput {
  projectId: string;
  mcVersion: string | null;
  loader: Exclude<LoaderType, 'vanilla'> | null;
}

export interface ModrinthSearchResult {
  hits: ModrinthHit[];
  total: number;
  offset: number;
}

export type CurseForgeClass = 'mod' | 'modpack' | 'resourcepack' | 'shader' | 'datapack';
export type CurseForgeSort = 'featured' | 'popularity' | 'lastUpdated' | 'name' | 'totalDownloads';

export interface CurseForgeHit {
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

export interface CurseForgeProjectInfo {
  id: number;
  slug: string;
  title: string;
  description: string;
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

export interface CurseForgeFileInfo {
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

export interface CurseForgeSearchResult {
  hits: CurseForgeHit[];
  total: number;
  offset: number;
}

export interface SkinEntry {
  id: string;
  name: string;
  variant: SkinVariant;
  addedAt: string;
  /** PNG of the skin; skins are tiny (a few KB) */
  dataUrl: string;
}

/** The skin currently worn by the Microsoft account. */
export interface AccountSkin {
  variant: SkinVariant;
  dataUrl: string;
}

export interface SkinImportResult {
  added: SkinEntry[];
  /** one line per file that was not added (wrong size, not a PNG, already in the wardrobe, ...) */
  problems: string[];
}

/** Official cape owned by the Microsoft account (from /minecraft/profile). */
export interface AccountCape {
  id: string;
  /** Human-readable name from Mojang (e.g. "Minecon2012", "Migrator") */
  alias: string;
  /** https texture URL */
  url: string;
  state: 'ACTIVE' | 'INACTIVE';
  /** PNG preview as data URL; empty string until the texture finishes loading in the background */
  dataUrl: string;
}

export interface CapeListResult {
  capes: AccountCape[];
  /** id of the currently active cape, or null if none */
  activeId: string | null;
}

/** Public profile on the Chald Friends server */
export interface ChaldUser {
  id: number;
  chaldId: string;
  mcUuid: string;
  mcName: string;
  displayName: string;
  bio: string;
  online: boolean;
  /** launcher | game | idle | offline */
  presence: string;
  /** e.g. instance name when playing */
  activity: string;
  lastSeen: number;
  createdAt: number;
  /** true when the friends server has a stored PNG head for this user */
  hasAvatar?: boolean;
  token?: string;
  requestId?: number;
}

/**
 * Microsoft (online-mode) UUIDs are random v4; offline-mode names get a v3 UUID from
 * `OfflinePlayer:<name>`. Used to decide whether mc-heads / skin services will return a real skin.
 */
export function isLicensedUuid(uuid: string | undefined | null): boolean {
  if (!uuid) return false;
  const u = uuid.replace(/-/g, '').toLowerCase();
  if (!/^[0-9a-f]{32}$/.test(u)) return false;
  return u[12] === '4';
}

/** Prefer the real skin for licensed accounts (UUID), otherwise fall back to the name / Steve. */
export function mcHeadUrl(name: string | undefined | null, uuid?: string | null, size = 64): string {
  if (uuid && isLicensedUuid(uuid)) {
    return `https://mc-heads.net/avatar/${uuid.replace(/-/g, '')}/${size}`;
  }
  const n = (name || 'MHF_Steve').trim() || 'MHF_Steve';
  return `https://mc-heads.net/avatar/${encodeURIComponent(n)}/${size}`;
}

export interface ChaldFriendsList {
  friends: ChaldUser[];
  incoming: ChaldUser[];
  outgoing: ChaldUser[];
}

export interface ChaldSessionResult {
  user: ChaldUser;
  created: boolean;
}

export interface ChaldMessage {
  id: number;
  fromUserId: number;
  /** DM peer; 0 / omitted in group messages */
  toUserId: number;
  /** set when the message belongs to a group chat */
  groupId?: number | null;
  body: string;
  createdAt: number;
  mine: boolean;
  readAt: number | null;
  /** text | image | share (older servers omit it) */
  kind?: string;
  /** JSON string or object, used by `share` messages */
  meta?: string | Record<string, unknown> | null;
  /** display name of the sender (group threads) */
  fromName?: string;
  /** mc name / uuid of the sender for avatars in group threads */
  fromMcName?: string;
  fromMcUuid?: string;
}

export interface ChaldConversation {
  user: {
    id: number;
    chaldId: string;
    mcName: string;
    mcUuid?: string;
    displayName: string;
    online: boolean;
    presence: string;
    activity: string;
  };
  lastMessage: ChaldMessage | null;
  unread: number;
}

/** Group chat on the Chald Friends server */
export interface ChaldGroup {
  id: number;
  name: string;
  ownerId: number;
  /** member user ids (including owner) */
  memberIds: number[];
  members?: ChaldUser[];
  lastMessage?: ChaldMessage | null;
  unread?: number;
  createdAt: number;
}

export interface ChaldPackSummary {
  name: string;
  description: string;
  mcVersion: string;
  loader: { type: LoaderType; version: string | null };
  /** files that will be downloaded from Modrinth */
  downloads: number;
  /** files taken from the archive itself */
  overrideFiles: number;
  overrideBytes: number;
}

export interface ChaldPackExportResult {
  downloads: number;
  /** of `downloads`: files that were not installed through the launcher but recognised on Modrinth by hash */
  identified: number;
  bundledFiles: number;
  bundledBytes: number;
  /** files that had to be packed instead of listed, with the reason */
  notices: string[];
}

export interface ModUpdateInfo {
  versionId: string;
  versionNumber: string;
  name: string;
  type: 'release' | 'beta' | 'alpha';
  published: string;
  fileName: string;
  size: number;
  changelog: string;
  requiredDeps: number;
}

export interface InstalledMod {
  file: string;
  name: string;
  version: string | null;
  enabled: boolean;
  size: number;
  /** Modrinth project, recognised by the file hash; null = not on Modrinth (or not checked) */
  projectId: string | null;
  slug: string | null;
  iconDataUrl: string | null;
  source: 'modrinth' | 'unknown';
  update: ModUpdateInfo | null;
}

export interface InstalledModsReport {
  mods: InstalledMod[];
  checkedAt: string;
  /** set when Modrinth could not be reached: the local list is still complete */
  error: string | null;
}
