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
exports.chaldPackSchema = exports.MAX_PACK_OVERRIDES_BYTES = exports.MANIFEST = exports.PACK_EXT = void 0;
exports.exportInstance = exportInstance;
exports.inspectPack = inspectPack;
exports.packToPlan = packToPlan;
exports.installedIndexFor = installedIndexFor;
const fs = __importStar(require("node:fs/promises"));
const path = __importStar(require("node:path"));
const adm_zip_1 = __importDefault(require("adm-zip"));
const zod_1 = require("zod");
const errors_1 = require("./errors");
const download_1 = require("./download");
const modrinth_1 = require("./modrinth");
const storage_1 = require("./storage");
/**
 * `.chaldlauncher` is a zip with:
 *   chaldlauncher.json   what to download (Modrinth files, with SHA-1) and what the instance is
 *   overrides/...        everything that cannot be downloaded: own mods, configs, options, (optionally) worlds
 */
exports.PACK_EXT = '.chaldlauncher';
exports.MANIFEST = 'chaldlauncher.json';
const MAX_MANIFEST_BYTES = 8 * 1024 * 1024;
exports.MAX_PACK_OVERRIDES_BYTES = 2048 * 1024 * 1024;
const MAX_PACK_FILES = 20_000;
/** Hashes per request to Modrinth's /version_files (small enough that the progress bar moves and shows file names). */
const IDENTIFY_BATCH = 25;
/** Folders whose files Modrinth can recognise by hash. */
const CONTENT_DIRS = ['mods', 'resourcepacks'];
const CONTENT_FILE = /\.(jar|zip)(\.disabled)?$/i;
/** Top-level folders of .minecraft that are never exported. */
const SKIP_DIRS = new Set(['logs', 'crash-reports', 'screenshots', '.fabric', '.mixin.out', 'webcache', 'webcache2', 'downloads', 'debug', '.cache']);
const SKIP_FILES = new Set(['.chald-modrinth.json']);
const cdnUrl = zod_1.z.string().url().max(2048).refine((u) => {
    try {
        const x = new URL(u);
        return x.protocol === 'https:' && x.hostname === 'cdn.modrinth.com';
    }
    catch {
        return false;
    }
}, 'Ссылка на файл ведёт не на cdn.modrinth.com');
exports.chaldPackSchema = zod_1.z.object({
    format: zod_1.z.literal('chaldlauncher-instance'),
    formatVersion: zod_1.z.literal(1),
    name: zod_1.z.string().trim().min(1).max(48),
    description: zod_1.z.string().max(120).default(''),
    mcVersion: zod_1.z.string().regex(/^[0-9A-Za-z._+-]{1,40}$/),
    loader: zod_1.z.object({ type: zod_1.z.enum(['vanilla', 'fabric', 'quilt', 'forge', 'neoforge']), version: zod_1.z.string().max(64).nullable() }),
    kind: zod_1.z.enum(['official', 'modded', 'custom']),
    coverColor: zod_1.z.number().int().min(0).max(7).default(0),
    files: zod_1.z.array(zod_1.z.object({
        path: zod_1.z.string().min(1).max(300).regex(/^(mods|resourcepacks)\/[^/]+$/, 'Файлы Modrinth лежат только в mods/ и resourcepacks/'),
        sha1: zod_1.z.string().regex(/^[0-9a-fA-F]{40}$/),
        size: zod_1.z.number().int().nonnegative().optional(),
        url: cdnUrl,
        projectId: zod_1.z.string().regex(/^[A-Za-z0-9]{8}$/),
        versionId: zod_1.z.string().regex(/^[A-Za-z0-9]{8}$/),
    })).max(5000),
});
// ---------------------------------------------------------------- export
async function sha1Of(file) {
    return (0, download_1.hashFile)(file, 'sha1');
}
async function walk(root, rel, out, top) {
    const dirents = await fs.readdir(path.join(root, rel), { withFileTypes: true });
    for (const d of dirents) {
        const childRel = rel ? `${rel}/${d.name}` : d.name;
        if (d.isSymbolicLink())
            continue;
        if (d.isDirectory()) {
            if (top && (SKIP_DIRS.has(d.name)))
                continue;
            await walk(root, childRel, out, false);
        }
        else if (d.isFile()) {
            if (top && SKIP_FILES.has(d.name))
                continue;
            if (d.name.endsWith('.part') || /^hs_err_pid\d+\.log$/.test(d.name))
                continue;
            const abs = path.join(root, childRel);
            out.push({ rel: childRel, abs, size: (await fs.stat(abs)).size });
        }
    }
}
/** File name without the folder: `mods/sodium.jar` → `sodium.jar`. */
const baseName = (rel) => rel.slice(rel.lastIndexOf('/') + 1);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
/**
 * One Modrinth lookup that does not give up on the first error: a failed batch is retried in chunks of 10 and then
 * one hash at a time (a single bad request or a rate limit must not push 100 mods into the archive).
 * Returns the merged answer and how many hashes could not be asked at all.
 */
