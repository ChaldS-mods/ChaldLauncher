import { execFile, spawn } from 'node:child_process';
import * as fsp from 'node:fs/promises';
import * as path from 'node:path';
import { app, BrowserWindow, dialog, ipcMain, safeStorage, shell, type IpcMainInvokeEvent } from 'electron';
import { z } from 'zod';
import type { IpcContract, IpcResult } from '../shared/ipc';
import {
  appSettingsPatchSchema, createInstanceSchema, dnsTestSchema, mojangLaunchSchema, mojangStoreSchema, presencePageSchema, fileNameSchema, instanceIdSchema, modrinthIdSchema, modrinthSearchSchema, modrinthVersionsSchema, offlineNameSchema,
  updateInstanceSchema, changeVersionSchema,
} from '../shared/schemas';
import { randomBytes } from 'node:crypto';
import { applyPlan, importJars, planArchive } from './archiveImport';
import type { ArchiveAnalysis, ContentAddResult } from '../shared/archive';
import { importContent, listContent, removeContent, toggleContent } from './content';
import { AppError } from './errors';
import { detectJava } from './java';
import { systemMemory } from './memory';
import { listInstalledProjects, loaderFilter } from './modrinth';
import { defaultEnv } from './launcherImport';
import { configureDns, testDns } from './dns';
import { MojangGames } from './mojangGames';
import { allowedHosts, clearNetLog, getNetLog } from './net';
import { DEFAULT_UPDATE_REPO } from './config';
import { Updater } from './updater';
import { relaunchEnv, replaceAppImage } from './selfUpdate';
import type { Services } from './services';
import { loaderVersions } from './versions';

const idArg = z.object({ id: instanceIdSchema });
const kindArg = z.enum(['mods', 'resourcepacks']);

/** Only our own renderer may call into the main process. */
function isTrusted(e: IpcMainInvokeEvent, trustedOrigins: string[]): boolean {
  const url = e.senderFrame?.url ?? '';
  return trustedOrigins.some((o) => url.startsWith(o));
}

/** Login = Chald ID: 3–20 chars, Latin letters, digits and "_"; a leading "@" typed by habit is dropped. */
const chaldLoginSchema = z
  .string()
  .transform((v) => v.trim().replace(/^@/, ''))
  .pipe(z.string().regex(/^[A-Za-z0-9_]{3,20}$/, 'Логин (он же Chald ID): 3–20 символов, латиница, цифры и «_»'));

