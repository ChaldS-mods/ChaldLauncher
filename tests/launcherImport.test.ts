import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  bareLoaderVersion, checkImportable, copyGameFiles, defaultEnv, detectLauncher, heapMb, importKey, inspectFolder, neoforgeToMc,
  parseCfg, parseCfLoader, parseMmcPack, parseVersionId, readCfInstance, readMmcInstance, scanModrinthRoot, scanOfficialRoot, stripHeapArgs, toCreateInput,
} from '../src/main/launcherImport';
import { createInstanceSchema } from '../src/shared/schemas';

let tmp: string;
beforeEach(async () => { tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'chald-li-')); });
afterEach(async () => fs.rm(tmp, { recursive: true, force: true }));

const w = async (file: string, text: string | Buffer) => {
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, text);
};
const exists = (p: string) => fs.access(p).then(() => true, () => false);

describe('parsers', () => {
  it('parseCfg reads key=value, skips sections and comments', () => {
    expect(parseCfg('\uFEFF[General]\r\nname=My = Pack\r\n#c\r\nMaxMemAlloc=4096\r\n')).toEqual({ name: 'My = Pack', MaxMemAlloc: '4096' });
  });

  it('parseMmcPack finds Minecraft and the loader', () => {
    const pack = { components: [{ uid: 'org.lwjgl3', version: '3.3.2' }, { uid: 'net.minecraft', version: '1.20.1' }, { uid: 'net.fabricmc.fabric-loader', version: '0.15.7' }] };
    expect(parseMmcPack(pack)).toEqual({ mcVersion: '1.20.1', loader: { type: 'fabric', version: '0.15.7' } });
    expect(parseMmcPack({ components: [{ uid: 'net.minecraft', version: '1.20.1' }, { uid: 'net.minecraftforge', version: '1.20.1-47.2.0' }] }))
      .toEqual({ mcVersion: '1.20.1', loader: { type: 'forge', version: '47.2.0' } });
    expect(parseMmcPack({ components: [{ uid: 'net.minecraft', version: '1.12.2' }, { uid: 'com.mumfrey.liteloader', version: '1' }] })).toHaveProperty('problem');
    expect(parseMmcPack({})).toHaveProperty('problem');
    expect(parseMmcPack({ components: [] })).toHaveProperty('problem');
  });

  it('parseVersionId understands the official launcher ids', () => {
    expect(parseVersionId('1.20.1')).toEqual({ mcVersion: '1.20.1', loader: { type: 'vanilla', version: null } });
    expect(parseVersionId('24w14a')).toMatchObject({ mcVersion: '24w14a' });
    expect(parseVersionId('fabric-loader-0.15.7-1.20.1')).toEqual({ mcVersion: '1.20.1', loader: { type: 'fabric', version: '0.15.7' } });
    expect(parseVersionId('quilt-loader-0.23.0-1.20.4')).toEqual({ mcVersion: '1.20.4', loader: { type: 'quilt', version: '0.23.0' } });
    expect(parseVersionId('1.20.1-forge-47.2.0')).toEqual({ mcVersion: '1.20.1', loader: { type: 'forge', version: '47.2.0' } });
    expect(parseVersionId('1.12.2-forge1.12.2-14.23.5.2860')).toEqual({ mcVersion: '1.12.2', loader: { type: 'forge', version: '14.23.5.2860' } });
    expect(parseVersionId('neoforge-20.4.237')).toEqual({ mcVersion: '1.20.4', loader: { type: 'neoforge', version: '20.4.237' } });
    expect(parseVersionId('1.20.1-OptiFine_HD_U_I6')).toHaveProperty('problem');
    expect(parseVersionId('latest-release')).toHaveProperty('problem');
  });

  it('neoforgeToMc is the inverse of the NeoForge version scheme', () => {
    expect(neoforgeToMc('21.0.5')).toBe('1.21');
    expect(neoforgeToMc('21.1.77')).toBe('1.21.1');
    expect(neoforgeToMc('20.2.86')).toBe('1.20.2');
    expect(neoforgeToMc('26.1.0.4')).toBe('26.1');
    expect(neoforgeToMc('26.1.2.4')).toBe('26.1.2');
    expect(neoforgeToMc('x')).toBeNull();
  });

  it('parseCfLoader handles CurseForge names', () => {
    expect(parseCfLoader({ gameVersion: '1.20.1', baseModLoader: { name: 'forge-47.2.0', type: 1 } })).toEqual({ mcVersion: '1.20.1', loader: { type: 'forge', version: '47.2.0' } });
    expect(parseCfLoader({ gameVersion: '1.20.1', baseModLoader: { name: 'fabric-0.15.7-1.20.1', type: 4 } })).toEqual({ mcVersion: '1.20.1', loader: { type: 'fabric', version: '0.15.7' } });
    expect(parseCfLoader({ gameVersion: '1.20.4', baseModLoader: { name: 'neoforge-20.4.237' } })).toEqual({ mcVersion: '1.20.4', loader: { type: 'neoforge', version: '20.4.237' } });
    expect(parseCfLoader({ gameVersion: '1.20.1', baseModLoader: null })).toEqual({ mcVersion: '1.20.1', loader: { type: 'vanilla', version: null } });
    expect(parseCfLoader({ baseModLoader: null })).toHaveProperty('problem');
  });

  it('small helpers', () => {
    expect(bareLoaderVersion('forge', '1.20.1', '1.20.1-47.2.0')).toBe('47.2.0');
    expect(bareLoaderVersion('neoforge', '1.20.4', 'neoforge-20.4.1')).toBe('20.4.1');
    expect(heapMb('-Xmx2G -Xms512M', 'x')).toBe(2048);
    expect(heapMb('-Xmx2G -Xms512M', 's')).toBe(512);
    expect(stripHeapArgs('-Xmx2G -XX:+UseG1GC  -Xms1G')).toBe('-XX:+UseG1GC');
    expect(checkImportable({ mcVersion: '1.12.2', loader: { type: 'forge', version: '14.23.5.2860' } })).toMatch(/Forge/);
    expect(checkImportable({ mcVersion: '1.20.1', loader: { type: 'fabric', version: null } })).toMatch(/версия загрузчика/);
    expect(checkImportable({ mcVersion: '../x', loader: { type: 'vanilla', version: null } })).toMatch(/Некорректная/);
    expect(checkImportable({ mcVersion: '1.20.1', loader: { type: 'fabric', version: '0.15.7' } })).toBeNull();
  });
});

