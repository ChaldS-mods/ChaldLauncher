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
  jvmArgs: string;
  width: number;
  height: number;
  fullscreen: boolean;
  closeBehavior: 'quit' | 'minimize-while-playing';
  checkUpdates: boolean;
  updateRepo: string;
  msClientId: string;
  accountMode: AccountMode;
  offlineName: string;
  lastInstanceId: string | null;
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

export type OpKind = 'install' | 'java' | 'launch' | 'modpack';
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
}

export type ModrinthType = 'mod' | 'modpack' | 'resourcepack';
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
