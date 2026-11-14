import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';

// The installer talks to Mojang/loader servers: replaced by a stub that we can make succeed or fail.
const install = vi.hoisted(() => vi.fn());
vi.mock('../src/main/installer', () => ({ installVersion: install, verifyInstall: async () => [], loadResolvedVersion: async () => ({}), extractNatives: async () => undefined }));

import { InstanceStore } from '../src/main/instances';
import { Services } from '../src/main/services';
import { backupSaves, disableMods, kindAfterChange, sameTarget } from '../src/main/versionChange';
import { changeVersionSchema } from '../src/shared/schemas';
import type { OpProgress } from '../src/shared/types';

let tmp: string;
beforeEach(async () => { tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'chald-vc-')); install.mockReset(); });
afterEach(async () => fs.rm(tmp, { recursive: true, force: true }));

const exists = (p: string) => fs.access(p).then(() => true, () => false);

describe('helpers', () => {
  it('sameTarget compares version and loader', () => {
    const a = { mcVersion: '1.20.1', loader: { type: 'forge' as const, version: '47.2.0' } };
    expect(sameTarget(a, { ...a })).toBe(true);
    expect(sameTarget(a, { ...a, mcVersion: '1.20.4' })).toBe(false);
    expect(sameTarget(a, { ...a, loader: { type: 'fabric', version: '0.15.0' } })).toBe(false);
    expect(sameTarget({ mcVersion: '1.21', loader: { type: 'vanilla', version: null } }, { mcVersion: '1.21', loader: { type: 'vanilla', version: null } })).toBe(true);
  });

  it('kind follows the loader unless the user made it custom', () => {
    expect(kindAfterChange('official', 'fabric')).toBe('modded');
    expect(kindAfterChange('modded', 'vanilla')).toBe('official');
    expect(kindAfterChange('custom', 'vanilla')).toBe('custom');
    expect(kindAfterChange('custom', 'forge')).toBe('custom');
  });

  it('the schema asks for a loader build unless vanilla', () => {
    const base = { id: 'x', mcVersion: '1.21.1', backupSaves: true, disableMods: false };
    expect(changeVersionSchema.safeParse({ ...base, loader: { type: 'vanilla', version: null } }).success).toBe(true);
    expect(changeVersionSchema.safeParse({ ...base, loader: { type: 'fabric', version: null } }).success).toBe(false);
    expect(changeVersionSchema.safeParse({ ...base, loader: { type: 'fabric', version: '0.16.0' } }).success).toBe(true);
    expect(changeVersionSchema.safeParse({ ...base, mcVersion: '../evil', loader: { type: 'vanilla', version: null } }).success).toBe(false);
  });
});

describe('backupSaves', () => {
  it('copies saves next to .minecraft, not into it', async () => {
    const game = path.join(tmp, 'inst', '.minecraft');
    await fs.mkdir(path.join(game, 'saves', 'World1'), { recursive: true });
    await fs.writeFile(path.join(game, 'saves', 'World1', 'level.dat'), 'data');
    const dest = await backupSaves(game, '1.20.1', new Date('2026-11-05T10:20:30Z'));
    expect(dest).toBe(path.join(tmp, 'inst', 'backups', 'saves-1.20.1-2026-11-05-10-20-30'));
    expect(await fs.readFile(path.join(dest!, 'World1', 'level.dat'), 'utf8')).toBe('data');
    expect(await exists(path.join(game, 'saves', 'World1', 'level.dat'))).toBe(true); // the original stays
  });

  it('does nothing when there are no worlds', async () => {
    const game = path.join(tmp, 'inst', '.minecraft');
    expect(await backupSaves(game, '1.20.1')).toBeNull(); // no saves folder
    await fs.mkdir(path.join(game, 'saves'), { recursive: true });
    expect(await backupSaves(game, '1.20.1')).toBeNull(); // empty saves folder
    expect(await exists(path.join(tmp, 'inst', 'backups'))).toBe(false);
  });
});

