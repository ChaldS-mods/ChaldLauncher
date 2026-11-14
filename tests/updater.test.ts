import { createHash } from 'node:crypto';
import * as fsp from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { OpProgress } from '../src/shared/types';
import { fitWindowSize } from '../src/main/windowSize';
import { compareVersions, isNoReleaseError, isOwnReleaseUrl, pickInstallerAsset, type ReleaseInfo } from '../src/main/update';
import { AppError } from '../src/main/errors';
import { Updater, type UpdaterDeps } from '../src/main/updater';
import { appSettingsSchema } from '../src/shared/schemas';
import { DEFAULT_SETTINGS } from '../src/main/settings';

const BYTES = Buffer.from('fake installer bytes '.repeat(50));
const SHA = createHash('sha256').update(BYTES).digest('hex');
const REPO = 'ChaldS-mods/ChaldLauncher';
const URL_OK = `https://github.com/${REPO}/releases/download/v0.2.0/ChaldLauncher-Setup.exe`;

function release(over: Partial<ReleaseInfo> = {}): ReleaseInfo {
  return {
    version: '0.2.0', pageUrl: `https://github.com/${REPO}/releases/tag/v0.2.0`,
    assets: [
      { name: 'ChaldLauncher-Setup.exe.blockmap', size: 5, url: URL_OK + '.blockmap', sha256: null },
      { name: 'ChaldLauncher-Setup.exe', size: BYTES.length, url: URL_OK, sha256: SHA },
    ],
    ...over,
  };
}

describe('update helpers', () => {
  it('compares versions', () => {
    expect(compareVersions('v0.2.0', '0.1.9')).toBe(1);
    expect(compareVersions('0.1.0', '0.1')).toBe(0);
    expect(compareVersions('0.1.0', '0.10.0')).toBe(-1);
  });
  it('picks the Windows installer and nothing on other systems', () => {
    expect(pickInstallerAsset(release().assets, 'win32')?.name).toBe('ChaldLauncher-Setup.exe');
    expect(pickInstallerAsset(release().assets, 'linux')).toBeNull();
    expect(pickInstallerAsset([{ name: 'ChaldLauncher-portable.exe', size: 1, url: '', sha256: null }], 'win32')).toBeNull();
  });
  it('on Linux picks the AppImage of the right architecture, and only when running from an AppImage', () => {
    const assets = [
      { name: 'ChaldLauncher-0.2.0-linux-x64.tar.gz', size: 1, url: '', sha256: null },
      { name: 'ChaldLauncher-0.2.0-linux-arm64.AppImage', size: 2, url: '', sha256: null },
      { name: 'ChaldLauncher-0.2.0-linux-x64.AppImage.zsync', size: 3, url: '', sha256: null },
      { name: 'ChaldLauncher-0.2.0-linux-x64.AppImage', size: 4, url: '', sha256: null },
    ];
    expect(pickInstallerAsset(assets, 'linux', { appImage: true, arch: 'x64' })?.size).toBe(4);
    expect(pickInstallerAsset(assets, 'linux', { appImage: true, arch: 'arm64' })?.size).toBe(2);
    expect(pickInstallerAsset(assets, 'linux', { appImage: false, arch: 'x64' })).toBeNull(); // tar.gz / distro package: no self-replace
    expect(pickInstallerAsset(assets, 'linux')).toBeNull();
    expect(pickInstallerAsset(assets, 'darwin', { appImage: true })).toBeNull();
  });
  it('accepts only files of the repository releases', () => {
    expect(isOwnReleaseUrl(URL_OK, REPO)).toBe(true);
    expect(isOwnReleaseUrl(URL_OK, 'someone/else')).toBe(false);
    expect(isOwnReleaseUrl('http://github.com/' + REPO + '/releases/download/x/a.exe', REPO)).toBe(false);
    expect(isOwnReleaseUrl('https://evil.example/' + REPO + '/releases/download/x/a.exe', REPO)).toBe(false);
    expect(isOwnReleaseUrl('not a url', REPO)).toBe(false);
  });
  it('new settings are valid by default and the volume is bounded', () => {
    expect(appSettingsSchema.safeParse(DEFAULT_SETTINGS).success).toBe(true);
    expect(DEFAULT_SETTINGS.uiSounds && DEFAULT_SETTINGS.autoDownloadUpdates).toBe(true);
    expect(appSettingsSchema.safeParse({ ...DEFAULT_SETTINGS, soundVolume: 101 }).success).toBe(false);
  });
});

describe('fitWindowSize', () => {
  it('keeps the normal size on a big screen', () => {
    expect(fitWindowSize({ width: 1920, height: 1040 })).toEqual({ width: 1280, height: 780, minWidth: 1040, minHeight: 660 });
  });
  it('shrinks to a small screen (1366x728 work area, 1280x600 at 150% scaling)', () => {
    expect(fitWindowSize({ width: 1366, height: 728 })).toMatchObject({ width: 1280, height: 728, minHeight: 660 });
    expect(fitWindowSize({ width: 1280, height: 600 })).toMatchObject({ width: 1280, height: 600, minHeight: 600 });
    expect(fitWindowSize({ width: 1000, height: 560 })).toEqual({ width: 1000, height: 560, minWidth: 1000, minHeight: 560 });
  });
});

