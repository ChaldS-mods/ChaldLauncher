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
exports.INDEX_FILE = exports.ModrinthApi = exports.mrpackIndexSchema = exports.mrVersionSchema = void 0;
exports.loaderFilter = loaderFilter;
exports.buildFacets = buildFacets;
exports.pickVersion = pickVersion;
exports.primaryFile = primaryFile;
exports.safePackPath = safePackPath;
exports.planPack = planPack;
exports.readMrpackIndex = readMrpackIndex;
exports.extractOverrides = extractOverrides;
exports.readInstalled = readInstalled;
exports.listInstalledProjects = listInstalledProjects;
exports.planInstall = planInstall;
exports.runInstallPlan = runInstallPlan;
exports.downloadPackFiles = downloadPackFiles;
const fs = __importStar(require("node:fs/promises"));
const path = __importStar(require("node:path"));
const adm_zip_1 = __importDefault(require("adm-zip"));
const zod_1 = require("zod");
const errors_1 = require("./errors");
const download_1 = require("./download");
const net_1 = require("./net");
const paths_1 = require("./paths");
const storage_1 = require("./storage");
const API = 'https://api.modrinth.com/v2';
const PAGE_SIZE = 20;
const MAX_ICON_BYTES = 256 * 1024;
const MAX_INDEX_BYTES = 8 * 1024 * 1024;
const MAX_OVERRIDE_ENTRY = 256 * 1024 * 1024;
const MAX_OVERRIDE_TOTAL = 2 * 1024 * 1024 * 1024;
const MAX_DEP_DEPTH = 6;
const MAX_BODY_CHARS = 60_000;
const MAX_CHANGELOG_CHARS = 6_000;
const MAX_VERSION_LIST = 150;
// ---------------------------------------------------------------- schemas
const fileSchema = zod_1.z.object({
    url: zod_1.z.string().url(),
    filename: zod_1.z.string().min(1).max(255),
    primary: zod_1.z.boolean().optional(),
    size: zod_1.z.number().int().nonnegative().optional(),
    hashes: zod_1.z.object({ sha1: zod_1.z.string().regex(/^[0-9a-fA-F]{40}$/).optional() }).passthrough(),
});
const dependencySchema = zod_1.z.object({
    project_id: zod_1.z.string().nullable().optional(),
    version_id: zod_1.z.string().nullable().optional(),
    dependency_type: zod_1.z.string(),
});
exports.mrVersionSchema = zod_1.z.object({
    id: zod_1.z.string(),
    project_id: zod_1.z.string(),
    name: zod_1.z.string().nullish().transform((v) => v ?? ''),
    version_number: zod_1.z.string().nullish().transform((v) => v ?? ''),
    version_type: zod_1.z.enum(['release', 'beta', 'alpha']),
    game_versions: zod_1.z.array(zod_1.z.string()),
    loaders: zod_1.z.array(zod_1.z.string()),
    files: zod_1.z.array(fileSchema),
    dependencies: zod_1.z.array(dependencySchema).nullish().transform((v) => v ?? []),
});
const projectSchema = zod_1.z.object({
    id: zod_1.z.string(),
    title: zod_1.z.string(),
    description: zod_1.z.string().default(''),
    slug: zod_1.z.string().optional(),
});
const detailSchema = zod_1.z.object({
    id: zod_1.z.string(),
    slug: zod_1.z.string(),
    title: zod_1.z.string(),
    description: zod_1.z.string().default(''),
    body: zod_1.z.string().nullable().optional(),
    project_type: zod_1.z.string(),
    downloads: zod_1.z.number().default(0),
    followers: zod_1.z.number().default(0),
    categories: zod_1.z.array(zod_1.z.string()).default([]),
    loaders: zod_1.z.array(zod_1.z.string()).default([]),
    game_versions: zod_1.z.array(zod_1.z.string()).default([]),
    icon_url: zod_1.z.string().nullable().optional(),
    license: zod_1.z.object({ name: zod_1.z.string().nullable().optional() }).nullable().optional(),
    updated: zod_1.z.string().nullable().optional(),
});
const versionDetailSchema = exports.mrVersionSchema.extend({
    date_published: zod_1.z.string().default(''),
    downloads: zod_1.z.number().default(0),
    changelog: zod_1.z.string().nullable().optional(),
});
const projectLiteSchema = zod_1.z.object({
    id: zod_1.z.string(),
    slug: zod_1.z.string(),
    title: zod_1.z.string(),
    icon_url: zod_1.z.string().nullable().optional(),
});
const hitSchema = zod_1.z.object({
    project_id: zod_1.z.string(),
    slug: zod_1.z.string(),
    title: zod_1.z.string(),
    description: zod_1.z.string().default(''),
    author: zod_1.z.string().default(''),
    downloads: zod_1.z.number().default(0),
    follows: zod_1.z.number().default(0),
    icon_url: zod_1.z.string().nullable().optional(),
    display_categories: zod_1.z.array(zod_1.z.string()).optional(),
    categories: zod_1.z.array(zod_1.z.string()).default([]),
    project_type: zod_1.z.string(),
});
const searchSchema = zod_1.z.object({ hits: zod_1.z.array(hitSchema), total_hits: zod_1.z.number(), offset: zod_1.z.number() });
// ---------------------------------------------------------------- pure helpers
/** Loader names to ask Modrinth for. Quilt runs Fabric mods too. */
function loaderFilter(loader) {
    switch (loader) {
        case 'vanilla': return null;
        case 'quilt': return ['quilt', 'fabric'];
        default: return [loader];
    }
}
function buildFacets(q) {
    const facets = [[`project_type:${q.type}`]];
    if (q.mcVersion)
        facets.push([`versions:${q.mcVersion}`]);
    if (q.loader && q.type !== 'resourcepack')
        facets.push((loaderFilter(q.loader) ?? []).map((l) => `categories:${l}`));
    return facets;
}
/** Newest release, otherwise newest beta, otherwise newest alpha. `list` is newest first, as Modrinth returns it. */
function pickVersion(list) {
    return list.find((v) => v.version_type === 'release') ?? list.find((v) => v.version_type === 'beta') ?? list[0];
}
function primaryFile(v) {
    const f = v.files.find((x) => x.primary) ?? v.files[0];
    if (!f)
        throw new errors_1.AppError('MODRINTH_NO_FILE', 'У этой версии нет файлов для скачивания');
    return f;
}
/** A relative path inside an .mrpack: forward slashes, no `..`, nothing absolute. */
function safePackPath(raw) {
    if (!raw || raw.includes('\0') || raw.includes('\\') || raw.startsWith('/') || /^[A-Za-z]:/.test(raw)) {
        throw new errors_1.AppError('PACK_PATH', `Недопустимый путь в сборке: ${raw.slice(0, 80)}`);
    }
    const norm = path.posix.normalize(raw);
    if (norm === '.' || norm === '..' || norm.startsWith('../') || norm.endsWith('/')) {
        throw new errors_1.AppError('PACK_PATH', `Недопустимый путь в сборке: ${raw.slice(0, 80)}`);
    }
    return norm;
}
const envSchema = zod_1.z.enum(['required', 'optional', 'unsupported']);
exports.mrpackIndexSchema = zod_1.z.object({
    formatVersion: zod_1.z.literal(1),
    game: zod_1.z.literal('minecraft'),
    versionId: zod_1.z.string().optional().default(''),
    name: zod_1.z.string().min(1).max(200),
    summary: zod_1.z.string().max(4000).optional(),
    files: zod_1.z
        .array(zod_1.z.object({
        path: zod_1.z.string().min(1).max(512),
        hashes: zod_1.z.object({ sha1: zod_1.z.string().regex(/^[0-9a-fA-F]{40}$/) }).passthrough(),
        env: zod_1.z.object({ client: envSchema.optional(), server: envSchema.optional() }).optional(),
        downloads: zod_1.z.array(zod_1.z.string().url()).min(1).max(10),
        fileSize: zod_1.z.number().int().nonnegative().optional(),
    }))
        .max(5000),
    dependencies: zod_1.z.record(zod_1.z.string(), zod_1.z.string()),
});
const LOADER_KEYS = [
    ['neoforge', 'neoforge'], ['forge', 'forge'], ['fabric-loader', 'fabric'], ['quilt-loader', 'quilt'],
];
function planPack(index) {
    const mcVersion = index.dependencies.minecraft;
    if (!mcVersion || !/^[0-9A-Za-z._+-]{1,40}$/.test(mcVersion)) {
        throw new errors_1.AppError('PACK_INVALID', 'В сборке не указана версия Minecraft');
    }
    const found = LOADER_KEYS.filter(([key]) => index.dependencies[key]);
    if (found.length > 1)
        throw new errors_1.AppError('PACK_INVALID', 'В сборке указано несколько загрузчиков');
    const loader = found[0]
        ? { type: found[0][1], version: index.dependencies[found[0][0]].slice(0, 64) }
        : { type: 'vanilla', version: null };
    const seen = new Set();
    const files = [];
    for (const f of index.files) {
        if (f.env?.client === 'unsupported')
            continue; // server-only
        const rel = safePackPath(f.path);
        if (seen.has(rel))
            throw new errors_1.AppError('PACK_INVALID', `Файл указан дважды: ${rel}`);
        seen.add(rel);
        files.push({ rel, sha1: f.hashes.sha1, size: f.fileSize, urls: f.downloads });
    }
    return { name: index.name, mcVersion, loader, files };
}
function readMrpackIndex(packFile) {
    let zip;
    try {
        zip = new adm_zip_1.default(packFile);
    }
    catch {
        throw new errors_1.AppError('PACK_INVALID', 'Файл сборки повреждён');
    }
    const entry = zip.getEntry('modrinth.index.json');
    if (!entry || entry.header.size > MAX_INDEX_BYTES)
        throw new errors_1.AppError('PACK_INVALID', 'В сборке нет modrinth.index.json');
    let json;
    try {
        json = JSON.parse(entry.getData().toString('utf8'));
    }
    catch {
        throw new errors_1.AppError('PACK_INVALID', 'modrinth.index.json не читается');
    }
    const parsed = exports.mrpackIndexSchema.safeParse(json);
    if (!parsed.success)
        throw new errors_1.AppError('PACK_INVALID', `Неверный формат сборки: ${parsed.error.issues[0]?.message ?? ''}`);
    return parsed.data;
}
/** Copies `overrides/` and then `client-overrides/` into the game directory. Returns the number of files written. */
async function extractOverrides(packFile, gameDir, signal) {
    const zip = new adm_zip_1.default(packFile);
    let total = 0;
    let count = 0;
    for (const prefix of ['overrides/', 'client-overrides/']) {
        for (const e of zip.getEntries()) {
            if (signal?.aborted)
                throw new DOMException('Aborted', 'AbortError');
            if (e.isDirectory || !e.entryName.startsWith(prefix))
                continue;
            const rel = safePackPath(e.entryName.slice(prefix.length));
            if (e.header.size > MAX_OVERRIDE_ENTRY)
                throw new errors_1.AppError('PACK_TOO_BIG', `Файл слишком большой: ${rel}`);
            total += e.header.size;
            if (total > MAX_OVERRIDE_TOTAL)
                throw new errors_1.AppError('PACK_TOO_BIG', 'Сборка распаковывается в слишком большой объём');
            const dest = (0, paths_1.resolveInside)(gameDir, ...rel.split('/'));
            await fs.mkdir(path.dirname(dest), { recursive: true });
            await fs.writeFile(dest, e.getData());
            count++;
        }
    }
    return count;
}
class ModrinthApi {
    userAgent;
    /** @param userAgent Modrinth asks every client to identify itself */
    constructor(userAgent) {
        this.userAgent = userAgent;
    }
    post(url, body, schema, signal) {
        return (0, net_1.netJson)(url, {
            purpose: 'Modrinth',
            signal,
            method: 'POST',
            idempotent: true, // both POST endpoints only look things up
            headers: { 'User-Agent': this.userAgent, Accept: 'application/json', 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
        }).then((j) => {
            const r = schema.safeParse(j);
            if (!r.success)
                throw new errors_1.AppError('MODRINTH_FORMAT', 'Modrinth вернул неожиданный ответ');
            return r.data;
        });
    }
    /** Which Modrinth versions do these file hashes (SHA-1) belong to? Unknown files are simply missing from the result. */
    identify(hashes, signal) {
        // Validated entry by entry: a single version with an unexpected shape must not discard the answer for the other hashes.
        return this.post(`${API}/version_files`, { hashes, algorithm: 'sha1' }, zod_1.z.record(zod_1.z.string(), zod_1.z.unknown()), signal).then((raw) => {
            const out = {};
            for (const [hash, v] of Object.entries(raw)) {
                const r = versionDetailSchema.safeParse(v);
                if (r.success)
                    out[hash] = r.data;
            }
            return out;
        });
    }
    /** The newest version for the given Minecraft version and loaders, for every hash Modrinth knows. */
    latest(hashes, opts, signal) {
        return this.post(`${API}/version_files/update`, { hashes, algorithm: 'sha1', loaders: opts.loaders, game_versions: [opts.mcVersion] }, zod_1.z.record(zod_1.z.string(), versionDetailSchema), signal);
    }
    projectsLite(ids, signal) {
        if (!ids.length)
            return Promise.resolve([]);
        return this.get(`${API}/projects?ids=${encodeURIComponent(JSON.stringify(ids))}`, zod_1.z.array(projectLiteSchema), signal);
    }
    /** All versions of a project with full details (newest first), unlike the trimmed list of the project page. */
    versionDetails(projectId, opts, signal) {
        return this.get(this.versionsUrl(projectId, opts), zod_1.z.array(versionDetailSchema), signal);
    }
    iconData(url, signal) {
        return this.icon(url, signal);
    }
    get(url, schema, signal) {
        return (0, net_1.netJson)(url, {
            purpose: 'Modrinth',
            signal,
            headers: { 'User-Agent': this.userAgent, Accept: 'application/json' },
        }).then((j) => {
            const r = schema.safeParse(j);
            if (!r.success)
                throw new errors_1.AppError('MODRINTH_FORMAT', 'Modrinth вернул неожиданный ответ');
            return r.data;
        });
    }
    project(id, signal) {
        return this.get(`${API}/project/${encodeURIComponent(id)}`, projectSchema, signal);
    }
    version(id, signal) {
        return this.get(`${API}/version/${encodeURIComponent(id)}`, exports.mrVersionSchema, signal);
    }
    versionsUrl(projectId, opts) {
        const qs = new URLSearchParams();
        if (opts.mcVersion)
            qs.set('game_versions', JSON.stringify([opts.mcVersion]));
        if (opts.loaders?.length)
            qs.set('loaders', JSON.stringify(opts.loaders));
        const q = qs.toString();
        return `${API}/project/${encodeURIComponent(projectId)}/version${q ? `?${q}` : ''}`;
    }
    versions(projectId, opts, signal) {
        return this.get(this.versionsUrl(projectId, opts), zod_1.z.array(exports.mrVersionSchema), signal);
    }
    /** Everything the project page needs: long Markdown description, stats, icon. */
    async projectInfo(id, signal) {
        const p = await this.get(`${API}/project/${encodeURIComponent(id)}`, detailSchema, signal);
        const type = (['mod', 'modpack', 'resourcepack'].includes(p.project_type) ? p.project_type : 'mod');
        return {
            id: p.id, slug: p.slug, title: p.title, description: p.description, body: (p.body ?? '').slice(0, MAX_BODY_CHARS), type,
            downloads: p.downloads, follows: p.followers, categories: p.categories, loaders: p.loaders, gameVersions: p.game_versions,
            license: p.license?.name ?? null, updated: p.updated ?? null, iconDataUrl: await this.icon(p.icon_url, signal),
        };
    }
    /** Versions list for the project page (newest first). */
    async versionInfos(projectId, opts, signal) {
        const list = await this.get(this.versionsUrl(projectId, opts), zod_1.z.array(versionDetailSchema), signal);
        return list.slice(0, MAX_VERSION_LIST).map((v) => {
            const f = v.files.find((x) => x.primary) ?? v.files[0];
            return {
                id: v.id, name: v.name, versionNumber: v.version_number, type: v.version_type,
                gameVersions: v.game_versions, loaders: v.loaders, published: v.date_published, downloads: v.downloads,
                changelog: (v.changelog ?? '').slice(0, MAX_CHANGELOG_CHARS),
                fileName: f?.filename ?? '', size: f?.size ?? 0,
                requiredDeps: v.dependencies.filter((d) => d.dependency_type === 'required' && d.project_id).length,
            };
        });
    }
    async icon(url, signal) {
        if (!url)
            return null;
        try {
            const { res, entry } = await (0, net_1.netRequest)(url, { purpose: 'Иконка проекта', signal, headers: { 'User-Agent': this.userAgent } });
            const type = (res.headers.get('content-type') ?? '').split(';')[0].trim();
            if (!res.ok || !['image/png', 'image/jpeg', 'image/webp', 'image/gif'].includes(type)) {
                await res.body?.cancel().catch(() => undefined);
                return null;
            }
            const buf = Buffer.from(await res.arrayBuffer());
            entry.bytes = buf.length;
            if (buf.length > MAX_ICON_BYTES)
                return null;
            return `data:${type};base64,${buf.toString('base64')}`;
        }
        catch {
            return null; // a missing icon never breaks search
        }
    }
    async search(input, signal) {
        const qs = new URLSearchParams({
            query: input.query,
            facets: JSON.stringify(buildFacets(input)),
            index: input.sort,
            offset: String(input.offset),
            limit: String(PAGE_SIZE),
        });
        const r = await this.get(`${API}/search?${qs.toString()}`, searchSchema, signal);
        const hits = r.hits.map((h) => ({
            id: h.project_id, slug: h.slug, title: h.title, description: h.description, author: h.author,
            downloads: h.downloads, follows: h.follows, categories: h.display_categories ?? h.categories,
            type: (['mod', 'modpack', 'resourcepack'].includes(h.project_type) ? h.project_type : input.type),
            iconDataUrl: null,
        }));
        const icons = r.hits.map((h) => h.icon_url);
        await (0, download_1.runPool)(hits.map((_, i) => i), 6, async (i) => {
            hits[i].iconDataUrl = await this.icon(icons[i], signal);
        });
        return { hits, total: r.total_hits, offset: r.offset };
    }
}
exports.ModrinthApi = ModrinthApi;
exports.INDEX_FILE = '.chald-modrinth.json';
async function readInstalled(gameDir) {
    try {
        const j = await (0, storage_1.readJson)(path.join(gameDir, exports.INDEX_FILE));
        return j && typeof j.projects === 'object' && j.projects ? j : { projects: {} };
    }
    catch {
        return { projects: {} };
    }
}
/** Modrinth project ids installed in this game directory (the file must still exist). Dependencies count too. */
async function listInstalledProjects(gameDir, kind) {
    const dir = path.join(gameDir, kind === 'mod' ? 'mods' : 'resourcepacks');
    const installed = await readInstalled(gameDir);
    const out = [];
    for (const [projectId, info] of Object.entries(installed.projects)) {
        if (typeof info?.file !== 'string' || info.file.includes('/') || info.file.includes('\\'))
            continue;
        // a disabled mod is renamed to *.disabled, it is still installed
        if ((await (0, storage_1.exists)(path.join(dir, info.file))) || (await (0, storage_1.exists)(path.join(dir, `${info.file}.disabled`))))
            out.push(projectId);
    }
    return out;
}
/** Works out which files must be downloaded: the project itself plus its required dependencies (mods only). */
/** `versionId` pins the version of the requested project itself; its dependencies are still resolved automatically. */
async function planInstall(api, t, projectId, signal, versionId) {
    if (t.kind === 'mod' && t.loader === 'vanilla') {
        throw new errors_1.AppError('LOADER_REQUIRED', 'Моды не работают в инстансе Vanilla. Создай инстанс с Fabric, Quilt, Forge или NeoForge.');
    }
    const dirName = t.kind === 'mod' ? 'mods' : 'resourcepacks';
    const ext = t.kind === 'mod' ? '.jar' : '.zip';
    const dir = path.join(t.gameDir, dirName);
    const installed = await readInstalled(t.gameDir);
    const loaders = t.kind === 'mod' ? loaderFilter(t.loader) : null;
    const plan = [];
    const seen = new Set();
    const queue = [{ projectId, versionId: versionId ?? null, depth: 0 }];
    while (queue.length) {
        const cur = queue.shift();
        if (seen.has(cur.projectId))
            continue;
        seen.add(cur.projectId);
        const requested = cur.depth === 0;
        const have = installed.projects[cur.projectId];
        if (have && (await (0, storage_1.exists)(path.join(dir, have.file)))) {
            if (requested)
                throw new errors_1.AppError('ALREADY_INSTALLED', 'Этот проект уже установлен в инстансе. Чтобы поставить другую версию, сначала удали старый файл на вкладке «Моды» или «Ресурспаки».');
            continue;
        }
        const project = await api.project(cur.projectId, signal);
        let version;
        if (cur.versionId) {
            version = await api.version(cur.versionId, signal);
            if (version.project_id !== cur.projectId)
                throw new errors_1.AppError('MODRINTH_FORMAT', 'Эта версия относится к другому проекту');
        }
        else {
            version = pickVersion(await api.versions(cur.projectId, { mcVersion: t.mcVersion, loaders }, signal));
        }
        if (!version) {
            const what = requested ? 'Для этого проекта' : `Для обязательной зависимости «${project.title}»`;
            throw new errors_1.AppError('NO_COMPATIBLE_VERSION', `${what} нет версии под Minecraft ${t.mcVersion}${loaders ? ` и ${t.loader}` : ''}`);
        }
        const file = primaryFile(version);
        const name = (0, paths_1.safeFileName)(file.filename);
        if (!name.toLowerCase().endsWith(ext))
            throw new errors_1.AppError('CONTENT_TYPE', `Ожидался файл ${ext}: ${name}`);
        plan.push({ projectId: cur.projectId, title: project.title, version, file, dest: (0, paths_1.resolveInside)(dir, name), requested });
        if (t.kind === 'mod' && cur.depth < MAX_DEP_DEPTH) {
            for (const d of version.dependencies) {
                if (d.dependency_type === 'required' && d.project_id) {
                    queue.push({ projectId: d.project_id, versionId: d.version_id ?? null, depth: cur.depth + 1 });
                }
            }
        }
    }
    return plan;
}
/** Downloads a plan. Never overwrites a different file that happens to have the same name. Returns the file names. */
async function runInstallPlan(gameDir, kind, plan, report, signal) {
    const index = await readInstalled(gameDir);
    const names = [];
    let done = 0;
    for (const item of plan) {
        const spec = { sha1: item.file.hashes.sha1, size: item.file.size };
        report(`Скачиваю: ${item.title}`, done / plan.length);
        if (!(await (0, download_1.isFileValid)(item.dest, spec)) && (await (0, storage_1.exists)(item.dest))) {
            throw new errors_1.AppError('CONTENT_EXISTS', `Файл с таким именем уже есть и отличается: ${path.basename(item.dest)}`);
        }
        await (0, download_1.downloadFile)({ url: item.file.url, dest: item.dest, ...spec, purpose: kind === 'mod' ? 'Мод Modrinth' : 'Ресурспак Modrinth' }, { signal });
        index.projects[item.projectId] = { file: path.basename(item.dest), versionId: item.version.id };
        names.push(path.basename(item.dest));
        done++;
    }
    await (0, storage_1.writeJsonAtomic)(path.join(gameDir, exports.INDEX_FILE), index);
    report('Готово', 1);
    return names;
}
// ---------------------------------------------------------------- modpack files
/** Downloads every client file of a pack. Tries the mirrors in order. */
async function downloadPackFiles(plan, gameDir, report, signal) {
    const total = plan.files.length;
    let done = 0;
    await (0, download_1.runPool)(plan.files, 6, async (f) => {
        const dest = (0, paths_1.resolveInside)(gameDir, ...f.rel.split('/'));
        let last;
        for (const url of f.urls) {
            try {
                await (0, download_1.downloadFile)({ url, dest, sha1: f.sha1, size: f.size, purpose: 'Файл сборки' }, { signal, retries: 2 });
                last = null;
                break;
            }
            catch (e) {
                if (signal?.aborted)
                    throw e;
                last = e;
            }
        }
        if (last)
            throw last;
        done++;
        report(`Файлы сборки: ${done} из ${total}`, total ? done / total : 1);
    });
}
//# sourceMappingURL=modrinth.js.map