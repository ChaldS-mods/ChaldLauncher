"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.registerIpc = registerIpc;
const node_child_process_1 = require("node:child_process");
const fsp = __importStar(require("node:fs/promises"));
const path = __importStar(require("node:path"));
const electron_1 = require("electron");
const zod_1 = require("zod");
const schemas_1 = require("../shared/schemas");
const content_1 = require("./content");
const errors_1 = require("./errors");
const java_1 = require("./java");
const memory_1 = require("./memory");
const modrinth_1 = require("./modrinth");
const dns_1 = require("./dns");
const mojangGames_1 = require("./mojangGames");
const net_1 = require("./net");
const config_1 = require("./config");
const updater_1 = require("./updater");
const versions_1 = require("./versions");
const idArg = zod_1.z.object({ id: schemas_1.instanceIdSchema });
const kindArg = zod_1.z.enum(['mods', 'resourcepacks']);
/** Only our own renderer may call into the main process. */
function isTrusted(e, trustedOrigins) {
    const url = e.senderFrame?.url ?? '';
    return trustedOrigins.some((o) => url.startsWith(o));
}
function registerIpc(s, trustedOrigins) {
    function handle(channel, fn) {
        electron_1.ipcMain.handle(channel, async (e, arg) => {
            if (!isTrusted(e, trustedOrigins))
                return { ok: false, error: { code: 'UNTRUSTED', message: 'Запрос отклонён' } };
            try {
                return { ok: true, data: await fn(arg, e) };
            }
            catch (err) {
                if (err instanceof zod_1.z.ZodError) {
                    return { ok: false, error: { code: 'INVALID_ARGS', message: err.issues[0]?.message ?? 'Некорректные данные' } };
                }
                if (err instanceof errors_1.AppError)
                    return { ok: false, error: { code: err.code, message: err.message } };
                return { ok: false, error: { code: 'INTERNAL', message: err instanceof Error ? err.message : String(err) } };
            }
        });
    }
    const winOf = (e) => electron_1.BrowserWindow.fromWebContents(e.sender);
    async function gameDirOf(id) {
        const meta = await s.instances.readMeta(id);
        return { gameDir: await s.instances.gameDir(id), loader: meta.loader.type };
    }
    handle('app:info', async () => ({
        version: electron_1.app.getVersion(),
        platform: process.platform,
        arch: process.arch,
        dataDir: electron_1.app.getPath('userData'),
        instancesDir: await s.instancesRoot(),
        sharedDir: s.dirs.root,
        encryptionAvailable: electron_1.safeStorage.isEncryptionAvailable(),
    }));
    handle('window:control', (arg, e) => {
        const action = zod_1.z.enum(['minimize', 'maximize', 'close']).parse(arg);
        const w = winOf(e);
        if (!w)
            return;
        if (action === 'minimize')
            w.minimize();
        else if (action === 'maximize')
            (w.isMaximized() ? w.unmaximize() : w.maximize());
        else
            w.close();
    });
    handle('settings:get', () => s.settings.get());
    handle('settings:set', async (arg) => {
        const patch = schemas_1.appSettingsPatchSchema.parse(arg);
        const next = await s.settings.set(patch);
        s.closeBehavior = next.closeBehavior;
        (0, dns_1.configureDns)({ mode: next.dnsMode, servers: next.dnsServers, dohUrl: next.dnsDohUrl });
        s.presence.configure(next.discordRpc, next.discordShowInstance, next.language);
        await s.auth.refresh();
        return next;
    });
    const mojang = new mojangGames_1.MojangGames({
        platform: process.platform,
        env: process.env,
        powershell: (script) => new Promise((resolve, reject) => (0, node_child_process_1.execFile)('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script], { timeout: 20000, windowsHide: true, maxBuffer: 1 << 20 }, (err, out) => (err ? reject(err) : resolve(out)))),
        exists: (file) => fsp.access(file).then(() => true, () => false),
        // only URIs built by MojangGames (minecraft:, ms-windows-store:) get here, never a string from the renderer
        openUri: (uri) => electron_1.shell.openExternal(uri),
        spawnDetached: (file, args) => {
            const child = (0, node_child_process_1.spawn)(file, args, { detached: true, stdio: 'ignore' });
            child.on('error', () => undefined);
            child.unref();
        },
    });
    handle('mojang:status', () => mojang.status());
    handle('mojang:launch', (arg) => {
        const a = schemas_1.mojangLaunchSchema.parse(arg);
        return mojang.launch(a.game, a.server);
    });
    handle('mojang:store', (arg) => mojang.openStore(schemas_1.mojangStoreSchema.parse(arg).game));
    handle('net:testDns', (arg) => {
        const c = schemas_1.dnsTestSchema.parse(arg);
        return (0, dns_1.testDns)({ mode: c.dnsMode, servers: c.dnsServers, dohUrl: c.dnsDohUrl });
    });
    handle('presence:page', (arg) => {
        s.presence.setPage(schemas_1.presencePageSchema.parse(arg));
    });
    handle('dialog:pickDirectory', async (arg, e) => {
        const { title } = zod_1.z.object({ title: zod_1.z.string().max(100) }).parse(arg);
        const w = winOf(e);
        const opts = { title, properties: ['openDirectory', 'createDirectory'] };
        const r = w ? await electron_1.dialog.showOpenDialog(w, opts) : await electron_1.dialog.showOpenDialog(opts);
        return r.canceled ? null : (r.filePaths[0] ?? null);
    });
    handle('instances:list', () => s.instances.list(s.ctx()));
    handle('instances:create', async (arg) => s.instances.create(schemas_1.createInstanceSchema.parse(arg), s.ctx()));
    handle('instances:update', async (arg) => {
        const { id, patch } = zod_1.z.object({ id: schemas_1.instanceIdSchema, patch: schemas_1.updateInstanceSchema }).parse(arg);
        return s.instances.update(id, patch, s.ctx());
    });
    handle('instances:duplicate', async (arg) => {
        const { id, name } = zod_1.z.object({ id: schemas_1.instanceIdSchema, name: zod_1.z.string().trim().min(1).max(48) }).parse(arg);
        return s.instances.duplicate(id, name, s.ctx());
    });
    handle('instances:remove', async (arg) => {
        const { id, confirm } = zod_1.z.object({ id: schemas_1.instanceIdSchema, confirm: zod_1.z.literal(true) }).parse(arg);
        if (s.games.activeIds().has(id) || s.installs.has(id))
            throw new errors_1.AppError('BUSY', 'Останови игру или установку перед удалением');
        await s.instances.remove(id, confirm);
        if ((await s.settings.get()).lastInstanceId === id)
            await s.settings.set({ lastInstanceId: null });
    });
    handle('instances:openFolder', async (arg) => {
        const { id } = idArg.parse(arg);
        const dir = (await s.instances.get(id, s.ctx())).path;
        const err = await electron_1.shell.openPath(dir);
        if (err)
            throw new errors_1.AppError('OPEN_FAILED', err);
    });
    handle('instances:setCover', async (arg, e) => {
        const { id } = idArg.parse(arg);
        const w = winOf(e);
        const opts = { title: 'Обложка инстанса', properties: ['openFile'], filters: [{ name: 'Изображения', extensions: ['png', 'jpg', 'jpeg', 'webp'] }] };
        const r = w ? await electron_1.dialog.showOpenDialog(w, opts) : await electron_1.dialog.showOpenDialog(opts);
        if (r.canceled || !r.filePaths[0])
            return null;
        await s.instances.setCoverFromFile(id, r.filePaths[0]);
        return s.instances.get(id, s.ctx());
    });
    handle('instances:install', (arg) => s.startInstall(idArg.parse(arg).id));
    handle('instances:cancelInstall', (arg) => s.cancelInstall(idArg.parse(arg).id));
    handle('instances:select', async (arg) => {
        const { id } = zod_1.z.object({ id: schemas_1.instanceIdSchema.nullable() }).parse(arg);
        await s.settings.set({ lastInstanceId: id });
    });
    handle('versions:minecraft', (arg) => {
        return s.catalog.minecraft(zod_1.z.object({ refresh: zod_1.z.boolean() }).parse(arg).refresh);
    });
    handle('versions:loaders', (arg) => {
        const { loader, mcVersion } = zod_1.z.object({
            loader: zod_1.z.enum(['fabric', 'quilt', 'forge', 'neoforge']),
            mcVersion: zod_1.z.string().regex(/^[0-9A-Za-z._+-]{1,40}$/),
        }).parse(arg);
        return (0, versions_1.loaderVersions)(loader, mcVersion);
    });
    handle('content:list', async (arg) => {
        const { id, kind } = zod_1.z.object({ id: schemas_1.instanceIdSchema, kind: kindArg }).parse(arg);
        const { gameDir, loader } = await gameDirOf(id);
        return (0, content_1.listContent)(gameDir, kind, loader);
    });
    handle('content:toggle', async (arg) => {
        const { id, kind, file } = zod_1.z.object({ id: schemas_1.instanceIdSchema, kind: kindArg, file: schemas_1.fileNameSchema }).parse(arg);
        if (s.games.activeIds().has(id))
            throw new errors_1.AppError('BUSY', 'Останови игру, чтобы менять файлы');
        await (0, content_1.toggleContent)((await gameDirOf(id)).gameDir, kind, file);
    });
    handle('content:remove', async (arg) => {
        const { id, kind, file, confirm } = zod_1.z.object({ id: schemas_1.instanceIdSchema, kind: kindArg, file: schemas_1.fileNameSchema, confirm: zod_1.z.literal(true) }).parse(arg);
        if (s.games.activeIds().has(id))
            throw new errors_1.AppError('BUSY', 'Останови игру, чтобы менять файлы');
        await (0, content_1.removeContent)((await gameDirOf(id)).gameDir, kind, file, confirm);
    });
    handle('content:import', async (arg, e) => {
        const { id, kind } = zod_1.z.object({ id: schemas_1.instanceIdSchema, kind: kindArg }).parse(arg);
        if (s.games.activeIds().has(id))
            throw new errors_1.AppError('BUSY', 'Останови игру, чтобы менять файлы');
        const ext = kind === 'mods' ? 'jar' : 'zip';
        const w = winOf(e);
        const opts = { title: kind === 'mods' ? 'Импорт модов' : 'Импорт ресурспаков', properties: ['openFile', 'multiSelections'], filters: [{ name: ext.toUpperCase(), extensions: [ext] }] };
        const r = w ? await electron_1.dialog.showOpenDialog(w, opts) : await electron_1.dialog.showOpenDialog(opts);
        if (r.canceled)
            return 0;
        return (0, content_1.importContent)((await gameDirOf(id)).gameDir, kind, r.filePaths);
    });
    handle('modrinth:search', (arg) => s.modrinth.search(schemas_1.modrinthSearchSchema.parse(arg)));
    handle('modrinth:project', (arg) => s.modrinth.projectInfo(zod_1.z.object({ projectId: schemas_1.modrinthIdSchema }).parse(arg).projectId));
    handle('modrinth:versions', (arg) => {
        const q = schemas_1.modrinthVersionsSchema.parse(arg);
        return s.modrinth.versionInfos(q.projectId, { mcVersion: q.mcVersion, loaders: q.loader ? (0, modrinth_1.loaderFilter)(q.loader) : null });
    });
    handle('modrinth:openPage', (arg) => {
        const { type, slug } = zod_1.z.object({ type: zod_1.z.enum(['mod', 'modpack', 'resourcepack']), slug: zod_1.z.string().min(1).max(64) }).parse(arg);
        s.openModrinthPage(type, slug);
    });
    handle('modrinth:install', (arg) => {
        const { id, projectId, kind, versionId } = zod_1.z.object({
            id: schemas_1.instanceIdSchema, projectId: schemas_1.modrinthIdSchema, kind: zod_1.z.enum(['mod', 'resourcepack']), versionId: schemas_1.modrinthIdSchema.nullish(),
        }).parse(arg);
        return s.installFromModrinth(id, projectId, kind, versionId ?? null);
    });
    handle('modrinth:installed', async (arg) => {
        const { id, kind } = zod_1.z.object({ id: schemas_1.instanceIdSchema, kind: zod_1.z.enum(['mod', 'resourcepack']) }).parse(arg);
        return (0, modrinth_1.listInstalledProjects)((await gameDirOf(id)).gameDir, kind);
    });
    handle('chaldpack:inspect', async (_arg, e) => {
        const w = winOf(e);
        const opts = { title: 'Импорт инстанса', properties: ['openFile'], filters: [{ name: 'Инстанс ChaldLauncher', extensions: ['chaldlauncher'] }] };
        const r = w ? await electron_1.dialog.showOpenDialog(w, opts) : await electron_1.dialog.showOpenDialog(opts);
        if (r.canceled || !r.filePaths[0])
            return null;
        return s.inspectChaldPack(r.filePaths[0]);
    });
    handle('chaldpack:import', (arg) => s.startChaldPack(zod_1.z.object({ token: zod_1.z.string().regex(/^[a-f0-9]{16}$/) }).parse(arg).token));
    handle('chaldpack:export', async (arg, e) => {
        const { id, includeWorlds } = zod_1.z.object({ id: schemas_1.instanceIdSchema, includeWorlds: zod_1.z.boolean() }).parse(arg);
        const meta = await s.instances.readMeta(id);
        const w = winOf(e);
        const opts = { title: 'Экспорт инстанса', defaultPath: `${meta.name.replace(/[\\/:*?"<>|]+/g, '_').trim() || 'instance'}.chaldlauncher`, filters: [{ name: 'Инстанс ChaldLauncher', extensions: ['chaldlauncher'] }] };
        const r = w ? await electron_1.dialog.showSaveDialog(w, opts) : await electron_1.dialog.showSaveDialog(opts);
        if (r.canceled || !r.filePath)
            return null;
        const file = r.filePath.toLowerCase().endsWith('.chaldlauncher') ? r.filePath : `${r.filePath}.chaldlauncher`;
        return { ...(await s.exportChaldPack(id, file, includeWorlds)), file };
    });
    handle('modrinth:installPack', (arg) => {
        const { projectId, versionId } = zod_1.z.object({ projectId: schemas_1.modrinthIdSchema, versionId: schemas_1.modrinthIdSchema.nullish() }).parse(arg);
        return s.startModpack(projectId, versionId ?? null);
    });
    handle('modrinth:cancelPack', (arg) => s.cancelModpack(zod_1.z.object({ projectId: schemas_1.modrinthIdSchema }).parse(arg).projectId));
    const skinId = zod_1.z.string().regex(/^[a-f0-9]{12}$/, 'Некорректный идентификатор скина');
    const skinName = zod_1.z.string().trim().min(1, 'Введи название скина').max(32, 'Не длиннее 32 символов');
    handle('wardrobe:list', () => s.wardrobe.list());
    handle('wardrobe:import', async (_arg, e) => {
        const w = winOf(e);
        const opts = { title: 'Добавить скины', properties: ['openFile', 'multiSelections'], filters: [{ name: 'Скины (PNG)', extensions: ['png'] }] };
        const r = w ? await electron_1.dialog.showOpenDialog(w, opts) : await electron_1.dialog.showOpenDialog(opts);
        if (r.canceled)
            return { added: [], problems: [] };
        return s.wardrobe.importFiles(r.filePaths);
    });
    handle('wardrobe:update', (arg) => {
        const { id, patch } = zod_1.z.object({ id: skinId, patch: zod_1.z.object({ name: skinName.optional(), variant: zod_1.z.enum(['classic', 'slim']).optional() }) }).parse(arg);
        return s.wardrobe.update(id, patch);
    });
    handle('wardrobe:remove', async (arg) => {
        const { id } = zod_1.z.object({ id: skinId, confirm: zod_1.z.literal(true) }).parse(arg);
        await s.wardrobe.remove(id);
    });
    handle('wardrobe:current', () => s.wardrobe.current());
    handle('wardrobe:saveCurrent', async (arg) => {
        const { name } = zod_1.z.object({ name: skinName }).parse(arg);
        const { entry, duplicate } = await s.wardrobe.saveCurrent(name);
        return duplicate ? { added: [], problems: [`Такой скин уже есть в гардеробе («${entry.name}»)`] } : { added: [entry], problems: [] };
    });
    handle('wardrobe:apply', (arg) => s.wardrobe.apply(zod_1.z.object({ id: skinId }).parse(arg).id));
    handle('wardrobe:reset', () => s.wardrobe.reset());
    handle('java:detect', () => (0, java_1.detectJava)(s.dirs));
    handle('system:memory', () => (0, memory_1.systemMemory)());
    handle('auth:state', () => s.auth.state());
    handle('auth:login', (arg) => s.auth.login(zod_1.z.object({ method: zod_1.z.enum(['browser', 'code']).default('browser') }).parse(arg ?? {}).method));
    handle('auth:cancel', () => s.auth.cancel());
    handle('auth:logout', () => s.auth.logout());
    handle('auth:setOffline', (arg) => s.auth.setOffline(zod_1.z.object({ name: schemas_1.offlineNameSchema }).parse(arg).name));
    handle('game:launch', (arg) => s.games.launch(idArg.parse(arg).id));
    handle('game:stop', (arg) => s.games.stop(idArg.parse(arg).id));
    handle('game:logs', (arg) => s.games.getLogs(idArg.parse(arg).id));
    handle('net:log', () => (0, net_1.getNetLog)());
    handle('net:clear', () => (0, net_1.clearNetLog)());
    handle('net:allowedHosts', () => (0, net_1.allowedHosts)());
    const updater = new updater_1.Updater({
        dir: path.join(electron_1.app.getPath('userData'), 'updates'),
        version: electron_1.app.getVersion(),
        platform: process.platform,
        repo: async () => (await s.settings.get()).updateRepo || config_1.DEFAULT_UPDATE_REPO,
        emit: (p) => s.emitProgress(p),
        gamesRunning: () => s.games.runningCount(),
        runInstaller: (file) => new Promise((resolve, reject) => {
            const child = (0, node_child_process_1.spawn)(file, ['--silent', '--launch'], { detached: true, stdio: 'ignore' });
            child.once('error', (err) => reject(new errors_1.AppError('UPDATE_RUN_FAILED', `Не удалось запустить установщик: ${err.message}`)));
            child.once('spawn', () => { child.unref(); resolve(); });
        }),
        quit: () => electron_1.app.quit(),
    });
    handle('update:check', () => updater.check());
    handle('update:download', () => updater.start());
    handle('update:install', () => updater.install());
}
//# sourceMappingURL=ipc.js.map