import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';

// All requests to Microsoft / Xbox / Minecraft go through netRequest: the tests decide what it answers.
const net = vi.hoisted(() => ({ netRequest: vi.fn() }));
vi.mock('../src/main/net', () => ({ netRequest: net.netRequest }));

import { AuthService, isLicenseServerDown, type AccountConfig } from '../src/main/auth';
import { AppError } from '../src/main/errors';
import { InstanceStore } from '../src/main/instances';
import { formatPlayTime } from '../src/renderer/util';

let tmp: string;
beforeEach(async () => { tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'chald-lf-')); net.netRequest.mockReset(); });
afterEach(async () => fs.rm(tmp, { recursive: true, force: true }));

const box = { isEncryptionAvailable: () => false, encryptString: () => Buffer.alloc(0), decryptString: () => '' };
const UUID = '069a79f4-44e9-4726-a5be-fca90e38aaf5';

/** A launcher that signed in with a licensed account earlier (refresh token + name + UUID are on disk). */
async function signedIn(over: Partial<{ refreshToken: string; name: string; uuid: string }> = {}) {
  const cfg: AccountConfig = { mode: 'microsoft', offlineName: '', msClientId: '11111111-1111-1111-1111-111111111111' };
  const file = path.join(tmp, 'auth.bin');
  await fs.writeFile(file, JSON.stringify({ refreshToken: 'r-token', uuid: UUID, name: 'Notch', clientId: cfg.msClientId, ...over }));
  return new AuthService(file, box, async () => cfg, async () => undefined, () => undefined, () => undefined, () => undefined);
}

const reply = (status: number, body: string) => ({
  res: { status, ok: status >= 200 && status < 300, text: async () => body },
  entry: { host: 'login.microsoftonline.com', bytes: 0 },
});

describe('licence servers unreachable', () => {
  it('no network: launches offline under the SAME name and UUID as the licensed account', async () => {
    net.netRequest.mockRejectedValue(new AppError('NET_FAILED', 'Нет связи'));
    const svc = await signedIn();
    expect(await svc.getLaunchAuth({ offlineFallback: true })).toEqual({
      name: 'Notch', uuid: UUID, accessToken: '0', userType: 'legacy', offlineFallback: true,
    });
  });

  it('a server outage (HTTP 503, an error page, 429) counts as unreachable too', async () => {
    for (const r of [reply(503, 'oops'), reply(200, '<html>Service Unavailable</html>'), reply(429, '{}')]) {
      net.netRequest.mockReset();
      net.netRequest.mockResolvedValue(r);
      const svc = await signedIn();
      expect(await svc.getLaunchAuth({ offlineFallback: true })).toMatchObject({ name: 'Notch', uuid: UUID, offlineFallback: true });
    }
  });

  it('without the option (skin wardrobe, etc.) the error is passed on: no fake token is ever handed out', async () => {
    net.netRequest.mockRejectedValue(new AppError('NET_FAILED', 'Нет связи'));
    const svc = await signedIn();
    await expect(svc.getLaunchAuth()).rejects.toMatchObject({ code: 'NET_FAILED' });
  });

  it('a refused account is NOT an outage: the user has to sign in again', async () => {
    net.netRequest.mockResolvedValue(reply(400, JSON.stringify({ error: 'invalid_grant' })));
    const svc = await signedIn();
    await expect(svc.getLaunchAuth({ offlineFallback: true })).rejects.toMatchObject({ code: 'AUTH_REQUIRED' });
  });

  it('never signed in: there is no licensed name / UUID to fall back to', async () => {
    net.netRequest.mockRejectedValue(new AppError('NET_FAILED', 'Нет связи'));
    const svc = await signedIn({ name: '', uuid: '' });
    await expect(svc.getLaunchAuth({ offlineFallback: true })).rejects.toMatchObject({ code: 'NET_FAILED' });
    const none = new AuthService(path.join(tmp, 'missing.bin'), box, async () => ({ mode: 'microsoft', offlineName: '', msClientId: '' }), async () => undefined, () => undefined, () => undefined, () => undefined);
    await expect(none.getLaunchAuth({ offlineFallback: true })).rejects.toMatchObject({ code: 'AUTH_REQUIRED' });
  });

  it('isLicenseServerDown only recognises connection problems', () => {
    expect(isLicenseServerDown(new AppError('NET_FAILED', 'x'))).toBe(true);
    expect(isLicenseServerDown(new AppError('AUTH_UNAVAILABLE', 'x'))).toBe(true);
    expect(isLicenseServerDown(new AppError('AUTH_NO_GAME', 'x'))).toBe(false);
    expect(isLicenseServerDown(new AppError('AUTH_REQUIRED', 'x'))).toBe(false);
    expect(isLicenseServerDown(new Error('boom'))).toBe(false);
  });
});

describe('play time', () => {
  const ctx = { running: new Set<string>(), installing: new Set<string>() };
  async function store() {
    const root = path.join(tmp, 'instances');
    const st = new InstanceStore(async () => root, path.join(tmp, 'versions'));
    const inst = await st.create({
      name: 'T', description: '', mcVersion: '1.20.1', loader: { type: 'vanilla', version: null }, kind: 'official', coverColor: 0,
      settings: { javaPath: '', memoryMinMb: null, memoryMaxMb: null, jvmArgs: '', width: null, height: null, fullscreen: null },
    }, ctx);
    return { st, id: inst.id };
  }

  it('adds up, shows in the view and ignores nonsense', async () => {
    const { st, id } = await store();
    expect((await st.get(id, ctx)).playTimeSec ?? 0).toBe(0);
    await st.addPlayTime(id, 120);
    await st.addPlayTime(id, 59.9);
    await st.addPlayTime(id, -5);
    await st.addPlayTime(id, Number.NaN);
    expect((await st.get(id, ctx)).playTimeSec).toBe(179);
  });

  it('simultaneous saves do not lose each other (saving while other edits happen)', async () => {
    const { st, id } = await store();
    await Promise.all([
      ...Array.from({ length: 20 }, () => st.addPlayTime(id, 10)),
      st.update(id, { name: 'Renamed' }, ctx),
      st.patchInternal(id, { lastPlayedAt: '2026-01-01T00:00:00.000Z' }),
    ]);
    expect(await st.get(id, ctx)).toMatchObject({ playTimeSec: 200, name: 'Renamed', lastPlayedAt: '2026-01-01T00:00:00.000Z' });
  });

  it('a duplicate starts from zero', async () => {
    const { st, id } = await store();
    await st.addPlayTime(id, 500);
    const copy = await st.duplicate(id, 'Copy', ctx);
    expect(copy.playTimeSec ?? 0).toBe(0);
    expect((await st.get(id, ctx)).playTimeSec).toBe(500);
  });

  it('formatPlayTime', () => {
    const t = (k: string, v?: Record<string, string | number>) => `${k}:${JSON.stringify(v ?? {})}`;
    expect(formatPlayTime(undefined, t)).toBe('—');
    expect(formatPlayTime(0, t)).toBe('—');
    expect(formatPlayTime(30, t)).toBe('time.lessMinute:{}');
    expect(formatPlayTime(45 * 60 + 20, t)).toBe('time.m:{"m":45}');
    expect(formatPlayTime(12 * 3600 + 35 * 60, t)).toBe('time.hm:{"h":12,"m":35}');
    expect(formatPlayTime(3600, t)).toBe('time.hm:{"h":1,"m":0}');
  });
});
