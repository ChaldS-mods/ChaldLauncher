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
exports.assertFabricCompatible = exports.fabricProfileUrl = exports.fabricLoaders = exports.VersionCatalog = exports.MANIFEST_URL = void 0;
exports.isProfileLoader = isProfileLoader;
exports.profileLoaders = profileLoaders;
exports.profileUrl = profileUrl;
exports.compareVersions = compareVersions;
exports.forgeSupportsMc = forgeSupportsMc;
exports.neoforgePrefix = neoforgePrefix;
exports.parseForgeMetadata = parseForgeMetadata;
exports.forgeLoaders = forgeLoaders;
exports.neoforgeLoaders = neoforgeLoaders;
exports.loaderVersions = loaderVersions;
exports.assertLoaderCompatible = assertLoaderCompatible;
exports.versionPaths = versionPaths;
const path = __importStar(require("node:path"));
const errors_1 = require("./errors");
const net_1 = require("./net");
const storage_1 = require("./storage");
exports.MANIFEST_URL = 'https://piston-meta.mojang.com/mc/game/version_manifest_v2.json';
class VersionCatalog {
    cacheFile;
    manifest = null;
    constructor(cacheFile) {
        this.cacheFile = cacheFile;
    }
    /** Network first; on failure fall back to the last cached copy so the launcher works offline. */
    async getManifest(refresh = false) {
        if (this.manifest && !refresh)
            return this.manifest;
        try {
            const m = await (0, net_1.netJson)(exports.MANIFEST_URL, { purpose: 'Список версий Minecraft' });
            this.manifest = m;
            await (0, storage_1.writeJsonAtomic)(this.cacheFile, m).catch(() => undefined);
            return m;
        }
        catch (e) {
            const cached = await (0, storage_1.readJson)(this.cacheFile).catch(() => null);
            if (cached) {
                this.manifest = cached;
                return cached;
            }
            throw new errors_1.AppError('VERSIONS_UNAVAILABLE', `Не удалось получить список версий: ${e instanceof Error ? e.message : e}`);
        }
    }
    async minecraft(refresh = false) {
        const m = await this.getManifest(refresh);
        return m.versions.map((v) => ({ id: v.id, type: v.type, releaseTime: v.releaseTime }));
    }
    async find(id) {
        const v = (await this.getManifest()).versions.find((x) => x.id === id);
        if (!v)
            throw new errors_1.AppError('VERSION_UNKNOWN', `Версия Minecraft ${id} не найдена в официальном списке`);
        return v;
    }
}
exports.VersionCatalog = VersionCatalog;
/** Loaders whose launch profile comes ready-made from a meta API (a small json inheriting the vanilla version). */
const PROFILE_API = {
    fabric: { base: 'https://meta.fabricmc.net/v2/versions/loader', title: 'Fabric' },
    quilt: { base: 'https://meta.quiltmc.org/v3/versions/loader', title: 'Quilt' },
};
function isProfileLoader(t) {
    return t === 'fabric' || t === 'quilt';
}
async function profileLoaders(loader, mcVersion) {
    const { base, title } = PROFILE_API[loader];
    const list = await (0, net_1.netJson)(`${base}/${encodeURIComponent(mcVersion)}`, { purpose: `Версии ${title}` });
    return list.map((x) => ({
        version: x.loader.version,
        // Quilt has no "stable" flag: pre-releases are recognisable by their suffix
        stable: x.loader.stable ?? !/-(alpha|beta|rc|pre)/i.test(x.loader.version),
    }));
}
function profileUrl(loader, mcVersion, loaderVersion) {
    return `${PROFILE_API[loader].base}/${encodeURIComponent(mcVersion)}/${encodeURIComponent(loaderVersion)}/profile/json`;
}
const fabricLoaders = (mcVersion) => profileLoaders('fabric', mcVersion);
exports.fabricLoaders = fabricLoaders;
const fabricProfileUrl = (mcVersion, loaderVersion) => profileUrl('fabric', mcVersion, loaderVersion);
exports.fabricProfileUrl = fabricProfileUrl;
// ---- Forge / NeoForge: versions come from their maven, the install itself is done by forgeInstall.ts
const FORGE_METADATA = 'https://maven.minecraftforge.net/net/minecraftforge/forge/maven-metadata.xml';
const FORGE_PROMOS = 'https://files.minecraftforge.net/net/minecraftforge/forge/promotions_slim.json';
const NEOFORGE_VERSIONS = 'https://maven.neoforged.net/api/maven/versions/releases/net/neoforged/neoforge';
/** Numeric, segment-wise comparison ("52.0.9" < "52.0.40"); a suffix like "-beta" sorts below the plain release. */
function compareVersions(a, b) {
    const split = (v) => v.split(/[.-]/).map((x) => (/^\d+$/.test(x) ? Number(x) : x));
    const pa = split(a);
    const pb = split(b);
    for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
        const x = pa[i];
        const y = pb[i];
        if (x === y)
            continue;
        if (x === undefined)
            return typeof y === 'string' ? 1 : -1;
        if (y === undefined)
            return typeof x === 'string' ? -1 : 1;
        if (typeof x === 'number' && typeof y === 'number')
            return x - y;
        return String(x).localeCompare(String(y));
    }
    return 0;
}
/** Forge's `net.minecraftforge:forge` installers with a `version.json` exist from Minecraft 1.13. */
function forgeSupportsMc(mc) {
    const old = /^1\.(\d+)(?:\.\d+)?$/.exec(mc);
    if (old)
        return Number(old[1]) >= 13;
    return /^\d{2,}\.\d+(?:\.\d+)?$/.test(mc) && Number(mc.split('.')[0]) >= 26;
}
/**
 * NeoForge versions start with the Minecraft version: 1.21.1 -> "21.1.", 1.21 -> "21.0.",
 * and since the year-based Minecraft versions 26.1 -> "26.1.0.", 26.1.2 -> "26.1.2.".
 * Returns null for versions NeoForge does not publish for (snapshots, 1.20.1 and older).
 */
