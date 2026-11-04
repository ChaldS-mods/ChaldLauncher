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
exports.WardrobeService = exports.MAX_SKIN_BYTES = exports.MAX_SKINS = void 0;
exports.cleanSkinName = cleanSkinName;
exports.inspectSkin = inspectSkin;
exports.pickActiveSkin = pickActiveSkin;
exports.texturesUrl = texturesUrl;
const node_crypto_1 = require("node:crypto");
const fs = __importStar(require("node:fs/promises"));
const path = __importStar(require("node:path"));
const skin_1 = require("../shared/skin");
const errors_1 = require("./errors");
const net_1 = require("./net");
const png_1 = require("./png");
const storage_1 = require("./storage");
exports.MAX_SKINS = 100;
exports.MAX_SKIN_BYTES = 64 * 1024;
const API = 'https://api.minecraftservices.com';
const TEXTURES_HOST = 'textures.minecraft.net';
const ID_RE = /^[a-f0-9]{12}$/;
const dataUrl = (png) => `data:image/png;base64,${png.toString('base64')}`;
function cleanSkinName(raw) {
    // eslint-disable-next-line no-control-regex
    return raw.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 32);
}
/** Throws a user-readable error unless this is a PNG skin of an accepted size. Returns the detected model. */
function inspectSkin(png) {
    if (png.length > exports.MAX_SKIN_BYTES)
        throw new errors_1.AppError('SKIN_INVALID', `Файл слишком большой (больше ${exports.MAX_SKIN_BYTES / 1024} КБ): это не похоже на скин.`);
    const h = (0, png_1.readPngHeader)(png);
    if (!h)
        throw new errors_1.AppError('SKIN_INVALID', 'Это не PNG-файл.');
    if (!(0, skin_1.isValidSkinSize)(h.width, h.height))
        throw new errors_1.AppError('SKIN_INVALID', `Размер скина должен быть 64×64 или 64×32, а у файла ${h.width}×${h.height}.`);
    const px = (0, png_1.decodePngRgba)(png);
    return { variant: px && (0, skin_1.isSlimSkin)(px.rgba, px.width, px.height) ? 'slim' : 'classic' };
}
/** The active skin from GET /minecraft/profile, or null (nothing useful there). */
function pickActiveSkin(profile) {
    const skins = profile?.skins;
    const s = skins?.find((k) => k.state === 'ACTIVE' && typeof k.url === 'string');
    if (!s?.url)
        return null;
    return { url: s.url, variant: s.variant === 'SLIM' ? 'slim' : 'classic' };
}
/** Skin textures live on textures.minecraft.net (the profile returns an http:// link); we only ever fetch that host over https. */
function texturesUrl(raw) {
    let u;
    try {
        u = new URL(raw);
    }
    catch {
        throw new errors_1.AppError('SKIN_URL', 'Mojang вернул некорректную ссылку на скин');
    }
    if (u.hostname !== TEXTURES_HOST)
        throw new errors_1.AppError('SKIN_URL', 'Ссылка на скин ведёт не на сервер Minecraft: не загружаю');
    u.protocol = 'https:';
    u.port = '';
    return u.toString();
}
function apiError(status, text) {
    let detail = '';
    try {
        const j = JSON.parse(text);
        detail = j.errorMessage ?? j.error ?? '';
    }
    catch { /* not json */ }
    if (status === 401 || status === 403)
        return new errors_1.AppError('SKIN_AUTH', 'Mojang не принял сессию. Выйди и снова войди в аккаунт Microsoft.');
    if (status === 429)
        return new errors_1.AppError('SKIN_RATE', 'Mojang ограничивает частоту смены скина. Подожди минуту и попробуй снова.');
    if (status === 400)
        return new errors_1.AppError('SKIN_REJECTED', `Mojang не принял файл скина${detail ? `: ${detail}` : ''}.`);
    return new errors_1.AppError('SKIN_HTTP', `Не удалось сменить скин (HTTP ${status}${detail ? `: ${detail}` : ''}).`);
}
class WardrobeService {
    dir;
    o;
    lock = Promise.resolve();
    api;
    constructor(dir, o) {
        this.dir = dir;
        this.o = o;
        this.api = o.apiBase ?? API;
    }
    serial(fn) {
        const run = this.lock.then(fn, fn);
        this.lock = run.catch(() => undefined);
        return run;
    }
    get indexFile() { return path.join(this.dir, 'index.json'); }
    pngFile(id) {
        if (!ID_RE.test(id))
            throw new errors_1.AppError('SKIN_ID', 'Некорректный идентификатор скина');
        return path.join(this.dir, `${id}.png`);
    }
    async readIndex() {
        try {
            const j = await (0, storage_1.readJson)(this.indexFile);
            const skins = Array.isArray(j?.skins) ? j.skins.filter((s) => ID_RE.test(s.id) && (s.variant === 'classic' || s.variant === 'slim') && typeof s.name === 'string') : [];
            return { version: 1, skins };
        }
        catch {
            return { version: 1, skins: [] }; // damaged index: start with an empty wardrobe, the PNG files stay on disk
        }
    }
    async view(s) {
        try {
            return { id: s.id, name: s.name, variant: s.variant, addedAt: s.addedAt, dataUrl: dataUrl(await fs.readFile(this.pngFile(s.id))) };
        }
        catch {
            return null; // the file was deleted by hand
        }
    }
    async list() {
        const idx = await this.readIndex();
        const views = await Promise.all(idx.skins.map((s) => this.view(s)));
        return views.filter((v) => v !== null).sort((a, b) => b.addedAt.localeCompare(a.addedAt));
    }
    /** Adds a PNG to the wardrobe; an identical skin that is already there is returned instead of adding a copy. */
    async addPng(png, name, variant) {
        const detected = inspectSkin(png);
        const sha256 = (0, node_crypto_1.createHash)('sha256').update(png).digest('hex');
        return this.serial(async () => {
            const idx = await this.readIndex();
            const same = idx.skins.find((s) => s.sha256 === sha256);
            if (same) {
                const v = await this.view(same);
                if (v)
                    return { entry: v, duplicate: true };
            }
            if (idx.skins.length >= exports.MAX_SKINS)
                throw new errors_1.AppError('SKIN_LIMIT', `В гардеробе уже ${exports.MAX_SKINS} скинов. Удали ненужные.`);
            let id = (0, node_crypto_1.randomBytes)(6).toString('hex');
            while (await (0, storage_1.exists)(this.pngFile(id)))
                id = (0, node_crypto_1.randomBytes)(6).toString('hex');
            await fs.mkdir(this.dir, { recursive: true });
            await fs.writeFile(this.pngFile(id), png);
            const stored = { id, name: cleanSkinName(name) || 'Скин', variant: variant ?? detected.variant, addedAt: new Date().toISOString(), sha256 };
            idx.skins.push(stored);
            await (0, storage_1.writeJsonAtomic)(this.indexFile, idx);
            return { entry: { id, name: stored.name, variant: stored.variant, addedAt: stored.addedAt, dataUrl: dataUrl(png) }, duplicate: false };
        });
    }
    /** Imports PNG files chosen by the user; bad files are reported, not fatal. */
    async importFiles(files) {
        const added = [];
        const problems = [];
        for (const f of files) {
            const base = path.basename(f);
            try {
                const st = await fs.stat(f);
                if (st.size > exports.MAX_SKIN_BYTES)
                    throw new errors_1.AppError('SKIN_INVALID', `Файл слишком большой (больше ${exports.MAX_SKIN_BYTES / 1024} КБ): это не похоже на скин.`);
                const { entry, duplicate } = await this.addPng(await fs.readFile(f), base.replace(/\.png$/i, ''));
                if (duplicate)
                    problems.push(`«${base}»: такой скин уже есть в гардеробе («${entry.name}»)`);
                else
                    added.push(entry);
            }
            catch (e) {
                problems.push(`«${base}»: ${e instanceof Error ? e.message : String(e)}`);
            }
        }
        return { added, problems };
    }
    async update(id, patch) {
        this.pngFile(id);
        return this.serial(async () => {
            const idx = await this.readIndex();
            const s = idx.skins.find((k) => k.id === id);
            if (!s)
                throw new errors_1.AppError('SKIN_NOT_FOUND', 'Скин не найден');
            if (patch.name !== undefined) {
                const n = cleanSkinName(patch.name);
                if (!n)
                    throw new errors_1.AppError('SKIN_NAME', 'Введи название скина');
                s.name = n;
            }
            if (patch.variant)
                s.variant = patch.variant;
            await (0, storage_1.writeJsonAtomic)(this.indexFile, idx);
            const v = await this.view(s);
            if (!v)
                throw new errors_1.AppError('SKIN_NOT_FOUND', 'Файл скина пропал с диска');
            return v;
        });
    }
    async remove(id) {
        const file = this.pngFile(id);
        await this.serial(async () => {
            const idx = await this.readIndex();
            idx.skins = idx.skins.filter((k) => k.id !== id);
            await (0, storage_1.writeJsonAtomic)(this.indexFile, idx);
            await fs.rm(file, { force: true });
        });
    }
    // ---- account (Minecraft services) ----
    async fetchProfile(token) {
        const { res, entry } = await (0, net_1.netRequest)(`${this.api}/minecraft/profile`, { purpose: 'Гардероб: профиль Minecraft', headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' } });
        const text = await res.text();
        entry.bytes = Buffer.byteLength(text);
        if (!res.ok)
            throw apiError(res.status, text);
        return JSON.parse(text);
    }
    async downloadCurrent() {
        const token = await this.o.getToken();
        const active = pickActiveSkin(await this.fetchProfile(token));
        if (!active)
            return null;
        const { res, entry } = await (0, net_1.netRequest)(texturesUrl(active.url), { purpose: 'Гардероб: текущий скин аккаунта' });
        if (!res.ok)
            throw new errors_1.AppError('SKIN_HTTP', `Не удалось загрузить текущий скин (HTTP ${res.status})`);
        const png = Buffer.from(await res.arrayBuffer());
        entry.bytes = png.length;
        inspectSkin(png);
        return { png, variant: active.variant };
    }
    /** The skin that is on the account right now (null = the account has no custom skin). */
    async current() {
        const c = await this.downloadCurrent();
        return c ? { variant: c.variant, dataUrl: dataUrl(c.png) } : null;
    }
    async saveCurrent(name) {
        const c = await this.downloadCurrent();
        if (!c)
            throw new errors_1.AppError('SKIN_NONE', 'На аккаунте нет собственного скина: нечего сохранять.');
        return this.addPng(c.png, name, c.variant);
    }
    /** Uploads a skin from the wardrobe to the Microsoft account. */
    async apply(id) {
        const stored = (await this.readIndex()).skins.find((k) => k.id === id);
        if (!stored)
            throw new errors_1.AppError('SKIN_NOT_FOUND', 'Скин не найден');
        let png;
        try {
            png = await fs.readFile(this.pngFile(id));
        }
        catch {
            throw new errors_1.AppError('SKIN_NOT_FOUND', 'Файл скина пропал с диска');
        }
        const token = await this.o.getToken();
        const form = new FormData();
        form.append('variant', stored.variant);
        form.append('file', new Blob([new Uint8Array(png)], { type: 'image/png' }), 'skin.png');
        const { res, entry } = await (0, net_1.netRequest)(`${this.api}/minecraft/profile/skins`, {
            method: 'POST', purpose: 'Гардероб: смена скина', headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' }, body: form,
        });
        const text = await res.text();
        entry.bytes = Buffer.byteLength(text);
        if (!res.ok)
            throw apiError(res.status, text);
        return { variant: stored.variant, dataUrl: dataUrl(png) };
    }
    /** Back to the default skin (Steve/Alex, chosen by Mojang from the account's UUID). */
    async reset() {
        const token = await this.o.getToken();
        const { res, entry } = await (0, net_1.netRequest)(`${this.api}/minecraft/profile/skins/active`, {
            method: 'DELETE', purpose: 'Гардероб: сброс скина', headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
        });
        const text = await res.text();
        entry.bytes = Buffer.byteLength(text);
        if (!res.ok)
            throw apiError(res.status, text);
    }
}
exports.WardrobeService = WardrobeService;
//# sourceMappingURL=wardrobe.js.map