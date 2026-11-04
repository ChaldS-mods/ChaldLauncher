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
exports.InstanceStore = void 0;
const fs = __importStar(require("node:fs/promises"));
const path = __importStar(require("node:path"));
const schemas_1 = require("../shared/schemas");
const errors_1 = require("./errors");
const paths_1 = require("./paths");
const storage_1 = require("./storage");
const COVER_EXT = new Set(['.png', '.jpg', '.jpeg', '.webp']);
const MAX_COVER_BYTES = 1024 * 1024;
class InstanceStore {
    getRoot;
    versionsDir;
    /**
     * @param getRoot instances directory (read on every call, so a settings change applies immediately)
     * @param versionsDir shared directory with version jsons and client jars
     */
    constructor(getRoot, versionsDir) {
        this.getRoot = getRoot;
        this.versionsDir = versionsDir;
    }
    async dir(id) {
        if (!paths_1.INSTANCE_ID_RE.test(id))
            throw new errors_1.AppError('INSTANCE_ID', 'Некорректный ID инстанса');
        return (0, paths_1.resolveInside)(await this.getRoot(), id);
    }
    async readMeta(id) {
        const dir = await this.dir(id);
        let meta;
        try {
            meta = await (0, storage_1.readJson)(path.join(dir, 'instance.json'));
        }
        catch {
            throw new errors_1.AppError('INSTANCE_CORRUPT', 'instance.json повреждён');
        }
        if (!meta)
            throw new errors_1.AppError('INSTANCE_NOT_FOUND', 'Инстанс не найден');
        return meta;
    }
    async writeMeta(meta) {
        await (0, storage_1.writeJsonAtomic)(path.join(await this.dir(meta.id), 'instance.json'), meta);
    }
    async gameDir(id) {
        return path.join(await this.dir(id), '.minecraft');
    }
    async list(ctx) {
        const root = await this.getRoot();
        await fs.mkdir(root, { recursive: true });
        const dirents = await fs.readdir(root, { withFileTypes: true });
        const views = [];
        for (const d of dirents) {
            if (!d.isDirectory() || !paths_1.INSTANCE_ID_RE.test(d.name))
                continue;
            const hasMeta = await (0, storage_1.exists)(path.join(root, d.name, 'instance.json'));
            if (!hasMeta)
                continue;
            try {
                views.push(await this.toView(await this.readMeta(d.name), ctx));
            }
            catch (e) {
                views.push(this.brokenView(root, d.name, e instanceof Error ? e.message : 'Ошибка чтения'));
            }
        }
        return views.sort((a, b) => (b.lastPlayedAt ?? b.createdAt).localeCompare(a.lastPlayedAt ?? a.createdAt));
    }
    async get(id, ctx) {
        return this.toView(await this.readMeta(id), ctx);
    }
    brokenView(root, id, reason) {
        const dir = path.join(root, id);
        return {
            schemaVersion: 1, id, name: id, description: '', mcVersion: '?', loader: { type: 'vanilla', version: null },
            kind: 'custom', versionId: null, installed: false, createdAt: new Date(0).toISOString(), lastPlayedAt: null,
            coverColor: 0, coverFile: null,
            settings: { javaPath: '', memoryMinMb: null, memoryMaxMb: null, jvmArgs: '', width: null, height: null, fullscreen: null },
            state: 'broken', stateReason: reason, path: dir, gameDir: path.join(dir, '.minecraft'),
            modCount: 0, packCount: 0, coverDataUrl: null, running: false,
        };
    }
    async countFiles(dir, pred) {
        try {
            return (await fs.readdir(dir, { withFileTypes: true })).filter((e) => pred(e.name, e.isDirectory())).length;
        }
        catch {
            return 0;
        }
    }
    async computeState(meta, ctx) {
        if (ctx.installing.has(meta.id))
            return { state: 'installing', reason: null };
        if (!meta.installed || !meta.versionId)
            return { state: 'not-installed', reason: 'Установка не завершена' };
        const json = path.join(this.versionsDir, meta.versionId, `${meta.versionId}.json`);
        const jar = path.join(this.versionsDir, meta.mcVersion, `${meta.mcVersion}.jar`);
        if (!(await (0, storage_1.exists)(json)) || !(await (0, storage_1.exists)(jar))) {
            return { state: 'broken', reason: 'Не найдены файлы версии. Запусти восстановление.' };
        }
        return { state: 'ready', reason: null };
    }
    async toView(meta, ctx) {
        const dir = await this.dir(meta.id);
        const gameDir = path.join(dir, '.minecraft');
        const { state, reason } = await this.computeState(meta, ctx);
        let coverDataUrl = null;
        if (meta.coverFile) {
            try {
                const file = (0, paths_1.resolveInside)(dir, meta.coverFile);
                const st = await fs.stat(file);
                if (st.size <= MAX_COVER_BYTES) {
                    const ext = path.extname(file).slice(1).replace('jpg', 'jpeg');
                    coverDataUrl = `data:image/${ext};base64,${(await fs.readFile(file)).toString('base64')}`;
                }
            }
            catch {
                coverDataUrl = null;
            }
        }
        return {
            ...meta, state, stateReason: reason, path: dir, gameDir,
            modCount: await this.countFiles(path.join(gameDir, 'mods'), (n, d) => !d && n.endsWith('.jar')),
            packCount: await this.countFiles(path.join(gameDir, 'resourcepacks'), (n) => !n.endsWith('.disabled')),
            coverDataUrl, running: ctx.running.has(meta.id),
        };
    }
    async uniqueId(root, wanted) {
        let id = wanted;
        for (let n = 2; await (0, storage_1.exists)(path.join(root, id)); n++)
            id = `${wanted.slice(0, 60)}-${n}`;
        return id;
    }
    async create(input, ctx) {
        const p = schemas_1.createInstanceSchema.safeParse(input);
        if (!p.success)
            throw new errors_1.AppError('INSTANCE_INVALID', p.error.issues[0]?.message ?? 'Некорректные данные');
        const data = p.data;
        const root = await this.getRoot();
        await fs.mkdir(root, { recursive: true });
        let id;
        if (data.id) {
            if (await (0, storage_1.exists)(path.join(root, data.id)))
                throw new errors_1.AppError('INSTANCE_EXISTS', `Папка «${data.id}» уже существует`);
            id = data.id;
        }
        else {
            id = await this.uniqueId(root, (0, paths_1.slugify)(data.name));
        }
        if (data.loader.type !== 'vanilla' && !data.loader.version) {
            throw new errors_1.AppError('INSTANCE_INVALID', 'Выбери версию загрузчика');
        }
        const meta = {
            schemaVersion: 1, id, name: data.name, description: data.description, mcVersion: data.mcVersion,
            loader: { type: data.loader.type, version: data.loader.type === 'vanilla' ? null : data.loader.version },
            kind: data.kind, versionId: null, installed: false, createdAt: new Date().toISOString(), lastPlayedAt: null,
            coverColor: data.coverColor, coverFile: null, settings: data.settings,
        };
        const dir = (0, paths_1.resolveInside)(root, id);
        const gameDir = path.join(dir, '.minecraft');
        for (const sub of ['mods', 'config', 'saves', 'resourcepacks'])
            await fs.mkdir(path.join(gameDir, sub), { recursive: true });
        await this.writeMeta(meta);
        return this.toView(meta, ctx);
    }
    async update(id, patch, ctx) {
        const p = schemas_1.updateInstanceSchema.safeParse(patch);
        if (!p.success)
            throw new errors_1.AppError('INSTANCE_INVALID', p.error.issues[0]?.message ?? 'Некорректные данные');
        const upd = p.data;
        const meta = await this.readMeta(id);
        if (upd.name !== undefined)
            meta.name = upd.name;
        if (upd.description !== undefined)
            meta.description = upd.description;
        if (upd.kind !== undefined)
            meta.kind = upd.kind;
        if (upd.coverColor !== undefined)
            meta.coverColor = upd.coverColor;
        if (upd.settings !== undefined)
            meta.settings = schemas_1.instanceSettingsSchema.parse(upd.settings);
        await this.writeMeta(meta);
        return this.toView(meta, ctx);
    }
    async patchInternal(id, patch) {
        const meta = await this.readMeta(id);
        Object.assign(meta, patch);
        await this.writeMeta(meta);
    }
    async duplicate(id, name, ctx) {
        const trimmed = name.trim();
        if (!trimmed || trimmed.length > 48)
            throw new errors_1.AppError('INSTANCE_INVALID', 'Название: от 1 до 48 символов');
        const src = await this.readMeta(id);
        const root = await this.getRoot();
        const newId = await this.uniqueId(root, (0, paths_1.slugify)(trimmed));
        const from = await this.dir(id);
        const to = (0, paths_1.resolveInside)(root, newId);
        await fs.cp(from, to, { recursive: true, errorOnExist: true });
        const meta = { ...src, id: newId, name: trimmed, createdAt: new Date().toISOString(), lastPlayedAt: null };
        await this.writeMeta(meta);
        return this.toView(meta, ctx);
    }
    async remove(id, confirm) {
        if (confirm !== true)
            throw new errors_1.AppError('CONFIRM_REQUIRED', 'Удаление нужно подтвердить');
        const dir = await this.dir(id);
        if (!(await (0, storage_1.exists)(path.join(dir, 'instance.json'))))
            throw new errors_1.AppError('INSTANCE_NOT_FOUND', 'Инстанс не найден');
        await fs.rm(dir, { recursive: true, force: true });
    }
    async setCoverFromFile(id, source) {
        const ext = path.extname(source).toLowerCase();
        if (!COVER_EXT.has(ext))
            throw new errors_1.AppError('COVER_INVALID', 'Поддерживаются PNG, JPG и WebP');
        const st = await fs.stat(source);
        if (st.size > MAX_COVER_BYTES)
            throw new errors_1.AppError('COVER_INVALID', 'Обложка не больше 1 МБ');
        const dir = await this.dir(id);
        const name = `cover${ext}`;
        await fs.copyFile(source, path.join(dir, name));
        await this.patchInternal(id, { coverFile: name });
    }
}
exports.InstanceStore = InstanceStore;
//# sourceMappingURL=instances.js.map