describe('Prism / MultiMC', () => {
  const makeInstance = async (root: string, folder: string, cfg: string, pack: unknown) => {
    const dir = path.join(root, 'instances', folder);
    await w(path.join(dir, 'instance.cfg'), cfg);
    await w(path.join(dir, 'mmc-pack.json'), JSON.stringify(pack));
    await w(path.join(dir, '.minecraft', 'mods', 'a.jar'), 'x');
    await w(path.join(dir, '.minecraft', 'mods', 'b.jar.disabled'), 'x');
    await w(path.join(dir, '.minecraft', 'saves', 'World1', 'level.dat'), 'x');
    return dir;
  };

  it('reads an instance with its settings, counts and icon', async () => {
    const root = path.join(tmp, 'PrismLauncher');
    const dir = await makeInstance(root, 'Test', '[General]\nname=Тест\niconKey=shiny\nOverrideMemory=true\nMaxMemAlloc=6144\nMinMemAlloc=1024\nOverrideJavaArgs=true\nJvmArgs=-Xmx6G -XX:+UseZGC\nOverrideWindow=true\nMinecraftWinWidth=1600\nMinecraftWinHeight=900\nlastLaunchTime=1700000000000\nnotes=Hello\\nsecond\n',
      { components: [{ uid: 'net.minecraft', version: '1.20.1' }, { uid: 'net.fabricmc.fabric-loader', version: '0.15.7' }] });
    await w(path.join(root, 'icons', 'shiny.png'), 'png');
    const r = await readMmcInstance('prism', dir, path.join(root, 'icons'));
    expect(r).toMatchObject({
      name: 'Тест', description: 'Hello', mcVersion: '1.20.1', loader: { type: 'fabric', version: '0.15.7' }, mods: 2, worlds: 1, problem: null,
      settings: { memoryMaxMb: 6144, memoryMinMb: 1024, jvmArgs: '-XX:+UseZGC', width: 1600, height: 900 },
    });
    expect(r!.lastPlayedAt).toBe(new Date(1700000000000).toISOString());
    expect(r!.iconFile).toBe(path.join(root, 'icons', 'shiny.png'));
    // the memory settings are only taken when the instance overrides them
    const dir2 = await makeInstance(root, 'Plain', '[General]\nname=Plain\nMaxMemAlloc=9999\n', { components: [{ uid: 'net.minecraft', version: '1.21' }] });
    expect((await readMmcInstance('prism', dir2, null))!.settings.memoryMaxMb).toBeNull();
  });

  it('detects a launcher, follows InstanceDir and skips folders that are not instances', async () => {
    const home = path.join(tmp, 'home');
    const root = path.join(home, 'AppData', 'Roaming', 'PrismLauncher');
    await w(path.join(root, 'prismlauncher.cfg'), '[General]\nInstanceDir=mine\n');
    const dir = path.join(root, 'mine', 'One');
    await w(path.join(dir, 'instance.cfg'), '[General]\nname=One\n');
    await w(path.join(dir, 'mmc-pack.json'), JSON.stringify({ components: [{ uid: 'net.minecraft', version: '1.20.1' }] }));
    await w(path.join(root, 'mine', '_LAUNCHER_TEMP', 'x'), '');
    await fs.mkdir(path.join(root, 'mine', 'junk'), { recursive: true });
    const env = defaultEnv({ platform: 'win32', home, appData: path.join(home, 'AppData', 'Roaming'), documents: path.join(home, 'Documents') });
    const found = await detectLauncher('prism', env);
    expect(found?.instances.map((i) => i.name)).toEqual(['One']);
    expect(await detectLauncher('modrinth', env)).toBeNull();
  });

  it('marks a broken instance instead of failing', async () => {
    const dir = path.join(tmp, 'instances', 'Broken');
    await w(path.join(dir, 'instance.cfg'), '[General]\nname=Broken\n');
    const r = await readMmcInstance('multimc', dir, null);
    expect(r?.problem).toBeTruthy();
    expect(r?.name).toBe('Broken');
  });
});

