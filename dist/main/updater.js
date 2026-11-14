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
exports.Updater = void 0;
const fsp = __importStar(require("node:fs/promises"));
const path = __importStar(require("node:path"));
const download_1 = require("./download");
const errors_1 = require("./errors");
const paths_1 = require("./paths");
const update_1 = require("./update");
/** Finds a new launcher version, downloads its installer in the background and starts it on request. */
class Updater {
    d;
    found = null;
    ac = null;
    applying = false;
    constructor(d) {
        this.d = d;
    }
    get pick() {
        return { appImage: !!this.d.appImage, arch: this.d.arch };
    }
    fileFor(f) {
        return path.join(this.d.dir, f.release.version, (0, paths_1.safeFileName)(f.asset.name));
    }
    async downloaded(f) {
        if (!f.asset)
            return false;
        return (0, download_1.isFileValid)(this.fileFor(f), { size: f.asset.size, sha256: f.asset.sha256 ?? undefined });
    }
    async check() {
        const repo = await this.d.repo();
        if (!repo)
            return (0, update_1.noUpdateSource)(this.d.version);
        let release;
        try {
            release = await (this.d.fetchRelease ?? update_1.fetchLatestRelease)(repo);
        }
        catch (e) {
            // a repository without a single release is normal at the start: not an error, just nothing to update to
            if ((0, update_1.isNoReleaseError)(e)) {
                this.found = null;
                return (0, update_1.noReleasesYet)(this.d.version);
            }
            throw e;
        }
        const asset = (0, update_1.pickInstallerAsset)(release.assets, this.d.platform, this.pick);
        this.found = { repo, release, asset };
        const info = (0, update_1.toUpdateInfo)(release, this.d.version, this.d.platform, { downloaded: false, downloading: this.ac !== null }, this.pick);
        if (info.hasUpdate && asset)
            info.downloaded = await this.downloaded(this.found);
        return info;
    }
    /** Starts the download and returns right away; progress goes out as op:progress (opId update:<version>). */
    async start() {
        const f = this.found ?? (await this.check(), this.found);
        if (!f || !f.asset)
            throw new errors_1.AppError('UPDATE_NO_FILE', 'Для этой версии нет файла установки: скачай обновление со страницы релиза.');
        if ((0, update_1.toUpdateInfo)(f.release, this.d.version, this.d.platform, { downloaded: false, downloading: false }, this.pick).hasUpdate === false) {
            throw new errors_1.AppError('UPDATE_NONE', 'Новой версии нет');
        }
        if (this.ac)
            return;
        if (!(0, update_1.isOwnReleaseUrl)(f.asset.url, f.repo))
            throw new errors_1.AppError('UPDATE_BAD_URL', 'Файл обновления не из репозитория лаунчера: скачивание отменено.');
        const { asset } = f;
        const version = f.release.version;
        const file = this.fileFor(f);
        const opId = `update:${version}`;
        const emit = (label, fraction, status = 'running', message = null) => this.d.emit({ opId, kind: 'update', instanceId: null, label, fraction, status, message });
        const ac = new AbortController();
        this.ac = ac;
        emit(`Скачиваю обновление ${version}…`, asset.size > 0 ? 0 : null);
        void (async () => {
            try {
                await this.dropOldVersions(version);
                let got = 0;
                await (this.d.download ?? download_1.downloadFile)({ url: asset.url, dest: file, size: asset.size || undefined, sha256: asset.sha256 ?? undefined, purpose: 'Скачивание обновления лаунчера' }, {
                    signal: ac.signal,
                    onBytes: (n) => {
                        got = Math.max(0, got + n);
                        if (asset.size > 0)
                            emit(`Скачиваю обновление ${version}…`, Math.min(1, got / asset.size));
                    },
                });
                this.ac = null;
                const onQuit = await (this.d.autoInstall?.() ?? Promise.resolve(false)).catch(() => false);
                emit(onQuit ? `Обновление ${version} скачано: установится при закрытии лаунчера` : `Обновление ${version} скачано`, 1, 'done');
            }
            catch (e) {
                this.ac = null;
                if ((0, errors_1.isAbort)(e) || ac.signal.aborted)
                    emit('Скачивание обновления отменено', null, 'cancelled');
                else
                    emit('Не удалось скачать обновление', null, 'error', e instanceof Error ? e.message : String(e));
            }
        })();
    }
    cancel() {
        this.ac?.abort();
    }
    /** Applies the downloaded update (silently, the launcher starts again) and closes the launcher. */
    async install() {
        const f = this.found;
        if (!f || !f.asset || !(await this.downloaded(f)))
            throw new errors_1.AppError('UPDATE_NOT_READY', 'Обновление ещё не скачано');
        if (this.d.gamesRunning() > 0)
            throw new errors_1.AppError('UPDATE_GAME_RUNNING', 'Сначала закрой игру: лаунчер перезапустится для обновления.');
        if (this.applying)
            return;
        this.applying = true;
        try {
            await this.d.runInstaller(this.fileFor(f), { launch: true }); // the file was just verified against size and SHA-256
        }
        catch (e) {
            this.applying = false;
            throw e;
        }
        setTimeout(() => this.d.quit(), 400);
    }
    /**
     * Called when the launcher is being closed: if a verified update is waiting and the user wants updates installed by
     * themselves, applies it now (without starting the launcher again). Returns true when something was applied.
     * Never throws: a failed update must not keep the launcher from closing.
     */
    async installOnQuit() {
        try {
            const f = this.found;
            if (this.applying || !f || !f.asset)
                return false;
            if (!(await (this.d.autoInstall?.() ?? Promise.resolve(false))))
                return false;
            if ((0, update_1.toUpdateInfo)(f.release, this.d.version, this.d.platform, { downloaded: false, downloading: false }, this.pick).hasUpdate === false)
                return false;
            if (this.ac || this.d.gamesRunning() > 0 || !(await this.downloaded(f)))
                return false;
            if (!(0, update_1.isOwnReleaseUrl)(f.asset.url, f.repo))
                return false;
            this.applying = true;
            await this.d.runInstaller(this.fileFor(f), { launch: false });
            return true;
        }
        catch {
            this.applying = false;
            return false;
        }
    }
    async dropOldVersions(keep) {
        let names = [];
        try {
            names = await fsp.readdir(this.d.dir);
        }
        catch {
            return;
        }
        await Promise.all(names.filter((n) => n !== keep).map((n) => fsp.rm(path.join(this.d.dir, n), { recursive: true, force: true }).catch(() => undefined)));
    }
}
exports.Updater = Updater;
//# sourceMappingURL=updater.js.map