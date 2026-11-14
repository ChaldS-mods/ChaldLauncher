import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { InstanceStore } from '../src/main/instances';

let tmp: string;
let store: InstanceStore;
const ctx = { running: new Set<string>(), installing: new Set<string>() };
const settings = { javaPath: '', memoryMinMb: null, memoryMaxMb: null, jvmArgs: '', width: null, height: null, fullscreen: null };
const input = (name: string, extra: object = {}) => ({
  name, description: '', mcVersion: '1.21.1', loader: { type: 'vanilla' as const, version: null },
  kind: 'official' as const, coverColor: 0, settings, ...extra,
});

beforeEach(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'chald-'));
  store = new InstanceStore(async () => path.join(tmp, 'instances'), path.join(tmp, 'versions'));
});
afterEach(async () => fs.rm(tmp, { recursive: true, force: true }));

describe('InstanceStore', () => {
  it('creates an isolated structure and persists metadata', async () => {
    const v = await store.create(input('My Pack'), ctx);
    expect(v.id).toBe('my-pack');
    for (const sub of ['mods', 'config', 'saves', 'resourcepacks']) {
      await expect(fs.stat(path.join(v.gameDir, sub))).resolves.toBeTruthy();
    }
    // new store instance = "app restart"
    const again = new InstanceStore(async () => path.join(tmp, 'instances'), path.join(tmp, 'versions'));
    const list = await again.list(ctx);
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ id: 'my-pack', name: 'My Pack', mcVersion: '1.21.1', state: 'not-installed' });
  });

  it('keeps ids unique', async () => {
    const a = await store.create(input('Same'), ctx);
    const b = await store.create(input('Same'), ctx);
    expect(a.id).not.toBe(b.id);
  });

  it('rejects an explicit id that already exists', async () => {
    await store.create(input('X', { id: 'x' }), ctx);
    await expect(store.create(input('Y', { id: 'x' }), ctx)).rejects.toThrow(/уже существует/);
  });

  it('requires a loader version for fabric', async () => {
    await expect(store.create(input('F', { loader: { type: 'fabric', version: null }, kind: 'modded' }), ctx)).rejects.toThrow();
  });

  it('rejects invalid input', async () => {
    await expect(store.create(input(''), ctx)).rejects.toThrow();
    await expect(store.create(input('ok', { mcVersion: '../x' }), ctx)).rejects.toThrow();
  });

  it('updates name and settings', async () => {
    const v = await store.create(input('Old'), ctx);
    const u = await store.update(v.id, { name: 'New', settings: { ...settings, memoryMaxMb: 2048 } }, ctx);
    expect(u.name).toBe('New');
    expect((await store.readMeta(v.id)).settings.memoryMaxMb).toBe(2048);
    await expect(store.update(v.id, { settings: { ...settings, memoryMinMb: 4096, memoryMaxMb: 2048 } }, ctx)).rejects.toThrow();
  });

  it('duplicates with files but not isolation', async () => {
    const v = await store.create(input('Orig'), ctx);
    await fs.writeFile(path.join(v.gameDir, 'mods', 'a.jar'), 'x');
    const d = await store.duplicate(v.id, 'Copy', ctx);
    expect(d.id).not.toBe(v.id);
    expect(d.modCount).toBe(1);
    await fs.writeFile(path.join(d.gameDir, 'mods', 'b.jar'), 'x');
    expect((await store.get(v.id, ctx)).modCount).toBe(1);
    expect(d.lastPlayedAt).toBeNull();
  });

  it('removes only with confirmation and stays inside root', async () => {
    const v = await store.create(input('Del'), ctx);
    await expect(store.remove(v.id, false as never)).rejects.toThrow();
    await expect(fs.stat(v.path)).resolves.toBeTruthy();
    await expect(store.remove('../instances', true)).rejects.toThrow();
    await store.remove(v.id, true);
    await expect(fs.stat(v.path)).rejects.toThrow();
  });

  it('reports a corrupted instance.json as broken instead of crashing', async () => {
    const v = await store.create(input('Bad'), ctx);
    await fs.writeFile(path.join(v.path, 'instance.json'), '{not json');
    const list = await store.list(ctx);
    expect(list[0]).toMatchObject({ id: 'bad', state: 'broken' });
  });

  it('marks an installed instance broken when version files are missing', async () => {
    const v = await store.create(input('Inst'), ctx);
    await store.patchInternal(v.id, { installed: true, versionId: '1.21.1' });
    expect((await store.get(v.id, ctx)).state).toBe('broken');
    const vdir = path.join(tmp, 'versions', '1.21.1');
    await fs.mkdir(vdir, { recursive: true });
    await fs.writeFile(path.join(vdir, '1.21.1.json'), '{}');
    await fs.writeFile(path.join(vdir, '1.21.1.jar'), 'x');
    expect((await store.get(v.id, ctx)).state).toBe('ready');
  });

  it('shows installing and running state from context', async () => {
    const v = await store.create(input('S'), ctx);
    expect((await store.get(v.id, { running: new Set(), installing: new Set([v.id]) })).state).toBe('installing');
    expect((await store.get(v.id, { running: new Set([v.id]), installing: new Set() })).running).toBe(true);
  });

  it('rejects oversize or wrong-type covers', async () => {
    const v = await store.create(input('C'), ctx);
    const txt = path.join(tmp, 'x.txt');
    await fs.writeFile(txt, 'x');
    await expect(store.setCoverFromFile(v.id, txt)).rejects.toThrow();
    const png = path.join(tmp, 'c.png');
    await fs.writeFile(png, Buffer.alloc(10));
    await store.setCoverFromFile(v.id, png);
    expect((await store.get(v.id, ctx)).coverDataUrl).toMatch(/^data:image\/png;base64,/);
  });
});
