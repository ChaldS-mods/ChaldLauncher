import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import type { InstanceKind, InstanceMeta, InstanceState, InstanceView, LoaderType } from '../shared/types';
import {
  createInstanceSchema, instanceSettingsSchema, updateInstanceSchema,
  type CreateInstanceInput, type UpdateInstanceInput,
} from '../shared/schemas';
import { AppError } from './errors';
import { INSTANCE_ID_RE, resolveInside, slugify } from './paths';
import { exists, readJson, writeJsonAtomic } from './storage';

const COVER_EXT = new Set(['.png', '.jpg', '.jpeg', '.webp']);
const MAX_COVER_BYTES = 1024 * 1024;

export interface InstanceCtx {
  running: ReadonlySet<string>;
  installing: ReadonlySet<string>;
}

export class InstanceStore {
  /**
   * @param getRoot instances directory (read on every call, so a settings change applies immediately)
   * @param versionsDir shared directory with version jsons and client jars
   */
  constructor(private getRoot: () => Promise<string>, private versionsDir: string) {}

  private async dir(id: string): Promise<string> {
    if (!INSTANCE_ID_RE.test(id)) throw new AppError('INSTANCE_ID', 'Некорректный ID инстанса');
    return resolveInside(await this.getRoot(), id);
  }

  async readMeta(id: string): Promise<InstanceMeta> {
    const dir = await this.dir(id);
    let meta: InstanceMeta | null;
    try {
      meta = await readJson<InstanceMeta>(path.join(dir, 'instance.json'));
    } catch {
      throw new AppError('INSTANCE_CORRUPT', 'instance.json повреждён');
    }
    if (!meta) throw new AppError('INSTANCE_NOT_FOUND', 'Инстанс не найден');
    return meta;
  }

  private async writeMeta(meta: InstanceMeta): Promise<void> {
    await writeJsonAtomic(path.join(await this.dir(meta.id), 'instance.json'), meta);
  }

  async gameDir(id: string): Promise<string> {
    return path.join(await this.dir(id), '.minecraft');
  }

  async list(ctx: InstanceCtx): Promise<InstanceView[]> {
    const root = await this.getRoot();
    await fs.mkdir(root, { recursive: true });
    const dirents = await fs.readdir(root, { withFileTypes: true });
    const views: InstanceView[] = [];
    for (const d of dirents) {
      if (!d.isDirectory() || !INSTANCE_ID_RE.test(d.name)) continue;
      const hasMeta = await exists(path.join(root, d.name, 'instance.json'));
      if (!hasMeta) continue;
      try {
        views.push(await this.toView(await this.readMeta(d.name), ctx));
      } catch (e) {
        views.push(this.brokenView(root, d.name, e instanceof Error ? e.message : 'Ошибка чтения'));
      }
    }
    return views.sort((a, b) => (b.lastPlayedAt ?? b.createdAt).localeCompare(a.lastPlayedAt ?? a.createdAt));
  }

  async get(id: string, ctx: InstanceCtx): Promise<InstanceView> {
    return this.toView(await this.readMeta(id), ctx);
  }

