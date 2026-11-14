import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { relaunchEnv, replaceAppImage } from '../src/main/selfUpdate';

let tmp: string;
beforeEach(async () => { tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'chald-self-')); });
afterEach(async () => { await fs.chmod(tmp, 0o755).catch(() => undefined); await fs.rm(tmp, { recursive: true, force: true }); });

describe('replaceAppImage', () => {
  it('puts the new file over the old one, executable, and leaves nothing else behind', async () => {
    const target = path.join(tmp, 'ChaldLauncher.AppImage');
    const src = path.join(tmp, 'dl', 'ChaldLauncher-0.4.0-linux-x64.AppImage');
    await fs.mkdir(path.dirname(src));
    await fs.writeFile(target, 'old', { mode: 0o755 });
    await fs.writeFile(src, 'new version', { mode: 0o644 });
    await replaceAppImage(src, target);
    expect(await fs.readFile(target, 'utf8')).toBe('new version');
    expect((await fs.stat(target)).mode & 0o777).toBe(0o755);
    expect(await fs.readdir(tmp)).toEqual(expect.arrayContaining(['ChaldLauncher.AppImage', 'dl']));
    expect((await fs.readdir(tmp)).filter((n) => n.includes('.new-'))).toEqual([]);
    expect(await fs.readFile(src, 'utf8')).toBe('new version'); // the download is not consumed
  });

  it('refuses a target that is not an absolute path to an AppImage', async () => {
    const src = path.join(tmp, 'x.AppImage');
    await fs.writeFile(src, 'x');
    await expect(replaceAppImage(src, 'relative/Launcher.AppImage')).rejects.toMatchObject({ code: 'UPDATE_BAD_TARGET' });
    await expect(replaceAppImage(src, path.join(tmp, 'launcher.sh'))).rejects.toMatchObject({ code: 'UPDATE_BAD_TARGET' });
  });

  it('keeps the old launcher and cleans up when the new file cannot be copied', async () => {
    const target = path.join(tmp, 'ChaldLauncher.AppImage');
    await fs.writeFile(target, 'old');
    await expect(replaceAppImage(path.join(tmp, 'missing.AppImage'), target)).rejects.toThrow();
    expect(await fs.readFile(target, 'utf8')).toBe('old');
    expect((await fs.readdir(tmp)).filter((n) => n.includes('.new-'))).toEqual([]);
  });

  it.skipIf(process.getuid?.() === 0 || process.platform === 'win32')('reports a read-only folder in plain words', async () => {
    const dir = path.join(tmp, 'ro');
    await fs.mkdir(dir);
    const target = path.join(dir, 'ChaldLauncher.AppImage');
    const src = path.join(tmp, 'new.AppImage');
    await fs.writeFile(target, 'old');
    await fs.writeFile(src, 'new');
    await fs.chmod(dir, 0o555);
    await expect(replaceAppImage(src, target)).rejects.toMatchObject({ code: 'UPDATE_NO_WRITE' });
    await fs.chmod(dir, 0o755);
    expect(await fs.readFile(target, 'utf8')).toBe('old');
  });
});

describe('relaunchEnv', () => {
  it('drops what the running AppImage exported, keeps the rest', () => {
    const out = relaunchEnv({ APPIMAGE: '/a', APPDIR: '/b', ARGV0: 'c', OWD: '/d', HOME: '/home/u', PATH: '/bin' });
    expect(out).toEqual({ HOME: '/home/u', PATH: '/bin' });
  });
  it('does not change the original environment', () => {
    const env = { APPIMAGE: '/a' };
    relaunchEnv(env);
    expect(env).toEqual({ APPIMAGE: '/a' });
  });
});
