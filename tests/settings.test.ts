import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { DEFAULT_SETTINGS, SettingsStore } from '../src/main/settings';

let tmp: string;
let file: string;
beforeEach(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'chald-s-'));
  file = path.join(tmp, 'settings.json');
});
afterEach(async () => fs.rm(tmp, { recursive: true, force: true }));

describe('SettingsStore', () => {
  it('returns defaults and persists changes across restarts', async () => {
    const a = new SettingsStore(file);
    expect(await a.get()).toEqual(DEFAULT_SETTINGS);
    await a.set({ memoryMaxMb: 8192, fullscreen: true });
    const b = new SettingsStore(file);
    expect(await b.get()).toMatchObject({ memoryMaxMb: 8192, fullscreen: true });
  });
  it('rejects invalid values with a clear message', async () => {
    const s = new SettingsStore(file);
    await expect(s.set({ memoryMaxMb: 10 })).rejects.toThrow();
    await expect(s.set({ memoryMinMb: 8000, memoryMaxMb: 2000 })).rejects.toThrow(/Минимум/);
    await expect(s.set({ msClientId: 'nope' })).rejects.toThrow();
    await expect(s.set({ updateRepo: 'no-slash' })).rejects.toThrow();
  });
  it('rejects unknown keys and relative paths', async () => {
    const s = new SettingsStore(file);
    await expect(s.set({ evil: 1 })).rejects.toThrow();
    await expect(s.set({ instancesDir: 'relative/dir' })).rejects.toThrow(/абсолютным/);
    await expect(s.set({ javaPath: 'java' })).rejects.toThrow();
  });
  it('survives a corrupted file', async () => {
    await fs.writeFile(file, '{broken');
    expect(await new SettingsStore(file).get()).toEqual(DEFAULT_SETTINGS);
  });
  it('drops invalid stored values back to defaults', async () => {
    await fs.writeFile(file, JSON.stringify({ memoryMaxMb: 1 }));
    expect((await new SettingsStore(file).get()).memoryMaxMb).toBe(DEFAULT_SETTINGS.memoryMaxMb);
  });
});
