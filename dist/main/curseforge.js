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
exports.CF_INDEX_FILE = exports.CurseForgeApi = exports.CF_LOADER = void 0;
exports.cfFingerprint = cfFingerprint;
exports.parseCfModpackManifest = parseCfModpackManifest;
exports.readCfInstalled = readCfInstalled;
exports.listCfInstalled = listCfInstalled;
exports.installCfFile = installCfFile;
const path = __importStar(require("node:path"));
const zod_1 = require("zod");
const errors_1 = require("./errors");
const download_1 = require("./download");
const net_1 = require("./net");
const paths_1 = require("./paths");
const storage_1 = require("./storage");
/** Public key used by Prism and many third-party launchers. */
const CF_API_KEY = '$2a$10$bL4bIL5pUWqfcO7KQtnMReakwtfHbNKh6v1uTpKlzhwoueEJQnPnm';
const API = 'https://api.curseforge.com';
const GAME_ID = 432;
const PAGE_SIZE = 20;
const MAX_ICON_BYTES = 256 * 1024;
exports.CF_LOADER = {
    forge: 1,
    fabric: 4,
    quilt: 5,
    neoforge: 6,
};
const CLASS_ID = {
    mod: 6,
    resourcepack: 12,
    modpack: 4471,
    shader: 6552,
    datapack: 6945,
};
const SORT_FIELD = {
    featured: 1,
    popularity: 2,
    lastUpdated: 3,
    name: 4,
    totalDownloads: 6,
};
const authorSchema = zod_1.z.object({
    id: zod_1.z.number().optional(),
    name: zod_1.z.string().default(''),
}).passthrough();
const logoSchema = zod_1.z
    .object({
    thumbnailUrl: zod_1.z.string().nullish(),
    url: zod_1.z.string().nullish(),
})
    .passthrough()
    .nullish();
const modSchema = zod_1.z
    .object({
    id: zod_1.z.number(),
    name: zod_1.z.string(),
    slug: zod_1.z.string().default(''),
    summary: zod_1.z.string().default(''),
    downloadCount: zod_1.z.number().default(0),
    authors: zod_1.z.array(authorSchema).default([]),
    logo: logoSchema,
    classId: zod_1.z.number().optional(),
    dateModified: zod_1.z.string().optional(),
    links: zod_1.z.object({ websiteUrl: zod_1.z.string().optional() }).passthrough().optional(),
})
    .passthrough();
const searchResponseSchema = zod_1.z
    .object({
    data: zod_1.z.array(modSchema),
    pagination: zod_1.z
        .object({
        index: zod_1.z.number().default(0),
        pageSize: zod_1.z.number().default(PAGE_SIZE),
        resultCount: zod_1.z.number().default(0),
        totalCount: zod_1.z.number().default(0),
    })
        .passthrough(),
})
    .passthrough();
const hashSchema = zod_1.z.object({ value: zod_1.z.string(), algo: zod_1.z.number() }).passthrough();
const fileSchema = zod_1.z
    .object({
    id: zod_1.z.number(),
    displayName: zod_1.z.string().default(''),
    fileName: zod_1.z.string(),
    fileDate: zod_1.z.string().default(''),
    fileLength: zod_1.z.number().default(0),
    downloadCount: zod_1.z.number().default(0),
    downloadUrl: zod_1.z.string().nullish(),
    gameVersions: zod_1.z.array(zod_1.z.string()).default([]),
    releaseType: zod_1.z.number().default(1),
    hashes: zod_1.z.array(hashSchema).default([]),
    isAvailable: zod_1.z.boolean().default(true),
})
    .passthrough();
const filesResponseSchema = zod_1.z
    .object({
    data: zod_1.z.array(fileSchema),
    pagination: zod_1.z
        .object({
        index: zod_1.z.number().default(0),
        pageSize: zod_1.z.number().default(50),
        resultCount: zod_1.z.number().default(0),
        totalCount: zod_1.z.number().default(0),
    })
        .passthrough(),
})
    .passthrough();
