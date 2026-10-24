import type {
  AccountSkin, AppInfo, ChaldPackExportResult, ChaldPackSummary, AppSettings, AuthState, ContentEntry, GameLogEvent, GameStatusEvent, InstanceView, JavaInstall,
  LoaderType, LoaderVersionEntry, McVersionEntry, ModrinthProjectInfo, ModrinthSearchInput, ModrinthSearchResult, ModrinthType, ModrinthVersionInfo, ModrinthVersionsInput, NetEntry, OpProgress, SkinEntry, SkinImportResult, UpdateInfo, DeviceCodeInfo,
} from './types';
import type { SkinVariant } from './skin';
import type { PresencePage } from './presence';
import type { CreateInstanceInput, UpdateInstanceInput } from './schemas';

type Ch<Req, Res> = { req: Req; res: Res };

export interface IpcContract {
  'app:info': Ch<void, AppInfo>;
  'window:control': Ch<'minimize' | 'maximize' | 'close', void>;
  'settings:get': Ch<void, AppSettings>;
  'settings:set': Ch<Partial<AppSettings>, AppSettings>;
  'dialog:pickDirectory': Ch<{ title: string }, string | null>;
  /** the page the user is on now (for the Discord status) */
  'presence:page': Ch<PresencePage, void>;

  'instances:list': Ch<void, InstanceView[]>;
  'instances:create': Ch<CreateInstanceInput, InstanceView>;
  'instances:update': Ch<{ id: string; patch: UpdateInstanceInput }, InstanceView>;
  'instances:duplicate': Ch<{ id: string; name: string }, InstanceView>;
  'instances:remove': Ch<{ id: string; confirm: true }, void>;
  'instances:openFolder': Ch<{ id: string }, void>;
  'instances:setCover': Ch<{ id: string }, InstanceView | null>;
  'instances:install': Ch<{ id: string }, void>;
  'instances:cancelInstall': Ch<{ id: string }, void>;
  'instances:select': Ch<{ id: string | null }, void>;

  'versions:minecraft': Ch<{ refresh: boolean }, McVersionEntry[]>;
  'versions:loaders': Ch<{ loader: LoaderType; mcVersion: string }, LoaderVersionEntry[]>;

  'content:list': Ch<{ id: string; kind: 'mods' | 'resourcepacks' }, ContentEntry[]>;
  'content:toggle': Ch<{ id: string; kind: 'mods' | 'resourcepacks'; file: string }, void>;
  'content:remove': Ch<{ id: string; kind: 'mods' | 'resourcepacks'; file: string; confirm: true }, void>;
  'content:import': Ch<{ id: string; kind: 'mods' | 'resourcepacks' }, number>;

  'modrinth:search': Ch<ModrinthSearchInput, ModrinthSearchResult>;
  'modrinth:project': Ch<{ projectId: string }, ModrinthProjectInfo>;
  'modrinth:versions': Ch<ModrinthVersionsInput, ModrinthVersionInfo[]>;
  'modrinth:openPage': Ch<{ type: ModrinthType; slug: string }, void>;
  /** versionId = a specific version; omitted/null = newest compatible */
  'modrinth:install': Ch<{ id: string; projectId: string; kind: 'mod' | 'resourcepack'; versionId?: string | null }, string[]>;
  /** ids of Modrinth projects already installed in the instance */
  'modrinth:installed': Ch<{ id: string; kind: 'mod' | 'resourcepack' }, string[]>;
  'modrinth:installPack': Ch<{ projectId: string; versionId?: string | null }, void>;
  'modrinth:cancelPack': Ch<{ projectId: string }, void>;

  /** opens a file dialog, validates the chosen .chaldlauncher file; null = dialog cancelled. Nothing is written. */
  'chaldpack:inspect': Ch<void, { token: string; summary: ChaldPackSummary } | null>;
  /** creates the instance from an inspected file; progress comes as op:progress (opId modpack:chald:<token>) */
  'chaldpack:import': Ch<{ token: string }, void>;
  /** save dialog + export; null = dialog cancelled */
  'chaldpack:export': Ch<{ id: string; includeWorlds: boolean }, (ChaldPackExportResult & { file: string }) | null>;

  'wardrobe:list': Ch<void, SkinEntry[]>;
  'wardrobe:import': Ch<void, SkinImportResult>;
  'wardrobe:update': Ch<{ id: string; patch: { name?: string; variant?: SkinVariant } }, SkinEntry>;
  'wardrobe:remove': Ch<{ id: string; confirm: true }, void>;
  /** Microsoft account only: the skin that is on the account now (null = none) */
  'wardrobe:current': Ch<void, AccountSkin | null>;
  'wardrobe:saveCurrent': Ch<{ name: string }, SkinImportResult>;
  'wardrobe:apply': Ch<{ id: string }, AccountSkin>;
  'wardrobe:reset': Ch<void, void>;

  'java:detect': Ch<void, JavaInstall[]>;
  'system:memory': Ch<void, { totalMb: number; freeMb: number }>;

  'auth:state': Ch<void, AuthState>;
  'auth:login': Ch<{ method: 'browser' | 'code' }, AuthState>;
  'auth:cancel': Ch<void, void>;
  'auth:logout': Ch<void, AuthState>;
  'auth:setOffline': Ch<{ name: string }, AuthState>;

  'game:launch': Ch<{ id: string }, void>;
  'game:stop': Ch<{ id: string }, void>;
  'game:logs': Ch<{ id: string }, string[]>;

  'net:log': Ch<void, NetEntry[]>;
  'net:clear': Ch<void, void>;
  'net:allowedHosts': Ch<void, string[]>;

  'update:check': Ch<void, UpdateInfo>;
  /** starts the download of the found update in the background (progress: op:progress, opId update:<version>) */
  'update:download': Ch<void, void>;
  /** runs the downloaded installer and closes the launcher */
  'update:install': Ch<void, void>;
}

export interface IpcEvents {
  'op:progress': OpProgress;
  'game:status': GameStatusEvent;
  'game:log': GameLogEvent;
  'auth:deviceCode': DeviceCodeInfo;
  'auth:changed': AuthState;
}

export type IpcResult<T> = { ok: true; data: T } | { ok: false; error: { code: string; message: string } };
