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
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.Services = void 0;
const path = __importStar(require("node:path"));
const auth_1 = require("./auth");
const dirs_1 = require("./dirs");
const config_1 = require("./config");
const presence_1 = require("./presence");
const errors_1 = require("./errors");
const launcher_1 = require("./launcher");
const instances_1 = require("./instances");
const installer_1 = require("./installer");
const download_1 = require("./download");
const chaldpack_1 = require("./chaldpack");
const node_crypto_1 = require("node:crypto");
const storage_1 = require("./storage");
const modrinth_1 = require("./modrinth");
const adm_zip_1 = __importDefault(require("adm-zip"));
const curseforge_1 = require("./curseforge");
const paths_1 = require("./paths");
const launcherImport_1 = require("./launcherImport");
const launchers_1 = require("../shared/launchers");
const dns_1 = require("./dns");
const versionChange_1 = require("./versionChange");
const settings_1 = require("./settings");
const wardrobe_1 = require("./wardrobe");
const versions_1 = require("./versions");
const friends_1 = require("./friends");
const fs = __importStar(require("node:fs"));
const fsp = __importStar(require("node:fs/promises"));
class Services {
    o;
    dirs;
    settings;
    catalog;
    instances;
    auth;
    games;
    wardrobe;
    friends;
    friendsLegacyFlag;
    presence;
    installs = new Map();
    packs = new Map();
    modrinth;
    curseforge;
    /** Last progress event per instance (install / modpack), so the AI agent can see how an installation is going. */
    lastOps = new Map();
    /** .chaldlauncher files the user picked and we validated, waiting for the confirmation click */
    pendingPacks = new Map();
    /** instances found in other launchers, by the token the UI got (paths never leave the main process) */
    pendingImports = new Map();
    /** Sync copy of settings for places that cannot await (window close handler). */
    closeBehavior = 'quit';
    constructor(o) {
        this.o = o;
        const rawEmit = o.emit;
        this.o = {
            ...o,
            emit: (channel, payload) => {
                if (channel === 'op:progress')
                    this.trackOp(payload);
                rawEmit(channel, payload);
            },
        };
        this.dirs = (0, dirs_1.sharedDirs)(o.dataDir);
        this.modrinth = new modrinth_1.ModrinthApi(`ChaldStudio/ChaldLauncher/${o.appVersion} (Minecraft launcher)`);
        this.curseforge = new curseforge_1.CurseForgeApi(`ChaldStudio/ChaldLauncher/${o.appVersion} (Minecraft launcher)`);
        this.settings = new settings_1.SettingsStore(path.join(o.dataDir, 'settings.json'));
        this.catalog = new versions_1.VersionCatalog(path.join(o.dataDir, 'cache', 'version_manifest.json'));
        this.instances = new instances_1.InstanceStore(() => this.instancesRoot(), this.dirs.versions);
        this.auth = new auth_1.AuthService(path.join(o.dataDir, 'auth.bin'), o.box, async () => {
            const s = await this.settings.get();
            return { mode: s.accountMode, offlineName: s.offlineName, msClientId: config_1.DEFAULT_MS_CLIENT_ID };
        }, async (patch) => {
            await this.settings.set({
                ...(patch.mode ? { accountMode: patch.mode } : {}),
                ...(patch.offlineName !== undefined ? { offlineName: patch.offlineName } : {}),
            });
        }, (c) => o.emit('auth:deviceCode', c), o.openExternal, (s) => o.emit('auth:changed', s));
        this.wardrobe = new wardrobe_1.WardrobeService(path.join(o.dataDir, 'wardrobe'), {
            getToken: async () => {
                const st = await this.auth.state();
                if (st.mode !== 'microsoft' || !st.loggedIn)
                    throw new errors_1.AppError('WARDROBE_NEEDS_MS', 'Скин на аккаунте можно менять только после входа через Microsoft (офлайн-режим скин не поддерживает).');
                return (await this.auth.getLaunchAuth()).accessToken;
            },
            onCapePreview: (id, dataUrl) => o.emit('wardrobe:capePreview', { id, dataUrl }),
        });
        const friendsTokenFile = path.join(o.dataDir, 'friends-token.txt');
        let friendsToken = null;
        try {
            if (fs.existsSync(friendsTokenFile)) {
                friendsToken = fs.readFileSync(friendsTokenFile, 'utf8').trim() || null;
            }
        }
        catch { /* ignore */ }
        // Chald accounts made before "login = Chald ID = nickname" are dropped once: the user registers again under the new rules.
        this.friendsLegacyFlag = path.join(o.dataDir, 'friends-legacy-reset.flag');
        const accountMarker = path.join(o.dataDir, 'friends-account.v2');
        try {
            if (!fs.existsSync(accountMarker)) {
                if (friendsToken) {
                    friendsToken = null;
                    fs.writeFileSync(friendsTokenFile, '', 'utf8');
                    fs.writeFileSync(this.friendsLegacyFlag, '1', 'utf8');
                }
                fs.mkdirSync(o.dataDir, { recursive: true });
                fs.writeFileSync(accountMarker, '2', 'utf8');
            }
        }
        catch { /* a failed migration must never stop the launcher */ }
        this.friends = new friends_1.FriendsService(this.settings, {
            get: () => friendsToken,
            set: (t) => {
                friendsToken = t;
                void fsp.writeFile(friendsTokenFile, t ?? '', 'utf8').catch(() => undefined);
            },
        });
        if (friendsToken)
            this.friends.startHeartbeat();
        this.presence = new presence_1.PresenceService({
            appVersion: o.appVersion,
            clientId: config_1.DEFAULT_DISCORD_CLIENT_ID,
            downloadUrl: `https://github.com/${config_1.DEFAULT_UPDATE_REPO}/releases/latest`,
            pid: process.pid,
        });
        this.games = new launcher_1.GameManager({
            dirs: this.dirs,
            instances: this.instances,
            auth: this.auth,
            getSettings: () => this.settings.get(),
            launcherVersion: o.appVersion,
            onProgress: (p) => o.emit('op:progress', p),
            onStatus: (e) => {
                o.emit('game:status', e);
                this.trackPresence(e);
            },
            onLog: (e) => o.emit('game:log', e),
            onNotice: (e) => o.emit('game:notice', e),
        });
    }
    get appVersion() {
        return this.o.appVersion;
    }
    trackOp(p) {
        if (!p.instanceId || (p.kind !== 'install' && p.kind !== 'modpack'))
            return;
        this.lastOps.set(p.instanceId, p);
        if (this.lastOps.size > 50)
            this.lastOps.delete(this.lastOps.keys().next().value);
    }
    /** The most recent install/modpack progress of an instance (null if nothing was started in this session). */
    lastOp(instanceId) {
        return this.lastOps.get(instanceId) ?? null;
    }
    /** True once after the legacy Chald session was dropped (to tell the user to register again). */
    consumeFriendsLegacyReset() {
        try {
            if (!fs.existsSync(this.friendsLegacyFlag))
                return false;
            fs.rmSync(this.friendsLegacyFlag, { force: true });
            return true;
        }
        catch {
            return false;
        }
    }
    async init() {
        const s = await this.settings.get();
        this.closeBehavior = s.closeBehavior;
        (0, dns_1.configureDns)({ mode: s.dnsMode, servers: s.dnsServers, dohUrl: s.dnsDohUrl });
        this.presence.configure(s.discordRpc, s.discordShowInstance, s.language);
    }
    /** Mirrors a started/stopped game to the Discord status and Chald Friends presence. Never throws. */
    trackPresence(e) {
        if (e.status !== 'running') {
            this.presence.gameStopped(e.instanceId);
            this.friends.setPresence('launcher', '');
            return;
        }
        void this.instances
            .readMeta(e.instanceId)
            .then((meta) => {
            // the game may already be gone by the time the file is read
            if (!this.games.activeIds().has(e.instanceId))
                return;
            this.presence.gameStarted({ id: e.instanceId, name: meta.name, mcVersion: meta.mcVersion, loader: meta.loader.type, since: Date.now() });
            this.friends.setPresence('game', meta.name);
        })
            .catch(() => undefined);
    }
    async instancesRoot() {
        const s = await this.settings.get();
        return s.instancesDir || path.join(this.o.dataDir, 'instances');
    }
    emitProgress(p) {
        this.o.emit('op:progress', p);
    }
    ctx() {
        return { running: this.games.activeIds(), installing: new Set(this.installs.keys()) };
    }
    /**
     * Starts installing (or repairing) an instance in the background; progress goes out as op:progress events.
     * With `change` the instance is moved to another Minecraft version / loader: the new version is installed first and
     * only when that has worked is the instance switched (so a failure leaves a playable instance behind).
     */
    startInstall(id, change) {
        void this.beginInstall(id, change);
    }
    /** Like startInstall, but the returned promise settles when the installation is over (it never rejects after starting). */
    beginInstall(id, change) {
        if (this.installs.has(id))
            throw new errors_1.AppError('ALREADY_INSTALLING', 'Установка уже идёт');
        if (this.games.activeIds().has(id))
            throw new errors_1.AppError('ALREADY_RUNNING', 'Останови игру перед установкой');
        const ac = new AbortController();
        this.installs.set(id, ac);
        const opId = `install:${id}`;
        const emit = (label, fraction, status = 'running', message = null) => this.o.emit('op:progress', { opId, kind: 'install', instanceId: id, label, fraction, status, message });
        emit('Подготовка…', null);
        return (async () => {
            try {
                const meta = await this.instances.readMeta(id);
                const settings = await this.settings.get();
                const target = change?.target ?? { mcVersion: meta.mcVersion, loader: meta.loader };
                const { versionId } = await (0, installer_1.installVersion)(target, this.dirs, this.catalog, (p) => emit(p.label, p.fraction), ac.signal, { javaFor: (major) => this.games.ensureJava(meta.settings.javaPath || settings.javaPath, major, (l, f) => emit(l, f), ac.signal) });
                if (change) {
                    ac.signal.throwIfAborted();
                    const gameDir = await this.instances.gameDir(id);
                    if (change.backupSaves) {
                        emit('Копирую миры в резервную копию…', null);
                        await (0, versionChange_1.backupSaves)(gameDir, meta.mcVersion);
                    }
                    if (change.disableMods)
                        await (0, versionChange_1.disableMods)(gameDir);
                    await this.instances.applyVersion(id, { mcVersion: target.mcVersion, loader: target.loader, versionId });
                }
                else {
                    await this.instances.patchInternal(id, { installed: true, versionId });
                }
                this.installs.delete(id);
                emit(change ? 'Версия изменена' : 'Установка завершена', 1, 'done');
            }
            catch (e) {
                this.installs.delete(id);
                if ((0, errors_1.isAbort)(e) || ac.signal.aborted)
                    emit('Установка отменена', null, 'cancelled');
                else
                    emit('Ошибка установки', null, 'error', e instanceof Error ? e.message : String(e));
            }
        })();
    }
    cancelInstall(id) {
        this.installs.get(id)?.abort();
    }
    /** Moves an existing instance to another Minecraft version and/or loader (installs it in the background). */
    async startVersionChange(input) {
        const { id } = input;
        if (this.installs.has(id))
            throw new errors_1.AppError('ALREADY_INSTALLING', 'Установка уже идёт');
        if (this.games.activeIds().has(id))
            throw new errors_1.AppError('ALREADY_RUNNING', 'Останови игру перед сменой версии');
        const meta = await this.instances.readMeta(id);
        const target = {
            mcVersion: input.mcVersion,
            loader: { type: input.loader.type, version: input.loader.type === 'vanilla' ? null : input.loader.version },
        };
        if (meta.installed && (0, versionChange_1.sameTarget)(target, meta))
            throw new errors_1.AppError('VERSION_UNCHANGED', 'Версия Minecraft и загрузчик те же: менять нечего');
        this.startInstall(id, { target, backupSaves: input.backupSaves, disableMods: input.disableMods });
    }
    /** Install a CurseForge mod / resource pack into an instance. Returns the file name. */
    async installFromCurseForge(id, modId, kind, fileId, worldName) {
        if (this.games.activeIds().has(id))
            throw new errors_1.AppError('BUSY', 'Останови игру, чтобы менять файлы');
        if (this.installs.has(id))
            throw new errors_1.AppError('BUSY', 'Идёт установка инстанса: изменение файлов недоступно');
        const meta = await this.instances.readMeta(id);
        const gameDir = await this.instances.gameDir(id);
        const opId = `curseforge:${id}:${modId}`;
        const emit = (label, fraction, status = 'running', message = null) => this.o.emit('op:progress', { opId, kind: 'install', instanceId: id, label, fraction, status, message });
        emit('Ищу файл на CurseForge…', null);
        try {
            const name = await (0, curseforge_1.installCfFile)({
                api: this.curseforge,
                gameDir,
                kind,
                modId,
                fileId,
                mcVersion: meta.mcVersion,
                loader: meta.loader.type,
                worldName,
            });
            emit('Установлено', 1, 'done');
            return name;
        }
        catch (e) {
            emit('Установка прервана', null, 'cancelled');
            throw e;
        }
    }
    openCurseForgePage(slug, kind = 'mod') {
        const segment = kind === 'modpack' ? 'modpacks'
            : kind === 'resourcepack' ? 'texture-packs'
                : kind === 'shader' ? 'shaders'
                    : kind === 'datapack' ? 'data-packs'
                        : 'mc-mods';
        this.o.openExternal(`https://www.curseforge.com/minecraft/${segment}/${encodeURIComponent(slug)}`);
    }
    async listWorlds(id) {
        return this.instances.listWorlds(id);
    }
    async listCurseForgeInstalled(id, kind) {
        const gameDir = await this.instances.gameDir(id);
        return (0, curseforge_1.listCfInstalled)(gameDir, kind);
    }
    /** Installs a mod or resource pack (and the required dependencies of a mod) into an instance. Returns the file names. */
    async installFromModrinth(id, projectId, kind, versionId, worldName) {
        if (this.games.activeIds().has(id))
            throw new errors_1.AppError('BUSY', 'Останови игру, чтобы менять файлы');
        if (this.installs.has(id))
            throw new errors_1.AppError('BUSY', 'Идёт установка инстанса: изменение файлов недоступно');
        const meta = await this.instances.readMeta(id);
        const gameDir = await this.instances.gameDir(id);
        const target = { gameDir, mcVersion: meta.mcVersion, loader: meta.loader.type, kind, worldName: worldName ?? null };
        const opId = `modrinth:${id}:${projectId}`;
        const emit = (label, fraction, status = 'running', message = null) => this.o.emit('op:progress', { opId, kind: 'install', instanceId: id, label, fraction, status, message });
        emit('Ищу подходящую версию…', null);
        try {
            const plan = await (0, modrinth_1.planInstall)(this.modrinth, target, projectId, undefined, versionId);
            const names = await (0, modrinth_1.runInstallPlan)(gameDir, kind, plan, (l, f) => emit(l, f));
            emit('Установлено', 1, 'done');
            return names;
        }
        catch (e) {
            emit('Установка прервана', null, 'cancelled'); // the caller shows the error
            throw e;
        }
    }
    /** Downloads a .mrpack, creates an instance from it, fills it and starts installing Minecraft + the loader. */
    startModpack(projectId, versionId) {
        if (this.packs.has(projectId))
            throw new errors_1.AppError('ALREADY_INSTALLING', 'Эта сборка уже устанавливается');
        const ac = new AbortController();
        this.packs.set(projectId, ac);
        const opId = `modpack:${projectId}`;
        let instanceId = null;
        let title = 'Сборка';
        const emit = (label, fraction, status = 'running', message = null) => this.o.emit('op:progress', { opId, kind: 'modpack', instanceId, label, fraction, status, message });
        emit('Загружаю сведения о сборке…', null);
        void (async () => {
            try {
                const project = await this.modrinth.project(projectId, ac.signal);
                title = project.title;
                const version = versionId ? await this.modrinth.version(versionId, ac.signal) : (0, modrinth_1.pickVersion)(await this.modrinth.versions(projectId, {}, ac.signal));
                if (!version)
                    throw new errors_1.AppError('NO_COMPATIBLE_VERSION', 'У сборки нет доступных версий');
                if (version.project_id !== projectId)
                    throw new errors_1.AppError('MODRINTH_FORMAT', 'Эта версия относится к другому проекту');
                const file = (0, modrinth_1.primaryFile)(version);
                if (!file.filename.toLowerCase().endsWith('.mrpack'))
                    throw new errors_1.AppError('PACK_INVALID', 'Это не файл сборки Modrinth (.mrpack)');
                const packFile = path.join(this.dirs.root, 'cache', 'modpacks', (0, paths_1.safeFileName)(`${project.id}-${version.id}.mrpack`));
                emit(`Скачиваю сборку «${title}»…`, null);
                await (0, download_1.downloadFile)({ url: file.url, dest: packFile, sha1: file.hashes.sha1, size: file.size, purpose: 'Сборка Modrinth' }, { signal: ac.signal });
                const plan = (0, modrinth_1.planPack)((0, modrinth_1.readMrpackIndex)(packFile));
                const hash = [...project.id].reduce((a, c) => (a + c.charCodeAt(0)) % 8, 0);
                const inst = await this.instances.create({
                    name: title.slice(0, 48),
                    description: project.description.slice(0, 120),
                    mcVersion: plan.mcVersion,
                    loader: plan.loader,
                    kind: 'custom',
                    coverColor: hash,
                    settings: { javaPath: '', memoryMinMb: null, memoryMaxMb: null, jvmArgs: '', width: null, height: null, fullscreen: null },
                }, this.ctx());
                instanceId = inst.id;
                const gameDir = await this.instances.gameDir(inst.id);
                await (0, modrinth_1.downloadPackFiles)(plan, gameDir, (l, f) => emit(l, f * 0.9), ac.signal);
                emit('Копирую настройки сборки…', 0.95);
                await (0, modrinth_1.extractOverrides)(packFile, gameDir, ac.signal);
                this.packs.delete(projectId);
                emit(`Сборка «${title}» добавлена. Устанавливаю Minecraft…`, 1, 'done');
                this.startInstall(inst.id);
            }
            catch (e) {
                this.packs.delete(projectId);
                if (instanceId)
                    await this.instances.remove(instanceId, true).catch(() => undefined);
                instanceId = null;
                if ((0, errors_1.isAbort)(e) || ac.signal.aborted)
                    emit('Установка сборки отменена', null, 'cancelled');
                else
                    emit(`Не удалось установить «${title}»`, null, 'error', e instanceof Error ? e.message : String(e));
            }
        })();
    }
    /**
     * Downloads a CurseForge modpack zip, creates an instance from manifest.json,
     * pulls every required project file, applies overrides/, then installs Minecraft + loader.
     */
    startCfModpack(modId, fileId) {
        const key = `cf:${modId}:${fileId ?? 0}`;
        if (this.packs.has(key))
            throw new errors_1.AppError('ALREADY_INSTALLING', 'Эта сборка уже устанавливается');
        const ac = new AbortController();
        this.packs.set(key, ac);
        const opId = `modpack:${key}`;
        let instanceId = null;
        let title = 'Сборка CurseForge';
        const emit = (label, fraction, status = 'running', message = null) => this.o.emit('op:progress', { opId, kind: 'modpack', instanceId, label, fraction, status, message });
        emit('Загружаю сведения о сборке CurseForge…', null);
        void (async () => {
            try {
                const project = await this.curseforge.getMod(modId, ac.signal);
                title = project.title || title;
                if (project.type !== 'modpack')
                    throw new errors_1.AppError('PACK_INVALID', 'Это не сборка CurseForge (modpack)');
                // Prefer an explicit file; otherwise the newest available pack zip.
                let packMeta = fileId
                    ? await this.curseforge.getFile(modId, fileId, ac.signal)
                    : (await this.curseforge.files(modId, { pageSize: 50 }, ac.signal))[0];
                if (!packMeta)
                    throw new errors_1.AppError('CF_NO_FILE', 'У сборки нет файлов для скачивания');
                if (!packMeta.fileName.toLowerCase().endsWith('.zip')) {
                    // Some packs use .zip only in the CDN path; still try if downloadable.
                    const lower = packMeta.fileName.toLowerCase();
                    if (!lower.endsWith('.zip') && !lower.endsWith('.cfpack')) {
                        throw new errors_1.AppError('PACK_INVALID', 'Файл сборки CurseForge должен быть .zip');
                    }
                }
                const packFile = path.join(this.dirs.root, 'cache', 'modpacks', (0, paths_1.safeFileName)(`cf-${modId}-${packMeta.id}.zip`));
                emit(`Скачиваю сборку «${title}»…`, null);
                await (0, download_1.downloadFile)({
                    url: this.curseforge.resolveDownloadUrl(packMeta),
                    dest: packFile,
                    sha1: packMeta.sha1 ?? undefined,
                    size: packMeta.size || undefined,
                    purpose: 'Сборка CurseForge',
                }, { signal: ac.signal });
                let zip;
                try {
                    zip = new adm_zip_1.default(packFile);
                }
                catch {
                    throw new errors_1.AppError('PACK_INVALID', 'Не удалось открыть архив сборки CurseForge');
                }
                const manifestEntry = zip.getEntries().find((e) => !e.isDirectory && e.entryName.replace(/\\/g, '/').split('/').pop()?.toLowerCase() === 'manifest.json');
                if (!manifestEntry)
                    throw new errors_1.AppError('PACK_INVALID', 'В архиве нет manifest.json');
                const manifest = (0, curseforge_1.parseCfModpackManifest)(manifestEntry.getData().toString('utf8'));
                title = manifest.name || title;
                const hash = [...String(modId)].reduce((a, c) => (a + c.charCodeAt(0)) % 8, 0);
                const inst = await this.instances.create({
                    name: title.slice(0, 48),
                    description: (project.description || '').slice(0, 120),
                    mcVersion: manifest.mcVersion,
                    loader: {
                        type: manifest.loader.type,
                        version: manifest.loader.type === 'vanilla' ? null : manifest.loader.version,
                    },
                    kind: 'custom',
                    coverColor: hash,
                    settings: { javaPath: '', memoryMinMb: null, memoryMaxMb: null, jvmArgs: '', width: null, height: null, fullscreen: null },
                }, this.ctx());
                instanceId = inst.id;
                const gameDir = await this.instances.gameDir(inst.id);
                await fsp.mkdir(path.join(gameDir, 'mods'), { recursive: true });
                const files = manifest.files.filter((f) => f.required);
                const total = Math.max(1, files.length);
                const cfIndex = { projects: {} };
                let done = 0;
                for (const f of files) {
                    ac.signal.throwIfAborted();
                    emit(`Скачиваю моды (${done + 1}/${total})…`, done / total * 0.85);
                    try {
                        const fileInfo = await this.curseforge.getFile(f.projectID, f.fileID, ac.signal);
                        const destName = (0, paths_1.safeFileName)(fileInfo.fileName);
                        const dest = path.join(gameDir, 'mods', destName);
                        await (0, download_1.downloadFile)({
                            url: this.curseforge.resolveDownloadUrl(fileInfo),
                            dest,
                            sha1: fileInfo.sha1 ?? undefined,
                            size: fileInfo.size || undefined,
                            purpose: 'Мод сборки CurseForge',
                        }, { signal: ac.signal });
                        cfIndex.projects[String(f.projectID)] = { file: destName, fileId: f.fileID };
                    }
                    catch (e) {
                        // Required file failed — surface a clear error rather than a half-empty instance.
                        throw new errors_1.AppError('CF_PACK_FILE', `Не удалось скачать файл CurseForge project=${f.projectID} file=${f.fileID}: ${e instanceof Error ? e.message : String(e)}`);
                    }
                    done++;
                }
                await (0, storage_1.writeJsonAtomic)(path.join(gameDir, '.chald-curseforge.json'), cfIndex);
                // Extract overrides/ (configs, resource packs, options…) into the game dir.
                emit('Копирую overrides…', 0.9);
                const prefix = `${manifest.overrides}/`;
                for (const entry of zip.getEntries()) {
                    if (entry.isDirectory)
                        continue;
                    const name = entry.entryName.replace(/\\/g, '/');
                    const idx = name.toLowerCase().indexOf(prefix.toLowerCase());
                    // accept both "overrides/foo" at root and "SomeFolder/overrides/foo"
                    let rel = null;
                    if (name.toLowerCase().startsWith(prefix.toLowerCase()))
                        rel = name.slice(prefix.length);
                    else if (idx > 0)
                        rel = name.slice(idx + prefix.length);
                    if (!rel || rel.includes('..'))
                        continue;
                    const dest = path.join(gameDir, ...rel.split('/').map((p, i, a) => (i === a.length - 1 ? (0, paths_1.safeFileName)(p) : p)));
                    await fsp.mkdir(path.dirname(dest), { recursive: true });
                    await fsp.writeFile(dest, entry.getData());
                }
                this.packs.delete(key);
                emit(`Сборка «${title}» добавлена. Устанавливаю Minecraft…`, 1, 'done');
                this.startInstall(inst.id);
            }
            catch (e) {
                this.packs.delete(key);
                if (instanceId)
                    await this.instances.remove(instanceId, true).catch(() => undefined);
                instanceId = null;
                if ((0, errors_1.isAbort)(e) || ac.signal.aborted)
                    emit('Установка сборки отменена', null, 'cancelled');
                else
                    emit(`Не удалось установить «${title}»`, null, 'error', e instanceof Error ? e.message : String(e));
            }
        })();
    }
    /** Validates a picked .chaldlauncher file and remembers it under a token; nothing is written yet. */
    inspectChaldPack(file) {
        const { manifest, summary } = (0, chaldpack_1.inspectPack)(file);
        if (this.pendingPacks.size >= 5)
            this.pendingPacks.delete(this.pendingPacks.keys().next().value);
        const token = (0, node_crypto_1.randomBytes)(8).toString('hex');
        this.pendingPacks.set(token, { file, manifest });
        return { token, summary };
    }
    /** Creates an instance from a confirmed .chaldlauncher file: downloads the Modrinth files, unpacks the rest, installs Minecraft. */
    startChaldPack(token) {
        const pending = this.pendingPacks.get(token);
        if (!pending)
            throw new errors_1.AppError('PACK_EXPIRED', 'Файл нужно выбрать заново');
        this.pendingPacks.delete(token);
        const { file, manifest } = pending;
        const key = `chald:${token}`;
        const ac = new AbortController();
        this.packs.set(key, ac);
        const opId = `modpack:${key}`;
        let instanceId = null;
        const emit = (label, fraction, status = 'running', message = null) => this.o.emit('op:progress', { opId, kind: 'modpack', instanceId, label, fraction, status, message });
        emit(`Импорт «${manifest.name}»…`, null);
        void (async () => {
            try {
                const { manifest: m } = (0, chaldpack_1.inspectPack)(file); // read again: the file may have changed since the preview
                const inst = await this.instances.create({
                    name: m.name, description: m.description, mcVersion: m.mcVersion, loader: m.loader, kind: m.kind, coverColor: m.coverColor,
                    settings: { javaPath: '', memoryMinMb: null, memoryMaxMb: null, jvmArgs: '', width: null, height: null, fullscreen: null },
                }, this.ctx());
                instanceId = inst.id;
                const gameDir = await this.instances.gameDir(inst.id);
                await (0, modrinth_1.downloadPackFiles)((0, chaldpack_1.packToPlan)(m), gameDir, (l, f) => emit(l, f * 0.85), ac.signal);
                emit('Копирую файлы из архива…', 0.9);
                await (0, modrinth_1.extractOverrides)(file, gameDir, ac.signal);
                await (0, storage_1.writeJsonAtomic)(path.join(gameDir, '.chald-modrinth.json'), (0, chaldpack_1.installedIndexFor)(m));
                const cfIdx = (0, chaldpack_1.cfInstalledIndexFor)(m);
                if (Object.keys(cfIdx.projects).length) {
                    await (0, storage_1.writeJsonAtomic)(path.join(gameDir, '.chald-curseforge.json'), cfIdx);
                }
                this.packs.delete(key);
                emit(`Инстанс «${m.name}» импортирован. Устанавливаю Minecraft…`, 1, 'done');
                this.startInstall(inst.id);
            }
            catch (e) {
                this.packs.delete(key);
                if (instanceId)
                    await this.instances.remove(instanceId, true).catch(() => undefined);
                instanceId = null;
                if ((0, errors_1.isAbort)(e) || ac.signal.aborted)
                    emit('Импорт отменён', null, 'cancelled');
                else
                    emit(`Не удалось импортировать «${manifest.name}»`, null, 'error', e instanceof Error ? e.message : String(e));
            }
        })();
    }
    /** Writes the instance as a .chaldlauncher file. Modrinth files are only listed (checked against Modrinth), the rest is packed. */
    async exportChaldPack(id, out, includeWorlds) {
        if (this.installs.has(id))
            throw new errors_1.AppError('BUSY', 'Идёт установка инстанса: подожди её окончания');
        if (includeWorlds && this.games.activeIds().has(id))
            throw new errors_1.AppError('BUSY', 'Останови игру, чтобы экспортировать миры');
        const meta = await this.instances.readMeta(id);
        const gameDir = await this.instances.gameDir(id);
        // progress for the export dialog (label contains the name of the file being checked); throttled so hashing
        // hundreds of small files does not flood the IPC channel
        const opId = `export:${id}`;
        const send = (label, fraction, status) => this.o.emit('op:progress', { opId, kind: 'export', instanceId: null, label, fraction, status, message: null });
        let last = 0;
        const report = (label, fraction) => {
            const now = Date.now();
            if (now - last < 60)
                return;
            last = now;
            send(label, Math.max(0, Math.min(1, fraction)), 'running');
        };
        send('Подготовка…', 0, 'running');
        try {
            const r = await (0, chaldpack_1.exportInstance)({ gameDir, meta, includeWorlds, out, api: this.modrinth,
                cfApi: this.curseforge, report });
            send('Экспорт готов', 1, 'done');
            return r;
        }
        catch (e) {
            send('Экспорт не удался', null, 'cancelled');
            throw e;
        }
    }
    /** Opens the project page on modrinth.com in the system browser. */
    openModrinthPage(type, slug) {
        if (!/^[A-Za-z0-9_-]{1,64}$/.test(slug))
            throw new errors_1.AppError('BAD_ARGUMENT', 'Некорректная ссылка на проект');
        this.o.openExternal(`https://modrinth.com/${type}/${slug}`);
    }
    cancelModpack(projectId) {
        this.packs.get(projectId)?.abort();
    }
    // ---------------------------------------------------------------- import from other launchers
    rememberImports(raws, imported) {
        return raws.map((r) => {
            const token = (0, node_crypto_1.randomBytes)(8).toString('hex');
            this.pendingImports.set(token, r);
            if (this.pendingImports.size > 600)
                this.pendingImports.delete(this.pendingImports.keys().next().value);
            return {
                token, name: r.name, mcVersion: r.mcVersion, loader: r.loader, mods: r.mods, worlds: r.worlds,
                imported: imported.has((0, launcherImport_1.importKey)(r)), problem: r.problem,
            };
        });
    }
    async importedKeys() {
        const list = await this.instances.list(this.ctx()).catch(() => []);
        return new Set(list.map((i) => i.importedFrom).filter((v) => typeof v === 'string'));
    }
    /** Looks for the other launchers on this computer. Every supported launcher is listed, installed or not. */
    async detectLaunchers(env) {
        const imported = await this.importedKeys();
        const found = await Promise.all(launchers_1.LAUNCHER_IDS.map(async (id) => {
            try {
                return await (0, launcherImport_1.detectLauncher)(id, env);
            }
            catch {
                return null; // an unreadable launcher folder must not break the list
            }
        }));
        return launchers_1.LAUNCHER_IDS.map((id, n) => {
            const f = found[n] ?? null;
            return { id, name: launchers_1.LAUNCHER_NAMES[id], path: f?.path ?? null, found: !!f, candidates: f ? this.rememberImports(f.instances, imported) : [] };
        });
    }
    /** A folder the user picked: recognises what is in it (launcher data folder, instances folder or one instance). */
    async sourceFromFolder(dir) {
        const raws = await (0, launcherImport_1.inspectFolder)(dir);
        return { id: 'custom', name: path.basename(dir) || dir, path: dir, found: true, candidates: this.rememberImports(raws, await this.importedKeys()) };
    }
    /**
     * Copies the chosen instances into ChaldLauncher (the other launcher is only read). Progress: op `modpack:import-<batch>`.
     * Minecraft + the loader are installed afterwards, one instance at a time.
     */
    startLauncherImport(tokens) {
        const items = [...new Set(tokens)].map((t) => this.pendingImports.get(t)).filter((r) => !!r && !r.problem);
        if (!items.length)
            throw new errors_1.AppError('IMPORT_EXPIRED', 'Список устарел или нечего импортировать. Открой импорт заново.');
        const batch = (0, node_crypto_1.randomBytes)(6).toString('hex');
        const key = `import-${batch}`;
        const ac = new AbortController();
        this.packs.set(key, ac);
        const opId = `modpack:${key}`;
        let current = null;
        const emit = (label, fraction, status = 'running', message = null, id = current) => this.o.emit('op:progress', { opId, kind: 'modpack', instanceId: id, label, fraction, status, message });
        emit('Подготовка импорта…', null);
        void (async () => {
            const created = [];
            const failures = [];
            let last = 0;
            for (const [n, r] of items.entries()) {
                if (ac.signal.aborted)
                    break;
                const head = items.length > 1 ? `Импорт ${n + 1} из ${items.length}: «${r.name}»` : `Импорт «${r.name}»`;
                let id = null;
                try {
                    emit(`${head}…`, n / items.length);
                    const inst = await this.instances.create((0, launcherImport_1.toCreateInput)(r), this.ctx());
                    id = inst.id;
                    const gameDir = await this.instances.gameDir(id);
                    await (0, launcherImport_1.copyGameFiles)(r.gameDir, gameDir, {
                        signal: ac.signal,
                        onProgress: (f) => {
                            const now = Date.now();
                            if (f < 1 && now - last < 120)
                                return; // hundreds of small files: do not flood the IPC channel
                            last = now;
                            emit(`${head}: копирую файлы`, (n + f) / items.length, 'running', null, null);
                        },
                    });
                    if (r.cfIndex)
                        await (0, storage_1.writeJsonAtomic)(path.join(gameDir, '.chald-curseforge.json'), { projects: r.cfIndex });
                    if (r.iconFile)
                        await this.instances.setCoverFromFile(id, r.iconFile).catch(() => undefined);
                    await this.instances.patchInternal(id, { importedFrom: (0, launcherImport_1.importKey)(r), ...(r.lastPlayedAt ? { lastPlayedAt: r.lastPlayedAt } : {}) });
                    created.push(id);
                    current = id;
                }
                catch (e) {
                    if (id)
                        await this.instances.remove(id, true).catch(() => undefined);
                    if ((0, errors_1.isAbort)(e) || ac.signal.aborted)
                        break;
                    failures.push(`«${r.name}»: ${e instanceof Error ? e.message : String(e)}`);
                }
            }
            this.packs.delete(key);
            failures.forEach((msg, i) => this.o.emit('op:progress', {
                opId: `${opId}-err${i}`, kind: 'modpack', instanceId: null, label: 'Не удалось импортировать', fraction: null, status: 'error', message: msg,
            }));
            if (created.length) {
                emit(created.length === 1 ? 'Инстанс импортирован. Устанавливаю Minecraft…' : `Импортировано инстансов: ${created.length}. Устанавливаю Minecraft…`, 1, 'done', null, created[created.length - 1]);
                // one at a time: several loader installs at once would fight over the shared libraries
                for (const id of created) {
                    try {
                        await this.beginInstall(id);
                    }
                    catch {
                        /* the user already started it by hand, or the game is running */
                    }
                }
            }
            else if (ac.signal.aborted) {
                emit('Импорт отменён', null, 'cancelled', null, null);
            }
            else if (!failures.length) {
                emit('Нечего импортировать', null, 'cancelled', null, null);
            }
            else {
                emit('Импорт не удался', null, 'cancelled', null, null);
            }
        })();
        return { batch };
    }
    cancelLauncherImport(batch) {
        this.packs.get(`import-${batch}`)?.abort();
    }
}
exports.Services = Services;
//# sourceMappingURL=services.js.map