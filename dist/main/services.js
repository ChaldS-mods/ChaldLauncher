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
const paths_1 = require("./paths");
const dns_1 = require("./dns");
const settings_1 = require("./settings");
const wardrobe_1 = require("./wardrobe");
const versions_1 = require("./versions");
class Services {
    o;
    dirs;
    settings;
    catalog;
    instances;
    auth;
    games;
    wardrobe;
    presence;
    installs = new Map();
    packs = new Map();
    modrinth;
    /** .chaldlauncher files the user picked and we validated, waiting for the confirmation click */
    pendingPacks = new Map();
    /** Sync copy of settings for places that cannot await (window close handler). */
    closeBehavior = 'quit';
    constructor(o) {
        this.o = o;
        this.dirs = (0, dirs_1.sharedDirs)(o.dataDir);
        this.modrinth = new modrinth_1.ModrinthApi(`ChaldStudio/ChaldLauncher/${o.appVersion} (Minecraft launcher)`);
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
        });
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
        });
    }
    async init() {
        const s = await this.settings.get();
        this.closeBehavior = s.closeBehavior;
        (0, dns_1.configureDns)({ mode: s.dnsMode, servers: s.dnsServers, dohUrl: s.dnsDohUrl });
        this.presence.configure(s.discordRpc, s.discordShowInstance, s.language);
    }
    /** Mirrors a started/stopped game to the Discord status. Never throws: the status is a nicety. */
    trackPresence(e) {
        if (e.status !== 'running') {
            this.presence.gameStopped(e.instanceId);
            return;
        }
        void this.instances
            .readMeta(e.instanceId)
            .then((meta) => {
            // the game may already be gone by the time the file is read
            if (!this.games.activeIds().has(e.instanceId))
                return;
            this.presence.gameStarted({ id: e.instanceId, name: meta.name, mcVersion: meta.mcVersion, loader: meta.loader.type, since: Date.now() });
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
    /** Starts installing (or repairing) an instance in the background; progress goes out as op:progress events. */
    startInstall(id) {
        if (this.installs.has(id))
            throw new errors_1.AppError('ALREADY_INSTALLING', 'Установка уже идёт');
        if (this.games.activeIds().has(id))
            throw new errors_1.AppError('ALREADY_RUNNING', 'Останови игру перед установкой');
        const ac = new AbortController();
        this.installs.set(id, ac);
        const opId = `install:${id}`;
        const emit = (label, fraction, status = 'running', message = null) => this.o.emit('op:progress', { opId, kind: 'install', instanceId: id, label, fraction, status, message });
        emit('Подготовка…', null);
        void (async () => {
            try {
                const meta = await this.instances.readMeta(id);
                const settings = await this.settings.get();
                const { versionId } = await (0, installer_1.installVersion)({ mcVersion: meta.mcVersion, loader: meta.loader }, this.dirs, this.catalog, (p) => emit(p.label, p.fraction), ac.signal, { javaFor: (major) => this.games.ensureJava(meta.settings.javaPath || settings.javaPath, major, (l, f) => emit(l, f), ac.signal) });
                await this.instances.patchInternal(id, { installed: true, versionId });
                this.installs.delete(id);
                emit('Установка завершена', 1, 'done');
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
    /** Installs a mod or resource pack (and the required dependencies of a mod) into an instance. Returns the file names. */
    async installFromModrinth(id, projectId, kind, versionId) {
        if (this.games.activeIds().has(id))
            throw new errors_1.AppError('BUSY', 'Останови игру, чтобы менять файлы');
        if (this.installs.has(id))
            throw new errors_1.AppError('BUSY', 'Идёт установка инстанса: изменение файлов недоступно');
        const meta = await this.instances.readMeta(id);
        const gameDir = await this.instances.gameDir(id);
        const target = { gameDir, mcVersion: meta.mcVersion, loader: meta.loader.type, kind };
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
            const r = await (0, chaldpack_1.exportInstance)({ gameDir, meta, includeWorlds, out, api: this.modrinth, report });
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
}
exports.Services = Services;
//# sourceMappingURL=services.js.map