describe('CurseForge', () => {
  it('reads minecraftinstance.json and builds the installed-mods index from files that exist', async () => {
    const dir = path.join(tmp, 'Instances', 'Pack');
    await w(path.join(dir, 'minecraftinstance.json'), JSON.stringify({
      name: 'Pack', gameVersion: '1.20.1', baseModLoader: { name: 'forge-47.2.0', type: 1 }, lastPlayed: '2024-05-01T10:00:00Z',
      installedAddons: [
        { addonID: 111, installedFile: { id: 999, fileName: 'jei.jar' } },
        { addonID: 222, installedFile: { id: 888, fileName: 'gone.jar' } },
        { addonID: 333, installedFile: { id: 777, fileName: '../evil.jar' } },
      ],
    }));
    await w(path.join(dir, 'mods', 'jei.jar'), 'x');
    const r = await readCfInstance(dir);
    expect(r).toMatchObject({ name: 'Pack', mcVersion: '1.20.1', loader: { type: 'forge', version: '47.2.0' }, mods: 1, problem: null, gameDir: dir });
    expect(r!.cfIndex).toEqual({ '111': { file: 'jei.jar', fileId: 999 } });
    expect(await readCfInstance(path.join(tmp, 'nothing'))).toBeNull();
  });
});

describe('Modrinth App', () => {
  it('reads profiles from app.db (a copy is read, the original stays untouched)', async () => {
    const sqlite = await import('node:sqlite').catch(() => null);
    if (!sqlite) return; // old Node without node:sqlite
    const root = path.join(tmp, 'ModrinthApp');
    await w(path.join(root, 'profiles', 'Cool Pack', 'mods', 'm.jar'), 'x');
    await w(path.join(root, 'profiles', 'Old', 'mods', 'm.jar'), 'x');
    await fs.mkdir(path.join(root, 'profiles', 'Vanilla Run'), { recursive: true });
    const db = new sqlite.DatabaseSync(path.join(root, 'app.db'));
    db.exec(`CREATE TABLE profiles (path TEXT PRIMARY KEY, name TEXT, game_version TEXT, mod_loader TEXT, mod_loader_version TEXT, icon_path TEXT,
      last_played INTEGER, override_mc_memory_max INTEGER, override_extra_launch_args TEXT, override_mc_force_fullscreen INTEGER,
      override_mc_game_resolution_x INTEGER, override_mc_game_resolution_y INTEGER)`);
    const ins = db.prepare('INSERT INTO profiles (path, name, game_version, mod_loader, mod_loader_version, last_played, override_mc_memory_max, override_extra_launch_args) VALUES (?,?,?,?,?,?,?,?)');
    ins.run('Cool Pack', 'Cool Pack', '1.20.1', 'fabric', '0.15.7', 1700000000, 5000, '["-Xmx5G","-Dfoo=1"]');
    ins.run('Vanilla Run', 'Vanilla Run', '1.21', 'vanilla', null, null, null, null);
    ins.run('Weird', 'Weird', '1.20.1', 'liteloader', null, null, null, null);
    ins.run('Missing', 'Missing folder', '1.20.1', 'fabric', '0.15.7', null, null, null);
    db.close();
    // an old-style profile (profile.json in the folder)
    await w(path.join(root, 'profiles', 'Old', 'profile.json'), JSON.stringify({ metadata: { name: 'Old one', game_version: '1.19.2', loader: 'forge', loader_version: { id: '1.19.2-43.2.0' } }, memory: { maximum: 3000 } }));

    const list = await scanModrinthRoot(root);
    const by = Object.fromEntries(list.map((r) => [r.name, r]));
    expect(Object.keys(by).sort()).toEqual(['Cool Pack', 'Old one', 'Vanilla Run']);
    expect(by['Cool Pack']).toMatchObject({ mcVersion: '1.20.1', loader: { type: 'fabric', version: '0.15.7' }, mods: 1, problem: null, settings: { memoryMaxMb: 5000, jvmArgs: '-Dfoo=1' } });
    expect(by['Cool Pack']!.lastPlayedAt).toBe(new Date(1700000000 * 1000).toISOString());
    expect(by['Vanilla Run']).toMatchObject({ loader: { type: 'vanilla', version: null }, problem: null });
    expect(by['Old one']).toMatchObject({ mcVersion: '1.19.2', loader: { type: 'forge', version: '43.2.0' }, settings: { memoryMaxMb: 3000 } });
    expect(await exists(path.join(root, 'app.db'))).toBe(true);
  });
});

