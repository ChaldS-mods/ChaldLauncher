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
exports.contentDir = contentDir;
exports.parseModsToml = parseModsToml;
exports.listContent = listContent;
exports.toggleContent = toggleContent;
exports.removeContent = removeContent;
exports.importContent = importContent;
const fs = __importStar(require("node:fs/promises"));
const path = __importStar(require("node:path"));
const adm_zip_1 = __importDefault(require("adm-zip"));
const errors_1 = require("./errors");
const paths_1 = require("./paths");
const MAX_SCAN_BYTES = 200 * 1024 * 1024;
const DISABLED = '.disabled';
function contentDir(gameDir, kind) {
    return path.join(gameDir, kind);
}
function stripDisabled(n) {
    return n.endsWith(DISABLED) ? n.slice(0, -DISABLED.length) : n;
}
function isAllowedName(kind, base, isDir) {
    if (kind === 'mods')
        return !isDir && base.endsWith('.jar');
    return isDir || base.endsWith('.zip');
}
const MAX_ICON_BYTES = 256 * 1024;
const MIME = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif' };
/** Reads an image out of a jar/zip. `rel` comes from the mod's own metadata, so it is only ever used as a key into the archive. */
function iconFromZip(zip, rel) {
    if (typeof rel !== 'string' || !rel || rel.length > 300)
        return null;
    const mime = MIME[path.posix.extname(rel).toLowerCase()];
    if (!mime)
        return null;
    const entry = zip.getEntry(rel.replace(/^\/+/, ''));
    if (!entry || entry.isDirectory || entry.header.size > MAX_ICON_BYTES || entry.header.size === 0)
        return null;
    return `data:${mime};base64,${entry.getData().toString('base64')}`;
}
/** Fabric allows `"icon": "x.png"` or `{ "16": "a.png", "128": "b.png" }`: take the biggest. */
function fabricIconPath(icon) {
    if (typeof icon === 'string')
        return icon;
    if (icon && typeof icon === 'object') {
        const sizes = Object.entries(icon).filter(([, v]) => typeof v === 'string').sort((a, b) => Number(b[0]) - Number(a[0]));
        return sizes[0]?.[1] ?? null;
    }
    return null;
}
/** Just enough TOML for mods.toml / neoforge.mods.toml: `key = "value"` lines of the top level and of the first [[mods]] table. */
function parseModsToml(text) {
    const top = {};
    const mod = {};
    let section = 'top';
    let seenMod = false;
    for (const raw of text.split(/\r?\n/)) {
        const line = raw.trim();
        if (!line || line.startsWith('#'))
            continue;
        if (line.startsWith('[')) {
            if (/^\[\[\s*mods\s*\]\]/.test(line) && !seenMod) {
                section = 'mod';
                seenMod = true;
            }
            else
                section = 'other';
            continue;
        }
        const m = /^([A-Za-z]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/.exec(line);
        if (!m)
            continue;
        const value = m[2] ?? m[3] ?? '';
        if (section === 'top')
            top[m[1]] = value;
        else if (section === 'mod')
            mod[m[1]] = value;
    }
    const clean = (v) => (v && !v.includes('${') ? v : null);
    return { name: clean(mod.displayName), version: clean(mod.version), logoFile: clean(mod.logoFile) ?? clean(top.logoFile) };
}
function readModInfo(file) {
    const none = { name: null, version: null, loader: null, iconDataUrl: null };
    try {
        const zip = new adm_zip_1.default(file);
        const fabric = zip.getEntry('fabric.mod.json');
        if (fabric) {
            const j = JSON.parse(fabric.getData().toString('utf8'));
            return { name: j.name ?? null, version: j.version ?? null, loader: 'fabric', iconDataUrl: iconFromZip(zip, fabricIconPath(j.icon)) };
        }
        const quilt = zip.getEntry('quilt.mod.json');
        if (quilt) {
            const j = JSON.parse(quilt.getData().toString('utf8'));
            return {
                name: j.quilt_loader?.metadata?.name ?? null, version: j.quilt_loader?.version ?? null, loader: 'quilt',
                iconDataUrl: iconFromZip(zip, fabricIconPath(j.quilt_loader?.metadata?.icon)),
            };
        }
        for (const [entryName, loader] of [['META-INF/neoforge.mods.toml', 'neoforge'], ['META-INF/mods.toml', 'forge']]) {
            const toml = zip.getEntry(entryName);
            if (!toml || toml.header.size > 512 * 1024)
                continue;
            const t = parseModsToml(toml.getData().toString('utf8'));
            return { name: t.name, version: t.version, loader, iconDataUrl: iconFromZip(zip, t.logoFile) ?? iconFromZip(zip, 'pack.png') };
        }
    }
    catch {
        /* unreadable jar: no metadata */
    }
    return none;
}
function readPackIcon(file, isDir) {
    try {
        if (isDir)
            return null;
        const entry = new adm_zip_1.default(file).getEntry('pack.png');
        if (!entry || entry.header.size > 256 * 1024)
            return null;
        return `data:image/png;base64,${entry.getData().toString('base64')}`;
    }
    catch {
        return null;
    }
}
async function listContent(gameDir, kind, instanceLoader) {
    const dir = contentDir(gameDir, kind);
    let dirents;
    try {
        dirents = await fs.readdir(dir, { withFileTypes: true });
    }
    catch {
        return [];
    }
    const out = [];
    for (const d of dirents) {
        const enabled = !d.name.endsWith(DISABLED);
        const base = stripDisabled(d.name);
        const isDir = d.isDirectory();
        if (!isAllowedName(kind, base, isDir))
            continue;
        const full = path.join(dir, d.name);
        const st = await fs.stat(full);
        const entry = {
            file: d.name, name: base, version: null, size: isDir ? 0 : st.size, enabled, isDir, iconDataUrl: null, warning: null,
        };
        if (kind === 'mods' && st.size <= MAX_SCAN_BYTES) {
            const info = readModInfo(full);
            if (info.name)
                entry.name = info.name;
            entry.version = info.version;
            entry.iconDataUrl = info.iconDataUrl;
            const compatible = info.loader === instanceLoader || (instanceLoader === 'quilt' && info.loader === 'fabric');
            if (info.loader && instanceLoader !== 'vanilla' && !compatible) {
                entry.warning = `Мод для ${info.loader}, а инстанс на ${instanceLoader}`;
            }
            else if (info.loader && instanceLoader === 'vanilla') {
                entry.warning = `Мод для ${info.loader}, а инстанс без загрузчика`;
            }
        }
        else if (kind === 'resourcepacks') {
            entry.iconDataUrl = readPackIcon(full, isDir);
        }
        out.push(entry);
    }
    return out.sort((a, b) => a.name.localeCompare(b.name));
}
function target(gameDir, kind, file) {
    return (0, paths_1.resolveInside)(contentDir(gameDir, kind), (0, paths_1.safeFileName)(file));
}
async function toggleContent(gameDir, kind, file) {
    const from = target(gameDir, kind, file);
    const to = file.endsWith(DISABLED) ? from.slice(0, -DISABLED.length) : from + DISABLED;
    try {
        await fs.access(to);
        throw new errors_1.AppError('CONTENT_EXISTS', 'Файл с таким именем уже существует');
    }
    catch (e) {
        if (e instanceof errors_1.AppError)
            throw e;
    }
    await fs.rename(from, to);
}
async function removeContent(gameDir, kind, file, confirm) {
    if (confirm !== true)
        throw new errors_1.AppError('CONFIRM_REQUIRED', 'Удаление нужно подтвердить');
    await fs.rm(target(gameDir, kind, file), { recursive: true, force: true });
}
async function importContent(gameDir, kind, sources) {
    const dir = contentDir(gameDir, kind);
    await fs.mkdir(dir, { recursive: true });
    let n = 0;
    for (const src of sources) {
        const name = (0, paths_1.safeFileName)(path.basename(src));
        const ext = kind === 'mods' ? '.jar' : '.zip';
        if (!name.toLowerCase().endsWith(ext))
            throw new errors_1.AppError('CONTENT_TYPE', `Ожидался файл ${ext}: ${name}`);
        const st = await fs.stat(src);
        if (!st.isFile())
            throw new errors_1.AppError('CONTENT_TYPE', `Не файл: ${name}`);
        const dest = (0, paths_1.resolveInside)(dir, name);
        await fs.copyFile(src, dest, 1 /* COPYFILE_EXCL: never overwrite */).catch((e) => {
            if (e.code === 'EEXIST')
                throw new errors_1.AppError('CONTENT_EXISTS', `Файл уже есть: ${name}`);
            throw e;
        });
        n++;
    }
    return n;
}
//# sourceMappingURL=content.js.map