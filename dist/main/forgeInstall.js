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
exports.installerUrl = installerUrl;
exports.makeResolver = makeResolver;
exports.installForgeLike = installForgeLike;
const fs = __importStar(require("node:fs/promises"));
const os = __importStar(require("node:os"));
const path = __importStar(require("node:path"));
const node_child_process_1 = require("node:child_process");
const adm_zip_1 = __importDefault(require("adm-zip"));
const errors_1 = require("./errors");
const download_1 = require("./download");
const net_1 = require("./net");
const paths_1 = require("./paths");
const storage_1 = require("./storage");
const versionJson_1 = require("./versionJson");
const versions_1 = require("./versions");
function installerUrl(loader, mcVersion, loaderVersion) {
    if (loader === 'forge') {
        const v = `${mcVersion}-${loaderVersion}`;
        return `https://maven.minecraftforge.net/net/minecraftforge/forge/${v}/forge-${v}-installer.jar`;
    }
    return `https://maven.neoforged.net/releases/net/neoforged/neoforge/${loaderVersion}/neoforge-${loaderVersion}-installer.jar`;
}
/** Token handling of Forge-style installers: [maven:coord], 'literal', /file/in/installer and {PLACEHOLDER}. */
function makeResolver(i) {
    const dataValue = (raw) => {
        if (raw.length >= 2 && raw.startsWith('[') && raw.endsWith(']'))
            return i.libPath(raw.slice(1, -1));
        if (raw.length >= 2 && raw.startsWith("'") && raw.endsWith("'"))
            return raw.slice(1, -1);
        if (raw.startsWith('/'))
            return i.extract(raw.slice(1));
        return raw;
    };
    const values = {};
    for (const [k, v] of Object.entries(i.data))
        values[k] = dataValue(v);
    const arg = (raw) => {
        if (raw.length >= 2 && raw.startsWith('[') && raw.endsWith(']'))
            return i.libPath(raw.slice(1, -1));
        return raw.replace(/\{([A-Za-z0-9_]+)\}/g, (_m, key) => {
            const v = i.vars[key] ?? values[key];
            if (v === undefined)
                throw new errors_1.AppError('INSTALL_PROFILE', `Установщик использует неизвестный параметр {${key}}`);
            return v;
        });
    };
    return { arg, dataValue };
}
function mainClassOf(jar) {
    const manifest = new adm_zip_1.default(jar).readAsText('META-INF/MANIFEST.MF');
    const m = /^Main-Class:\s*(\S+)/m.exec(manifest);
    if (!m)
        throw new errors_1.AppError('INSTALL_PROFILE', `В ${path.basename(jar)} нет Main-Class`);
    return m[1];
}
function runJava(java, args, cwd, signal) {
    return new Promise((resolve, reject) => {
        if (signal.aborted)
            return reject(new DOMException('Aborted', 'AbortError'));
        const child = (0, node_child_process_1.spawn)(java, args, { cwd, windowsHide: true, shell: false, stdio: ['ignore', 'pipe', 'pipe'] });
        const tail = [];
        const keep = (chunk) => {
            for (const line of chunk.toString('utf8').split(/\r?\n/))
                if (line.trim())
                    tail.push(line.trim());
            if (tail.length > 30)
                tail.splice(0, tail.length - 30);
        };
        child.stdout.on('data', keep);
        child.stderr.on('data', keep);
        const onAbort = () => child.kill();
        signal.addEventListener('abort', onAbort, { once: true });
        child.once('error', (e) => {
            signal.removeEventListener('abort', onAbort);
            reject(new errors_1.AppError('SPAWN_FAILED', `Не удалось запустить Java: ${e.message}`));
        });
        child.once('close', (code) => {
            signal.removeEventListener('abort', onAbort);
            if (signal.aborted)
                return reject(new DOMException('Aborted', 'AbortError'));
            if (code === 0)
                return resolve();
            reject(new errors_1.AppError('INSTALL_FAILED', `Обработчик установщика завершился с кодом ${code}. ${tail.slice(-6).join(' | ')}`));
        });
    });
}
async function fetchInstaller(url, dest, signal, onBytes) {
    let sha1;
    try {
        const t = (await (0, net_1.netText)(`${url}.sha1`, 'Контрольная сумма установщика', signal)).trim().split(/\s/)[0]?.toLowerCase();
        if (t && /^[0-9a-f]{40}$/.test(t))
            sha1 = t;
    }
    catch (e) {
        if ((0, errors_1.isAbort)(e) || signal.aborted)
            throw e;
        /* the checksum file is optional; the download itself is still over HTTPS from the official maven */
    }
    await (0, download_1.downloadFile)({ url, dest, sha1, purpose: 'Установщик загрузчика' }, { signal, onBytes });
}
/**
 * Installs Forge / NeoForge into the shared directories without running the installer's GUI:
 * unpacks the installer, downloads the libraries of the profile through our own (allow-listed) network layer,
 * runs the installer's processors with Java and writes the resulting version json.
 * The vanilla client jar (versions/<mc>/<mc>.jar) must already be in place.
 */