describe('official launcher', () => {
  it('lists profiles, resolves «latest release» from installed versions and drops duplicates', async () => {
    const root = path.join(tmp, '.minecraft');
    await w(path.join(root, 'versions', '1.20.1', '1.20.1.json'), '{}');
    await w(path.join(root, 'versions', '1.20.4', '1.20.4.json'), '{}');
    await w(path.join(root, 'saves', 'W', 'level.dat'), 'x');
    await w(path.join(root, 'launcher_profiles.json'), JSON.stringify({ profiles: {
      a: { type: 'latest-release', name: '', lastUsed: '2024-01-02T00:00:00Z' },
      b: { type: 'latest-snapshot' },
      c: { type: 'custom', name: 'Fabric', lastVersionId: 'fabric-loader-0.15.7-1.20.1', javaArgs: '-Xmx3G -XX:+UseG1GC', resolution: { width: 1280, height: 720 } },
      d: { type: 'custom', name: 'Dup', lastVersionId: 'fabric-loader-0.15.7-1.20.1' },
      e: { type: 'custom', name: 'Opti', lastVersionId: '1.20.1-OptiFine_HD' },
    } }));
    const list = await scanOfficialRoot(root);
    expect(list.map((r) => r.name).sort()).toEqual(['Fabric', 'Minecraft 1.20.4', 'Opti']);
    const fabric = list.find((r) => r.name === 'Fabric')!;
    expect(fabric).toMatchObject({ mcVersion: '1.20.1', loader: { type: 'fabric', version: '0.15.7' }, worlds: 1, settings: { memoryMaxMb: 3072, jvmArgs: '-XX:+UseG1GC', width: 1280, height: 720 } });
    expect(list.find((r) => r.name === 'Opti')!.problem).toBeTruthy();
  });
});