describe('disableMods', () => {
  it('renames jars to .disabled, leaves the rest alone and never overwrites', async () => {
    const mods = path.join(tmp, '.minecraft', 'mods');
    await fs.mkdir(path.join(mods, 'folder.jar'), { recursive: true });
    for (const [n, c] of [['a.jar', 'A'], ['b.jar', 'B'], ['b.jar.disabled', 'OLD-B'], ['readme.txt', 'T'], ['c.jar.disabled', 'C']]) await fs.writeFile(path.join(mods, n), c);
    const n = await disableMods(path.join(tmp, '.minecraft'));
    expect(n).toBe(2);
    const names = (await fs.readdir(mods)).sort();
    expect(names).toEqual(['a.jar.disabled', 'b-1.jar.disabled', 'b.jar.disabled', 'c.jar.disabled', 'folder.jar', 'readme.txt']);
    expect(await fs.readFile(path.join(mods, 'b.jar.disabled'), 'utf8')).toBe('OLD-B');
    expect(await fs.readFile(path.join(mods, 'b-1.jar.disabled'), 'utf8')).toBe('B');
  });

  it('a missing mods folder is fine', async () => {
    expect(await disableMods(path.join(tmp, '.minecraft'))).toBe(0);
  });
});

describe('InstanceStore.applyVersion', () => {
  it('records the new version and moves official/modded with the loader', async () => {
    const store = new InstanceStore(async () => path.join(tmp, 'instances'), path.join(tmp, 'versions'));
    const ctx = { running: new Set<string>(), installing: new Set<string>() };
    const settings = { javaPath: '', memoryMinMb: null, memoryMaxMb: null, jvmArgs: '', width: null, height: null, fullscreen: null };
    const v = await store.create({ name: 'Pack', description: '', mcVersion: '1.20.1', loader: { type: 'vanilla', version: null }, kind: 'official', coverColor: 0, settings }, ctx);
    await store.patchInternal(v.id, { installed: true, versionId: '1.20.1' });
    await store.applyVersion(v.id, { mcVersion: '1.21.1', loader: { type: 'fabric', version: '0.16.5' }, versionId: 'fabric-loader-0.16.5-1.21.1' });
    expect(await store.readMeta(v.id)).toMatchObject({
      mcVersion: '1.21.1', loader: { type: 'fabric', version: '0.16.5' }, versionId: 'fabric-loader-0.16.5-1.21.1', installed: true, kind: 'modded',
    });
    await store.applyVersion(v.id, { mcVersion: '1.21.1', loader: { type: 'vanilla', version: '9.9' }, versionId: '1.21.1' });
    expect(await store.readMeta(v.id)).toMatchObject({ loader: { type: 'vanilla', version: null }, kind: 'official' });
  });
});

