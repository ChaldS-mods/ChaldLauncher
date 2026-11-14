import type {
  AccountSkin, AccountCape, CapeListResult, AppInfo, ChaldPackExportResult, ChaldPackSummary, AppSettings, AuthState, ContentEntry, GameLogEvent, GameNoticeEvent, GameStatusEvent, InstanceView, JavaInstall,
  LoaderType, LoaderVersionEntry, McVersionEntry, ModrinthProjectInfo, ModrinthSearchInput, ModrinthSearchResult, ModrinthType, ModrinthVersionInfo, ModrinthVersionsInput, DnsTestResult, NetEntry, OpProgress, SkinEntry, SkinImportResult, UpdateInfo, DeviceCodeInfo,
} from './types';
import type { LauncherSource } from './launchers';
import type { ArchiveApplyResult, ContentAddResult } from './archive';
import type { DnsMode } from './dns';
import type { MojangGameId, MojangStatus, BedrockServer } from './mojang';
import type { SkinVariant } from './skin';
import type { PresencePage } from './presence';
import type { ChangeVersionInput, CreateInstanceInput, UpdateInstanceInput } from './schemas';

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
  /** moves the instance to another Minecraft version / loader; progress comes as op:progress (opId install:<id>) */
  'instances:changeVersion': Ch<ChangeVersionInput, void>;
  'instances:select': Ch<{ id: string | null }, void>;

  'versions:minecraft': Ch<{ refresh: boolean }, McVersionEntry[]>;
  'versions:loaders': Ch<{ loader: LoaderType; mcVersion: string }, LoaderVersionEntry[]>;

  'content:list': Ch<{ id: string; kind: 'mods' | 'resourcepacks' }, ContentEntry[]>;
  'content:toggle': Ch<{ id: string; kind: 'mods' | 'resourcepacks'; file: string }, void>;
  'content:remove': Ch<{ id: string; kind: 'mods' | 'resourcepacks'; file: string; confirm: true }, void>;
  'content:import': Ch<{ id: string; kind: 'mods' | 'resourcepacks' }, number>;
  /**
   * Adds mods: .jar files and .zip archives (picked in a dialog when `paths` is null, or dropped on the page).
   * An archive with only mods goes straight to mods/; one with other folders is returned in `pending` for the user to decide.
   */
  'content:add': Ch<{ id: string; paths: string[] | null }, ContentAddResult>;
  /** the user's decision about one pending archive: only its mods, or everything into its own folders */
  'content:applyArchive': Ch<{ id: string; token: string; mode: 'mods' | 'all' }, ArchiveApplyResult>;

  'instances:worlds': Ch<{ id: string }, string[]>;

  'modrinth:search': Ch<ModrinthSearchInput, ModrinthSearchResult>;
  'modrinth:project': Ch<{ projectId: string }, ModrinthProjectInfo>;
  'modrinth:versions': Ch<ModrinthVersionsInput, ModrinthVersionInfo[]>;
  'modrinth:openPage': Ch<{ type: ModrinthType; slug: string }, void>;
  /** versionId = a specific version; omitted/null = newest compatible */
  'modrinth:install': Ch<{ id: string; projectId: string; kind: 'mod' | 'resourcepack' | 'shader' | 'datapack'; versionId?: string | null; worldName?: string | null }, string[]>;
  /** ids of Modrinth projects already installed in the instance */
  'modrinth:installed': Ch<{ id: string; kind: 'mod' | 'resourcepack' | 'shader' | 'datapack' }, string[]>;
  'modrinth:installPack': Ch<{ projectId: string; versionId?: string | null }, void>;
  'modrinth:cancelPack': Ch<{ projectId: string }, void>;

  'curseforge:search': Ch<
    {
      query: string;
      classType: 'mod' | 'modpack' | 'resourcepack' | 'shader' | 'datapack';
      mcVersion: string | null;
      loader: 'fabric' | 'quilt' | 'forge' | 'neoforge' | null;
      sort: 'featured' | 'popularity' | 'lastUpdated' | 'name' | 'totalDownloads';
      offset: number;
    },
    import('./types').CurseForgeSearchResult
  >;
  'curseforge:project': Ch<{ modId: number }, import('./types').CurseForgeProjectInfo>;
  'curseforge:files': Ch<{ modId: number; mcVersion: string | null; loader: 'fabric' | 'quilt' | 'forge' | 'neoforge' | null }, import('./types').CurseForgeFileInfo[]>;
  'curseforge:install': Ch<{ id: string; modId: number; kind: 'mod' | 'resourcepack' | 'shader' | 'datapack'; fileId?: number | null; worldName?: string | null }, string>;
  /** Downloads a CurseForge modpack as a new instance (background, progress via op:progress). */
  'curseforge:installPack': Ch<{ modId: number; fileId?: number | null }, void>;
  'curseforge:installed': Ch<{ id: string; kind: 'mod' | 'resourcepack' | 'shader' | 'datapack' }, number[]>;
  'curseforge:openPage': Ch<{ slug: string }, void>;

  /** opens a file dialog, validates the chosen .chaldlauncher file; null = dialog cancelled. Nothing is written. */
  'chaldpack:inspect': Ch<void, { token: string; summary: ChaldPackSummary } | null>;
  /** creates the instance from an inspected file; progress comes as op:progress (opId modpack:chald:<token>) */
  'chaldpack:import': Ch<{ token: string }, void>;
  /** save dialog + export; null = dialog cancelled */
  'chaldpack:export': Ch<{ id: string; includeWorlds: boolean }, (ChaldPackExportResult & { file: string }) | null>;

  /** other launchers found on this PC (all supported ones are listed; `found` tells which are installed) */
  'launchers:detect': Ch<void, LauncherSource[]>;
  /** folder dialog + recognising what is in the folder; null = dialog cancelled */
  'launchers:pickFolder': Ch<void, LauncherSource | null>;
  /** copies the chosen instances; progress comes as op:progress (opId modpack:import-<batch>) */
  'launchers:import': Ch<{ tokens: string[] }, { batch: string }>;
  'launchers:cancel': Ch<{ batch: string }, void>;

  'wardrobe:list': Ch<void, SkinEntry[]>;
  'wardrobe:import': Ch<void, SkinImportResult>;
  'wardrobe:update': Ch<{ id: string; patch: { name?: string; variant?: SkinVariant } }, SkinEntry>;
  'wardrobe:remove': Ch<{ id: string; confirm: true }, void>;
  /** Microsoft account only: the skin that is on the account now (null = none) */
  'wardrobe:current': Ch<void, AccountSkin | null>;
  'wardrobe:saveCurrent': Ch<{ name: string }, SkinImportResult>;
  'wardrobe:apply': Ch<{ id: string }, AccountSkin>;
  'wardrobe:reset': Ch<void, void>;
  /** Official account capes (Microsoft login only) */
  'wardrobe:listCapes': Ch<void, CapeListResult>;
  'wardrobe:equipCape': Ch<{ id: string }, CapeListResult>;
  'wardrobe:unequipCape': Ch<void, CapeListResult>;

  /** Chald Friends (local social server) */
  'friends:session': Ch<{ chaldId?: string | null }, import('./types').ChaldSessionResult>;
  /** the login (= Chald ID) is the account nickname, so only the password is sent */
  'friends:register': Ch<{ password: string }, import('./types').ChaldSessionResult>;
  'friends:login': Ch<{ login: string; password: string }, import('./types').ChaldSessionResult>;
  'friends:logout': Ch<void, boolean>;
  /** true once after an old Chald account (made before login = nickname) was reset: the user must register again */
  'friends:legacyReset': Ch<void, boolean>;
  'friends:me': Ch<void, import('./types').ChaldUser>;
  'friends:updateMe': Ch<{ displayName?: string; bio?: string; chaldId?: string }, import('./types').ChaldUser>;
  'friends:search': Ch<{ q: string }, import('./types').ChaldUser[]>;
  'friends:list': Ch<void, import('./types').ChaldFriendsList>;
  'friends:request': Ch<{ toChaldId?: string; toMcName?: string; toUserId?: number }, unknown>;
  'friends:accept': Ch<{ requestId: number }, unknown>;
  'friends:reject': Ch<{ requestId: number }, unknown>;
  'friends:remove': Ch<{ userId: number }, unknown>;
  'friends:hasSession': Ch<void, boolean>;
  /** Upload PNG head (data URL) for licensed skins — stored on the friends server */
  'friends:uploadAvatar': Ch<{ dataUrl: string }, boolean>;
  /** Resolve avatar: server PNG as data URL when hasAvatar, else null */
  'friends:avatarData': Ch<{ userId: number }, string | null>;
  'friends:inbox': Ch<void, { conversations: import('./types').ChaldConversation[] }>;
  'friends:thread': Ch<{ peerId: number; afterId?: number }, { messages: import('./types').ChaldMessage[]; peer: import('./types').ChaldUser | null }>;
  'friends:send': Ch<{ toUserId: number; body: string; kind?: 'text' | 'image' | 'share'; meta?: string | Record<string, unknown> }, { message: import('./types').ChaldMessage }>;
  'friends:invite': Ch<{ toUserId: number; instanceName: string; address?: string; note?: string }, unknown>;
  'friends:invites': Ch<void, { incoming: unknown[]; outgoing: unknown[] }>;
  'friends:inviteAccept': Ch<{ inviteId: number }, unknown>;
  'friends:inviteDecline': Ch<{ inviteId: number }, unknown>;
  'friends:callSignal': Ch<{ toUserId: number; kind: string; payload: string; groupId?: number | null }, unknown>;
  'friends:callPoll': Ch<void, { signals: { id: number; fromUserId: number; kind: string; payload: string; createdAt: number; groupId?: number | null }[] }>;
  /** Group chats */
  'friends:groups': Ch<void, import('./types').ChaldGroup[]>;
  'friends:groupCreate': Ch<{ name: string; memberIds?: number[] }, import('./types').ChaldGroup>;
  'friends:groupGet': Ch<{ groupId: number }, import('./types').ChaldGroup>;
  'friends:groupAddMember': Ch<{ groupId: number; userId: number }, import('./types').ChaldGroup>;
  'friends:groupRemoveMember': Ch<{ groupId: number; userId: number }, unknown>;
  'friends:groupUpdate': Ch<{ groupId: number; name: string }, import('./types').ChaldGroup>;
  'friends:groupDelete': Ch<{ groupId: number }, unknown>;
  'friends:groupThread': Ch<{ groupId: number; afterId?: number }, { messages: import('./types').ChaldMessage[]; group: import('./types').ChaldGroup | null }>;
  'friends:groupSend': Ch<{ groupId: number; body: string; kind?: 'text' | 'image' | 'share'; meta?: string | Record<string, unknown> }, { message: import('./types').ChaldMessage }>;
  'overlay:show': Ch<void, boolean>;
  'overlay:startCall': Ch<{ userId: number; name?: string; mcName?: string; groupId?: number | null; memberIds?: number[] }, boolean>;
  'overlay:toggle': Ch<void, boolean>;
  /** the overlay renderer reports the call phase: the HUD stays on screen while a call is going */
  'overlay:callState': Ch<{ phase: 'idle' | 'outgoing' | 'incoming' | 'connecting' | 'active' }, boolean>;


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

  /** tries a DNS configuration (also an unsaved one) on a real host */
  'net:testDns': Ch<{ dnsMode: DnsMode; dnsServers: string; dnsDohUrl: string }, DnsTestResult>;
  /** other Mojang games found on this PC (Windows only) */
  'mojang:status': Ch<void, MojangStatus>;
  'mojang:launch': Ch<{ game: MojangGameId; server?: BedrockServer }, void>;
  /** opens the game's (or the official launcher's) Microsoft Store page */
  'mojang:store': Ch<{ game: MojangGameId }, void>;
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
  'game:notice': GameNoticeEvent;
  'auth:deviceCode': DeviceCodeInfo;
  'auth:changed': AuthState;
  /** Progressive cape preview: emitted as each official cape texture finishes downloading. */
  'wardrobe:capePreview': { id: string; dataUrl: string };
}

export type IpcResult<T> = { ok: true; data: T } | { ok: false; error: { code: string; message: string } };