export function registerIpc(s: Services, trustedOrigins: string[], extra?: {
  toggleOverlay?: () => boolean;
  showOverlay?: () => boolean;
  startCallOverlay?: (userId: number, name?: string, mcName?: string, groupId?: number | null, memberIds?: number[]) => boolean;
  setCallPhase?: (phase: 'idle' | 'outgoing' | 'incoming' | 'connecting' | 'active') => boolean;
}): { updater: Updater } {
  function handle<C extends keyof IpcContract>(
    channel: C,
    fn: (arg: unknown, e: IpcMainInvokeEvent) => Promise<IpcContract[C]['res']> | IpcContract[C]['res'],
  ): void {
    ipcMain.handle(channel, async (e, arg): Promise<IpcResult<IpcContract[C]['res']>> => {
      if (!isTrusted(e, trustedOrigins)) return { ok: false, error: { code: 'UNTRUSTED', message: 'Запрос отклонён' } };
      try {
        return { ok: true, data: await fn(arg, e) };
      } catch (err) {
        if (err instanceof z.ZodError) {
          return { ok: false, error: { code: 'INVALID_ARGS', message: err.issues[0]?.message ?? 'Некорректные данные' } };
        }
        if (err instanceof AppError) return { ok: false, error: { code: err.code, message: err.message } };
        return { ok: false, error: { code: 'INTERNAL', message: err instanceof Error ? err.message : String(err) } };
      }
    });
  }

  const winOf = (e: IpcMainInvokeEvent) => BrowserWindow.fromWebContents(e.sender);

  async function gameDirOf(id: string): Promise<{ gameDir: string; loader: import('../shared/types').LoaderType }> {
    const meta = await s.instances.readMeta(id);
    return { gameDir: await s.instances.gameDir(id), loader: meta.loader.type };
  }

  handle('app:info', async () => ({
    version: app.getVersion(),
    platform: process.platform,
    arch: process.arch,
    dataDir: app.getPath('userData'),
    instancesDir: await s.instancesRoot(),
    sharedDir: s.dirs.root,
    encryptionAvailable: safeStorage.isEncryptionAvailable(),
  }));

  handle('window:control', (arg, e) => {
    const action = z.enum(['minimize', 'maximize', 'close']).parse(arg);
    const w = winOf(e);
    if (!w) return;
    if (action === 'minimize') w.minimize();
    else if (action === 'maximize') (w.isMaximized() ? w.unmaximize() : w.maximize());
    else w.close();
  });

  handle('settings:get', () => s.settings.get());
  handle('settings:set', async (arg) => {
    const patch = appSettingsPatchSchema.parse(arg);
    const next = await s.settings.set(patch);
    s.closeBehavior = next.closeBehavior;
    configureDns({ mode: next.dnsMode, servers: next.dnsServers, dohUrl: next.dnsDohUrl });
    s.presence.configure(next.discordRpc, next.discordShowInstance, next.language);
    await s.auth.refresh();
    return next;
  });
  const mojang = new MojangGames({
    platform: process.platform,
    env: process.env,
    powershell: (script) =>
      new Promise((resolve, reject) =>
        execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script], { timeout: 20000, windowsHide: true, maxBuffer: 1 << 20 }, (err, out) => (err ? reject(err) : resolve(out))),
      ),
    exists: (file) => fsp.access(file).then(() => true, () => false),
    // only URIs built by MojangGames (minecraft:, ms-windows-store:) get here, never a string from the renderer
    openUri: (uri) => shell.openExternal(uri),
    spawnDetached: (file, args) => {
      const child = spawn(file, args, { detached: true, stdio: 'ignore' });
      child.on('error', () => undefined);
      child.unref();
    },
  });
  handle('mojang:status', () => mojang.status());
  handle('mojang:launch', (arg) => {
    const a = mojangLaunchSchema.parse(arg);
    return mojang.launch(a.game, a.server);
  });
  handle('mojang:store', (arg) => mojang.openStore(mojangStoreSchema.parse(arg).game));
  handle('net:testDns', (arg) => {
    const c = dnsTestSchema.parse(arg);
    return testDns({ mode: c.dnsMode, servers: c.dnsServers, dohUrl: c.dnsDohUrl });
  });
  handle('presence:page', (arg) => {
    s.presence.setPage(presencePageSchema.parse(arg));
  });
  handle('dialog:pickDirectory', async (arg, e) => {
    const { title } = z.object({ title: z.string().max(100) }).parse(arg);
    const w = winOf(e);
    const opts = { title, properties: ['openDirectory', 'createDirectory'] as ('openDirectory' | 'createDirectory')[] };
    const r = w ? await dialog.showOpenDialog(w, opts) : await dialog.showOpenDialog(opts);
    return r.canceled ? null : (r.filePaths[0] ?? null);
  });

  handle('instances:list', () => s.instances.list(s.ctx()));
  handle('instances:create', async (arg) => s.instances.create(createInstanceSchema.parse(arg), s.ctx()));
  handle('instances:update', async (arg) => {
    const { id, patch } = z.object({ id: instanceIdSchema, patch: updateInstanceSchema }).parse(arg);
    return s.instances.update(id, patch, s.ctx());
  });
  handle('instances:duplicate', async (arg) => {
    const { id, name } = z.object({ id: instanceIdSchema, name: z.string().trim().min(1).max(48) }).parse(arg);
    return s.instances.duplicate(id, name, s.ctx());
  });
  handle('instances:remove', async (arg) => {
    const { id, confirm } = z.object({ id: instanceIdSchema, confirm: z.literal(true) }).parse(arg);
    if (s.games.activeIds().has(id) || s.installs.has(id)) throw new AppError('BUSY', 'Останови игру или установку перед удалением');
    await s.instances.remove(id, confirm);
    if ((await s.settings.get()).lastInstanceId === id) await s.settings.set({ lastInstanceId: null });
  });
  handle('instances:openFolder', async (arg) => {
    const { id } = idArg.parse(arg);
    const dir = (await s.instances.get(id, s.ctx())).path;
    const err = await shell.openPath(dir);
    if (err) throw new AppError('OPEN_FAILED', err);
  });
  handle('instances:setCover', async (arg, e) => {
    const { id } = idArg.parse(arg);
    const w = winOf(e);
    const opts = { title: 'Обложка инстанса', properties: ['openFile'] as 'openFile'[], filters: [{ name: 'Изображения', extensions: ['png', 'jpg', 'jpeg', 'webp'] }] };
    const r = w ? await dialog.showOpenDialog(w, opts) : await dialog.showOpenDialog(opts);
    if (r.canceled || !r.filePaths[0]) return null;
    await s.instances.setCoverFromFile(id, r.filePaths[0]);
    return s.instances.get(id, s.ctx());
  });
  handle('instances:install', (arg) => s.startInstall(idArg.parse(arg).id));
  handle('instances:cancelInstall', (arg) => s.cancelInstall(idArg.parse(arg).id));
  handle('instances:changeVersion', (arg) => s.startVersionChange(changeVersionSchema.parse(arg)));
  handle('instances:select', async (arg) => {
    const { id } = z.object({ id: instanceIdSchema.nullable() }).parse(arg);
    await s.settings.set({ lastInstanceId: id });
  });

  handle('versions:minecraft', (arg) => {
    return s.catalog.minecraft(z.object({ refresh: z.boolean() }).parse(arg).refresh);
  });
  handle('versions:loaders', (arg) => {
    const { loader, mcVersion } = z.object({
      loader: z.enum(['fabric', 'quilt', 'forge', 'neoforge']),
      mcVersion: z.string().regex(/^[0-9A-Za-z._+-]{1,40}$/),
    }).parse(arg);
    return loaderVersions(loader, mcVersion);
  });

  handle('content:list', async (arg) => {
    const { id, kind } = z.object({ id: instanceIdSchema, kind: kindArg }).parse(arg);
    const { gameDir, loader } = await gameDirOf(id);
    return listContent(gameDir, kind, loader);
  });
  handle('content:toggle', async (arg) => {
    const { id, kind, file } = z.object({ id: instanceIdSchema, kind: kindArg, file: fileNameSchema }).parse(arg);
    if (s.games.activeIds().has(id)) throw new AppError('BUSY', 'Останови игру, чтобы менять файлы');
    await toggleContent((await gameDirOf(id)).gameDir, kind, file);
  });
  handle('content:remove', async (arg) => {
    const { id, kind, file, confirm } = z.object({ id: instanceIdSchema, kind: kindArg, file: fileNameSchema, confirm: z.literal(true) }).parse(arg);
    if (s.games.activeIds().has(id)) throw new AppError('BUSY', 'Останови игру, чтобы менять файлы');
    await removeContent((await gameDirOf(id)).gameDir, kind, file, confirm);
  });
  handle('content:import', async (arg, e) => {
    const { id, kind } = z.object({ id: instanceIdSchema, kind: kindArg }).parse(arg);
    if (s.games.activeIds().has(id)) throw new AppError('BUSY', 'Останови игру, чтобы менять файлы');
    const ext = kind === 'mods' ? 'jar' : 'zip';
    const w = winOf(e);
    const opts = { title: kind === 'mods' ? 'Импорт модов' : 'Импорт ресурспаков', properties: ['openFile', 'multiSelections'] as ('openFile' | 'multiSelections')[], filters: [{ name: ext.toUpperCase(), extensions: [ext] }] };
    const r = w ? await dialog.showOpenDialog(w, opts) : await dialog.showOpenDialog(opts);
    if (r.canceled) return 0;
    return importContent((await gameDirOf(id)).gameDir, kind, r.filePaths);
  });

  /** archives that need the user's decision: token -> instance + file (the file is read again when they decide) */
  const pendingArchives = new Map<string, { id: string; file: string }>();
  handle('content:add', async (arg, e) => {
    const { id, paths } = z.object({ id: instanceIdSchema, paths: z.array(z.string().min(1).max(4096)).max(500).nullable() }).parse(arg);
    if (s.games.activeIds().has(id)) throw new AppError('BUSY', 'Останови игру, чтобы менять файлы');
    const out: ContentAddResult = { imported: 0, skipped: 0, pending: [], errors: [] };
    let files = paths;
    if (!files) {
      const w = winOf(e);
      const opts = {
        title: 'Добавить моды',
        properties: ['openFile', 'multiSelections'] as ('openFile' | 'multiSelections')[],
        filters: [{ name: 'Моды (.jar) и архивы (.zip)', extensions: ['jar', 'zip'] }],
      };
      const r = w ? await dialog.showOpenDialog(w, opts) : await dialog.showOpenDialog(opts);
      if (r.canceled) return out;
      files = r.filePaths;
    }
    const { gameDir } = await gameDirOf(id);
    const why = (err: unknown) => (err instanceof Error ? err.message : String(err));
    const jars: string[] = [];
    for (const f of files) {
      const name = path.basename(f);
      const ext = path.extname(f).toLowerCase();
      if (!path.isAbsolute(f)) {
        out.errors.push(`«${name}»: не удалось определить путь к файлу`);
      } else if (ext === '.jar') {
        jars.push(f);
      } else if (ext === '.zip') {
        try {
          const { zip, plan } = await planArchive(f);
          if (plan.kind === 'modpack') {
            out.errors.push(`«${name}»: это сборка, а не набор модов. Установи её на странице Modrinth или CurseForge, либо через «Импорт» на странице инстансов.`);
          } else if (plan.kind === 'empty') {
            out.errors.push(`«${name}»: в архиве нет ни модов, ни других нужных файлов`);
          } else if (plan.kind === 'mods') {
            const r = await applyPlan(zip, plan, gameDir, 'mods');
            out.imported += r.mods;
            out.skipped += r.skipped;
          } else {
            const token = randomBytes(8).toString('hex');
            pendingArchives.set(token, { id, file: f });
            if (pendingArchives.size > 50) pendingArchives.delete(pendingArchives.keys().next().value!);
            const a: ArchiveAnalysis = { token, name, mods: plan.mods, modBytes: plan.modBytes, groups: plan.groups, ignored: plan.ignored };
            out.pending.push(a);
          }
        } catch (err) {
          out.errors.push(`«${name}»: ${why(err)}`);
        }
      } else {
        out.errors.push(`«${name}»: поддерживаются файлы .jar и архивы .zip (для .rar и .7z сначала распакуй файлы)`);
      }
    }
    if (jars.length) {
      try {
        const r = await importJars(gameDir, jars);
        out.imported += r.imported;
        out.skipped += r.skipped;
      } catch (err) {
        out.errors.push(why(err));
      }
    }
    return out;
  });
  handle('content:applyArchive', async (arg) => {
    const { id, token, mode } = z.object({ id: instanceIdSchema, token: z.string().regex(/^[a-f0-9]{16}$/), mode: z.enum(['mods', 'all']) }).parse(arg);
    if (s.games.activeIds().has(id)) throw new AppError('BUSY', 'Останови игру, чтобы менять файлы');
    const p = pendingArchives.get(token);
    if (!p || p.id !== id) throw new AppError('ARCHIVE_EXPIRED', 'Список устарел. Добавь архив заново.');
    pendingArchives.delete(token);
    const { gameDir } = await gameDirOf(id);
    const { zip, plan } = await planArchive(p.file); // read again: the file may have changed since the question was asked
    if (plan.kind === 'modpack' || plan.kind === 'empty') throw new AppError('ARCHIVE_CHANGED', 'Содержимое архива изменилось. Добавь его заново.');
    return applyPlan(zip, plan, gameDir, mode);
  });

  handle('instances:worlds', (arg) => s.listWorlds(z.object({ id: instanceIdSchema }).parse(arg).id));

  handle('modrinth:search', (arg) => s.modrinth.search(modrinthSearchSchema.parse(arg)));
  handle('modrinth:project', (arg) => s.modrinth.projectInfo(z.object({ projectId: modrinthIdSchema }).parse(arg).projectId));
  handle('modrinth:versions', (arg) => {
    const q = modrinthVersionsSchema.parse(arg);
    return s.modrinth.versionInfos(q.projectId, { mcVersion: q.mcVersion, loaders: q.loader ? loaderFilter(q.loader) : null });
  });
  handle('modrinth:openPage', (arg) => {
    const { type, slug } = z.object({ type: z.enum(['mod', 'modpack', 'resourcepack']), slug: z.string().min(1).max(64) }).parse(arg);
    s.openModrinthPage(type, slug);
  });
  handle('modrinth:install', (arg) => {
    const { id, projectId, kind, versionId, worldName } = z.object({
      id: instanceIdSchema, projectId: modrinthIdSchema, kind: z.enum(['mod', 'resourcepack', 'shader', 'datapack']), versionId: modrinthIdSchema.nullish(),
      worldName: z.string().min(1).max(128).nullish(),
    }).parse(arg);
    return s.installFromModrinth(id, projectId, kind, versionId ?? null, worldName ?? null);
  });
  handle('modrinth:installed', async (arg) => {
    const { id, kind } = z.object({ id: instanceIdSchema, kind: z.enum(['mod', 'resourcepack', 'shader', 'datapack']) }).parse(arg);
    return listInstalledProjects((await gameDirOf(id)).gameDir, kind);
  });
  handle('chaldpack:inspect', async (_arg, e) => {
    const w = winOf(e);
    const opts = { title: 'Импорт инстанса', properties: ['openFile'] as 'openFile'[], filters: [{ name: 'Инстанс ChaldLauncher', extensions: ['chaldlauncher'] }] };
    const r = w ? await dialog.showOpenDialog(w, opts) : await dialog.showOpenDialog(opts);
    if (r.canceled || !r.filePaths[0]) return null;
    return s.inspectChaldPack(r.filePaths[0]);
  });
  handle('chaldpack:import', (arg) => s.startChaldPack(z.object({ token: z.string().regex(/^[a-f0-9]{16}$/) }).parse(arg).token));
  handle('chaldpack:export', async (arg, e) => {
    const { id, includeWorlds } = z.object({ id: instanceIdSchema, includeWorlds: z.boolean() }).parse(arg);
    const meta = await s.instances.readMeta(id);
    const w = winOf(e);
    const opts = { title: 'Экспорт инстанса', defaultPath: `${meta.name.replace(/[\\/:*?"<>|]+/g, '_').trim() || 'instance'}.chaldlauncher`, filters: [{ name: 'Инстанс ChaldLauncher', extensions: ['chaldlauncher'] }] };
    const r = w ? await dialog.showSaveDialog(w, opts) : await dialog.showSaveDialog(opts);
    if (r.canceled || !r.filePath) return null;
    const file = r.filePath.toLowerCase().endsWith('.chaldlauncher') ? r.filePath : `${r.filePath}.chaldlauncher`;
    return { ...(await s.exportChaldPack(id, file, includeWorlds)), file };
  });
  handle('launchers:detect', () => {
    const safe = (name: 'appData' | 'documents' | 'home'): string | undefined => {
      try { return app.getPath(name); } catch { return undefined; }
    };
    const home = safe('home');
    const appData = safe('appData');
    const documents = safe('documents');
    return s.detectLaunchers(defaultEnv({ ...(home ? { home } : {}), ...(appData ? { appData } : {}), ...(documents ? { documents } : {}) }));
  });
  handle('launchers:pickFolder', async (_arg, e) => {
    const w = winOf(e);
    const opts = { title: 'Папка лаунчера или инстанса', properties: ['openDirectory'] as 'openDirectory'[] };
    const r = w ? await dialog.showOpenDialog(w, opts) : await dialog.showOpenDialog(opts);
    if (r.canceled || !r.filePaths[0]) return null;
    return s.sourceFromFolder(r.filePaths[0]);
  });
  handle('launchers:import', (arg) => s.startLauncherImport(z.object({ tokens: z.array(z.string().regex(/^[a-f0-9]{16}$/)).min(1).max(200) }).parse(arg).tokens));
  handle('launchers:cancel', (arg) => s.cancelLauncherImport(z.object({ batch: z.string().regex(/^[a-f0-9]{12}$/) }).parse(arg).batch));
  handle('modrinth:installPack', (arg) => {
    const { projectId, versionId } = z.object({ projectId: modrinthIdSchema, versionId: modrinthIdSchema.nullish() }).parse(arg);
    return s.startModpack(projectId, versionId ?? null);
  });
  handle('modrinth:cancelPack', (arg) => s.cancelModpack(z.object({ projectId: modrinthIdSchema }).parse(arg).projectId));

  handle('curseforge:search', (arg) => {
    const q = z.object({
      query: z.string().max(200).default(''),
      classType: z.enum(['mod', 'modpack', 'resourcepack', 'shader', 'datapack']).default('mod'),
      mcVersion: z.string().max(40).nullable().default(null),
      loader: z.enum(['fabric', 'quilt', 'forge', 'neoforge']).nullable().default(null),
      sort: z.enum(['featured', 'popularity', 'lastUpdated', 'name', 'totalDownloads']).default('popularity'),
      offset: z.number().int().min(0).max(10_000).default(0),
    }).parse(arg);
    return s.curseforge.search(q);
  });
  handle('curseforge:project', (arg) => s.curseforge.getMod(z.object({ modId: z.number().int().positive() }).parse(arg).modId));
  handle('curseforge:files', (arg) => {
    const q = z.object({
      modId: z.number().int().positive(),
      mcVersion: z.string().max(40).nullable().default(null),
      loader: z.enum(['fabric', 'quilt', 'forge', 'neoforge']).nullable().default(null),
    }).parse(arg);
    return s.curseforge.files(q.modId, { mcVersion: q.mcVersion, loader: q.loader, pageSize: 50 });
  });
  handle('curseforge:install', (arg) => {
    const { id, modId, kind, fileId, worldName } = z.object({
      id: instanceIdSchema,
      modId: z.number().int().positive(),
      kind: z.enum(['mod', 'resourcepack', 'shader', 'datapack']),
      fileId: z.number().int().positive().nullish(),
      worldName: z.string().min(1).max(128).nullish(),
    }).parse(arg);
    return s.installFromCurseForge(id, modId, kind, fileId ?? null, worldName ?? null);
  });
  handle('curseforge:installPack', (arg) => {
    const { modId, fileId } = z.object({
      modId: z.number().int().positive(),
      fileId: z.number().int().positive().nullish(),
    }).parse(arg);
    s.startCfModpack(modId, fileId ?? null);
  });
  handle('curseforge:installed', (arg) => {
    const { id, kind } = z.object({ id: instanceIdSchema, kind: z.enum(['mod', 'resourcepack', 'shader', 'datapack']) }).parse(arg);
    return s.listCurseForgeInstalled(id, kind);
  });
  handle('curseforge:openPage', (arg) => {
    const { slug } = z.object({ slug: z.string().min(1).max(128) }).parse(arg);
    s.openCurseForgePage(slug);
  });

  const skinId = z.string().regex(/^[a-f0-9]{12}$/, 'Некорректный идентификатор скина');
  const skinName = z.string().trim().min(1, 'Введи название скина').max(32, 'Не длиннее 32 символов');
  handle('wardrobe:list', () => s.wardrobe.list());
  handle('wardrobe:import', async (_arg, e) => {
    const w = winOf(e);
    const opts = { title: 'Добавить скины', properties: ['openFile', 'multiSelections'] as ('openFile' | 'multiSelections')[], filters: [{ name: 'Скины (PNG)', extensions: ['png'] }] };
    const r = w ? await dialog.showOpenDialog(w, opts) : await dialog.showOpenDialog(opts);
    if (r.canceled) return { added: [], problems: [] };
    return s.wardrobe.importFiles(r.filePaths);
  });
  handle('wardrobe:update', (arg) => {
    const { id, patch } = z.object({ id: skinId, patch: z.object({ name: skinName.optional(), variant: z.enum(['classic', 'slim']).optional() }) }).parse(arg);
    return s.wardrobe.update(id, patch);
  });
  handle('wardrobe:remove', async (arg) => {
    const { id } = z.object({ id: skinId, confirm: z.literal(true) }).parse(arg);
    await s.wardrobe.remove(id);
  });
  handle('wardrobe:current', () => s.wardrobe.current());
  handle('wardrobe:saveCurrent', async (arg) => {
    const { name } = z.object({ name: skinName }).parse(arg);
    const { entry, duplicate } = await s.wardrobe.saveCurrent(name);
    return duplicate ? { added: [], problems: [`Такой скин уже есть в гардеробе («${entry.name}»)`] } : { added: [entry], problems: [] };
  });
  handle('wardrobe:apply', (arg) => s.wardrobe.apply(z.object({ id: skinId }).parse(arg).id));
  handle('wardrobe:reset', () => s.wardrobe.reset());
  handle('wardrobe:listCapes', () => s.wardrobe.listCapes());
  handle('wardrobe:equipCape', (arg) => {
    const { id } = z.object({ id: z.string().min(1).max(64) }).parse(arg);
    return s.wardrobe.equipCape(id);
  });
  handle('wardrobe:unequipCape', () => s.wardrobe.unequipCape());

  handle('friends:hasSession', () => s.friends.hasToken());
  handle('friends:uploadAvatar', async (arg) => {
    const { dataUrl } = z.object({ dataUrl: z.string().min(32).max(200_000) }).parse(arg);
    if (!dataUrl.startsWith('data:image/png')) throw new AppError('AVATAR_TYPE', 'Нужен PNG');
    await s.friends.uploadAvatar(dataUrl);
    return true;
  });
  handle('friends:avatarData', async (arg) => {
    const { userId } = z.object({ userId: z.number().int().positive() }).parse(arg);
    return s.friends.fetchAvatarDataUrl(userId);
  });
  handle('friends:register', async (arg) => {
    // the login IS the Chald ID, and it is bound to the account nickname (Microsoft or offline): the client sends only a password
    const body = z.object({ password: z.string().min(6).max(72) }).parse(arg ?? {});
    const st = await s.auth.state();
    if (!st.loggedIn || !st.uuid || !st.name) {
      throw new AppError('FRIENDS_AUTH', 'Сначала укажи offline-ник или войди через Microsoft.');
    }
    const login = chaldLoginSchema.safeParse(st.name);
    if (!login.success) {
      throw new AppError('FRIENDS_AUTH', 'Ник должен быть из 3–20 символов (латиница, цифры, «_»), чтобы стать Chald ID.');
    }
    return s.friends.registerAccount(login.data, body.password, st.uuid, st.name);
  });
  handle('friends:login', async (arg) => {
    const body = z.object({
      login: chaldLoginSchema,
      password: z.string().min(6).max(72),
    }).parse(arg ?? {});
    return s.friends.loginAccount(body.login, body.password);
  });
  handle('friends:session', async (arg) => {
    const { chaldId } = z.object({ chaldId: z.string().min(3).max(20).nullable().optional() }).parse(arg ?? {});
    const st = await s.auth.state();
    if (!st.loggedIn || !st.uuid || !st.name) {
      throw new AppError(
        'FRIENDS_AUTH',
        st.mode === 'offline'
          ? 'Укажи ник в настройках аккаунта (режим Offline), затем зарегистрируй Chald ID.'
          : 'Войди через Microsoft или включи offline-ник, чтобы зарегистрировать Chald ID.',
      );
    }
    return s.friends.session(st.uuid, st.name, chaldId ?? null);
  });
  handle('friends:legacyReset', () => s.consumeFriendsLegacyReset());
  handle('friends:logout', () => { s.friends.clearSession(); return true; });
  handle('friends:me', () => s.friends.me());
  handle('friends:updateMe', (arg) => {
    const patch = z.object({
      displayName: z.string().min(1).max(32).optional(),
      bio: z.string().max(200).optional(),
      chaldId: z.string().min(3).max(20).optional(),
    }).parse(arg ?? {});
    return s.friends.updateMe(patch);
  });
  handle('friends:search', (arg) => {
    const { q } = z.object({ q: z.string().min(1).max(32) }).parse(arg);
    return s.friends.search(q);
  });
  handle('friends:list', () => s.friends.list());
  handle('friends:request', (arg) => {
    const body = z.object({
      toChaldId: z.string().min(1).max(20).optional(),
      toMcName: z.string().min(1).max(16).optional(),
      toUserId: z.number().int().positive().optional(),
    }).parse(arg ?? {});
    return s.friends.requestFriend(body);
  });
  handle('friends:accept', (arg) => {
    const { requestId } = z.object({ requestId: z.number().int().positive() }).parse(arg);
    return s.friends.accept(requestId);
  });
  handle('friends:reject', (arg) => {
    const { requestId } = z.object({ requestId: z.number().int().positive() }).parse(arg);
    return s.friends.reject(requestId);
  });
  handle('friends:remove', (arg) => {
    const { userId } = z.object({ userId: z.number().int().positive() }).parse(arg);
    return s.friends.remove(userId);
  });
  handle('friends:inbox', () => s.friends.inbox());
  handle('friends:thread', (arg) => {
    const { peerId, afterId } = z.object({
      peerId: z.number().int().positive(),
      afterId: z.number().int().nonnegative().optional(),
    }).parse(arg);
    return s.friends.thread(peerId, afterId ?? 0);
  });
  handle('friends:send', (arg) => {
    const body = z.object({
      toUserId: z.number().int().positive(),
      body: z.string().min(1).max(450_000),
      kind: z.enum(['text', 'image', 'share']).optional(),
      meta: z.union([z.string(), z.record(z.string(), z.unknown())]).optional(),
    }).parse(arg);
    return s.friends.sendMessage(body.toUserId, body.body, body.kind ?? 'text', body.meta);
  });
  handle('friends:invite', (arg) => {
    const body = z.object({
      toUserId: z.number().int().positive(),
      instanceName: z.string().max(64),
      address: z.string().max(128).optional(),
      note: z.string().max(200).optional(),
    }).parse(arg);
    return s.friends.sendInvite(body.toUserId, body.instanceName, body.address ?? '', body.note ?? '');
  });
  handle('friends:invites', () => s.friends.listInvites());
  handle('friends:inviteAccept', (arg) => {
    const { inviteId } = z.object({ inviteId: z.number().int().positive() }).parse(arg);
    return s.friends.acceptInvite(inviteId);
  });
  handle('friends:inviteDecline', (arg) => {
    const { inviteId } = z.object({ inviteId: z.number().int().positive() }).parse(arg);
    return s.friends.declineInvite(inviteId);
  });
  handle('friends:callSignal', (arg) => {
    const body = z.object({
      toUserId: z.number().int().positive(),
      kind: z.enum(['offer', 'answer', 'ice', 'hangup', 'ring']),
      payload: z.string().max(16000),
      groupId: z.number().int().positive().nullable().optional(),
    }).parse(arg);
    return s.friends.sendCallSignal(body.toUserId, body.kind, body.payload, body.groupId);
  });
  handle('friends:callPoll', () => s.friends.pollCallSignals());

  handle('friends:groups', () => s.friends.listGroups());
  handle('friends:groupCreate', (arg) => {
    const body = z.object({
      name: z.string().trim().min(1).max(64),
      memberIds: z.array(z.number().int().positive()).max(32).optional(),
    }).parse(arg);
    return s.friends.createGroup(body.name, body.memberIds ?? []);
  });
  handle('friends:groupGet', (arg) => {
    const { groupId } = z.object({ groupId: z.number().int().positive() }).parse(arg);
    return s.friends.getGroup(groupId);
  });
  handle('friends:groupAddMember', (arg) => {
    const body = z.object({
      groupId: z.number().int().positive(),
      userId: z.number().int().positive(),
    }).parse(arg);
    return s.friends.addGroupMember(body.groupId, body.userId);
  });
  handle('friends:groupRemoveMember', (arg) => {
    const body = z.object({
      groupId: z.number().int().positive(),
      userId: z.number().int().positive(),
    }).parse(arg);
    return s.friends.removeGroupMember(body.groupId, body.userId);
  });
  handle('friends:groupUpdate', (arg) => {
    const body = z.object({
      groupId: z.number().int().positive(),
      name: z.string().trim().min(1).max(64),
    }).parse(arg);
    return s.friends.updateGroup(body.groupId, body.name);
  });
  handle('friends:groupDelete', (arg) => {
    const { groupId } = z.object({ groupId: z.number().int().positive() }).parse(arg);
    return s.friends.deleteGroup(groupId);
  });
  handle('friends:groupThread', (arg) => {
    const body = z.object({
      groupId: z.number().int().positive(),
      afterId: z.number().int().nonnegative().optional(),
    }).parse(arg);
    return s.friends.groupThread(body.groupId, body.afterId ?? 0);
  });
  handle('friends:groupSend', (arg) => {
    const body = z.object({
      groupId: z.number().int().positive(),
      body: z.string().min(1).max(450_000),
      kind: z.enum(['text', 'image', 'share']).optional(),
      meta: z.union([z.string(), z.record(z.string(), z.unknown())]).optional(),
    }).parse(arg);
    return s.friends.sendGroupMessage(body.groupId, body.body, body.kind ?? 'text', body.meta);
  });

  handle('overlay:toggle', () => {
    if (extra?.toggleOverlay) return extra.toggleOverlay();
    return false;
  });
  handle('overlay:show', () => {
    if (extra?.showOverlay) return extra.showOverlay();
    return false;
  });
  handle('overlay:callState', (arg) => {
    const { phase } = z.object({ phase: z.enum(['idle', 'outgoing', 'incoming', 'connecting', 'active']) }).parse(arg ?? {});
    return extra?.setCallPhase ? extra.setCallPhase(phase) : false;
  });
  handle('overlay:startCall', (arg) => {
    const body = z.object({
      userId: z.number().int().nonnegative().default(0),
      name: z.string().max(64).optional(),
      mcName: z.string().max(16).optional(),
      groupId: z.number().int().positive().nullable().optional(),
      memberIds: z.array(z.number().int().positive()).max(32).optional(),
    }).parse(arg ?? {});
    if (extra?.startCallOverlay) {
      return extra.startCallOverlay(body.userId, body.name, body.mcName, body.groupId, body.memberIds);
    }
    return false;
  });


  handle('java:detect', () => detectJava(s.dirs));
  handle('system:memory', () => systemMemory());

  handle('auth:state', () => s.auth.state());
  handle('auth:login', (arg) => s.auth.login(z.object({ method: z.enum(['browser', 'code']).default('browser') }).parse(arg ?? {}).method));
  handle('auth:cancel', () => s.auth.cancel());
  handle('auth:logout', () => s.auth.logout());
  handle('auth:setOffline', (arg) => s.auth.setOffline(z.object({ name: offlineNameSchema }).parse(arg).name));

  handle('game:launch', (arg) => s.games.launch(idArg.parse(arg).id));
  handle('game:stop', (arg) => s.games.stop(idArg.parse(arg).id));
  handle('game:logs', (arg) => s.games.getLogs(idArg.parse(arg).id));

  handle('net:log', () => getNetLog());
  handle('net:clear', () => clearNetLog());
  handle('net:allowedHosts', () => allowedHosts());

  // Linux: only an AppImage can replace itself; the AppImage runtime tells where the running file is
  const appImage = process.platform === 'linux' && process.env.APPIMAGE ? process.env.APPIMAGE : null;
  const startDetached = (file: string, args: string[], env: NodeJS.ProcessEnv): Promise<void> =>
    new Promise<void>((resolve, reject) => {
      const child = spawn(file, args, { detached: true, stdio: 'ignore', env });
      child.once('error', (err) => reject(new AppError('UPDATE_RUN_FAILED', `Не удалось запустить установщик: ${err.message}`)));
      child.once('spawn', () => { child.unref(); resolve(); });
    });
  const updater = new Updater({
    dir: path.join(app.getPath('userData'), 'updates'),
    version: app.getVersion(),
    platform: process.platform,
    appImage,
    arch: process.arch,
    repo: async () => (await s.settings.get()).updateRepo || DEFAULT_UPDATE_REPO,
    autoInstall: async () => (await s.settings.get()).autoInstallUpdates,
    emit: (p) => s.emitProgress(p),
    gamesRunning: () => s.games.runningCount(),
    runInstaller: async (file, { launch }) => {
      if (appImage) {
        await replaceAppImage(file, appImage);
        // the old process still holds the single-instance lock for a moment: start the new one a little later
        if (launch) await startDetached('/bin/sh', ['-c', 'sleep 2; exec "$0"', appImage], relaunchEnv(process.env));
        return;
      }
      if (process.platform !== 'win32') throw new AppError('UPDATE_NO_FILE', 'Автообновление на этой системе недоступно.');
      await startDetached(file, launch ? ['--silent', '--launch'] : ['--silent'], process.env);
    },
    quit: () => app.quit(),
  });
  handle('update:check', () => updater.check());
  handle('update:download', () => updater.start());
  handle('update:install', () => updater.install());

  return { updater };
}