  private brokenView(root: string, id: string, reason: string): InstanceView {
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

  private async countFiles(dir: string, pred: (name: string, isDir: boolean) => boolean): Promise<number> {
    try {
      return (await fs.readdir(dir, { withFileTypes: true })).filter((e) => pred(e.name, e.isDirectory())).length;
    } catch {
      return 0;
    }
  }

  private async computeState(meta: InstanceMeta, ctx: InstanceCtx): Promise<{ state: InstanceState; reason: string | null }> {
    if (ctx.installing.has(meta.id)) return { state: 'installing', reason: null };
    if (!meta.installed || !meta.versionId) return { state: 'not-installed', reason: 'Установка не завершена' };
    const json = path.join(this.versionsDir, meta.versionId, `${meta.versionId}.json`);
    const jar = path.join(this.versionsDir, meta.mcVersion, `${meta.mcVersion}.jar`);
    if (!(await exists(json)) || !(await exists(jar))) {
      return { state: 'broken', reason: 'Не найдены файлы версии. Запусти восстановление.' };
    }
    return { state: 'ready', reason: null };
  }

  private async toView(meta: InstanceMeta, ctx: InstanceCtx): Promise<InstanceView> {
    const dir = await this.dir(meta.id);
    const gameDir = path.join(dir, '.minecraft');
    const { state, reason } = await this.computeState(meta, ctx);
    let coverDataUrl: string | null = null;
    if (meta.coverFile) {
      try {
        const file = resolveInside(dir, meta.coverFile);
        const st = await fs.stat(file);
        if (st.size <= MAX_COVER_BYTES) {
          const ext = path.extname(file).slice(1).replace('jpg', 'jpeg');
          coverDataUrl = `data:image/${ext};base64,${(await fs.readFile(file)).toString('base64')}`;
        }
      } catch {
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

  private async uniqueId(root: string, wanted: string): Promise<string> {
    let id = wanted;
    for (let n = 2; await exists(path.join(root, id)); n++) id = `${wanted.slice(0, 60)}-${n}`;
    return id;
  }

  async create(input: unknown, ctx: InstanceCtx): Promise<InstanceView> {
    const p = createInstanceSchema.safeParse(input);
    if (!p.success) throw new AppError('INSTANCE_INVALID', p.error.issues[0]?.message ?? 'Некорректные данные');
    const data: CreateInstanceInput = p.data;
    const root = await this.getRoot();
    await fs.mkdir(root, { recursive: true });

    let id: string;
    if (data.id) {
      if (await exists(path.join(root, data.id))) throw new AppError('INSTANCE_EXISTS', `Папка «${data.id}» уже существует`);
      id = data.id;
    } else {
      id = await this.uniqueId(root, slugify(data.name));
    }
    if (data.loader.type !== 'vanilla' && !data.loader.version) {
      throw new AppError('INSTANCE_INVALID', 'Выбери версию загрузчика');
    }
    const meta: InstanceMeta = {
      schemaVersion: 1, id, name: data.name, description: data.description, mcVersion: data.mcVersion,
      loader: { type: data.loader.type as LoaderType, version: data.loader.type === 'vanilla' ? null : data.loader.version },
      kind: data.kind, versionId: null, installed: false, createdAt: new Date().toISOString(), lastPlayedAt: null,
      coverColor: data.coverColor, coverFile: null, settings: data.settings,
    };
    const dir = resolveInside(root, id);
    const gameDir = path.join(dir, '.minecraft');
    for (const sub of ['mods', 'config', 'saves', 'resourcepacks']) await fs.mkdir(path.join(gameDir, sub), { recursive: true });
    await this.writeMeta(meta);
    return this.toView(meta, ctx);
  }

  async update(id: string, patch: unknown, ctx: InstanceCtx): Promise<InstanceView> {
    const p = updateInstanceSchema.safeParse(patch);
    if (!p.success) throw new AppError('INSTANCE_INVALID', p.error.issues[0]?.message ?? 'Некорректные данные');
    const upd: UpdateInstanceInput = p.data;
    const meta = await this.readMeta(id);
    if (upd.name !== undefined) meta.name = upd.name;
    if (upd.description !== undefined) meta.description = upd.description;
    if (upd.kind !== undefined) meta.kind = upd.kind as InstanceKind;
    if (upd.coverColor !== undefined) meta.coverColor = upd.coverColor;
    if (upd.settings !== undefined) meta.settings = instanceSettingsSchema.parse(upd.settings);
    await this.writeMeta(meta);
    return this.toView(meta, ctx);
  }

  async patchInternal(id: string, patch: Partial<Pick<InstanceMeta, 'installed' | 'versionId' | 'lastPlayedAt' | 'coverFile'>>): Promise<void> {
    const meta = await this.readMeta(id);
    Object.assign(meta, patch);
    await this.writeMeta(meta);
  }

  async duplicate(id: string, name: string, ctx: InstanceCtx): Promise<InstanceView> {
    const trimmed = name.trim();
    if (!trimmed || trimmed.length > 48) throw new AppError('INSTANCE_INVALID', 'Название: от 1 до 48 символов');
    const src = await this.readMeta(id);
    const root = await this.getRoot();
    const newId = await this.uniqueId(root, slugify(trimmed));
    const from = await this.dir(id);
    const to = resolveInside(root, newId);
    await fs.cp(from, to, { recursive: true, errorOnExist: true });
    const meta: InstanceMeta = { ...src, id: newId, name: trimmed, createdAt: new Date().toISOString(), lastPlayedAt: null };
    await this.writeMeta(meta);
    return this.toView(meta, ctx);
  }

  async remove(id: string, confirm: boolean): Promise<void> {
    if (confirm !== true) throw new AppError('CONFIRM_REQUIRED', 'Удаление нужно подтвердить');
    const dir = await this.dir(id);
    if (!(await exists(path.join(dir, 'instance.json')))) throw new AppError('INSTANCE_NOT_FOUND', 'Инстанс не найден');
    await fs.rm(dir, { recursive: true, force: true });
  }

  async setCoverFromFile(id: string, source: string): Promise<void> {
    const ext = path.extname(source).toLowerCase();
    if (!COVER_EXT.has(ext)) throw new AppError('COVER_INVALID', 'Поддерживаются PNG, JPG и WebP');
    const st = await fs.stat(source);
    if (st.size > MAX_COVER_BYTES) throw new AppError('COVER_INVALID', 'Обложка не больше 1 МБ');
    const dir = await this.dir(id);
    const name = `cover${ext}`;
    await fs.copyFile(source, path.join(dir, name));
    await this.patchInternal(id, { coverFile: name });
  }
}
