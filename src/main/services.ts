import * as path from 'node:path';
import type { AppSettings, AuthState, DeviceCodeInfo, GameLogEvent, GameStatusEvent, OpProgress } from '../shared/types';
import type { IpcEvents } from '../shared/ipc';
import { AuthService, type SecretBox } from './auth';
import { sharedDirs, type SharedDirs } from './dirs';
import { DEFAULT_MS_CLIENT_ID } from './config';
import { AppError, isAbort } from './errors';
import { GameManager } from './launcher';
import { InstanceStore, type InstanceCtx } from './instances';
import { installVersion } from './installer';
import { downloadFile } from './download';
import { exportInstance, inspectPack, installedIndexFor, packToPlan, type ChaldPack, type ExportResult, type PackSummary } from './chaldpack';
import { randomBytes } from 'node:crypto';
import { writeJsonAtomic } from './storage';
import {
  ModrinthApi, downloadPackFiles, extractOverrides, pickVersion, planInstall, planPack, primaryFile, readMrpackIndex, runInstallPlan,
} from './modrinth';
import { safeFileName } from './paths';
import { SettingsStore } from './settings';
import { WardrobeService } from './wardrobe';
import { VersionCatalog } from './versions';

export interface ServicesOptions {
  dataDir: string;
  appVersion: string;
  box: SecretBox;
  emit: <K extends keyof IpcEvents>(channel: K, payload: IpcEvents[K]) => void;
  openExternal: (url: string) => void;
}

export class Services {
  readonly dirs: SharedDirs;
  readonly settings: SettingsStore;
  readonly catalog: VersionCatalog;
  readonly instances: InstanceStore;
  readonly auth: AuthService;
  readonly games: GameManager;
  readonly wardrobe: WardrobeService;
  readonly installs = new Map<string, AbortController>();
  readonly packs = new Map<string, AbortController>();
  readonly modrinth: ModrinthApi;
  /** .chaldlauncher files the user picked and we validated, waiting for the confirmation click */
  private pendingPacks = new Map<string, { file: string; manifest: ChaldPack }>();
  /** Sync copy of settings for places that cannot await (window close handler). */
  closeBehavior: AppSettings['closeBehavior'] = 'quit';

  constructor(private o: ServicesOptions) {
    this.dirs = sharedDirs(o.dataDir);
    this.modrinth = new ModrinthApi(`ChaldStudio/ChaldLauncher/${o.appVersion} (Minecraft launcher)`);
    this.settings = new SettingsStore(path.join(o.dataDir, 'settings.json'));
    this.catalog = new VersionCatalog(path.join(o.dataDir, 'cache', 'version_manifest.json'));
    this.instances = new InstanceStore(() => this.instancesRoot(), this.dirs.versions);
    this.auth = new AuthService(
      path.join(o.dataDir, 'auth.bin'),
      o.box,
      async () => {
        const s = await this.settings.get();
        return { mode: s.accountMode, offlineName: s.offlineName, msClientId: DEFAULT_MS_CLIENT_ID };
      },
      async (patch) => {
        await this.settings.set({
          ...(patch.mode ? { accountMode: patch.mode } : {}),
          ...(patch.offlineName !== undefined ? { offlineName: patch.offlineName } : {}),
        });
      },
      (c: DeviceCodeInfo) => o.emit('auth:deviceCode', c),
      o.openExternal,
      (s: AuthState) => o.emit('auth:changed', s),
    );
    this.wardrobe = new WardrobeService(path.join(o.dataDir, 'wardrobe'), {
      getToken: async () => {
        const st = await this.auth.state();
        if (st.mode !== 'microsoft' || !st.loggedIn) throw new AppError('WARDROBE_NEEDS_MS', 'Скин на аккаунте можно менять только после входа через Microsoft (офлайн-режим скин не поддерживает).');
        return (await this.auth.getLaunchAuth()).accessToken;
      },
    });
    this.games = new GameManager({
      dirs: this.dirs,
      instances: this.instances,
      auth: this.auth,
      getSettings: () => this.settings.get(),
      launcherVersion: o.appVersion,
      onProgress: (p: OpProgress) => o.emit('op:progress', p),
      onStatus: (e: GameStatusEvent) => o.emit('game:status', e),
      onLog: (e: GameLogEvent) => o.emit('game:log', e),
    });
  }

  async init(): Promise<void> {
    this.closeBehavior = (await this.settings.get()).closeBehavior;
  }

  async instancesRoot(): Promise<string> {
    const s = await this.settings.get();
    return s.instancesDir || path.join(this.o.dataDir, 'instances');
  }

  emitProgress(p: OpProgress): void {
    this.o.emit('op:progress', p);
  }

  ctx(): InstanceCtx {
    return { running: this.games.activeIds(), installing: new Set(this.installs.keys()) };
  }

