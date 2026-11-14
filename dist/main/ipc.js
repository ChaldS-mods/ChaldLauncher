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
const node_crypto_1 = require("node:crypto");
const archiveImport_1 = require("./archiveImport");
const content_1 = require("./content");
const errors_1 = require("./errors");
const java_1 = require("./java");
const memory_1 = require("./memory");
const modrinth_1 = require("./modrinth");
const launcherImport_1 = require("./launcherImport");
const dns_1 = require("./dns");
const mojangGames_1 = require("./mojangGames");
const net_1 = require("./net");
const config_1 = require("./config");
const updater_1 = require("./updater");
const selfUpdate_1 = require("./selfUpdate");
const versions_1 = require("./versions");
const idArg = zod_1.z.object({ id: schemas_1.instanceIdSchema });
const kindArg = zod_1.z.enum(['mods', 'resourcepacks']);
/** Only our own renderer may call into the main process. */
function isTrusted(e, trustedOrigins) {
    const url = e.senderFrame?.url ?? '';
    return trustedOrigins.some((o) => url.startsWith(o));
}
/** Login = Chald ID: 3–20 chars, Latin letters, digits and "_"; a leading "@" typed by habit is dropped. */
const chaldLoginSchema = zod_1.z
    .string()
    .transform((v) => v.trim().replace(/^@/, ''))
    .pipe(zod_1.z.string().regex(/^[A-Za-z0-9_]{3,20}$/, 'Логин (он же Chald ID): 3–20 символов, латиница, цифры и «_»'));