function neoforgePrefix(mc) {
    const old = /^1\.(\d+)(?:\.(\d+))?$/.exec(mc);
    if (old) {
        const minor = Number(old[1]);
        const patch = Number(old[2] ?? 0);
        // 1.20.1 and older are served by Forge; NeoForge starts with 1.20.2
        return minor >= 21 || (minor === 20 && patch >= 2) ? `${minor}.${patch}.` : null;
    }
    const year = /^(\d{2,})\.(\d+)(?:\.(\d+))?$/.exec(mc);
    if (year && Number(year[1]) >= 26)
        return year[3] !== undefined ? `${mc}.` : `${mc}.0.`;
    return null;
}
function parseForgeMetadata(xml, mc) {
    const out = [];
    for (const m of xml.matchAll(/<version>([^<]+)<\/version>/g)) {
        const full = m[1].trim();
        if (full.startsWith(`${mc}-`))
            out.push(full.slice(mc.length + 1));
    }
    return out;
}
async function forgeLoaders(mcVersion) {
    if (!forgeSupportsMc(mcVersion))
        return [];
    const versions = parseForgeMetadata(await (0, net_1.netText)(FORGE_METADATA, 'Версии Forge'), mcVersion).sort((a, b) => compareVersions(b, a));
    let recommended;
    try {
        const promos = await (0, net_1.netJson)(FORGE_PROMOS, { purpose: 'Рекомендуемые версии Forge' });
        recommended = promos.promos?.[`${mcVersion}-recommended`];
    }
    catch {
        /* the promotions list is optional */
    }
    return versions.map((version) => ({ version, stable: true, recommended: version === recommended }));
}
async function neoforgeLoaders(mcVersion) {
    const prefix = neoforgePrefix(mcVersion);
    if (!prefix)
        return [];
    const data = await (0, net_1.netJson)(NEOFORGE_VERSIONS, { purpose: 'Версии NeoForge' });
    return (data.versions ?? [])
        .filter((v) => v.startsWith(prefix))
        .sort((a, b) => compareVersions(b, a))
        .map((version) => ({ version, stable: !/-(alpha|beta|rc|snapshot)/i.test(version) }));
}
async function loaderVersions(loader, mcVersion) {
    switch (loader) {
        case 'fabric':
        case 'quilt': return profileLoaders(loader, mcVersion);
        case 'forge': return forgeLoaders(mcVersion);
        case 'neoforge': return neoforgeLoaders(mcVersion);
        default: return [];
    }
}
/** Throws when the loader (or this exact version of it) does not exist for the Minecraft version. */
async function assertLoaderCompatible(loader, mcVersion, loaderVersion) {
    const title = loader === 'neoforge' ? 'NeoForge' : loader[0].toUpperCase() + loader.slice(1);
    if (loader === 'forge' && !forgeSupportsMc(mcVersion)) {
        throw new errors_1.AppError('LOADER_INCOMPATIBLE', 'Forge поддерживается для Minecraft 1.13 и новее');
    }
    let list;
    try {
        list = await loaderVersions(loader, mcVersion);
    }
    catch (e) {
        // No connection to the version list is not proof of incompatibility: the download of the loader itself
        // will report a real network problem, and an already cached installation can still work offline.
        if (e instanceof errors_1.AppError && e.code === 'NET_FAILED')
            return;
        throw e;
    }
    if (list.length === 0)
        throw new errors_1.AppError('LOADER_INCOMPATIBLE', `${title} не поддерживает Minecraft ${mcVersion}`);
    if (!list.some((l) => l.version === loaderVersion)) {
        throw new errors_1.AppError('LOADER_INCOMPATIBLE', `${title} ${loaderVersion} не подходит для Minecraft ${mcVersion}`);
    }
}
const assertFabricCompatible = (mcVersion, loaderVersion) => assertLoaderCompatible('fabric', mcVersion, loaderVersion);
exports.assertFabricCompatible = assertFabricCompatible;
function versionPaths(versionsDir, id) {
    const dir = path.join(versionsDir, id);
    return { dir, json: path.join(dir, `${id}.json`), jar: path.join(dir, `${id}.jar`) };
}
//# sourceMappingURL=versions.js.map