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
exports.cleanEntryName = cleanEntryName;
exports.openArchive = openArchive;
exports.planArchive = planArchive;
exports.applyPlan = applyPlan;
exports.importJars = importJars;
const fs = __importStar(require("node:fs/promises"));
const path = __importStar(require("node:path"));
const adm_zip_1 = __importDefault(require("adm-zip"));
const errors_1 = require("./errors");
const launcherImport_1 = require("./launcherImport");
const paths_1 = require("./paths");
/**
 * Looks into an archive dropped on the mods page and decides where its files belong:
 *  - only .jar files (loose, in `mods/`, or inside one wrapper folder) -> the instance's mods folder;
 *  - other folders too (resourcepacks/, config/, saves/…) -> the caller asks the user whether to spread them.
 * Nothing is ever overwritten. Paths come from an untrusted archive: every one is checked.
 */
const MAX_ZIP_BYTES = 2 * 1024 * 1024 * 1024; // AdmZip reads the whole file into memory
const MAX_ENTRIES = 100_000;
const MAX_ENTRY_BYTES = 512 * 1024 * 1024;
const MAX_TOTAL_BYTES = 4 * 1024 * 1024 * 1024;
/** Folder names the game / loaders know: an archive made of these is not just «a folder around the files». */
const GAME_FOLDERS = new Set([
    'mods', 'resourcepacks', 'shaderpacks', 'config', 'saves', 'datapacks', 'defaultconfigs', 'kubejs', 'scripts', 'screenshots',
]);
/** Common spellings people use for the same folder. */
const ALIASES = {
    mod: 'mods', resourcepack: 'resourcepacks', resource_packs: 'resourcepacks', 'resource-packs': 'resourcepacks', texturepacks: 'resourcepacks',
    shaders: 'shaderpacks', shader: 'shaderpacks', shaderpack: 'shaderpacks',
};
/** Wrapper folders that only hold the instance's files (a Minecraft folder, a pack's overrides). */
const KNOWN_WRAPPERS = new Set(['.minecraft', 'minecraft', 'overrides']);
/** Single files that belong in the instance root. */
const ROOT_FILES = new Set(['options.txt', 'optionsof.txt', 'optionsshaders.txt', 'servers.dat']);
const JUNK_NAMES = new Set(['.ds_store', 'thumbs.db', 'desktop.ini']);
const isJar = (name) => /\.jar(\.disabled)?$/i.test(name);
/** A safe relative path with forward slashes, or null for anything that tries to leave the folder. */
function cleanEntryName(raw) {
    if (!raw || raw.includes('\0'))
        return null;
    const s = raw.replace(/\\/g, '/');
    if (s.startsWith('/') || /^[A-Za-z]:/.test(s))
        return null;
    const parts = [];
    for (const p of s.split('/')) {
        if (p === '' || p === '.')
            continue;
        if (p === '..')
            return null;
        parts.push(p);
    }
    return parts.length ? parts.join('/') : null;
}
function canonicalFolder(name) {
    const lower = name.toLowerCase();
    return ALIASES[lower] ?? (GAME_FOLDERS.has(lower) ? lower : name);
}
function looksLikeInstanceContent(rels) {
    if (rels.some((r) => (r.length === 1 ? isJar(r[0]) : GAME_FOLDERS.has(canonicalFolder(r[0])))))
        return true;
    // another wrapper below: `sborka/.minecraft/mods/…`
    const first = rels[0]?.[0];
    return !!first && KNOWN_WRAPPERS.has(first.toLowerCase()) && rels.every((r) => r.length >= 2 && r[0] === first);
}
/** Removes folders that only wrap the content: `sborka/mods/x.jar` -> `mods/x.jar`. At most two levels. */
function stripWrappers(rels) {
    let cur = rels;
    for (let i = 0; i < 2; i++) {
        if (!cur.length || cur.some((r) => r.length < 2))
            break;
        const first = cur[0][0];
        if (!cur.every((r) => r[0] === first))
            break;
        const inner = cur.map((r) => r.slice(1));
        const known = KNOWN_WRAPPERS.has(first.toLowerCase());
        // a folder that is itself a game folder (mods/, config/…) is content, not a wrapper
        if (GAME_FOLDERS.has(canonicalFolder(first)) && canonicalFolder(first) === first.toLowerCase())
            break;
        if (!known && !looksLikeInstanceContent(inner))
            break;
        cur = inner;
    }
    return cur;
}
function readManifestType(zip, name) {
    try {
        const e = zip.getEntry(name);
        if (!e || e.header.size > 1024 * 1024)
            return null;
        const j = JSON.parse(e.getData().toString('utf8'));
        return typeof j.manifestType === 'string' ? j.manifestType : null;
    }
    catch {
        return null;
    }
}
function openArchive(file) {
    try {
        return new adm_zip_1.default(file);
    }
    catch {
        throw new errors_1.AppError('ARCHIVE_INVALID', `Не удалось открыть архив: ${path.basename(file)}. Нужен обычный .zip (для .rar и .7z сначала распакуй файлы).`);
    }
}
async function planArchive(file) {
    const st = await fs.stat(file);
    if (!st.isFile())
        throw new errors_1.AppError('CONTENT_TYPE', `Не файл: ${path.basename(file)}`);
    if (st.size > MAX_ZIP_BYTES)
        throw new errors_1.AppError('ARCHIVE_TOO_BIG', 'Архив больше 2 ГБ: распакуй его и добавь файлы по частям.');
    const zip = openArchive(file);
    const entries = zip.getEntries().filter((e) => !e.isDirectory);
    if (entries.length > MAX_ENTRIES)
        throw new errors_1.AppError('ARCHIVE_TOO_BIG', 'В архиве слишком много файлов.');
    const raw = [];
    for (const entry of entries) {
        const name = cleanEntryName(entry.entryName);
        if (!name)
            continue; // unsafe or empty name: dropped, never written
        const parts = name.split('/');
        if (parts[0].toLowerCase() === '__macosx' || JUNK_NAMES.has(parts[parts.length - 1].toLowerCase()))
            continue;
        raw.push({ entry, parts });
    }
    // a pack (Modrinth .mrpack / CurseForge) is installed as a whole, not file by file
    const rels = stripWrappers(raw.map((r) => r.parts));
    const rootAt = (name) => rels.findIndex((r) => r.length === 1 && r[0].toLowerCase() === name);
    const manifest = rootAt('manifest.json');
    if (rootAt('modrinth.index.json') >= 0 || (manifest >= 0 && readManifestType(zip, raw[manifest].entry.entryName) === 'minecraftModpack')) {
        return { zip, plan: { kind: 'modpack', items: [], mods: 0, modBytes: 0, groups: [], ignored: 0 } };
    }
    const items = [];
    const groupMap = new Map();
    let mods = 0;
    let modBytes = 0;
    let ignored = 0;
    let total = 0;
    raw.forEach((r, n) => {
        const segs = rels[n];
        const size = r.entry.header.size;
        total += size;
        const add = (category, dest) => {
            items.push({ entry: r.entry, dest, category, size });
            if (category === 'mod') {
                mods++;
                modBytes += size;
            }
            else if (category === 'ignored')
                ignored++;
            else {
                const dir = dest.length === 1 ? '' : dest[0];
                const g = groupMap.get(dir) ?? { dir, files: 0, bytes: 0 };
                g.files++;
                g.bytes += size;
                groupMap.set(dir, g);
            }
        };
        const last = segs[segs.length - 1];
        if (segs.length === 1) {
            if (isJar(last))
                add('mod', ['mods', last]);
            else if (ROOT_FILES.has(last.toLowerCase()))
                add('other', [last]);
            else
                add('ignored', segs);
            return;
        }
        const top = segs[0];
        const folder = canonicalFolder(top);
        if (top.startsWith('.') || launcherImport_1.COPY_EXCLUDE.has(top.toLowerCase())) {
            add('ignored', segs);
            return;
        }
        if (folder === 'mods') {
            if (isJar(last))
                add('mod', ['mods', ...segs.slice(1)]);
            else
                add('ignored', segs);
            return;
        }
        add('other', [folder, ...segs.slice(1)]);
    });
    if (total > MAX_TOTAL_BYTES)
        throw new errors_1.AppError('ARCHIVE_TOO_BIG', 'Архив распаковывается в слишком большой объём.');
    const groups = [...groupMap.values()].sort((a, b) => a.dir.localeCompare(b.dir));
    const kind = mods === 0 && groups.length === 0 ? 'empty' : groups.length === 0 ? 'mods' : 'mixed';
    return { zip, plan: { kind, items, mods, modBytes, groups, ignored } };
}
/** Writes the planned files. `mods`: only the mods; `all`: the other folders as well. Existing files stay as they are. */
async function applyPlan(zip, plan, gameDir, mode, signal) {
    const result = { mods: 0, other: 0, skipped: 0 };
    const created = [];
    let total = 0;
    try {
        for (const item of plan.items) {
            if (item.category === 'ignored' || (item.category === 'other' && mode !== 'all'))
                continue;
            signal?.throwIfAborted();
            if (item.size > MAX_ENTRY_BYTES)
                throw new errors_1.AppError('ARCHIVE_TOO_BIG', `Файл слишком большой: ${item.dest[item.dest.length - 1]}`);
            total += item.size;
            if (total > MAX_TOTAL_BYTES)
                throw new errors_1.AppError('ARCHIVE_TOO_BIG', 'Архив распаковывается в слишком большой объём.');
            const dest = (0, paths_1.resolveInside)(gameDir, ...item.dest.map((p, i) => (i === item.dest.length - 1 ? (0, paths_1.safeFileName)(p) : p)));
            await fs.mkdir(path.dirname(dest), { recursive: true });
            const data = item.entry.getData();
            if (data.length !== item.size)
                throw new errors_1.AppError('ARCHIVE_CORRUPT', `Архив повреждён: ${item.dest[item.dest.length - 1]}`);
            try {
                await fs.writeFile(dest, data, { flag: 'wx' }); // never overwrite
                created.push(dest);
                if (item.category === 'mod')
                    result.mods++;
                else
                    result.other++;
            }
            catch (e) {
                if (e.code === 'EEXIST')
                    result.skipped++;
                else
                    throw e;
            }
        }
    }
    catch (e) {
        // all or nothing: do not leave half of an archive behind
        await Promise.all(created.map((f) => fs.rm(f, { force: true }).catch(() => undefined)));
        throw e;
    }
    return result;
}
/** Loose .jar files: copied, existing ones are skipped (not an error, so one duplicate does not stop a whole drop). */
async function importJars(gameDir, sources) {
    const dir = path.join(gameDir, 'mods');
    await fs.mkdir(dir, { recursive: true });
    let imported = 0;
    let skipped = 0;
    for (const src of sources) {
        const name = (0, paths_1.safeFileName)(path.basename(src));
        const st = await fs.stat(src);
        if (!st.isFile())
            throw new errors_1.AppError('CONTENT_TYPE', `Не файл: ${name}`);
        try {
            await fs.copyFile(src, (0, paths_1.resolveInside)(dir, name), 1 /* COPYFILE_EXCL */);
            imported++;
        }
        catch (e) {
            if (e.code === 'EEXIST')
                skipped++;
            else
                throw e;
        }
    }
    return { imported, skipped };
}
//# sourceMappingURL=archiveImport.js.map