describe('manual folder', () => {
  it('recognises an instance, an instances folder and a launcher folder', async () => {
    const root = path.join(tmp, 'Multi');
    const dir = path.join(root, 'instances', 'A');
    await w(path.join(dir, 'instance.cfg'), '[General]\nname=A\n');
    await w(path.join(dir, 'mmc-pack.json'), JSON.stringify({ components: [{ uid: 'net.minecraft', version: '1.20.1' }] }));
    expect((await inspectFolder(dir)).map((r) => r.name)).toEqual(['A']);
    expect((await inspectFolder(path.join(root, 'instances'))).map((r) => r.name)).toEqual(['A']);
    expect((await inspectFolder(root)).map((r) => r.name)).toEqual(['A']);
    expect(await inspectFolder(path.join(tmp, 'empty'))).toEqual([]);
  });
});

describe('copy', () => {
  it('copies game data, skips caches / launcher files / symlinks, and reports progress', async () => {
    const src = path.join(tmp, 'src');
    await w(path.join(src, 'mods', 'a.jar'), 'aaaa');
    await w(path.join(src, 'saves', 'W', 'region', 'r.mca'), 'bb');
    await w(path.join(src, 'options.txt'), 'fov:70');
    await w(path.join(src, 'logs', 'latest.log'), 'log');
    await w(path.join(src, 'libraries', 'big.jar'), 'lib');
    await w(path.join(src, 'launcher_profiles.json'), '{}');
    await w(path.join(src, 'Instance.cfg'), 'x');
    const secret = path.join(tmp, 'secret.txt');
    await w(secret, 'secret');
    let linked = true;
    try { await fs.symlink(secret, path.join(src, 'mods', 'link.jar')); } catch { linked = false; }
    const dest = path.join(tmp, 'dest');
    const seen: number[] = [];
    const r = await copyGameFiles(src, dest, { onProgress: (f) => seen.push(f) });
    expect(r.files).toBe(3);
    expect(await fs.readFile(path.join(dest, 'saves', 'W', 'region', 'r.mca'), 'utf8')).toBe('bb');
    expect(await exists(path.join(dest, 'logs'))).toBe(false);
    expect(await exists(path.join(dest, 'libraries'))).toBe(false);
    expect(await exists(path.join(dest, 'launcher_profiles.json'))).toBe(false);
    expect(await exists(path.join(dest, 'Instance.cfg'))).toBe(false);
    if (linked) expect(await exists(path.join(dest, 'mods', 'link.jar'))).toBe(false);
    expect(seen.at(-1)).toBe(1);
    expect(await exists(path.join(src, 'mods', 'a.jar'))).toBe(true); // the source is untouched
  });

  it('can be cancelled and tolerates a missing source', async () => {
    const src = path.join(tmp, 'src');
    await w(path.join(src, 'a.txt'), 'a');
    const ac = new AbortController();
    ac.abort();
    await expect(copyGameFiles(src, path.join(tmp, 'd'), { signal: ac.signal })).rejects.toBeTruthy();
    expect(await copyGameFiles(path.join(tmp, 'nope'), path.join(tmp, 'd2'))).toEqual({ files: 0, bytes: 0 });
  });
});

describe('create input', () => {
  it('always passes the instance schema, even for odd names', async () => {
    const dir = path.join(tmp, 'x');
    await w(path.join(dir, 'instance.cfg'), `[General]\nname=${'Очень длинное имя '.repeat(10)}\nOverrideMemory=true\nMaxMemAlloc=100\nMinMemAlloc=99999\n`);
    await w(path.join(dir, 'mmc-pack.json'), JSON.stringify({ components: [{ uid: 'net.minecraft', version: '1.20.1' }, { uid: 'net.neoforged', version: '20.4.1' }] }));
    const r = (await readMmcInstance('prism', dir, null))!;
    const input = toCreateInput(r);
    expect(createInstanceSchema.safeParse(input).success).toBe(true);
    expect(input.name.length).toBeLessThanOrEqual(48);
    expect(input.kind).toBe('modded');
    expect(input.description).toContain('Prism Launcher');
    expect(importKey(r)).toContain('prism:');
  });
});
