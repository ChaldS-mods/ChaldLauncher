import * as fsp from 'node:fs/promises';
import * as path from 'node:path';
import type { OpProgress, UpdateInfo } from '../shared/types';
import { downloadFile, isFileValid, type DownloadOptions, type DownloadSpec } from './download';
import { AppError, isAbort } from './errors';
import { safeFileName } from './paths';
import { fetchLatestRelease, isNoReleaseError, isOwnReleaseUrl, noReleasesYet, noUpdateSource, pickInstallerAsset, toUpdateInfo, type PickOptions, type ReleaseAsset, type ReleaseInfo } from './update';

export interface UpdaterDeps {
  /** <dataDir>/updates: one folder per version */
  dir: string;
  version: string;
  platform: string;
  /** owner/repo to look in */
  repo: () => Promise<string>;
  fetchRelease?: (repo: string) => Promise<ReleaseInfo>;
  download?: (spec: DownloadSpec, opts?: DownloadOptions) => Promise<void>;
  emit: (p: OpProgress) => void;
  gamesRunning: () => number;
  /** Linux: path of the AppImage the launcher runs from (process.env.APPIMAGE); empty = not an AppImage */
  appImage?: string | null;
  arch?: string;
  /** install a downloaded update by itself when the launcher is closed */
  autoInstall?: () => Promise<boolean>;
  /**
   * Applies the downloaded file (starts the installer / replaces the AppImage) and resolves once that is done.
   * launch: start the launcher again afterwards (false when the user is closing it anyway).
   */
  runInstaller: (file: string, opts: { launch: boolean }) => Promise<void>;
  quit: () => void;
}

interface Found { repo: string; release: ReleaseInfo; asset: ReleaseAsset | null }

/** Finds a new launcher version, downloads its installer in the background and starts it on request. */
export class Updater {
  private found: Found | null = null;
  private ac: AbortController | null = null;
  private applying = false;

  constructor(private d: UpdaterDeps) {}

  private get pick(): PickOptions {
    return { appImage: !!this.d.appImage, arch: this.d.arch };
  }

  private fileFor(f: Found): string {
    return path.join(this.d.dir, f.release.version, safeFileName(f.asset!.name));
  }

  private async downloaded(f: Found): Promise<boolean> {
    if (!f.asset) return false;
    return isFileValid(this.fileFor(f), { size: f.asset.size, sha256: f.asset.sha256 ?? undefined });
  }

  async check(): Promise<UpdateInfo> {
    const repo = await this.d.repo();
    if (!repo) return noUpdateSource(this.d.version);
    let release: ReleaseInfo;
    try {
      release = await (this.d.fetchRelease ?? fetchLatestRelease)(repo);
    } catch (e) {
      // a repository without a single release is normal at the start: not an error, just nothing to update to
      if (isNoReleaseError(e)) {
        this.found = null;
        return noReleasesYet(this.d.version);
      }
      throw e;
    }
    const asset = pickInstallerAsset(release.assets, this.d.platform, this.pick);
    this.found = { repo, release, asset };
    const info = toUpdateInfo(release, this.d.version, this.d.platform, { downloaded: false, downloading: this.ac !== null }, this.pick);
    if (info.hasUpdate && asset) info.downloaded = await this.downloaded(this.found);
    return info;
  }

