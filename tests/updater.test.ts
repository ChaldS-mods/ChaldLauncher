import { createHash } from 'node:crypto';
import * as fsp from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { OpProgress } from '../src/shared/types';
import { fitWindowSize } from '../src/main/windowSize';
import { compareVersions, isOwnReleaseUrl, pickInstallerAsset, type ReleaseInfo } from '../src/main/update';
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
  let quit: number;
  let games: number;
  beforeEach(async () => { dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'chald-upd-')); events = []; ran = []; quit = 0; games = 0; });
  afterEach(async () => { await fsp.rm(dir, { recursive: true, force: true }); });

  const make = (over: Partial<UpdaterDeps> = {}, rel: ReleaseInfo = release()) =>
    new Updater({
      dir, version: '0.1.0', platform: 'win32', repo: async () => REPO,
      fetchRelease: async () => rel,
      download: async (spec) => { await fsp.mkdir(path.dirname(spec.dest), { recursive: true }); await fsp.writeFile(spec.dest, BYTES); spec.size && events.length; },
      emit: (p) => events.push(p), gamesRunning: () => games,
      runInstaller: async (f) => { ran.push(f); }, quit: () => { quit++; },
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
});
