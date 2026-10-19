import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { AuthService, type AccountConfig } from '../src/main/auth';
import { buildLaunchCommand, redact, type LaunchInput } from '../src/main/launchArgs';
import { offlineUuid } from '../src/main/offline';
import { offlineNameSchema } from '../src/shared/schemas';
import { SettingsStore } from '../src/main/settings';
import type { VersionJson } from '../src/main/versionJson';

let tmp: string;
beforeEach(async () => { tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'chald-o-')); });
afterEach(async () => fs.rm(tmp, { recursive: true, force: true }));

const box = { isEncryptionAvailable: () => false, encryptString: () => Buffer.alloc(0), decryptString: () => '' };

function service(cfg: AccountConfig) {
  const saved: Partial<AccountConfig>[] = [];
  const svc = new AuthService(
    path.join(tmp, 'auth.bin'), box, async () => cfg,
    async (p) => { saved.push(p); Object.assign(cfg, p); },
    () => undefined, () => undefined, () => undefined,
  );
  return { svc, saved, cfg };
}

describe('offlineUuid', () => {
  it('matches the reference UUIDs a vanilla server derives from "OfflinePlayer:<name>"', () => {
    // UUID.nameUUIDFromBytes("OfflinePlayer:Steve") and "…:Notch" as seen on offline-mode servers
    expect(offlineUuid('Steve')).toBe('5627dd98-e6be-3c21-b8a8-e92344183641');
    expect(offlineUuid('Notch')).toBe('b50ad385-829d-3141-a216-7e7d7539ba7f');
  });
  it('is version 3, variant 1 and case sensitive', () => {
    const u = offlineUuid('Steve');
    expect(u[14]).toBe('3');
    expect('89ab').toContain(u[19]!);
    expect(offlineUuid('steve')).not.toBe(u);
  });
});

describe('offline nickname', () => {
  it('accepts 3-16 chars of A-Za-z0-9_', () => {
    for (const ok of ['Steve', 'abc', 'A_b_9', 'a'.repeat(16)]) expect(offlineNameSchema.safeParse(ok).success).toBe(true);
  });
  it('rejects everything else', () => {
    for (const bad of ['', 'ab', 'a'.repeat(17), 'Ste ve', 'Стив', 'a-b', 'a.b', 'a\n', ' Steve', '../x', 'ste§'])
      expect(offlineNameSchema.safeParse(bad).success, JSON.stringify(bad)).toBe(false);
  });
  it('AuthService.setOffline rejects invalid names and saves nothing', async () => {
    const { svc, saved } = service({ mode: 'microsoft', offlineName: '', msClientId: '' });
    await expect(svc.setOffline('x')).rejects.toThrow();
    await expect(svc.setOffline('bad name')).rejects.toThrow();
    expect(saved).toEqual([]);
  });
  it('settings schema rejects a bad offlineName and unknown mode', async () => {
    const s = new SettingsStore(path.join(tmp, 'settings.json'));
    await expect(s.set({ offlineName: 'a b' })).rejects.toThrow();
    await expect(s.set({ accountMode: 'cracked' })).rejects.toThrow();
    await s.set({ accountMode: 'offline', offlineName: 'Steve' });
    expect(await new SettingsStore(path.join(tmp, 'settings.json')).get()).toMatchObject({ accountMode: 'offline', offlineName: 'Steve' });
  });
});

