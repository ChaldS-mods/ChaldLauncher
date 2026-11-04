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
exports.loadResolvedVersion = loadResolvedVersion;
exports.installVersion = installVersion;
exports.verifyInstall = verifyInstall;
exports.extractNatives = extractNatives;
const fs = __importStar(require("node:fs/promises"));
const path = __importStar(require("node:path"));
const adm_zip_1 = __importDefault(require("adm-zip"));
const errors_1 = require("./errors");
const download_1 = require("./download");
const paths_1 = require("./paths");
const storage_1 = require("./storage");
const versions_1 = require("./versions");
const forgeInstall_1 = require("./forgeInstall");
const net_1 = require("./net");
const versionJson_1 = require("./versionJson");
/** Read a version json and resolve `inheritsFrom` into one merged description. */
async function loadResolvedVersion(dirs, versionId) {
    const file = (0, versions_1.versionPaths)(dirs.versions, versionId).json;
    const json = await (0, storage_1.readJson)(file);
    if (!json)
        throw new errors_1.AppError('VERSION_MISSING', `Нет файла версии ${versionId}`);
    if (!json.inheritsFrom)
        return json;
    const parent = await loadResolvedVersion(dirs, json.inheritsFrom);
    return (0, versionJson_1.mergeVersions)(parent, json);
}
function formatMb(bytes) {
    return (bytes / 1048576).toFixed(bytes > 10485760 ? 0 : 1);
}
async function installVersion(req, dirs, catalog, report, signal, hooks) {
    const platform = (0, versionJson_1.currentPlatform)();
    report({ label: 'Получение метаданных версии…', fraction: null });
    const entry = await catalog.find(req.mcVersion);
    const vanilla = (0, versions_1.versionPaths)(dirs.versions, entry.id);
    await (0, download_1.downloadFile)({ url: entry.url, dest: vanilla.json, sha1: entry.sha1, purpose: `Описание Minecraft ${entry.id}` }, { signal });
    let versionId = entry.id;
    const loaderType = req.loader.type;
    if ((0, versions_1.isProfileLoader)(loaderType)) {
        const title = loaderType === 'fabric' ? 'Fabric' : 'Quilt';
        if (!req.loader.version)
            throw new errors_1.AppError('LOADER_INCOMPATIBLE', `Не выбрана версия ${title}`);
        report({ label: `Проверка совместимости ${title}…`, fraction: null });
        await (0, versions_1.assertLoaderCompatible)(loaderType, req.mcVersion, req.loader.version);
        const profile = await (0, net_1.netJson)((0, versions_1.profileUrl)(loaderType, req.mcVersion, req.loader.version), { purpose: `Профиль ${title}`, signal });
        if (!profile.id || profile.inheritsFrom !== req.mcVersion) {
            throw new errors_1.AppError('LOADER_INCOMPATIBLE', `Профиль ${title} не соответствует выбранной версии Minecraft`);
        }
        versionId = profile.id;
        await (0, storage_1.writeJsonAtomic)((0, versions_1.versionPaths)(dirs.versions, versionId).json, profile);
    }
    else if (loaderType === 'forge' || loaderType === 'neoforge') {
        const title = loaderType === 'forge' ? 'Forge' : 'NeoForge';
        if (!req.loader.version)
            throw new errors_1.AppError('LOADER_INCOMPATIBLE', `Не выбрана версия ${title}`);
        if (!hooks)
            throw new errors_1.AppError('LOADER_UNSUPPORTED', `${title}: установка недоступна в этом режиме`);
        report({ label: `Проверка совместимости ${title}…`, fraction: null });
        await (0, versions_1.assertLoaderCompatible)(loaderType, req.mcVersion, req.loader.version);
        // The installer's processors patch the vanilla client, so it has to be on disk first.
        const vanillaJson = await loadResolvedVersion(dirs, entry.id);
        const vanillaClient = vanillaJson.downloads?.client;
        if (!vanillaClient)
            throw new errors_1.AppError('VERSION_INVALID', 'В описании версии нет клиента');
        let got = 0;
        await (0, download_1.downloadFile)({ url: vanillaClient.url, dest: vanilla.jar, sha1: vanillaClient.sha1, size: vanillaClient.size, purpose: `Клиент Minecraft ${entry.id}` }, { signal, onBytes: (d) => { got += d; report({ label: `Клиент Minecraft: ${formatMb(Math.max(0, got))} МБ`, fraction: vanillaClient.size ? Math.min(1, Math.max(0, got) / vanillaClient.size) : null }); } });
        const javaPath = await hooks.javaFor(vanillaJson.javaVersion?.majorVersion ?? 8);
        ({ versionId } = await (0, forgeInstall_1.installForgeLike)({
            loader: loaderType, mcVersion: req.mcVersion, loaderVersion: req.loader.version, dirs, javaPath, report, signal,
        }));
    }
    const resolved = await loadResolvedVersion(dirs, versionId);
    const client = resolved.downloads?.client;
    if (!client)
        throw new errors_1.AppError('VERSION_INVALID', 'В описании версии нет клиента');
    if (!resolved.assetIndex)
        throw new errors_1.AppError('VERSION_INVALID', 'В описании версии нет индекса ресурсов');
    report({ label: 'Получение списка ресурсов…', fraction: null });
    const indexFile = path.join(dirs.assets, 'indexes', `${resolved.assetIndex.id}.json`);
    await (0, download_1.downloadFile)({ url: resolved.assetIndex.url, dest: indexFile, sha1: resolved.assetIndex.sha1, size: resolved.assetIndex.size, purpose: 'Индекс ресурсов' }, { signal });
    const index = (await (0, storage_1.readJson)(indexFile));
    if (index.map_to_resources || index.virtual) {
        throw new errors_1.AppError('VERSION_UNSUPPORTED', 'Очень старые версии Minecraft (до 1.7) пока не поддерживаются');
    }
    const libs = (0, versionJson_1.resolveLibraries)(resolved, { platform, features: {} });
    const tasks = [
        { url: client.url, dest: (0, versions_1.versionPaths)(dirs.versions, req.mcVersion).jar, sha1: client.sha1, size: client.size, purpose: `Клиент Minecraft ${req.mcVersion}` },
        // libraries with an empty url are produced by the Forge/NeoForge processors, not downloaded
        ...libs.filter((l) => l.artifact.url).map((l) => ({
            url: l.artifact.url,
            dest: (0, paths_1.resolveInside)(dirs.libraries, l.artifact.path),
            sha1: l.artifact.sha1,
            size: l.artifact.size,
            purpose: 'Библиотека',
        })),
        ...Object.values(index.objects).map((o) => ({
            url: `https://resources.download.minecraft.net/${o.hash.slice(0, 2)}/${o.hash}`,
            dest: path.join(dirs.assets, 'objects', o.hash.slice(0, 2), o.hash),
            sha1: o.hash,
            size: o.size,
            purpose: 'Ресурсы игры',
        })),
    ];
    const totalBytes = tasks.reduce((s, t) => s + (t.size ?? 0), 0);
    let doneBytes = 0;
    let doneFiles = 0;
    let lastEmit = 0;
    const emit = (force = false) => {
        const now = Date.now();
        if (!force && now - lastEmit < 120)
            return;
        lastEmit = now;
        const fraction = totalBytes > 0 ? Math.min(1, doneBytes / totalBytes) : doneFiles / tasks.length;
        report({
            label: `Загрузка файлов ${doneFiles}/${tasks.length}` + (totalBytes > 0 ? ` · ${formatMb(doneBytes)} из ${formatMb(totalBytes)} МБ` : ''),
            fraction,
        });
    };
    emit(true);
    await (0, download_1.runPool)(tasks, 12, async (t) => {
        await (0, download_1.downloadFile)(t, { signal, onBytes: (d) => { doneBytes += d; emit(); } });
        doneFiles++;
        emit();
    });
    emit(true);
    return { versionId };
}
/** Existence check of everything needed to start the game. Returns human-readable problems. */
async function verifyInstall(dirs, versionId, platform = (0, versionJson_1.currentPlatform)()) {
    const problems = [];
    let resolved;
    try {
        resolved = await loadResolvedVersion(dirs, versionId);
    }
    catch {
        return [`Нет описания версии ${versionId}`];
    }
    const baseId = resolved.inheritsFrom ?? resolved.id;
    const jar = (0, versions_1.versionPaths)(dirs.versions, baseId).jar;
    if (!(await (0, download_1.isFileValid)(jar, { size: resolved.downloads?.client?.size })))
        problems.push('Нет файла клиента Minecraft');
    let missingLibs = 0;
    for (const l of (0, versionJson_1.resolveLibraries)(resolved, { platform, features: {} })) {
        if (!(await (0, download_1.isFileValid)((0, paths_1.resolveInside)(dirs.libraries, l.artifact.path), { size: l.artifact.size })))
            missingLibs++;
    }
    if (missingLibs)
        problems.push(`Не хватает библиотек: ${missingLibs}`);
    if (resolved.assetIndex) {
        const idx = await (0, storage_1.readJson)(path.join(dirs.assets, 'indexes', `${resolved.assetIndex.id}.json`)).catch(() => null);
        if (!idx)
            problems.push('Нет индекса ресурсов');
        else {
            let missing = 0;
            for (const o of Object.values(idx.objects)) {
                try {
                    await fs.access(path.join(dirs.assets, 'objects', o.hash.slice(0, 2), o.hash));
                }
                catch {
                    missing++;
                }
            }
            if (missing)
                problems.push(`Не хватает файлов ресурсов: ${missing}`);
        }
    }
    return problems;
}
/** Unpack legacy natives (pre-1.19) into a fresh per-instance directory. */
async function extractNatives(libs, librariesDir, nativesDir) {
    await fs.rm(nativesDir, { recursive: true, force: true });
    await fs.mkdir(nativesDir, { recursive: true });
    for (const lib of libs.filter((l) => l.native)) {
        const zip = new adm_zip_1.default((0, paths_1.resolveInside)(librariesDir, lib.artifact.path));
        for (const e of zip.getEntries()) {
            if (e.isDirectory)
                continue;
            if (lib.extractExclude.some((x) => e.entryName.startsWith(x)))
                continue;
            const dest = (0, paths_1.resolveInside)(nativesDir, e.entryName); // zip-slip guard
            await fs.mkdir(path.dirname(dest), { recursive: true });
            await fs.writeFile(dest, e.getData());
        }
    }
}
//# sourceMappingURL=installer.js.map