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
exports.parseJavaMajor = parseJavaMajor;
exports.javaMajor = javaMajor;
exports.detectJava = detectJava;
exports.pickJava = pickJava;
exports.findJavaBinary = findJavaBinary;
exports.downloadJava = downloadJava;
const node_child_process_1 = require("node:child_process");
const fs = __importStar(require("node:fs/promises"));
const path = __importStar(require("node:path"));
const adm_zip_1 = __importDefault(require("adm-zip"));
const tar = __importStar(require("tar"));
const errors_1 = require("./errors");
const download_1 = require("./download");
const net_1 = require("./net");
const paths_1 = require("./paths");
const EXE = process.platform === 'win32' ? 'java.exe' : 'java';
function parseJavaMajor(output) {
    const m = /version "(\d+)(?:\.(\d+))?/.exec(output);
    if (!m)
        return null;
    const first = Number(m[1]);
    return first === 1 ? Number(m[2]) : first;
}
function javaMajor(javaPath) {
    return new Promise((resolve) => {
        (0, node_child_process_1.execFile)(javaPath, ['-version'], { timeout: 8000, windowsHide: true }, (err, stdout, stderr) => {
            if (err && !stderr)
                return resolve(null);
            resolve(parseJavaMajor(`${stderr}\n${stdout}`));
        });
    });
}
async function subdirs(dir) {
    try {
        return (await fs.readdir(dir, { withFileTypes: true })).filter((d) => d.isDirectory()).map((d) => path.join(dir, d.name));
    }
    catch {
        return [];
    }
}
async function candidatePaths(runtimeDir) {
    const out = [{ path: 'java', source: 'system' }];
    if (process.env.JAVA_HOME)
        out.push({ path: path.join(process.env.JAVA_HOME, 'bin', EXE), source: 'system' });
    const roots = [];
    if (process.platform === 'win32') {
        for (const base of [process.env['ProgramFiles'], process.env['ProgramFiles(x86)']].filter(Boolean)) {
            for (const vendor of ['Java', 'Eclipse Adoptium', 'Microsoft', 'Zulu', 'BellSoft', 'Amazon Corretto']) {
                roots.push(...(await subdirs(path.join(base, vendor))));
            }
        }
    }
    else if (process.platform === 'darwin') {
        for (const d of await subdirs('/Library/Java/JavaVirtualMachines'))
            roots.push(path.join(d, 'Contents', 'Home'));
    }
    else {
        roots.push(...(await subdirs('/usr/lib/jvm')));
    }
    for (const r of roots)
        out.push({ path: path.join(r, 'bin', EXE), source: 'system' });
    for (const v of await subdirs(runtimeDir)) {
        const found = await findJavaBinary(v);
        if (found)
            out.push({ path: found, source: 'launcher' });
    }
    return out;
}
async function detectJava(dirs) {
    const seen = new Set();
    const result = [];
    for (const c of await candidatePaths(dirs.runtime)) {
        let real = c.path;
        if (path.isAbsolute(c.path)) {
            try {
                real = await fs.realpath(c.path);
            }
            catch {
                continue;
            }
        }
        if (seen.has(real))
            continue;
        const major = await javaMajor(c.path);
        if (major == null)
            continue;
        seen.add(real);
        result.push({ path: path.isAbsolute(c.path) ? c.path : real, major, source: c.source });
    }
    return result.sort((a, b) => a.major - b.major);
}
/** Exact match first, then the lowest newer major. */
function pickJava(required, installs) {
    const exact = installs.find((j) => j.major === required);
    if (exact)
        return exact;
    return installs.filter((j) => j.major > required).sort((a, b) => a.major - b.major)[0] ?? null;
}
async function findJavaBinary(root, depth = 5) {
    if (depth < 0)
        return null;
    let entries;
    try {
        entries = await fs.readdir(root, { withFileTypes: true });
    }
    catch {
        return null;
    }
    if (path.basename(root) === 'bin' && entries.some((e) => e.name === EXE))
        return path.join(root, EXE);
    for (const e of entries) {
        if (e.isDirectory()) {
            const f = await findJavaBinary(path.join(root, e.name), depth - 1);
            if (f)
                return f;
        }
    }
    return null;
}
/** Download Eclipse Temurin JRE (GPLv2+Classpath Exception) into the launcher's own runtime dir. */
async function downloadJava(major, dirs, report, signal) {
    const target = path.join(dirs.runtime, `temurin-${major}`);
    const existing = await findJavaBinary(target);
    if (existing && (await javaMajor(existing)) === major)
        return existing;
    const os = process.platform === 'win32' ? 'windows' : process.platform === 'darwin' ? 'mac' : 'linux';
    const arch = process.arch === 'arm64' ? 'aarch64' : process.arch === 'x64' ? 'x64' : null;
    if (!arch)
        throw new errors_1.AppError('JAVA_UNSUPPORTED', `Автозагрузка Java недоступна для архитектуры ${process.arch}`);
    report(`Поиск Java ${major}…`, null);
    const assets = await (0, net_1.netJson)(`https://api.adoptium.net/v3/assets/latest/${major}/hotspot?architecture=${arch}&image_type=jre&os=${os}`, { purpose: `Поиск Java ${major}`, signal });
    const pkg = assets[0]?.binary.package;
    if (!pkg)
        throw new errors_1.AppError('JAVA_NOT_FOUND', `Java ${major} для этой системы не найдена`);
    const archive = path.join(dirs.runtime, '.downloads', pkg.name);
    let total = pkg.size;
    let done = 0;
    report(`Загрузка Java ${major}…`, 0);
    await (0, download_1.downloadFile)({ url: pkg.link, dest: archive, sha256: pkg.checksum, size: pkg.size, purpose: `Java ${major} (Eclipse Temurin)` }, { signal, onBytes: (d) => { done += d; report(`Загрузка Java ${major}…`, total ? Math.min(1, done / total) : null); } });
    report(`Распаковка Java ${major}…`, null);
    const tmp = `${target}.tmp`;
    await fs.rm(tmp, { recursive: true, force: true });
    await fs.mkdir(tmp, { recursive: true });
    if (pkg.name.endsWith('.zip')) {
        const zip = new adm_zip_1.default(archive);
        for (const e of zip.getEntries()) {
            if (e.isDirectory)
                continue;
            const dest = (0, paths_1.resolveInside)(tmp, e.entryName); // zip-slip guard
            await fs.mkdir(path.dirname(dest), { recursive: true });
            await fs.writeFile(dest, e.getData(), { mode: 0o755 });
        }
    }
    else {
        await tar.x({ file: archive, cwd: tmp });
    }
    await fs.rm(target, { recursive: true, force: true });
    await fs.rename(tmp, target);
    await fs.rm(archive, { force: true });
    const bin = await findJavaBinary(target);
    if (!bin)
        throw new errors_1.AppError('JAVA_NOT_FOUND', 'В распакованном архиве нет java');
    if (process.platform !== 'win32')
        await fs.chmod(bin, 0o755);
    return bin;
}
//# sourceMappingURL=java.js.map