describe('AuthService offline mode', () => {
  it('getLaunchAuth returns offline data: UUID v3, token "0", legacy type, no network', async () => {
    const { svc } = service({ mode: 'offline', offlineName: 'Steve', msClientId: '' });
    expect(await svc.getLaunchAuth()).toEqual({
      name: 'Steve', uuid: '5627dd98-e6be-3c21-b8a8-e92344183641', accessToken: '0', userType: 'legacy',
    });
  });
  it('state reports the offline mode honestly', async () => {
    const { svc } = service({ mode: 'offline', offlineName: 'Steve', msClientId: '' });
    expect(await svc.state()).toMatchObject({ mode: 'offline', loggedIn: true, name: 'Steve', configured: false });
  });
  it('without a valid nickname launch is refused', async () => {
    const { svc } = service({ mode: 'offline', offlineName: '', msClientId: '' });
    expect(await svc.state()).toMatchObject({ mode: 'offline', loggedIn: false, name: null });
    await expect(svc.getLaunchAuth()).rejects.toMatchObject({ code: 'AUTH_REQUIRED' });
  });
  it('setOffline switches the mode and stores the nickname', async () => {
    const { svc, cfg } = service({ mode: 'microsoft', offlineName: '', msClientId: '' });
    const st = await svc.setOffline('Alex_1');
    expect(cfg).toMatchObject({ mode: 'offline', offlineName: 'Alex_1' });
    expect(st).toMatchObject({ mode: 'offline', loggedIn: true, uuid: offlineUuid('Alex_1') });
  });
  it('Microsoft mode without a Client ID does not pretend: login explains, launch needs sign-in', async () => {
    const { svc } = service({ mode: 'microsoft', offlineName: 'Steve', msClientId: '' });
    await expect(svc.login()).rejects.toMatchObject({ code: 'AUTH_NOT_CONFIGURED' });
    await expect(svc.getLaunchAuth()).rejects.toMatchObject({ code: 'AUTH_REQUIRED' });
    expect(await svc.state()).toMatchObject({ mode: 'microsoft', loggedIn: false, configured: false });
  });
});

describe('launchArgs with offline data', () => {
  const v: VersionJson = {
    id: '1.21.1', type: 'release', mainClass: 'net.minecraft.client.main.Main', assetIndex: { id: '17', url: 'u', sha1: 's', size: 1 }, assets: '17',
    downloads: { client: { url: 'c', sha1: 'x', size: 5 } }, libraries: [],
    arguments: {
      jvm: ['-cp', '${classpath}'],
      game: ['--username', '${auth_player_name}', '--uuid', '${auth_uuid}', '--accessToken', '${auth_access_token}', '--userType', '${user_type}'],
    },
  };
  const input = (): LaunchInput => ({
    version: v, platform: { name: 'linux', arch: 'x64', version: '6' }, javaPath: '/j', gameDir: '/g', assetsDir: '/a', librariesDir: '/l', nativesDir: '/n',
    clientJar: '/c.jar', auth: { name: 'Steve', uuid: offlineUuid('Steve'), accessToken: '0', userType: 'legacy' },
    memoryMinMb: 512, memoryMaxMb: 1024, extraJvmArgs: [], resolution: null, fullscreen: false, launcherName: 'ChaldLauncher', launcherVersion: '0.1.0',
  });
  it('does not throw and passes token 0 with user type legacy', () => {
    const c = buildLaunchCommand(input());
    const a = c.args;
    expect(a[a.indexOf('--accessToken') + 1]).toBe('0');
    expect(a[a.indexOf('--userType') + 1]).toBe('legacy');
    expect(a[a.indexOf('--uuid') + 1]).toBe('5627dd98-e6be-3c21-b8a8-e92344183641');
  });
  it('does not treat the placeholder token as a secret (log stays readable)', () => {
    const c = buildLaunchCommand(input());
    expect(c.secrets).toEqual([]);
    expect(redact('-Xmx1024M 5627dd98', c.secrets)).toBe('-Xmx1024M 5627dd98');
  });
  it('Microsoft sessions default to msa and still redact the token', () => {
    const c = buildLaunchCommand({ ...input(), auth: { name: 'A', uuid: 'u', accessToken: 'REAL-LONG-TOKEN' } });
    expect(c.args[c.args.indexOf('--userType') + 1]).toBe('msa');
    expect(c.secrets).toEqual(['REAL-LONG-TOKEN']);
  });
});