function parse(schema, data, label) {
    const r = schema.safeParse(data);
    if (!r.success)
        throw new errors_1.AppError('CF_FORMAT', `CurseForge вернул неожиданный ответ (${label})`);
    return r.data;
}
/** CurseForge fingerprint: MurmurHash2 (seed 1) over file bytes with whitespace stripped. */
function cfFingerprint(buf) {
    const filtered = Buffer.allocUnsafe(buf.length);
    let n = 0;
    for (let i = 0; i < buf.length; i++) {
        const b = buf[i];
        if (b !== 0x09 && b !== 0x0a && b !== 0x0d && b !== 0x20)
            filtered[n++] = b;
    }
    return murmur2(filtered.subarray(0, n), 1);
}
function murmur2(data, seed) {
    const m = 0x5bd1e995;
    let len = data.length;
    let h = seed ^ len;
    let i = 0;
    while (len >= 4) {
        let k = (data[i] | (data[i + 1] << 8) | (data[i + 2] << 16) | (data[i + 3] << 24)) >>> 0;
        k = Math.imul(k, m) >>> 0;
        k = (k ^ (k >>> 24)) >>> 0;
        k = Math.imul(k, m) >>> 0;
        h = Math.imul(h, m) >>> 0;
        h = (h ^ k) >>> 0;
        i += 4;
        len -= 4;
    }
    switch (len) {
        case 3:
            h = (h ^ (data[i + 2] << 16)) >>> 0;
        // fallthrough
        case 2:
            h = (h ^ (data[i + 1] << 8)) >>> 0;
        // fallthrough
        case 1:
            h = (h ^ data[i]) >>> 0;
            h = Math.imul(h, m) >>> 0;
    }
    h = (h ^ (h >>> 13)) >>> 0;
    h = Math.imul(h, m) >>> 0;
    h = (h ^ (h >>> 15)) >>> 0;
    return h >>> 0;
}
class CurseForgeApi {
    userAgent;
    constructor(userAgent) {
        this.userAgent = userAgent;
    }
    headers() {
        return {
            'x-api-key': CF_API_KEY,
            Accept: 'application/json',
            'User-Agent': this.userAgent,
        };
    }
    async getRaw(url, signal) {
        return (0, net_1.netJson)(url, {
            purpose: 'CurseForge API',
            signal,
            headers: this.headers(),
        });
    }
    async icon(url, signal) {
        if (!url)
            return null;
        try {
            const { res, entry } = await (0, net_1.netRequest)(url, {
                purpose: 'Иконка CurseForge',
                signal,
                headers: { 'User-Agent': this.userAgent, Accept: 'image/webp,image/png,image/jpeg,image/gif,*/*' },
            });
            if (!res.ok) {
                await res.body?.cancel().catch(() => undefined);
                return null;
            }
            const buf = Buffer.from(await res.arrayBuffer());
            entry.bytes = buf.length;
            if (buf.length < 16 || buf.length > MAX_ICON_BYTES)
                return null;
            let type = (res.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase();
            if (!['image/png', 'image/jpeg', 'image/webp', 'image/gif'].includes(type)) {
                if (buf[0] === 0x89 && buf[1] === 0x50)
                    type = 'image/png';
                else if (buf[0] === 0xff && buf[1] === 0xd8)
                    type = 'image/jpeg';
                else if (buf[0] === 0x47 && buf[1] === 0x49)
                    type = 'image/gif';
                else if (buf[0] === 0x52 && buf[1] === 0x49 && buf[8] === 0x57)
                    type = 'image/webp';
                else
                    return null;
            }
            return `data:${type};base64,${buf.toString('base64')}`;
        }
        catch {
            return null;
        }
    }
    classFromId(classId) {
        if (classId === 12)
            return 'resourcepack';
        if (classId === 4471)
            return 'modpack';
        if (classId === 6552)
            return 'shader';
        if (classId === 6945)
            return 'datapack';
        return 'mod';
    }
    async search(input, signal, opts = {}) {
        const qs = new URLSearchParams();
        qs.set('gameId', String(GAME_ID));
        qs.set('classId', String(CLASS_ID[input.classType]));
        qs.set('pageSize', String(PAGE_SIZE));
        qs.set('index', String(input.offset));
        qs.set('sortField', String(SORT_FIELD[input.sort]));
        qs.set('sortOrder', 'desc');
        if (input.query.trim())
            qs.set('searchFilter', input.query.trim());
        if (input.mcVersion)
            qs.set('gameVersion', input.mcVersion);
        if (input.loader && input.classType === 'mod') {
            qs.set('modLoaderType', String(exports.CF_LOADER[input.loader]));
        }
        const raw = await this.getRaw(`${API}/v1/mods/search?${qs}`, signal);
        const r = parse(searchResponseSchema, raw, 'search');
        const hits = r.data.map((m) => ({
            id: m.id,
            slug: m.slug || String(m.id),
            title: m.name,
            description: m.summary,
            author: m.authors[0]?.name ?? '',
            downloads: m.downloadCount,
            type: this.classFromId(m.classId) || input.classType,
            iconDataUrl: null,
            websiteUrl: m.links?.websiteUrl ?? null,
        }));
        if (opts.icons !== false) {
            const icons = r.data.map((m) => m.logo?.thumbnailUrl || m.logo?.url || null);
            await (0, download_1.runPool)(hits.map((_, i) => i), 6, async (i) => {
                hits[i].iconDataUrl = await this.icon(icons[i], signal);
            });
        }
        return { hits, total: r.pagination.totalCount, offset: r.pagination.index };
    }
    async getMod(modId, signal) {
        const [raw, descRaw] = await Promise.all([
            this.getRaw(`${API}/v1/mods/${modId}`, signal),
            this.getRaw(`${API}/v1/mods/${modId}/description`, signal).catch(() => null),
        ]);
        const body = parse(zod_1.z.object({ data: modSchema }).passthrough(), raw, 'mod');
        const m = body.data;
        let bodyHtml = '';
        if (descRaw) {
            const d = parse(zod_1.z.object({ data: zod_1.z.string() }).passthrough(), descRaw, 'description');
            bodyHtml = d.data;
        }
        const indexes = m.latestFilesIndexes ?? [];
        const gameVersions = [...new Set(indexes.map((i) => i.gameVersion).filter(Boolean))].slice(0, 20);
        const loaderMap = { 1: 'Forge', 4: 'Fabric', 5: 'Quilt', 6: 'NeoForge' };
        const loaders = [...new Set(indexes.map((i) => loaderMap[i.modLoader ?? -1]).filter(Boolean))];
        return {
            id: m.id,
            slug: m.slug || String(m.id),
            title: m.name,
            description: m.summary,
            bodyHtml,
            author: m.authors[0]?.name ?? '',
            downloads: m.downloadCount,
            type: this.classFromId(m.classId),
            iconDataUrl: await this.icon(m.logo?.thumbnailUrl || m.logo?.url, signal),
            websiteUrl: m.links?.websiteUrl ?? null,
            updated: m.dateModified ?? null,
            gameVersions,
            loaders,
        };
    }
    async files(modId, opts = {}, signal) {
        const qs = new URLSearchParams();
        qs.set('pageSize', String(opts.pageSize ?? 50));
        qs.set('index', '0');
        if (opts.mcVersion)
            qs.set('gameVersion', opts.mcVersion);
        if (opts.loader)
            qs.set('modLoaderType', String(exports.CF_LOADER[opts.loader]));
        const raw = await this.getRaw(`${API}/v1/mods/${modId}/files?${qs}`, signal);
        const body = parse(filesResponseSchema, raw, 'files');
        return body.data
            .filter((f) => f.isAvailable !== false)
            .map((f) => {
            const sha1 = f.hashes.find((h) => h.algo === 1)?.value ?? null;
            const releaseType = f.releaseType === 1 ? 'release' : f.releaseType === 2 ? 'beta' : 'alpha';
            return {
                id: f.id,
                fileName: f.fileName,
                displayName: f.displayName || f.fileName,
                size: f.fileLength,
                downloads: f.downloadCount,
                published: f.fileDate,
                releaseType,
                gameVersions: f.gameVersions,
                downloadUrl: f.downloadUrl ?? null,
                sha1,
            };
        });
    }
    /** POST /v1/fingerprints — match local jars to CurseForge files. */
    async identifyByFingerprints(fingerprints, signal) {
        const out = new Map();
        if (!fingerprints.length)
            return out;
        // API accepts up to ~1000; keep batches modest
        const BATCH = 100;
        for (let i = 0; i < fingerprints.length; i += BATCH) {
            const batch = fingerprints.slice(i, i + BATCH);
            const raw = await (0, net_1.netJson)(`${API}/v1/fingerprints`, {
                purpose: 'CurseForge fingerprints',
                signal,
                method: 'POST',
                idempotent: true,
                headers: { ...this.headers(), 'Content-Type': 'application/json' },
                body: JSON.stringify({ fingerprints: batch }),
            });
            const parsed = zod_1.z
                .object({
                data: zod_1.z
                    .object({
                    exactMatches: zod_1.z
                        .array(zod_1.z
                        .object({
                        id: zod_1.z.number(),
                        file: zod_1.z
                            .object({
                            id: zod_1.z.number(),
                            fileName: zod_1.z.string(),
                            downloadUrl: zod_1.z.string().nullish(),
                            fileLength: zod_1.z.number().default(0),
                            hashes: zod_1.z.array(zod_1.z.object({ value: zod_1.z.string(), algo: zod_1.z.number() }).passthrough()).default([]),
                            fileFingerprint: zod_1.z.number().optional(),
                            modId: zod_1.z.number().optional(),
                        })
                            .passthrough(),
                    })
                        .passthrough())
                        .default([]),
                })
                    .passthrough(),
            })
                .passthrough()
                .safeParse(raw);
            if (!parsed.success)
                continue;
            for (const m of parsed.data.data.exactMatches) {
                const f = m.file;
                const sha1 = f.hashes.find((h) => h.algo === 1)?.value?.toLowerCase() ?? null;
                const fp = f.fileFingerprint ?? m.id;
                out.set(fp, {
                    modId: f.modId ?? m.id,
                    fileId: f.id,
                    fileName: f.fileName,
                    downloadUrl: f.downloadUrl ?? null,
                    size: f.fileLength,
                    sha1,
                    fingerprint: fp,
                });
            }
        }
        return out;
    }
    resolveDownloadUrl(file) {
        if (file.downloadUrl)
            return file.downloadUrl;
        // CurseForge CDN layout: /files/{id/1000}/{id%1000}/{fileName}
        // Some API responses omit downloadUrl (null) even for free files — CDN still works.
        const id = file.id;
        const a = Math.floor(id / 1000);
        const b = id % 1000;
        return `https://edge.forgecdn.net/files/${a}/${b}/${encodeURIComponent(file.fileName)}`;
    }
    /** Single file metadata (needed when downloading pack dependencies by projectID/fileID). */
    async getFile(modId, fileId, signal) {
        const raw = await this.getRaw(`${API}/v1/mods/${modId}/files/${fileId}`, signal);
        const body = parse(zod_1.z.object({ data: fileSchema }).passthrough(), raw, 'file');
        const f = body.data;
        const sha1 = f.hashes.find((h) => h.algo === 1)?.value ?? null;
        const releaseType = f.releaseType === 1 ? 'release' : f.releaseType === 2 ? 'beta' : 'alpha';
        return {
            id: f.id,
            fileName: f.fileName,
            displayName: f.displayName || f.fileName,
            size: f.fileLength,
            downloads: f.downloadCount,
            published: f.fileDate,
            releaseType,
            gameVersions: f.gameVersions,
            downloadUrl: f.downloadUrl ?? null,
            sha1,
        };
    }
}
exports.CurseForgeApi = CurseForgeApi;
function parseCfModpackManifest(raw) {
    let j;
    try {
        j = JSON.parse(raw);
    }
    catch {
        throw new errors_1.AppError('PACK_INVALID', 'manifest.json сборки CurseForge повреждён');
    }
    const o = zod_1.z
        .object({
        name: zod_1.z.string().default('CurseForge pack'),
        version: zod_1.z.string().default(''),
        manifestType: zod_1.z.string().optional(),
        overrides: zod_1.z.string().default('overrides'),
        minecraft: zod_1.z
            .object({
            version: zod_1.z.string(),
            modLoaders: zod_1.z
                .array(zod_1.z.object({ id: zod_1.z.string(), primary: zod_1.z.boolean().optional() }).passthrough())
                .default([]),
        })
            .passthrough(),
        files: zod_1.z
            .array(zod_1.z
            .object({
            projectID: zod_1.z.number(),
            fileID: zod_1.z.number(),
            required: zod_1.z.boolean().optional(),
        })
            .passthrough())
            .default([]),
    })
        .passthrough()
        .safeParse(j);
    if (!o.success)
        throw new errors_1.AppError('PACK_INVALID', 'Некорректный manifest.json CurseForge');
    if (o.data.manifestType && o.data.manifestType !== 'minecraftModpack') {
        throw new errors_1.AppError('PACK_INVALID', 'Это не сборка Minecraft (minecraftModpack)');
    }
    const loaders = o.data.minecraft.modLoaders;
    const primary = loaders.find((l) => l.primary) ?? loaders[0];
    let type = 'vanilla';
    let version = null;
    if (primary?.id) {
        const id = primary.id.toLowerCase();
        // e.g. "forge-47.2.0", "fabric-0.16.5", "neoforge-21.1.1", "quilt-0.26"
        const m = id.match(/^(neoforge|forge|fabric|quilt)-(.+)$/i);
        if (m) {
            type = m[1].toLowerCase();
            version = m[2];
        }
    }
    return {
        name: o.data.name || 'CurseForge pack',
        version: o.data.version,
        mcVersion: o.data.minecraft.version,
        loader: { type, version },
        files: o.data.files.map((f) => ({
            projectID: f.projectID,
            fileID: f.fileID,
            required: f.required !== false,
        })),
        overrides: (o.data.overrides || 'overrides').replace(/^\/+|\/+$/g, '') || 'overrides',
    };
}
exports.CF_INDEX_FILE = '.chald-curseforge.json';
async function readCfInstalled(gameDir) {
    try {
        const j = await (0, storage_1.readJson)(path.join(gameDir, exports.CF_INDEX_FILE));
        return j && typeof j.projects === 'object' && j.projects ? j : { projects: {} };
    }
    catch {
        return { projects: {} };
    }
}
function cfDirName(kind) {
    switch (kind) {
        case 'mod': return 'mods';
        case 'resourcepack': return 'resourcepacks';
        case 'shader': return 'shaderpacks';
        case 'datapack': return 'datapacks';
    }
}
async function listCfInstalled(gameDir, kind) {
    const dir = path.join(gameDir, cfDirName(kind));
    const installed = await readCfInstalled(gameDir);
    const out = [];
    for (const [projectId, info] of Object.entries(installed.projects)) {
        if (typeof info?.file !== 'string')
            continue;
        if ((await (0, storage_1.exists)(path.join(dir, info.file))) || (await (0, storage_1.exists)(path.join(dir, `${info.file}.disabled`)))) {
            out.push(Number(projectId));
        }
    }
    return out;
}
async function installCfFile(opts) {
    const { api, gameDir, kind, modId, signal } = opts;
    if (kind === 'mod' && opts.loader === 'vanilla') {
        throw new errors_1.AppError('LOADER_REQUIRED', 'Моды не работают в инстансе Vanilla. Создай инстанс с Fabric, Quilt, Forge или NeoForge.');
    }
    const loader = opts.loader === 'vanilla' ? null : opts.loader;
    let file;
    if (opts.fileId) {
        const all = await api.files(modId, { pageSize: 50 }, signal);
        file = all.find((f) => f.id === opts.fileId);
    }
    else {
        const files = await api.files(modId, { mcVersion: opts.mcVersion, loader, pageSize: 50 }, signal);
        file =
            files.find((f) => f.releaseType === 'release') ??
                files.find((f) => f.releaseType === 'beta') ??
                files[0];
    }
    if (!file)
        throw new errors_1.AppError('CF_NO_FILE', 'Подходящий файл CurseForge не найден для этой версии / загрузчика');
    let dir;
    if (kind === 'datapack') {
        const world = (opts.worldName ?? '').trim();
        if (!world || world.includes('/') || world.includes('\\') || world.includes('..')) {
            throw new errors_1.AppError('CF_WORLD', 'Выбери мир для установки датапака');
        }
        dir = path.join(gameDir, 'saves', world, 'datapacks');
    }
    else {
        dir = path.join(gameDir, cfDirName(kind));
    }
    const destName = (0, paths_1.safeFileName)(file.fileName);
    const dest = path.join(dir, destName);
    const url = api.resolveDownloadUrl(file);
    await (0, download_1.downloadFile)({
        url,
        dest,
        sha1: file.sha1 ?? undefined,
        size: file.size || undefined,
        purpose: kind === 'mod' ? 'Мод CurseForge' : kind === 'shader' ? 'Шейдер CurseForge' : kind === 'datapack' ? 'Датапак CurseForge' : 'Ресурспак CurseForge',
    }, { signal });
    const index = await readCfInstalled(gameDir);
    index.projects[String(modId)] = { file: destName, fileId: file.id };
    await (0, storage_1.writeJsonAtomic)(path.join(gameDir, exports.CF_INDEX_FILE), index);
    return destName;
}
//# sourceMappingURL=curseforge.js.map