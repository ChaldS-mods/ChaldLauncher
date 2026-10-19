import type {
  AppInfo, AppSettings, AuthState, ContentEntry, GameLogEvent, GameStatusEvent, InstanceView, JavaInstall,
  LoaderType, LoaderVersionEntry, McVersionEntry, ModrinthProjectInfo, ModrinthSearchInput, ModrinthSearchResult, ModrinthType, ModrinthVersionInfo, ModrinthVersionsInput, NetEntry, OpProgress, UpdateInfo, DeviceCodeInfo,
} from './types';
import type { CreateInstanceInput, UpdateInstanceInput } from './schemas';

type Ch<Req, Res> = { req: Req; res: Res };

export interface IpcContract {
  'app:info': Ch<void, AppInfo>;
  'window:control': Ch<'minimize' | 'maximize' | 'close', void>;
  'settings:get': Ch<void, AppSettings>;
  'settings:set': Ch<Partial<AppSettings>, AppSettings>;
  'dialog:pickDirectory': Ch<{ title: string }, string | null>;

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
  'modrinth:installPack': Ch<{ projectId: string; versionId?: string | null }, void>;
  'modrinth:cancelPack': Ch<{ projectId: string }, void>;

  'java:detect': Ch<void, JavaInstall[]>;

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
}

export interface IpcEvents {
  'op:progress': OpProgress;
  'game:status': GameStatusEvent;
  'game:log': GameLogEvent;
  'auth:deviceCode': DeviceCodeInfo;
  'auth:changed': AuthState;
}

export type IpcResult<T> = { ok: true; data: T } | { ok: false; error: { code: string; message: string } };
