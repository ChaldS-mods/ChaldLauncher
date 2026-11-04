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
exports.GameManager = void 0;
const node_child_process_1 = require("node:child_process");
const path = __importStar(require("node:path"));
const errors_1 = require("./errors");
const installer_1 = require("./installer");
const java_1 = require("./java");
const launchArgs_1 = require("./launchArgs");
const memory_1 = require("./memory");
const memory_2 = require("../shared/memory");
const versionJson_1 = require("./versionJson");
const versions_1 = require("./versions");
const MAX_LOG_LINES = 5000;
class GameManager {
    d;
    procs = new Map();
    preparing = new Set();
    logs = new Map();
    aborts = new Map();
    constructor(d) {
        this.d = d;
    }
    activeIds() {
        return new Set([...this.procs.keys(), ...this.preparing]);
    }
    runningCount() {
        return this.procs.size;
    }
    getLogs(id) {
        return (this.logs.get(id) ?? []).slice();
    }
    pushLog(id, line) {
        const buf = this.logs.get(id) ?? [];
        buf.push(line);
        if (buf.length > MAX_LOG_LINES)
            buf.splice(0, buf.length - MAX_LOG_LINES);
        this.logs.set(id, buf);
        this.d.onLog({ instanceId: id, line });
    }
    progress(id, label, fraction, status = 'running', message = null) {
        this.d.onProgress({ opId: `launch:${id}`, kind: 'launch', instanceId: id, label, fraction, status, message });
    }
    stop(id) {
        this.aborts.get(id)?.abort();
        this.procs.get(id)?.kill();
    }
    async launch(id) {
        if (this.procs.has(id) || this.preparing.has(id)) {
            throw new errors_1.AppError('ALREADY_RUNNING', 'Этот инстанс уже запускается или запущен');
        }
        this.preparing.add(id);
        const ac = new AbortController();
        this.aborts.set(id, ac);
        try {
            await this.prepareAndSpawn(id, ac.signal);
        }
        catch (e) {
            const cancelled = ac.signal.aborted;
            this.progress(id, cancelled ? 'Запуск отменён' : 'Не удалось запустить', null, cancelled ? 'cancelled' : 'error', cancelled ? null : (e instanceof Error ? e.message : String(e)));
            if (cancelled)
                return;
            throw e;
        }
        finally {
            this.preparing.delete(id);
            this.aborts.delete(id);
        }
    }
    async prepareAndSpawn(id, signal) {
        const { dirs, instances } = this.d;
        const meta = await instances.readMeta(id);
        if (!meta.installed || !meta.versionId)
            throw new errors_1.AppError('NOT_INSTALLED', 'Инстанс не установлен. Запусти установку.');
        const settings = await this.d.getSettings();
        this.progress(id, 'Проверка аккаунта…', null);
        const auth = await this.d.auth.getLaunchAuth();
        this.progress(id, 'Проверка файлов игры…', null);
        const problems = await (0, installer_1.verifyInstall)(dirs, meta.versionId);
        if (problems.length)
            throw new errors_1.AppError('FILES_MISSING', `${problems.join('; ')}. Запусти восстановление инстанса.`);
        const version = await (0, installer_1.loadResolvedVersion)(dirs, meta.versionId);
        const requiredJava = version.javaVersion?.majorVersion ?? 8;
        const javaPath = await this.resolveJava(meta.settings.javaPath || settings.javaPath, requiredJava, id, signal);
        const platform = (0, versionJson_1.currentPlatform)();
        const instDir = path.dirname(await instances.gameDir(id));
        const gameDir = await instances.gameDir(id);
        const nativesDir = path.join(instDir, '.natives');
        this.progress(id, 'Подготовка библиотек…', null);
        await (0, installer_1.extractNatives)((0, versionJson_1.resolveLibraries)(version, { platform, features: {} }), dirs.libraries, nativesDir);
        const s = meta.settings;
        const width = s.width ?? settings.width;
        const height = s.height ?? settings.height;
        const fullscreen = s.fullscreen ?? settings.fullscreen;
        // Memory: the instance's own value wins; otherwise the automatic pick (computer's RAM + the instance's mods) or the global sliders.
        const { totalMb } = (0, memory_1.systemMemory)();
        const auto = settings.memoryAuto && (s.memoryMinMb == null || s.memoryMaxMb == null)
            ? (0, memory_2.recommendMemory)({ totalMb, modCount: await (0, memory_1.countModJars)(gameDir), loader: meta.loader.type })
            : null;
        const baseMin = auto ? auto.minMb : settings.memoryMinMb;
        const baseMax = auto ? auto.maxMb : settings.memoryMaxMb;
        const maxMb = s.memoryMaxMb ?? baseMax;
        let minMb = s.memoryMinMb ?? baseMin;
        if (minMb > maxMb) {
            if (s.memoryMinMb != null)
                throw new errors_1.AppError('SETTINGS_INVALID', 'Минимум памяти больше максимума');
            minMb = maxMb; // the minimum came from the global/auto value and the instance lowered the maximum under it
        }
        const cmd = (0, launchArgs_1.buildLaunchCommand)({
            version, platform, javaPath, gameDir, assetsDir: dirs.assets, librariesDir: dirs.libraries, nativesDir,
            clientJar: (0, versions_1.versionPaths)(dirs.versions, version.inheritsFrom ?? version.id).jar,
            auth, memoryMinMb: minMb, memoryMaxMb: maxMb,
            extraJvmArgs: [...(0, launchArgs_1.splitArgs)(settings.jvmArgs), ...(0, launchArgs_1.splitArgs)(s.jvmArgs)],
            resolution: { width, height }, fullscreen,
            launcherName: 'ChaldLauncher', launcherVersion: this.d.launcherVersion,
            // Forge/NeoForge put `${version_name}.jar` into -DignoreList: it must be the vanilla jar name, or the client is loaded twice.
            versionName: (meta.loader.type === 'forge' || meta.loader.type === 'neoforge') ? version.inheritsFrom : undefined,
        });
        this.logs.set(id, []);
        this.pushLog(id, `[launcher] ${(0, launchArgs_1.redact)([cmd.command, ...cmd.args].join(' '), cmd.secrets)}`);
        this.pushLog(id, `[launcher] память: ${minMb}–${maxMb} МБ (${auto ? 'подобрана автоматически' : s.memoryMinMb != null && s.memoryMaxMb != null ? 'свои настройки инстанса' : 'из настроек'}), ОЗУ компьютера: ${totalMb} МБ`);
        const warn = (0, memory_2.memoryWarning)(maxMb, totalMb);
        if (warn === 'exceeds-ram')
            this.pushLog(id, '[launcher] Предупреждение: максимум памяти больше, чем ОЗУ компьютера: игра будет сильно тормозить. Уменьши его в настройках.');
        else if (warn === 'tight')
            this.pushLog(id, '[launcher] Предупреждение: системе остаётся меньше 1,5 ГБ ОЗУ, возможны подвисания компьютера.');
        const child = (0, node_child_process_1.spawn)(cmd.command, cmd.args, { cwd: cmd.cwd, windowsHide: true, shell: false, stdio: ['ignore', 'pipe', 'pipe'] });
        this.procs.set(id, child);
        // Every listener is attached synchronously right after spawn(): an `await` in between lets the
        // 'spawn' / 'exit' events fire before anyone listens, which left the UI stuck on "Подготовка библиотек…".
        const pipeLines = (stream) => {
            let rest = '';
            stream.setEncoding('utf8');
            stream.on('data', (chunk) => {
                const parts = (rest + chunk).split(/\r?\n/);
                rest = parts.pop() ?? '';
                for (const p of parts)
                    this.pushLog(id, (0, launchArgs_1.redact)(p, cmd.secrets));
            });
            stream.on('end', () => rest && this.pushLog(id, (0, launchArgs_1.redact)(rest, cmd.secrets)));
        };
        pipeLines(child.stdout);
        pipeLines(child.stderr);
        child.once('exit', (code, sig) => {
            this.procs.delete(id);
            const crashed = (code !== null && code !== 0) || sig !== null;
            this.pushLog(id, `[launcher] процесс завершён, код: ${code ?? sig}`);
            this.d.onStatus({ instanceId: id, status: crashed ? 'crashed' : 'exited', exitCode: code });
        });
        await new Promise((resolve, reject) => {
            child.once('error', (err) => {
                this.procs.delete(id);
                reject(new errors_1.AppError('SPAWN_FAILED', `Не удалось запустить Java: ${err.message}`));
            });
            child.once('spawn', () => {
                this.progress(id, 'Игра запущена', 1, 'done');
                this.d.onStatus({ instanceId: id, status: 'running', exitCode: null });
                resolve();
            });
        });
        await instances.patchInternal(id, { lastPlayedAt: new Date().toISOString() }).catch(() => undefined);
    }
    /** Finds a suitable Java (configured path, installed one, or downloads Temurin). Used by launch and by loader installers. */
    async ensureJava(configured, required, report, signal) {
        if (configured) {
            const major = await (0, java_1.javaMajor)(configured);
            if (major == null)
                throw new errors_1.AppError('JAVA_INVALID', `Не удалось запустить Java по пути: ${configured}`);
            if (major < required)
                throw new errors_1.AppError('JAVA_OLD', `Нужна Java ${required}+, указана Java ${major}`);
            return configured;
        }
        report('Поиск Java…', null);
        const found = (0, java_1.pickJava)(required, await (0, java_1.detectJava)(this.d.dirs));
        if (found)
            return found.path;
        return (0, java_1.downloadJava)(required, this.d.dirs, report, signal);
    }
    resolveJava(configured, required, id, signal) {
        return this.ensureJava(configured, required, (label, fraction) => this.progress(id, label, fraction), signal);
    }
}
exports.GameManager = GameManager;
//# sourceMappingURL=launcher.js.map