async function lookupWithRetry(identify, batch, signal, 
/** Called with the hashes that are being asked about right now (to show their file names). */
onAsk) {
    onAsk?.(batch);
    let error;
    try {
        return { res: await identify(batch, signal), failed: 0 };
    }
    catch (e) {
        if (signal?.aborted)
            throw e;
        error = e instanceof Error ? e.message : String(e);
    }
    const res = {};
    let failed = 0;
    const ask = async (part) => {
        if (signal?.aborted)
            throw new DOMException('Aborted', 'AbortError');
        onAsk?.(part);
        try {
            Object.assign(res, await identify(part, signal));
            return true;
        }
        catch (e) {
            if (signal?.aborted)
                throw e;
            error = e instanceof Error ? e.message : String(e);
            return false;
        }
    };
    for (let i = 0; i < batch.length; i += 10) {
        const chunk = batch.slice(i, i + 10);
        await sleep(300);
        if (await ask(chunk))
            continue;
        for (const h of chunk) {
            await sleep(300);
            if (!(await ask([h])))
                failed++;
        }
    }
    return { res, failed, error: failed ? error : undefined };
}
/**
 * Hashes every mod / resource pack that is not listed yet and asks Modrinth which of them it hosts.
 * A file only counts when Modrinth serves exactly these bytes (same SHA-1) from its CDN, so the importer
 * gets the identical file. Anything else stays in the archive. A failed lookup never fails the export.
 */