describe('Services.startVersionChange', () => {
  async function setup() {
    const events: OpProgress[] = [];
    const s = new Services({
      dataDir: tmp, appVersion: '0.0.0', box: { isEncryptionAvailable: () => false, encryptString: (x) => Buffer.from(x), decryptString: (b) => b.toString() },
      emit: ((ch: string, p: unknown) => { if (ch === 'op:progress') events.push(p as OpProgress); }) as never, openExternal: () => undefined,
    });
    const inst = await s.instances.create({
      name: 'Pack', description: '', mcVersion: '1.20.1', loader: { type: 'forge', version: '47.2.0' }, kind: 'modded', coverColor: 0,
      settings: { javaPath: '', memoryMinMb: null, memoryMaxMb: null, jvmArgs: '', width: null, height: null, fullscreen: null },
    }, s.ctx());
    await s.instances.patchInternal(inst.id, { installed: true, versionId: '1.20.1-forge-47.2.0' });
    const game = await s.instances.gameDir(inst.id);
    await fs.mkdir(path.join(game, 'saves', 'W'), { recursive: true });
    await fs.writeFile(path.join(game, 'saves', 'W', 'level.dat'), 'x');
    await fs.writeFile(path.join(game, 'mods', 'm.jar'), 'm');
    const finished = async () => { for (let i = 0; i < 200 && !events.some((e) => e.status !== 'running'); i++) await new Promise((r) => setTimeout(r, 10)); return events.at(-1)!; };
    return { s, id: inst.id, game, events, finished };
  }
  const change = (id: string, over: object = {}) => ({ id, mcVersion: '1.21.1', loader: { type: 'fabric' as const, version: '0.16.5' }, backupSaves: true, disableMods: true, ...over });

  it('installs the new version first, then backs up worlds, disables mods and switches the instance', async () => {
    install.mockResolvedValue({ versionId: 'fabric-loader-0.16.5-1.21.1' });
    const { s, id, game, finished } = await setup();
    await s.startVersionChange(change(id));
    expect(await finished()).toMatchObject({ status: 'done', kind: 'install' });
    expect(install.mock.calls[0]![0]).toEqual({ mcVersion: '1.21.1', loader: { type: 'fabric', version: '0.16.5' } }); // the NEW target, not the old meta
    expect(await s.instances.readMeta(id)).toMatchObject({ mcVersion: '1.21.1', loader: { type: 'fabric', version: '0.16.5' }, versionId: 'fabric-loader-0.16.5-1.21.1', installed: true, kind: 'modded' });
    expect(await exists(path.join(game, 'mods', 'm.jar.disabled'))).toBe(true);
    const backups = await fs.readdir(path.join(path.dirname(game), 'backups'));
    expect(backups).toHaveLength(1);
    expect(backups[0]).toMatch(/^saves-1\.20\.1-/); // named after the version the worlds came from
    expect(await fs.readFile(path.join(game, 'saves', 'W', 'level.dat'), 'utf8')).toBe('x');
  });

  it('a failed install leaves the instance, its mods and its worlds exactly as they were', async () => {
    install.mockRejectedValue(new Error('нет сети'));
    const { s, id, game, finished } = await setup();
    await s.startVersionChange(change(id));
    expect(await finished()).toMatchObject({ status: 'error', message: 'нет сети' });
    expect(await s.instances.readMeta(id)).toMatchObject({ mcVersion: '1.20.1', loader: { type: 'forge', version: '47.2.0' }, versionId: '1.20.1-forge-47.2.0', installed: true });
    expect(await exists(path.join(game, 'mods', 'm.jar'))).toBe(true);
    expect(await exists(path.join(path.dirname(game), 'backups'))).toBe(false);
    expect(s.installs.has(id)).toBe(false);
  });

  it('respects the options: no backup, mods kept', async () => {
    install.mockResolvedValue({ versionId: '1.21.1' });
    const { s, id, game, finished } = await setup();
    await s.startVersionChange(change(id, { loader: { type: 'vanilla', version: null }, backupSaves: false, disableMods: false }));
    expect(await finished()).toMatchObject({ status: 'done' });
    expect(await exists(path.join(game, 'mods', 'm.jar'))).toBe(true);
    expect(await exists(path.join(path.dirname(game), 'backups'))).toBe(false);
    expect(await s.instances.readMeta(id)).toMatchObject({ loader: { type: 'vanilla', version: null }, kind: 'official' });
  });

  it('refuses a no-op change and a busy instance', async () => {
    install.mockImplementation(() => new Promise(() => undefined)); // never finishes: the instance stays "installing"
    const { s, id } = await setup();
    await expect(s.startVersionChange(change(id, { mcVersion: '1.20.1', loader: { type: 'forge', version: '47.2.0' } }))).rejects.toMatchObject({ code: 'VERSION_UNCHANGED' });
    await s.startVersionChange(change(id));
    await expect(s.startVersionChange(change(id, { mcVersion: '1.21.4' }))).rejects.toMatchObject({ code: 'ALREADY_INSTALLING' });
    s.cancelInstall(id);
  });

  it('cancelling the install changes nothing', async () => {
    install.mockImplementation((_t: unknown, _d: unknown, _c: unknown, _r: unknown, signal: AbortSignal) => new Promise((_res, rej) => {
      const stop = () => rej(new DOMException('Aborted', 'AbortError'));
      if (signal.aborted) stop(); else signal.addEventListener('abort', stop);
    }));
    const { s, id, game, finished } = await setup();
    await s.startVersionChange(change(id));
    await vi.waitFor(() => expect(install).toHaveBeenCalled()); // the download is under way
    s.cancelInstall(id);
    expect(await finished()).toMatchObject({ status: 'cancelled' });
    expect(await s.instances.readMeta(id)).toMatchObject({ mcVersion: '1.20.1' });
    expect(await exists(path.join(game, 'mods', 'm.jar'))).toBe(true);
  });
});