describe('Updater', () => {
  let dir: string;
  let events: OpProgress[];
  let ran: string[];
  let launches: boolean[];
  let quit: number;
  let games: number;
  beforeEach(async () => { dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'chald-upd-')); events = []; ran = []; launches = []; quit = 0; games = 0; });
  afterEach(async () => { await fsp.rm(dir, { recursive: true, force: true }); });

  const make = (over: Partial<UpdaterDeps> = {}, rel: ReleaseInfo = release()) =>
    new Updater({
      dir, version: '0.1.0', platform: 'win32', repo: async () => REPO,
      fetchRelease: async () => rel,
      download: async (spec) => { await fsp.mkdir(path.dirname(spec.dest), { recursive: true }); await fsp.writeFile(spec.dest, BYTES); spec.size && events.length; },
      emit: (p) => events.push(p), gamesRunning: () => games,
      runInstaller: async (f, o) => { ran.push(f); launches.push(o.launch); }, quit: () => { quit++; },
      ...over,
    });
  const settle = async (u: Updater) => { for (let i = 0; i < 50 && !events.some((e) => e.status !== 'running'); i++) await new Promise((r) => setTimeout(r, 10)); return u; };

  it('no new version: nothing to download', async () => {
    const info = await make({ version: '0.2.0' }).check();
    expect(info).toMatchObject({ hasUpdate: false, assetName: null, downloaded: false });
  });

  it('check -> download -> verified -> install runs the installer once and quits', async () => {
    const u = make();
    const before = await u.check();
    expect(before).toMatchObject({ hasUpdate: true, latest: '0.2.0', assetName: 'ChaldLauncher-Setup.exe', downloaded: false });
    await u.start();
    await settle(u);
    expect(events[0]).toMatchObject({ kind: 'update', status: 'running', opId: 'update:0.2.0' });
    expect(events.at(-1)).toMatchObject({ status: 'done', fraction: 1 });
    expect((await u.check()).downloaded).toBe(true);
    await u.install();
    expect(ran).toHaveLength(1);
    expect(ran[0]).toBe(path.join(dir, '0.2.0', 'ChaldLauncher-Setup.exe'));
    await new Promise((r) => setTimeout(r, 450));
    expect(quit).toBe(1);
  });

  it('a download that does not match the SHA-256 is not ready and is not run', async () => {
    const u = make({ download: async (spec) => { await fsp.mkdir(path.dirname(spec.dest), { recursive: true }); await fsp.writeFile(spec.dest, Buffer.alloc(BYTES.length, 1)); } });
    await u.check();
    await u.start();
    await settle(u);
    expect((await u.check()).downloaded).toBe(false);
    await expect(u.install()).rejects.toMatchObject({ code: 'UPDATE_NOT_READY' });
    expect(ran).toHaveLength(0);
  });

  it('does not install while a game is running', async () => {
    const u = make();
    await u.check(); await u.start(); await settle(u);
    games = 1;
    await expect(u.install()).rejects.toMatchObject({ code: 'UPDATE_GAME_RUNNING' });
    expect(ran).toHaveLength(0);
    expect(quit).toBe(0);
  });

  it('refuses a file that is not from the repository releases', async () => {
    const bad = release({ assets: [{ name: 'ChaldLauncher-Setup.exe', size: 10, url: 'https://github.com/evil/x/releases/download/v1/a.exe', sha256: null }] });
    const u = make({}, bad);
    await u.check();
    await expect(u.start()).rejects.toMatchObject({ code: 'UPDATE_BAD_URL' });
    expect(events).toHaveLength(0);
  });

  it('a failed download is reported as an error, and old versions are removed on the next one', async () => {
    await fsp.mkdir(path.join(dir, '0.0.9'), { recursive: true });
    await fsp.writeFile(path.join(dir, '0.0.9', 'old.exe'), 'x');
    const u = make({ download: async () => { throw new Error('нет сети'); } });
    await u.check(); await u.start(); await settle(u);
    expect(events.at(-1)).toMatchObject({ status: 'error', message: 'нет сети' });
    await expect(fsp.stat(path.join(dir, '0.0.9'))).rejects.toThrow();
  });

  it('on Linux there is no automatic download', async () => {
    const u = make({ platform: 'linux' });
    expect((await u.check()).assetName).toBeNull();
    await expect(u.start()).rejects.toMatchObject({ code: 'UPDATE_NO_FILE' });
  });

  describe('AppImage (Linux)', () => {
    const IMG_URL = `https://github.com/${REPO}/releases/download/v0.2.0/ChaldLauncher-0.2.0-linux-x64.AppImage`;
    const imgRelease = () => release({ assets: [
      { name: 'ChaldLauncher-0.2.0-linux-x64.tar.gz', size: 9, url: IMG_URL.replace('AppImage', 'tar.gz'), sha256: null },
      { name: 'ChaldLauncher-0.2.0-linux-x64.AppImage', size: BYTES.length, url: IMG_URL, sha256: SHA },
    ] });
    it('downloads the AppImage and applies it with a relaunch', async () => {
      const u = make({ platform: 'linux', appImage: '/home/u/.local/share/ChaldLauncher/ChaldLauncher.AppImage', arch: 'x64' }, imgRelease());
      expect(await u.check()).toMatchObject({ hasUpdate: true, assetName: 'ChaldLauncher-0.2.0-linux-x64.AppImage' });
      await u.start(); await settle(u);
      expect(events.at(-1)).toMatchObject({ status: 'done' });
      await u.install();
      expect(ran).toEqual([path.join(dir, '0.2.0', 'ChaldLauncher-0.2.0-linux-x64.AppImage')]);
      expect(launches).toEqual([true]);
      await new Promise((r) => setTimeout(r, 450)); // install() closes the launcher after a short delay
      expect(quit).toBe(1);
    });
    it('a tar.gz install (no APPIMAGE) still gets no automatic update', async () => {
      const u = make({ platform: 'linux', appImage: null, arch: 'x64' }, imgRelease());
      expect(await u.check()).toMatchObject({ hasUpdate: true, assetName: null });
    });
  });

  describe('install when the launcher is closed', () => {
    const ready = async (over: Partial<UpdaterDeps> = {}) => {
      const u = make({ autoInstall: async () => true, ...over });
      await u.check(); await u.start(); await settle(u);
      return u;
    };
    it('applies a verified update once, without relaunching, and without scheduling a quit of its own', async () => {
      const u = await ready();
      expect(await u.installOnQuit()).toBe(true);
      expect(await u.installOnQuit()).toBe(false); // already applied: never twice
      expect(ran).toEqual([path.join(dir, '0.2.0', 'ChaldLauncher-Setup.exe')]);
      expect(launches).toEqual([false]);
      await new Promise((r) => setTimeout(r, 450));
      expect(quit).toBe(0);
    });
    it('says in the toast that the update installs on close', async () => {
      await ready();
      expect(events.at(-1)?.label).toContain('при закрытии');
    });
    it('does nothing when the user turned it off', async () => {
      expect(await (await ready({ autoInstall: async () => false })).installOnQuit()).toBe(false);
      expect(ran).toHaveLength(0);
    });
    it('does nothing while a game is running', async () => {
      const u = await ready();
      games = 1;
      expect(await u.installOnQuit()).toBe(false);
      expect(ran).toHaveLength(0);
    });
    it('does nothing when the file is not downloaded yet, or no check was made', async () => {
      const u = make({ autoInstall: async () => true });
      await u.check(); // found, but nothing on disk
      expect(await u.installOnQuit()).toBe(false);
      expect(await make({ autoInstall: async () => true }).installOnQuit()).toBe(false);
      expect(ran).toHaveLength(0);
    });
    it('never throws and does not block closing when the installer cannot start', async () => {
      const u = await ready({ runInstaller: async () => { throw new AppError('UPDATE_RUN_FAILED', 'boom'); } });
      await expect(u.installOnQuit()).resolves.toBe(false);
    });
    it('ignores a release that is not newer than the running launcher', async () => {
      const u = make({ version: '0.2.0', autoInstall: async () => true });
      await u.check();
      await fsp.mkdir(path.join(dir, '0.2.0'), { recursive: true });
      await fsp.writeFile(path.join(dir, '0.2.0', 'ChaldLauncher-Setup.exe'), BYTES); // even a valid file lying around
      expect(await u.installOnQuit()).toBe(false);
      expect(ran).toHaveLength(0);
    });
  });

  describe('repository without releases', () => {
    it('is "nothing to update to", not an error', async () => {
      const u = make({ fetchRelease: async () => { throw new AppError('HTTP_ERROR', 'HTTP 404 от api.github.com'); } });
      expect(await u.check()).toMatchObject({ configured: true, latest: null, hasUpdate: false, downloaded: false });
      await expect(u.start()).rejects.toMatchObject({ code: 'UPDATE_NO_FILE' });
    });
    it('other failures are still reported', async () => {
      const u = make({ fetchRelease: async () => { throw new AppError('HTTP_ERROR', 'HTTP 500 от api.github.com'); } });
      await expect(u.check()).rejects.toThrow('HTTP 500');
      expect(isNoReleaseError(new Error('HTTP 404 от api.github.com'))).toBe(true);
      expect(isNoReleaseError(new Error('HTTP 4040 от x'))).toBe(false);
    });
  });
});
