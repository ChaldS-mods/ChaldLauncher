import { spawn } from 'node:child_process';
import * as path from 'node:path';
import { app, BrowserWindow, dialog, ipcMain, safeStorage, shell, type IpcMainInvokeEvent } from 'electron';
import { z } from 'zod';
import type { IpcContract, IpcResult } from '../shared/ipc';
import {
  appSettingsPatchSchema, createInstanceSchema, presencePageSchema, fileNameSchema, instanceIdSchema, modrinthIdSchema, modrinthSearchSchema, modrinthVersionsSchema, offlineNameSchema,
  updateInstanceSchema,
} from '../shared/schemas';
import { importContent, listContent, removeContent, toggleContent } from './content';
import { AppError } from './errors';
import { detectJava } from './java';
import { systemMemory } from './memory';
import { listInstalledProjects, loaderFilter } from './modrinth';
import { allowedHosts, clearNetLog, getNetLog } from './net';
import { DEFAULT_UPDATE_REPO } from './config';
import { Updater } from './updater';
import type { Services } from './services';
import { loaderVersions } from './versions';

const idArg = z.object({ id: instanceIdSchema });
const kindArg = z.enum(['mods', 'resourcepacks']);

/** Only our own renderer may call into the main process. */
function isTrusted(e: IpcMainInvokeEvent, trustedOrigins: string[]): boolean {
  const url = e.senderFrame?.url ?? '';
  return trustedOrigins.some((o) => url.startsWith(o));
}

export function registerIpc(s: Services, trustedOrigins: string[]): void {
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
    s.presence.configure(next.discordRpc, next.discordShowInstance);
    await s.auth.refresh();
    return next;
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
    const { id, projectId, kind, versionId } = z.object({
      id: instanceIdSchema, projectId: modrinthIdSchema, kind: z.enum(['mod', 'resourcepack']), versionId: modrinthIdSchema.nullish(),
    }).parse(arg);
    return s.installFromModrinth(id, projectId, kind, versionId ?? null);
  });
  handle('modrinth:installed', async (arg) => {
    const { id, kind } = z.object({ id: instanceIdSchema, kind: z.enum(['mod', 'resourcepack']) }).parse(arg);
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
  handle('modrinth:installPack', (arg) => {
    const { projectId, versionId } = z.object({ projectId: modrinthIdSchema, versionId: modrinthIdSchema.nullish() }).parse(arg);
    return s.startModpack(projectId, versionId ?? null);
  });
  handle('modrinth:cancelPack', (arg) => s.cancelModpack(z.object({ projectId: modrinthIdSchema }).parse(arg).projectId));

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

  const updater = new Updater({
    dir: path.join(app.getPath('userData'), 'updates'),
    version: app.getVersion(),
    platform: process.platform,
    repo: async () => (await s.settings.get()).updateRepo || DEFAULT_UPDATE_REPO,
    emit: (p) => s.emitProgress(p),
    gamesRunning: () => s.games.runningCount(),
    runInstaller: (file) =>
      new Promise<void>((resolve, reject) => {
        const child = spawn(file, ['--silent', '--launch'], { detached: true, stdio: 'ignore' });
        child.once('error', (err) => reject(new AppError('UPDATE_RUN_FAILED', `Не удалось запустить установщик: ${err.message}`)));
        child.once('spawn', () => { child.unref(); resolve(); });
      }),
    quit: () => app.quit(),
  });
  handle('update:check', () => updater.check());
  handle('update:download', () => updater.start());
  handle('update:install', () => updater.install());
}