  /** Starts the download and returns right away; progress goes out as op:progress (opId update:<version>). */
  async start(): Promise<void> {
    const f = this.found ?? (await this.check(), this.found);
    if (!f || !f.asset) throw new AppError('UPDATE_NO_FILE', 'Для этой версии нет файла установки: скачай обновление со страницы релиза.');
    if (toUpdateInfo(f.release, this.d.version, this.d.platform, { downloaded: false, downloading: false }, this.pick).hasUpdate === false) {
      throw new AppError('UPDATE_NONE', 'Новой версии нет');
    }
    if (this.ac) return;
    if (!isOwnReleaseUrl(f.asset.url, f.repo)) throw new AppError('UPDATE_BAD_URL', 'Файл обновления не из репозитория лаунчера: скачивание отменено.');
    const { asset } = f;
    const version = f.release.version;
    const file = this.fileFor(f);
    const opId = `update:${version}`;
    const emit = (label: string, fraction: number | null, status: OpProgress['status'] = 'running', message: string | null = null) =>
      this.d.emit({ opId, kind: 'update', instanceId: null, label, fraction, status, message });
    const ac = new AbortController();
    this.ac = ac;
    emit(`Скачиваю обновление ${version}…`, asset.size > 0 ? 0 : null);

    void (async () => {
      try {
        await this.dropOldVersions(version);
        let got = 0;
        await (this.d.download ?? downloadFile)(
          { url: asset.url, dest: file, size: asset.size || undefined, sha256: asset.sha256 ?? undefined, purpose: 'Скачивание обновления лаунчера' },
          {
            signal: ac.signal,
            onBytes: (n) => {
              got = Math.max(0, got + n);
              if (asset.size > 0) emit(`Скачиваю обновление ${version}…`, Math.min(1, got / asset.size));
            },
          },
        );
        this.ac = null;
        const onQuit = await (this.d.autoInstall?.() ?? Promise.resolve(false)).catch(() => false);
        emit(onQuit ? `Обновление ${version} скачано: установится при закрытии лаунчера` : `Обновление ${version} скачано`, 1, 'done');
      } catch (e) {
        this.ac = null;
        if (isAbort(e) || ac.signal.aborted) emit('Скачивание обновления отменено', null, 'cancelled');
        else emit('Не удалось скачать обновление', null, 'error', e instanceof Error ? e.message : String(e));
      }
    })();
  }

  cancel(): void {
    this.ac?.abort();
  }

  /** Applies the downloaded update (silently, the launcher starts again) and closes the launcher. */
  async install(): Promise<void> {
    const f = this.found;
    if (!f || !f.asset || !(await this.downloaded(f))) throw new AppError('UPDATE_NOT_READY', 'Обновление ещё не скачано');
    if (this.d.gamesRunning() > 0) throw new AppError('UPDATE_GAME_RUNNING', 'Сначала закрой игру: лаунчер перезапустится для обновления.');
    if (this.applying) return;
    this.applying = true;
    try {
      await this.d.runInstaller(this.fileFor(f), { launch: true }); // the file was just verified against size and SHA-256
    } catch (e) {
      this.applying = false;
      throw e;
    }
    setTimeout(() => this.d.quit(), 400);
  }

  /**
   * Called when the launcher is being closed: if a verified update is waiting and the user wants updates installed by
   * themselves, applies it now (without starting the launcher again). Returns true when something was applied.
   * Never throws: a failed update must not keep the launcher from closing.
   */
  async installOnQuit(): Promise<boolean> {
    try {
      const f = this.found;
      if (this.applying || !f || !f.asset) return false;
      if (!(await (this.d.autoInstall?.() ?? Promise.resolve(false)))) return false;
      if (toUpdateInfo(f.release, this.d.version, this.d.platform, { downloaded: false, downloading: false }, this.pick).hasUpdate === false) return false;
      if (this.ac || this.d.gamesRunning() > 0 || !(await this.downloaded(f))) return false;
      if (!isOwnReleaseUrl(f.asset.url, f.repo)) return false;
      this.applying = true;
      await this.d.runInstaller(this.fileFor(f), { launch: false });
      return true;
    } catch {
      this.applying = false;
      return false;
    }
  }

  private async dropOldVersions(keep: string): Promise<void> {
    let names: string[] = [];
    try { names = await fsp.readdir(this.d.dir); } catch { return; }
    await Promise.all(names.filter((n) => n !== keep).map((n) => fsp.rm(path.join(this.d.dir, n), { recursive: true, force: true }).catch(() => undefined)));
  }
}