async function installForgeLike(i) {
    const { dirs, signal, report } = i;
    const title = i.loader === 'forge' ? 'Forge' : 'NeoForge';
    const installerPath = path.join(dirs.root, 'installers', `${i.loader}-${i.mcVersion}-${i.loaderVersion}-installer.jar`);
    report({ label: `Загрузка установщика ${title}…`, fraction: null });
    await fetchInstaller(installerUrl(i.loader, i.mcVersion, i.loaderVersion), installerPath, signal, () => undefined);
    const zip = new adm_zip_1.default(installerPath);
    const readJson = (name) => {
        const e = zip.getEntry(name.replace(/^\//, ''));
        if (!e)
            throw new errors_1.AppError('INSTALL_PROFILE', `В установщике ${title} нет файла ${name}`);
        return JSON.parse(e.getData().toString('utf8'));
    };
    const profile = readJson('install_profile.json');
    if (!profile.json)
        throw new errors_1.AppError('LOADER_UNSUPPORTED', `Этот установщик ${title} старого формата и не поддерживается`);
    const versionJson = readJson(profile.json);
    if (versionJson.inheritsFrom !== i.mcVersion) {
        throw new errors_1.AppError('LOADER_INCOMPATIBLE', `Профиль ${title} не соответствует Minecraft ${i.mcVersion}`);
    }
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'chald-loader-'));
    try {
        // files the installer carries itself (maven/ folder)
        report({ label: 'Распаковка установщика…', fraction: null });
        for (const e of zip.getEntries()) {
            if (e.isDirectory || !e.entryName.startsWith('maven/'))
                continue;
            const dest = (0, paths_1.resolveInside)(dirs.libraries, e.entryName.slice('maven/'.length));
            if (await (0, download_1.isFileValid)(dest, { size: e.header.size }))
                continue;
            await fs.mkdir(path.dirname(dest), { recursive: true });
            await fs.writeFile(dest, e.getData());
        }
        // libraries the processors need
        const platform = (0, versionJson_1.currentPlatform)();
        const libTasks = (profile.libraries ?? [])
            .filter((l) => (0, versionJson_1.rulesAllow)(l.rules, { platform, features: {} }))
            .flatMap((l) => {
            const art = l.downloads?.artifact;
            const rel = art?.path ?? (0, paths_1.mavenPath)(l.name);
            const url = art ? art.url : l.url ? l.url.replace(/\/?$/, '/') + rel : '';
            return url ? [{ url, dest: (0, paths_1.resolveInside)(dirs.libraries, rel), sha1: art?.sha1 ?? l.sha1, size: art?.size ?? l.size, purpose: `Библиотека ${title}` }] : [];
        });
        let done = 0;
        const emitLibs = () => report({ label: `Библиотеки ${title} ${done}/${libTasks.length}`, fraction: libTasks.length ? done / libTasks.length : 1 });
        emitLibs();
        await (0, download_1.runPool)(libTasks, 8, async (t) => {
            await (0, download_1.downloadFile)(t, { signal });
            done++;
            emitLibs();
        });
        const { arg, dataValue } = makeResolver({
            vars: {
                SIDE: 'client',
                ROOT: dirs.root,
                INSTALLER: installerPath,
                LIBRARY_DIR: dirs.libraries,
                MINECRAFT_JAR: (0, versions_1.versionPaths)(dirs.versions, i.mcVersion).jar,
                MINECRAFT_VERSION: i.mcVersion,
            },
            data: Object.fromEntries(Object.entries(profile.data ?? {}).map(([k, v]) => [k, v.client])),
            libPath: (coord) => (0, paths_1.resolveInside)(dirs.libraries, (0, paths_1.mavenPath)(coord)),
            extract: (entry) => {
                const e = zip.getEntry(entry);
                if (!e)
                    throw new errors_1.AppError('INSTALL_PROFILE', `В установщике нет файла ${entry}`);
                const dest = (0, paths_1.resolveInside)(tmp, entry);
                return dest;
            },
        });
        // `extract` only computes the target path; write the files that are actually referenced
        for (const v of Object.values(profile.data ?? {})) {
            if (v.client.startsWith('/')) {
                const entry = v.client.slice(1);
                const e = zip.getEntry(entry);
                if (!e)
                    throw new errors_1.AppError('INSTALL_PROFILE', `В установщике нет файла ${entry}`);
                const dest = (0, paths_1.resolveInside)(tmp, entry);
                await fs.mkdir(path.dirname(dest), { recursive: true });
                await fs.writeFile(dest, e.getData());
            }
        }
        const procs = (profile.processors ?? []).filter((p) => !p.sides || p.sides.includes('client'));
        for (let n = 0; n < procs.length; n++) {
            const p = procs[n];
            report({ label: `Обработка файлов ${title} ${n + 1}/${procs.length}`, fraction: n / procs.length });
            const outputs = Object.entries(p.outputs ?? {}).map(([k, v]) => ({ file: arg(k), sha1: arg(dataValue(v)) }));
            if (outputs.length && (await Promise.all(outputs.map((o) => (0, download_1.isFileValid)(o.file, { sha1: o.sha1 })))).every(Boolean))
                continue;
            const cp = [p.jar, ...(p.classpath ?? [])].map((c) => (0, paths_1.resolveInside)(dirs.libraries, (0, paths_1.mavenPath)(c)));
            const args = (p.args ?? []).map(arg);
            for (const o of outputs)
                await fs.mkdir(path.dirname(o.file), { recursive: true });
            await runJava(i.javaPath, ['-cp', cp.join(path.delimiter), mainClassOf(cp[0]), ...args], dirs.root, signal);
            for (const o of outputs) {
                if (!(await (0, download_1.isFileValid)(o.file, { sha1: o.sha1 }))) {
                    throw new errors_1.AppError('INSTALL_FAILED', `Обработчик ${title} создал неверный файл: ${path.basename(o.file)}`);
                }
            }
        }
        await (0, storage_1.writeJsonAtomic)((0, versions_1.versionPaths)(dirs.versions, versionJson.id).json, versionJson);
        report({ label: `${title} установлен`, fraction: 1 });
        return { versionId: versionJson.id };
    }
    finally {
        await fs.rm(tmp, { recursive: true, force: true }).catch(() => undefined);
    }
}
//# sourceMappingURL=forgeInstall.js.map