  /** Starts installing (or repairing) an instance in the background; progress goes out as op:progress events. */
  startInstall(id: string): void {
    if (this.installs.has(id)) throw new AppError('ALREADY_INSTALLING', 'Установка уже идёт');
    if (this.games.activeIds().has(id)) throw new AppError('ALREADY_RUNNING', 'Останови игру перед установкой');
    const ac = new AbortController();
    this.installs.set(id, ac);
    const opId = `install:${id}`;
    const emit = (label: string, fraction: number | null, status: OpProgress['status'] = 'running', message: string | null = null) =>
      this.o.emit('op:progress', { opId, kind: 'install', instanceId: id, label, fraction, status, message });
    emit('Подготовка…', null);

    void (async () => {
      try {
        const meta = await this.instances.readMeta(id);
        const settings = await this.settings.get();
        const { versionId } = await installVersion(
          { mcVersion: meta.mcVersion, loader: meta.loader },
          this.dirs, this.catalog, (p) => emit(p.label, p.fraction), ac.signal,
          { javaFor: (major) => this.games.ensureJava(meta.settings.javaPath || settings.javaPath, major, (l, f) => emit(l, f), ac.signal) },
        );
        await this.instances.patchInternal(id, { installed: true, versionId });
        this.installs.delete(id);
        emit('Установка завершена', 1, 'done');
      } catch (e) {
        this.installs.delete(id);
        if (isAbort(e) || ac.signal.aborted) emit('Установка отменена', null, 'cancelled');
        else emit('Ошибка установки', null, 'error', e instanceof Error ? e.message : String(e));
      }
    })();
  }

  cancelInstall(id: string): void {
    this.installs.get(id)?.abort();
  }

  /** Installs a mod or resource pack (and the required dependencies of a mod) into an instance. Returns the file names. */
  async installFromModrinth(id: string, projectId: string, kind: 'mod' | 'resourcepack', versionId?: string | null): Promise<string[]> {
    if (this.games.activeIds().has(id)) throw new AppError('BUSY', 'Останови игру, чтобы менять файлы');
    if (this.installs.has(id)) throw new AppError('BUSY', 'Идёт установка инстанса: изменение файлов недоступно');
    const meta = await this.instances.readMeta(id);
    const gameDir = await this.instances.gameDir(id);
    const target = { gameDir, mcVersion: meta.mcVersion, loader: meta.loader.type, kind };
    const opId = `modrinth:${id}:${projectId}`;
    const emit = (label: string, fraction: number | null, status: OpProgress['status'] = 'running', message: string | null = null) =>
      this.o.emit('op:progress', { opId, kind: 'install', instanceId: id, label, fraction, status, message });
    emit('Ищу подходящую версию…', null);
    try {
      const plan = await planInstall(this.modrinth, target, projectId, undefined, versionId);
      const names = await runInstallPlan(gameDir, kind, plan, (l, f) => emit(l, f));
      emit('Установлено', 1, 'done');
      return names;
    } catch (e) {
      emit('Установка прервана', null, 'cancelled'); // the caller shows the error
      throw e;
    }
  }

  /** Downloads a .mrpack, creates an instance from it, fills it and starts installing Minecraft + the loader. */
  startModpack(projectId: string, versionId?: string | null): void {
    if (this.packs.has(projectId)) throw new AppError('ALREADY_INSTALLING', 'Эта сборка уже устанавливается');
    const ac = new AbortController();
    this.packs.set(projectId, ac);
    const opId = `modpack:${projectId}`;
    let instanceId: string | null = null;
    let title = 'Сборка';
    const emit = (label: string, fraction: number | null, status: OpProgress['status'] = 'running', message: string | null = null) =>
      this.o.emit('op:progress', { opId, kind: 'modpack', instanceId, label, fraction, status, message });
    emit('Загружаю сведения о сборке…', null);

    void (async () => {
      try {
        const project = await this.modrinth.project(projectId, ac.signal);
        title = project.title;
        const version = versionId ? await this.modrinth.version(versionId, ac.signal) : pickVersion(await this.modrinth.versions(projectId, {}, ac.signal));
        if (!version) throw new AppError('NO_COMPATIBLE_VERSION', 'У сборки нет доступных версий');
        if (version.project_id !== projectId) throw new AppError('MODRINTH_FORMAT', 'Эта версия относится к другому проекту');
        const file = primaryFile(version);
        if (!file.filename.toLowerCase().endsWith('.mrpack')) throw new AppError('PACK_INVALID', 'Это не файл сборки Modrinth (.mrpack)');

        const packFile = path.join(this.dirs.root, 'cache', 'modpacks', safeFileName(`${project.id}-${version.id}.mrpack`));
        emit(`Скачиваю сборку «${title}»…`, null);
        await downloadFile({ url: file.url, dest: packFile, sha1: file.hashes.sha1, size: file.size, purpose: 'Сборка Modrinth' }, { signal: ac.signal });

        const plan = planPack(readMrpackIndex(packFile));
        const hash = [...project.id].reduce((a, c) => (a + c.charCodeAt(0)) % 8, 0);
        const inst = await this.instances.create({
          name: title.slice(0, 48),
          description: project.description.slice(0, 120),
          mcVersion: plan.mcVersion,
          loader: plan.loader,
          kind: 'custom',
          coverColor: hash,
          settings: { javaPath: '', memoryMinMb: null, memoryMaxMb: null, jvmArgs: '', width: null, height: null, fullscreen: null },
        }, this.ctx());
        instanceId = inst.id;

        const gameDir = await this.instances.gameDir(inst.id);
        await downloadPackFiles(plan, gameDir, (l, f) => emit(l, f * 0.9), ac.signal);
        emit('Копирую настройки сборки…', 0.95);
        await extractOverrides(packFile, gameDir, ac.signal);

        this.packs.delete(projectId);
        emit(`Сборка «${title}» добавлена. Устанавливаю Minecraft…`, 1, 'done');
        this.startInstall(inst.id);
      } catch (e) {
        this.packs.delete(projectId);
        if (instanceId) await this.instances.remove(instanceId, true).catch(() => undefined);
        instanceId = null;
        if (isAbort(e) || ac.signal.aborted) emit('Установка сборки отменена', null, 'cancelled');
        else emit(`Не удалось установить «${title}»`, null, 'error', e instanceof Error ? e.message : String(e));
      }
    })();
  }