function registerIpc(s, trustedOrigins, extra) {
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
    handle('instances:changeVersion', (arg) => s.startVersionChange(schemas_1.changeVersionSchema.parse(arg)));
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
    /** archives that need the user's decision: token -> instance + file (the file is read again when they decide) */
    const pendingArchives = new Map();
    handle('content:add', async (arg, e) => {
        const { id, paths } = zod_1.z.object({ id: schemas_1.instanceIdSchema, paths: zod_1.z.array(zod_1.z.string().min(1).max(4096)).max(500).nullable() }).parse(arg);
        if (s.games.activeIds().has(id))
            throw new errors_1.AppError('BUSY', 'Останови игру, чтобы менять файлы');
        const out = { imported: 0, skipped: 0, pending: [], errors: [] };
        let files = paths;
        if (!files) {
            const w = winOf(e);
            const opts = {
                title: 'Добавить моды',
                properties: ['openFile', 'multiSelections'],
                filters: [{ name: 'Моды (.jar) и архивы (.zip)', extensions: ['jar', 'zip'] }],
            };
            const r = w ? await electron_1.dialog.showOpenDialog(w, opts) : await electron_1.dialog.showOpenDialog(opts);
            if (r.canceled)
                return out;
            files = r.filePaths;
        }
        const { gameDir } = await gameDirOf(id);
        const why = (err) => (err instanceof Error ? err.message : String(err));
        const jars = [];
        for (const f of files) {
            const name = path.basename(f);
            const ext = path.extname(f).toLowerCase();
            if (!path.isAbsolute(f)) {
                out.errors.push(`«${name}»: не удалось определить путь к файлу`);
            }
            else if (ext === '.jar') {
                jars.push(f);
            }
            else if (ext === '.zip') {
                try {
                    const { zip, plan } = await (0, archiveImport_1.planArchive)(f);
                    if (plan.kind === 'modpack') {
                        out.errors.push(`«${name}»: это сборка, а не набор модов. Установи её на странице Modrinth или CurseForge, либо через «Импорт» на странице инстансов.`);
                    }
                    else if (plan.kind === 'empty') {
                        out.errors.push(`«${name}»: в архиве нет ни модов, ни других нужных файлов`);
                    }
                    else if (plan.kind === 'mods') {
                        const r = await (0, archiveImport_1.applyPlan)(zip, plan, gameDir, 'mods');
                        out.imported += r.mods;
                        out.skipped += r.skipped;
                    }
                    else {
                        const token = (0, node_crypto_1.randomBytes)(8).toString('hex');
                        pendingArchives.set(token, { id, file: f });
                        if (pendingArchives.size > 50)
                            pendingArchives.delete(pendingArchives.keys().next().value);
                        const a = { token, name, mods: plan.mods, modBytes: plan.modBytes, groups: plan.groups, ignored: plan.ignored };
                        out.pending.push(a);
                    }
                }
                catch (err) {
                    out.errors.push(`«${name}»: ${why(err)}`);
                }
            }
            else {
                out.errors.push(`«${name}»: поддерживаются файлы .jar и архивы .zip (для .rar и .7z сначала распакуй файлы)`);
            }
        }
        if (jars.length) {
            try {
                const r = await (0, archiveImport_1.importJars)(gameDir, jars);
                out.imported += r.imported;
                out.skipped += r.skipped;
            }
            catch (err) {
                out.errors.push(why(err));
            }
        }
        return out;
    });
    handle('content:applyArchive', async (arg) => {
        const { id, token, mode } = zod_1.z.object({ id: schemas_1.instanceIdSchema, token: zod_1.z.string().regex(/^[a-f0-9]{16}$/), mode: zod_1.z.enum(['mods', 'all']) }).parse(arg);
        if (s.games.activeIds().has(id))
            throw new errors_1.AppError('BUSY', 'Останови игру, чтобы менять файлы');
        const p = pendingArchives.get(token);
        if (!p || p.id !== id)
            throw new errors_1.AppError('ARCHIVE_EXPIRED', 'Список устарел. Добавь архив заново.');
        pendingArchives.delete(token);
        const { gameDir } = await gameDirOf(id);
        const { zip, plan } = await (0, archiveImport_1.planArchive)(p.file); // read again: the file may have changed since the question was asked
        if (plan.kind === 'modpack' || plan.kind === 'empty')
            throw new errors_1.AppError('ARCHIVE_CHANGED', 'Содержимое архива изменилось. Добавь его заново.');
        return (0, archiveImport_1.applyPlan)(zip, plan, gameDir, mode);
    });
    handle('instances:worlds', (arg) => s.listWorlds(zod_1.z.object({ id: schemas_1.instanceIdSchema }).parse(arg).id));
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
        const { id, projectId, kind, versionId, worldName } = zod_1.z.object({
            id: schemas_1.instanceIdSchema, projectId: schemas_1.modrinthIdSchema, kind: zod_1.z.enum(['mod', 'resourcepack', 'shader', 'datapack']), versionId: schemas_1.modrinthIdSchema.nullish(),
            worldName: zod_1.z.string().min(1).max(128).nullish(),
        }).parse(arg);
        return s.installFromModrinth(id, projectId, kind, versionId ?? null, worldName ?? null);
    });
    handle('modrinth:installed', async (arg) => {
        const { id, kind } = zod_1.z.object({ id: schemas_1.instanceIdSchema, kind: zod_1.z.enum(['mod', 'resourcepack', 'shader', 'datapack']) }).parse(arg);
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
    handle('launchers:detect', () => {
        const safe = (name) => {
            try {
                return electron_1.app.getPath(name);
            }
            catch {
                return undefined;
            }
        };
        const home = safe('home');
        const appData = safe('appData');
        const documents = safe('documents');
        return s.detectLaunchers((0, launcherImport_1.defaultEnv)({ ...(home ? { home } : {}), ...(appData ? { appData } : {}), ...(documents ? { documents } : {}) }));
    });
    handle('launchers:pickFolder', async (_arg, e) => {
        const w = winOf(e);
        const opts = { title: 'Папка лаунчера или инстанса', properties: ['openDirectory'] };
        const r = w ? await electron_1.dialog.showOpenDialog(w, opts) : await electron_1.dialog.showOpenDialog(opts);
        if (r.canceled || !r.filePaths[0])
            return null;
        return s.sourceFromFolder(r.filePaths[0]);
    });
    handle('launchers:import', (arg) => s.startLauncherImport(zod_1.z.object({ tokens: zod_1.z.array(zod_1.z.string().regex(/^[a-f0-9]{16}$/)).min(1).max(200) }).parse(arg).tokens));
    handle('launchers:cancel', (arg) => s.cancelLauncherImport(zod_1.z.object({ batch: zod_1.z.string().regex(/^[a-f0-9]{12}$/) }).parse(arg).batch));
    handle('modrinth:installPack', (arg) => {
        const { projectId, versionId } = zod_1.z.object({ projectId: schemas_1.modrinthIdSchema, versionId: schemas_1.modrinthIdSchema.nullish() }).parse(arg);
        return s.startModpack(projectId, versionId ?? null);
    });
    handle('modrinth:cancelPack', (arg) => s.cancelModpack(zod_1.z.object({ projectId: schemas_1.modrinthIdSchema }).parse(arg).projectId));
    handle('curseforge:search', (arg) => {
        const q = zod_1.z.object({
            query: zod_1.z.string().max(200).default(''),
            classType: zod_1.z.enum(['mod', 'modpack', 'resourcepack', 'shader', 'datapack']).default('mod'),
            mcVersion: zod_1.z.string().max(40).nullable().default(null),
            loader: zod_1.z.enum(['fabric', 'quilt', 'forge', 'neoforge']).nullable().default(null),
            sort: zod_1.z.enum(['featured', 'popularity', 'lastUpdated', 'name', 'totalDownloads']).default('popularity'),
            offset: zod_1.z.number().int().min(0).max(10_000).default(0),
        }).parse(arg);
        return s.curseforge.search(q);
    });
    handle('curseforge:project', (arg) => s.curseforge.getMod(zod_1.z.object({ modId: zod_1.z.number().int().positive() }).parse(arg).modId));
    handle('curseforge:files', (arg) => {
        const q = zod_1.z.object({
            modId: zod_1.z.number().int().positive(),
            mcVersion: zod_1.z.string().max(40).nullable().default(null),
            loader: zod_1.z.enum(['fabric', 'quilt', 'forge', 'neoforge']).nullable().default(null),
        }).parse(arg);
        return s.curseforge.files(q.modId, { mcVersion: q.mcVersion, loader: q.loader, pageSize: 50 });
    });
    handle('curseforge:install', (arg) => {
        const { id, modId, kind, fileId, worldName } = zod_1.z.object({
            id: schemas_1.instanceIdSchema,
            modId: zod_1.z.number().int().positive(),
            kind: zod_1.z.enum(['mod', 'resourcepack', 'shader', 'datapack']),
            fileId: zod_1.z.number().int().positive().nullish(),
            worldName: zod_1.z.string().min(1).max(128).nullish(),
        }).parse(arg);
        return s.installFromCurseForge(id, modId, kind, fileId ?? null, worldName ?? null);
    });
    handle('curseforge:installPack', (arg) => {
        const { modId, fileId } = zod_1.z.object({
            modId: zod_1.z.number().int().positive(),
            fileId: zod_1.z.number().int().positive().nullish(),
        }).parse(arg);
        s.startCfModpack(modId, fileId ?? null);
    });
    handle('curseforge:installed', (arg) => {
        const { id, kind } = zod_1.z.object({ id: schemas_1.instanceIdSchema, kind: zod_1.z.enum(['mod', 'resourcepack', 'shader', 'datapack']) }).parse(arg);
        return s.listCurseForgeInstalled(id, kind);
    });
    handle('curseforge:openPage', (arg) => {
        const { slug } = zod_1.z.object({ slug: zod_1.z.string().min(1).max(128) }).parse(arg);
        s.openCurseForgePage(slug);
    });
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
    handle('wardrobe:listCapes', () => s.wardrobe.listCapes());
    handle('wardrobe:equipCape', (arg) => {
        const { id } = zod_1.z.object({ id: zod_1.z.string().min(1).max(64) }).parse(arg);
        return s.wardrobe.equipCape(id);
    });
    handle('wardrobe:unequipCape', () => s.wardrobe.unequipCape());
    handle('friends:hasSession', () => s.friends.hasToken());
    handle('friends:uploadAvatar', async (arg) => {
        const { dataUrl } = zod_1.z.object({ dataUrl: zod_1.z.string().min(32).max(200_000) }).parse(arg);
        if (!dataUrl.startsWith('data:image/png'))
            throw new errors_1.AppError('AVATAR_TYPE', 'Нужен PNG');
        await s.friends.uploadAvatar(dataUrl);
        return true;
    });
    handle('friends:avatarData', async (arg) => {
        const { userId } = zod_1.z.object({ userId: zod_1.z.number().int().positive() }).parse(arg);
        return s.friends.fetchAvatarDataUrl(userId);
    });
    handle('friends:register', async (arg) => {
        // the login IS the Chald ID, and it is bound to the account nickname (Microsoft or offline): the client sends only a password
        const body = zod_1.z.object({ password: zod_1.z.string().min(6).max(72) }).parse(arg ?? {});
        const st = await s.auth.state();
        if (!st.loggedIn || !st.uuid || !st.name) {
            throw new errors_1.AppError('FRIENDS_AUTH', 'Сначала укажи offline-ник или войди через Microsoft.');
        }
        const login = chaldLoginSchema.safeParse(st.name);
        if (!login.success) {
            throw new errors_1.AppError('FRIENDS_AUTH', 'Ник должен быть из 3–20 символов (латиница, цифры, «_»), чтобы стать Chald ID.');
        }
        return s.friends.registerAccount(login.data, body.password, st.uuid, st.name);
    });
    handle('friends:login', async (arg) => {
        const body = zod_1.z.object({
            login: chaldLoginSchema,
            password: zod_1.z.string().min(6).max(72),
        }).parse(arg ?? {});
        return s.friends.loginAccount(body.login, body.password);
    });
    handle('friends:session', async (arg) => {
        const { chaldId } = zod_1.z.object({ chaldId: zod_1.z.string().min(3).max(20).nullable().optional() }).parse(arg ?? {});
        const st = await s.auth.state();
        if (!st.loggedIn || !st.uuid || !st.name) {
            throw new errors_1.AppError('FRIENDS_AUTH', st.mode === 'offline'
                ? 'Укажи ник в настройках аккаунта (режим Offline), затем зарегистрируй Chald ID.'
                : 'Войди через Microsoft или включи offline-ник, чтобы зарегистрировать Chald ID.');
        }
        return s.friends.session(st.uuid, st.name, chaldId ?? null);
    });
    handle('friends:legacyReset', () => s.consumeFriendsLegacyReset());
    handle('friends:logout', () => { s.friends.clearSession(); return true; });
    handle('friends:me', () => s.friends.me());
    handle('friends:updateMe', (arg) => {
        const patch = zod_1.z.object({
            displayName: zod_1.z.string().min(1).max(32).optional(),
            bio: zod_1.z.string().max(200).optional(),
            chaldId: zod_1.z.string().min(3).max(20).optional(),
        }).parse(arg ?? {});
        return s.friends.updateMe(patch);
    });
    handle('friends:search', (arg) => {
        const { q } = zod_1.z.object({ q: zod_1.z.string().min(1).max(32) }).parse(arg);
        return s.friends.search(q);
    });
    handle('friends:list', () => s.friends.list());
    handle('friends:request', (arg) => {
        const body = zod_1.z.object({
            toChaldId: zod_1.z.string().min(1).max(20).optional(),
            toMcName: zod_1.z.string().min(1).max(16).optional(),
            toUserId: zod_1.z.number().int().positive().optional(),
        }).parse(arg ?? {});
        return s.friends.requestFriend(body);
    });
    handle('friends:accept', (arg) => {
        const { requestId } = zod_1.z.object({ requestId: zod_1.z.number().int().positive() }).parse(arg);
        return s.friends.accept(requestId);
    });
    handle('friends:reject', (arg) => {
        const { requestId } = zod_1.z.object({ requestId: zod_1.z.number().int().positive() }).parse(arg);
        return s.friends.reject(requestId);
    });
    handle('friends:remove', (arg) => {
        const { userId } = zod_1.z.object({ userId: zod_1.z.number().int().positive() }).parse(arg);
        return s.friends.remove(userId);
    });
    handle('friends:inbox', () => s.friends.inbox());
    handle('friends:thread', (arg) => {
        const { peerId, afterId } = zod_1.z.object({
            peerId: zod_1.z.number().int().positive(),
            afterId: zod_1.z.number().int().nonnegative().optional(),
        }).parse(arg);
        return s.friends.thread(peerId, afterId ?? 0);
    });
    handle('friends:send', (arg) => {
        const body = zod_1.z.object({
            toUserId: zod_1.z.number().int().positive(),
            body: zod_1.z.string().min(1).max(450_000),
            kind: zod_1.z.enum(['text', 'image', 'share']).optional(),
            meta: zod_1.z.union([zod_1.z.string(), zod_1.z.record(zod_1.z.string(), zod_1.z.unknown())]).optional(),
        }).parse(arg);
        return s.friends.sendMessage(body.toUserId, body.body, body.kind ?? 'text', body.meta);
    });
    handle('friends:invite', (arg) => {
        const body = zod_1.z.object({
            toUserId: zod_1.z.number().int().positive(),
            instanceName: zod_1.z.string().max(64),
            address: zod_1.z.string().max(128).optional(),
            note: zod_1.z.string().max(200).optional(),
        }).parse(arg);
        return s.friends.sendInvite(body.toUserId, body.instanceName, body.address ?? '', body.note ?? '');
    });
    handle('friends:invites', () => s.friends.listInvites());
    handle('friends:inviteAccept', (arg) => {
        const { inviteId } = zod_1.z.object({ inviteId: zod_1.z.number().int().positive() }).parse(arg);
        return s.friends.acceptInvite(inviteId);
    });
    handle('friends:inviteDecline', (arg) => {
        const { inviteId } = zod_1.z.object({ inviteId: zod_1.z.number().int().positive() }).parse(arg);
        return s.friends.declineInvite(inviteId);
    });
    handle('friends:callSignal', (arg) => {
        const body = zod_1.z.object({
            toUserId: zod_1.z.number().int().positive(),
            kind: zod_1.z.enum(['offer', 'answer', 'ice', 'hangup', 'ring']),
            payload: zod_1.z.string().max(16000),
            groupId: zod_1.z.number().int().positive().nullable().optional(),
        }).parse(arg);
        return s.friends.sendCallSignal(body.toUserId, body.kind, body.payload, body.groupId);
    });
    handle('friends:callPoll', () => s.friends.pollCallSignals());
    handle('friends:groups', () => s.friends.listGroups());
    handle('friends:groupCreate', (arg) => {
        const body = zod_1.z.object({
            name: zod_1.z.string().trim().min(1).max(64),
            memberIds: zod_1.z.array(zod_1.z.number().int().positive()).max(32).optional(),
        }).parse(arg);
        return s.friends.createGroup(body.name, body.memberIds ?? []);
    });
    handle('friends:groupGet', (arg) => {
        const { groupId } = zod_1.z.object({ groupId: zod_1.z.number().int().positive() }).parse(arg);
        return s.friends.getGroup(groupId);
    });
    handle('friends:groupAddMember', (arg) => {
        const body = zod_1.z.object({
            groupId: zod_1.z.number().int().positive(),
            userId: zod_1.z.number().int().positive(),
        }).parse(arg);
        return s.friends.addGroupMember(body.groupId, body.userId);
    });
    handle('friends:groupRemoveMember', (arg) => {
        const body = zod_1.z.object({
            groupId: zod_1.z.number().int().positive(),
            userId: zod_1.z.number().int().positive(),
        }).parse(arg);
        return s.friends.removeGroupMember(body.groupId, body.userId);
    });
    handle('friends:groupUpdate', (arg) => {
        const body = zod_1.z.object({
            groupId: zod_1.z.number().int().positive(),
            name: zod_1.z.string().trim().min(1).max(64),
        }).parse(arg);
        return s.friends.updateGroup(body.groupId, body.name);
    });
    handle('friends:groupDelete', (arg) => {
        const { groupId } = zod_1.z.object({ groupId: zod_1.z.number().int().positive() }).parse(arg);
        return s.friends.deleteGroup(groupId);
    });
    handle('friends:groupThread', (arg) => {
        const body = zod_1.z.object({
            groupId: zod_1.z.number().int().positive(),
            afterId: zod_1.z.number().int().nonnegative().optional(),
        }).parse(arg);
        return s.friends.groupThread(body.groupId, body.afterId ?? 0);
    });
    handle('friends:groupSend', (arg) => {
        const body = zod_1.z.object({
            groupId: zod_1.z.number().int().positive(),
            body: zod_1.z.string().min(1).max(450_000),
            kind: zod_1.z.enum(['text', 'image', 'share']).optional(),
            meta: zod_1.z.union([zod_1.z.string(), zod_1.z.record(zod_1.z.string(), zod_1.z.unknown())]).optional(),
        }).parse(arg);
        return s.friends.sendGroupMessage(body.groupId, body.body, body.kind ?? 'text', body.meta);
    });
    handle('overlay:toggle', () => {
        if (extra?.toggleOverlay)
            return extra.toggleOverlay();
        return false;
    });
    handle('overlay:show', () => {
        if (extra?.showOverlay)
            return extra.showOverlay();
        return false;
    });
    handle('overlay:callState', (arg) => {
        const { phase } = zod_1.z.object({ phase: zod_1.z.enum(['idle', 'outgoing', 'incoming', 'connecting', 'active']) }).parse(arg ?? {});
        return extra?.setCallPhase ? extra.setCallPhase(phase) : false;
    });
    handle('overlay:startCall', (arg) => {
        const body = zod_1.z.object({
            userId: zod_1.z.number().int().nonnegative().default(0),
            name: zod_1.z.string().max(64).optional(),
            mcName: zod_1.z.string().max(16).optional(),
            groupId: zod_1.z.number().int().positive().nullable().optional(),
            memberIds: zod_1.z.array(zod_1.z.number().int().positive()).max(32).optional(),
        }).parse(arg ?? {});
        if (extra?.startCallOverlay) {
            return extra.startCallOverlay(body.userId, body.name, body.mcName, body.groupId, body.memberIds);
        }
        return false;
    });
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
    // Linux: only an AppImage can replace itself; the AppImage runtime tells where the running file is
    const appImage = process.platform === 'linux' && process.env.APPIMAGE ? process.env.APPIMAGE : null;
    const startDetached = (file, args, env) => new Promise((resolve, reject) => {
        const child = (0, node_child_process_1.spawn)(file, args, { detached: true, stdio: 'ignore', env });
        child.once('error', (err) => reject(new errors_1.AppError('UPDATE_RUN_FAILED', `Не удалось запустить установщик: ${err.message}`)));
        child.once('spawn', () => { child.unref(); resolve(); });
    });
    const updater = new updater_1.Updater({
        dir: path.join(electron_1.app.getPath('userData'), 'updates'),
        version: electron_1.app.getVersion(),
        platform: process.platform,
        appImage,
        arch: process.arch,
        repo: async () => (await s.settings.get()).updateRepo || config_1.DEFAULT_UPDATE_REPO,
        autoInstall: async () => (await s.settings.get()).autoInstallUpdates,
        emit: (p) => s.emitProgress(p),
        gamesRunning: () => s.games.runningCount(),
        runInstaller: async (file, { launch }) => {
            if (appImage) {
                await (0, selfUpdate_1.replaceAppImage)(file, appImage);
                // the old process still holds the single-instance lock for a moment: start the new one a little later
                if (launch)
                    await startDetached('/bin/sh', ['-c', 'sleep 2; exec "$0"', appImage], (0, selfUpdate_1.relaunchEnv)(process.env));
                return;
            }
            if (process.platform !== 'win32')
                throw new errors_1.AppError('UPDATE_NO_FILE', 'Автообновление на этой системе недоступно.');
            await startDetached(file, launch ? ['--silent', '--launch'] : ['--silent'], process.env);
        },
        quit: () => electron_1.app.quit(),
    });
    handle('update:check', () => updater.check());
    handle('update:download', () => updater.start());
    handle('update:install', () => updater.install());
    return { updater };
}
//# sourceMappingURL=ipc.js.map