async function identifyOutsideFiles(o, already, notices) {
    // bound: ModrinthApi.identify uses `this`, a detached method call fails with "reading 'post'"
    const identify = o.api.identify?.bind(o.api);
    if (!identify)
        return [];
    const candidates = [];
    for (const dir of CONTENT_DIRS) {
        let dirents;
        try {
            dirents = await fs.readdir(path.join(o.gameDir, dir), { withFileTypes: true });
        }
        catch {
            continue;
        }
        for (const d of dirents) {
            if (!d.isFile() || d.isSymbolicLink() || !CONTENT_FILE.test(d.name) || d.name.length > 250)
                continue;
            const rel = `${dir}/${d.name}`;
            if (!already.has(rel))
                candidates.push(rel);
        }
    }
    if (!candidates.length)
        return [];
    const byHash = new Map();
    let hashed = 0;
    await (0, download_1.runPool)(candidates, 4, async (rel) => {
        if (o.signal?.aborted)
            throw new DOMException('Aborted', 'AbortError');
        o.report(`Считаю хеш: ${baseName(rel)} (${hashed + 1} из ${candidates.length})`, 0.25 + (hashed / candidates.length) * 0.15);
        try {
            const h = (await sha1Of(path.join(o.gameDir, rel))).toLowerCase();
            const list = byHash.get(h);
            if (list)
                list.push(rel);
            else
                byHash.set(h, [rel]);
        }
        catch {
            // unreadable file: it will be packed (or the packing step reports the real error)
        }
        finally {
            hashed++;
        }
    });
    const hashes = [...byHash.keys()];
    const out = [];
    let failedBatches = 0;
    let lastError = '';
    for (let i = 0; i < hashes.length; i += IDENTIFY_BATCH) {
        if (o.signal?.aborted)
            throw new DOMException('Aborted', 'AbortError');
        const batch = hashes.slice(i, i + IDENTIFY_BATCH);
        // names of the files being looked up: shown in the progress bar before the request is sent
        const nameOf = (h) => baseName(byHash.get(h)?.[0] ?? h);
        const frac = (n) => 0.4 + (Math.min(n, hashes.length) / hashes.length) * 0.1;
        const { res, failed, error } = await lookupWithRetry(identify, batch, o.signal, (asked) => {
            const first = nameOf(asked[0]);
            const more = asked.length > 1 ? ` и ещё ${asked.length - 1}` : '';
            const at = i + batch.indexOf(asked[0]) + 1;
            o.report(`Ищу на Modrinth: ${first}${more} (${at} из ${hashes.length})`, frac(i + batch.indexOf(asked[0])));
        });
        failedBatches += failed;
        if (error)
            lastError = error;
        for (const h of batch) {
            const v = res[h] ?? res[h.toUpperCase()];
            if (!v)
                continue;
            const f = v.files.find((x) => x.hashes.sha1?.toLowerCase() === h);
            const url = f ? cdnUrl.safeParse(f.url) : null;
            if (!f || !url?.success || !/^[A-Za-z0-9]{8}$/.test(v.project_id) || !/^[A-Za-z0-9]{8}$/.test(v.id))
                continue;
            for (const rel of byHash.get(h) ?? []) {
                out.push({ path: rel, sha1: h, size: f.size, url: f.url, projectId: v.project_id, versionId: v.id });
            }
        }
        o.report(`Ищу на Modrinth: ${Math.min(i + IDENTIFY_BATCH, hashes.length)} из ${hashes.length}`, frac(i + IDENTIFY_BATCH));
    }
    if (failedBatches)
        notices.push(`Не удалось связаться с Modrinth для ${failedBatches} файлов, они положены в архив. Повтори экспорт при наличии интернета.${lastError ? ` Причина: ${lastError.slice(0, 200)}` : ''}`);
    // say which files stayed in the archive, so "why is the pack big" has a visible answer
    const found = new Set(out.map((f) => f.path));
    const missing = candidates.filter((rel) => !found.has(rel));
    if (missing.length) {
        notices.push(`Не найдено на Modrinth по хешу (${missing.length} из ${candidates.length}), эти файлы положены в архив целиком.`);
        for (const rel of missing.slice(0, 40))
            notices.push(`В архиве: ${rel}`);
    }
    return out;
}
async function exportInstance(o) {
    const notices = [];
    const index = await (0, modrinth_1.readInstalled)(o.gameDir);
    const downloads = [];
    const downloaded = new Set();
    // 1. which files can be fetched from Modrinth again (and are byte-for-byte what Modrinth serves)
    const entries = Object.entries(index.projects);
    let done = 0;
    let current = '';
    const step1 = () => o.report(`Сверяю с Modrinth: ${current || '…'} (${Math.min(done + 1, entries.length)} из ${entries.length})`, entries.length ? (done / entries.length) * 0.25 : 0.25);
    await (0, download_1.runPool)(entries, 4, async ([projectId, info]) => {
        if (o.signal?.aborted)
            throw new DOMException('Aborted', 'AbortError');
        try {
            const name = typeof info?.file === 'string' ? info.file : '';
            if (!name || name.includes('/') || name.includes('\\'))
                return;
            current = name;
            step1();
            let found = null;
            for (const cand of [`mods/${name}`, `mods/${name}.disabled`, `resourcepacks/${name}`, `resourcepacks/${name}.disabled`]) {
                if (await (0, storage_1.exists)(path.join(o.gameDir, cand))) {
                    found = cand;
                    break;
                }
            }
            if (!found)
                return;
            const local = await sha1Of(path.join(o.gameDir, found));
            let version;
            try {
                version = await o.api.version(info.versionId, o.signal);
            }
            catch (e) {
                if (o.signal?.aborted)
                    throw e;
                notices.push(`Не удалось сверить с Modrinth, файл положен в архив: ${name}`);
                return;
            }
            const f = version.files.find((x) => x.filename === name);
            const parsed = f ? cdnUrl.safeParse(f.url) : null;
            if (version.project_id === projectId && f && parsed?.success && f.hashes.sha1?.toLowerCase() === local) {
                downloads.push({ path: found, sha1: local, size: f.size, url: f.url, projectId, versionId: info.versionId });
                downloaded.add(found);
            }
            else {
                notices.push(`Файл отличается от версии на Modrinth, положен в архив: ${name}`);
            }
        }
        finally {
            done++;
            step1();
        }
    });
    // 1b. mods and resource packs that were NOT installed through the launcher (downloaded by hand, copied from another
    //     launcher, ...): recognise them on Modrinth by SHA-1 and list them instead of packing the jar
    let identified = 0;
    if (o.api.identify) {
        const found = await identifyOutsideFiles(o, downloaded, notices);
        for (const d of found) {
            downloads.push(d);
            downloaded.add(d.path);
        }
        identified = found.length;
    }
    downloads.sort((a, b) => a.path.localeCompare(b.path));
    // 2. everything else goes into the archive
    o.report('Собираю остальные файлы…', 0.55);
    const all = [];
    const rootDirents = await fs.readdir(o.gameDir, { withFileTypes: true });
    for (const d of rootDirents) {
        if (d.isSymbolicLink())
            continue;
        if (d.isDirectory()) {
            if (SKIP_DIRS.has(d.name) || (d.name === 'saves' && !o.includeWorlds))
                continue;
            await walk(o.gameDir, d.name, all, false);
        }
        else if (d.isFile() && !SKIP_FILES.has(d.name) && !d.name.endsWith('.part') && !/^hs_err_pid\d+\.log$/.test(d.name)) {
            const abs = path.join(o.gameDir, d.name);
            all.push({ rel: d.name, abs, size: (await fs.stat(abs)).size });
        }
    }
    const bundle = all.filter((f) => !downloaded.has(f.rel));
    const bytes = bundle.reduce((a, f) => a + f.size, 0);
    if (bundle.length > MAX_PACK_FILES)
        throw new errors_1.AppError('PACK_TOO_BIG', `Слишком много файлов для архива (${bundle.length}). Не включай миры или удали лишнее.`);
    if (bytes > exports.MAX_PACK_OVERRIDES_BYTES) {
        throw new errors_1.AppError('PACK_TOO_BIG', `Файлы, которые нельзя скачать, весят ${(bytes / 1024 / 1024).toFixed(0)} МБ (предел 2048 МБ).${o.includeWorlds ? ' Попробуй экспорт без миров.' : ''}`);
    }
    const manifest = {
        format: 'chaldlauncher-instance', formatVersion: 1,
        name: o.meta.name, description: o.meta.description, mcVersion: o.meta.mcVersion,
        loader: { type: o.meta.loader.type, version: o.meta.loader.version },
        kind: o.meta.kind, coverColor: o.meta.coverColor, files: downloads,
    };
    const zip = new adm_zip_1.default();
    zip.addFile(exports.MANIFEST, Buffer.from(JSON.stringify(manifest, null, 2), 'utf8'));
    let n = 0;
    for (const f of bundle) {
        if (o.signal?.aborted)
            throw new DOMException('Aborted', 'AbortError');
        zip.addFile(`overrides/${f.rel}`, await fs.readFile(f.abs));
        n++;
        if (n % 25 === 0)
            o.report(`Упаковываю файлы: ${n} из ${bundle.length}`, 0.55 + (n / bundle.length) * 0.4);
    }
    o.report('Записываю файл…', 0.97);
    const part = `${o.out}.part`;
    try {
        zip.writeZip(part);
        await fs.rename(part, o.out);
    }
    catch (e) {
        await fs.rm(part, { force: true });
        throw e;
    }
    return { downloads: downloads.length, identified, bundledFiles: bundle.length, bundledBytes: bytes, notices };
}
// ---------------------------------------------------------------- import
/** Reads and validates a .chaldlauncher file without writing anything. Hostile input is expected. */
function inspectPack(file) {
    let zip;
    try {
        zip = new adm_zip_1.default(file);
    }
    catch {
        throw new errors_1.AppError('PACK_INVALID', 'Файл повреждён или это не архив .chaldlauncher');
    }
    const entry = zip.getEntry(exports.MANIFEST);
    if (!entry || entry.header.size > MAX_MANIFEST_BYTES)
        throw new errors_1.AppError('PACK_INVALID', `В файле нет ${exports.MANIFEST}`);
    let json;
    try {
        json = JSON.parse(entry.getData().toString('utf8'));
    }
    catch {
        throw new errors_1.AppError('PACK_INVALID', `${exports.MANIFEST} не читается`);
    }
    const parsed = exports.chaldPackSchema.safeParse(json);
    if (!parsed.success)
        throw new errors_1.AppError('PACK_INVALID', `Неверный формат файла: ${parsed.error.issues[0]?.message ?? ''}`);
    const manifest = parsed.data;
    if (manifest.loader.type !== 'vanilla' && !manifest.loader.version)
        throw new errors_1.AppError('PACK_INVALID', 'Не указана версия загрузчика');
    const dl = new Set();
    for (const f of manifest.files) {
        const rel = (0, modrinth_1.safePackPath)(f.path);
        if (dl.has(rel))
            throw new errors_1.AppError('PACK_INVALID', `Файл указан дважды: ${rel}`);
        dl.add(rel);
    }
    let count = 0;
    let total = 0;
    for (const e of zip.getEntries()) {
        if (e.isDirectory || e.entryName === exports.MANIFEST)
            continue;
        if (!e.entryName.startsWith('overrides/'))
            throw new errors_1.AppError('PACK_INVALID', `Лишний файл в архиве: ${e.entryName.slice(0, 80)}`);
        const rel = (0, modrinth_1.safePackPath)(e.entryName.slice('overrides/'.length));
        if (dl.has(rel))
            throw new errors_1.AppError('PACK_INVALID', `Файл есть и в списке загрузки, и в архиве: ${rel}`);
        total += e.header.size;
        count++;
        if (count > MAX_PACK_FILES)
            throw new errors_1.AppError('PACK_TOO_BIG', 'В архиве слишком много файлов');
        if (total > exports.MAX_PACK_OVERRIDES_BYTES)
            throw new errors_1.AppError('PACK_TOO_BIG', 'Архив распаковывается в слишком большой объём');
    }
    return {
        manifest,
        summary: {
            name: manifest.name, description: manifest.description, mcVersion: manifest.mcVersion, loader: manifest.loader,
            downloads: manifest.files.length, overrideFiles: count, overrideBytes: total,
        },
    };
}
function packToPlan(m) {
    return {
        name: m.name, mcVersion: m.mcVersion, loader: m.loader,
        files: m.files.map((f) => ({ rel: (0, modrinth_1.safePackPath)(f.path), sha1: f.sha1, size: f.size, urls: [f.url] })),
    };
}
/** The index that makes the Modrinth page show "Установлено" for what the pack brought. */
function installedIndexFor(m) {
    const projects = {};
    for (const f of m.files) {
        projects[f.projectId] = { file: path.posix.basename(f.path).replace(/\.disabled$/, ''), versionId: f.versionId };
    }
    return { projects };
}
//# sourceMappingURL=chaldpack.js.map