  /** Validates a picked .chaldlauncher file and remembers it under a token; nothing is written yet. */
  inspectChaldPack(file: string): { token: string; summary: PackSummary } {
    const { manifest, summary } = inspectPack(file);
    if (this.pendingPacks.size >= 5) this.pendingPacks.delete(this.pendingPacks.keys().next().value!);
    const token = randomBytes(8).toString('hex');
    this.pendingPacks.set(token, { file, manifest });
    return { token, summary };
  }

  /** Creates an instance from a confirmed .chaldlauncher file: downloads the Modrinth files, unpacks the rest, installs Minecraft. */
  startChaldPack(token: string): void {
    const pending = this.pendingPacks.get(token);
    if (!pending) throw new AppError('PACK_EXPIRED', 'Файл нужно выбрать заново');
    this.pendingPacks.delete(token);
    const { file, manifest } = pending;
    const key = `chald:${token}`;
    const ac = new AbortController();
    this.packs.set(key, ac);
    const opId = `modpack:${key}`;
    let instanceId: string | null = null;
    const emit = (label: string, fraction: number | null, status: OpProgress['status'] = 'running', message: string | null = null) =>
      this.o.emit('op:progress', { opId, kind: 'modpack', instanceId, label, fraction, status, message });
    emit(`Импорт «${manifest.name}»…`, null);

    void (async () => {
      try {
        const { manifest: m } = inspectPack(file); // read again: the file may have changed since the preview
        const inst = await this.instances.create({
          name: m.name, description: m.description, mcVersion: m.mcVersion, loader: m.loader, kind: m.kind, coverColor: m.coverColor,
          settings: { javaPath: '', memoryMinMb: null, memoryMaxMb: null, jvmArgs: '', width: null, height: null, fullscreen: null },
        }, this.ctx());
        instanceId = inst.id;
        const gameDir = await this.instances.gameDir(inst.id);
        await downloadPackFiles(packToPlan(m), gameDir, (l, f) => emit(l, f * 0.85), ac.signal);
        emit('Копирую файлы из архива…', 0.9);
        await extractOverrides(file, gameDir, ac.signal);
        await writeJsonAtomic(path.join(gameDir, '.chald-modrinth.json'), installedIndexFor(m));
        this.packs.delete(key);
        emit(`Инстанс «${m.name}» импортирован. Устанавливаю Minecraft…`, 1, 'done');
        this.startInstall(inst.id);
      } catch (e) {
        this.packs.delete(key);
        if (instanceId) await this.instances.remove(instanceId, true).catch(() => undefined);
        instanceId = null;
        if (isAbort(e) || ac.signal.aborted) emit('Импорт отменён', null, 'cancelled');
        else emit(`Не удалось импортировать «${manifest.name}»`, null, 'error', e instanceof Error ? e.message : String(e));
      }
    })();
  }

  /** Writes the instance as a .chaldlauncher file. Modrinth files are only listed (checked against Modrinth), the rest is packed. */
  async exportChaldPack(id: string, out: string, includeWorlds: boolean): Promise<ExportResult> {
    if (this.installs.has(id)) throw new AppError('BUSY', 'Идёт установка инстанса: подожди её окончания');
    if (includeWorlds && this.games.activeIds().has(id)) throw new AppError('BUSY', 'Останови игру, чтобы экспортировать миры');
    const meta = await this.instances.readMeta(id);
    const gameDir = await this.instances.gameDir(id);
    return exportInstance({ gameDir, meta, includeWorlds, out, api: this.modrinth, report: () => undefined });
  }

  /** Opens the project page on modrinth.com in the system browser. */
  openModrinthPage(type: 'mod' | 'modpack' | 'resourcepack', slug: string): void {
    if (!/^[A-Za-z0-9_-]{1,64}$/.test(slug)) throw new AppError('BAD_ARGUMENT', 'Некорректная ссылка на проект');
    this.o.openExternal(`https://modrinth.com/${type}/${slug}`);
  }

  cancelModpack(projectId: string): void {
    this.packs.get(projectId)?.abort();
  }
}
