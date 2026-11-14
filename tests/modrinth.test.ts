import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import AdmZip from 'adm-zip';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  buildFacets, extractOverrides, listInstalledProjects, loaderFilter, mrpackIndexSchema, pickVersion, planInstall, planPack, readMrpackIndex, safePackPath,
  type MrVersion, type ModrinthLike,
} from '../src/main/modrinth';

let tmp: string;
beforeEach(async () => { tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'chald-mr-')); });
afterEach(async () => { await fs.rm(tmp, { recursive: true, force: true }); });

const sha = 'a'.repeat(40);
function ver(over: Partial<MrVersion> & { id: string }): MrVersion {
  return {
    project_id: 'AAAAAAAA', name: '', version_number: '1', version_type: 'release', game_versions: ['1.20.1'], loaders: ['fabric'],
    files: [{ url: 'https://cdn.modrinth.com/data/x/versions/y/mod.jar', filename: 'mod.jar', primary: true, size: 10, hashes: { sha1: sha } }],
    dependencies: [], ...over,
  };
}

describe('facets and version choice', () => {
  it('quilt also accepts fabric projects', () => {
    expect(loaderFilter('quilt')).toEqual(['quilt', 'fabric']);
    expect(loaderFilter('vanilla')).toBeNull();
    expect(buildFacets({ type: 'mod', mcVersion: '1.20.1', loader: 'quilt' })).toEqual([
      ['project_type:mod'], ['versions:1.20.1'], ['categories:quilt', 'categories:fabric'],
    ]);
  });
  it('resource packs are not filtered by loader', () => {
    expect(buildFacets({ type: 'resourcepack', mcVersion: null, loader: 'fabric' })).toEqual([['project_type:resourcepack']]);
  });
  it('prefers the newest release over a newer beta', () => {
    const list = [ver({ id: 'b1', version_type: 'beta' }), ver({ id: 'r1' }), ver({ id: 'r0' })];
    expect(pickVersion(list)?.id).toBe('r1');
    expect(pickVersion([ver({ id: 'b1', version_type: 'beta' })])?.id).toBe('b1');
    expect(pickVersion([])).toBeUndefined();
  });
});

describe('safePackPath', () => {
  it('accepts normal paths', () => {
    expect(safePackPath('mods/sodium.jar')).toBe('mods/sodium.jar');
    expect(safePackPath('config/a/../b.toml')).toBe('config/b.toml');
  });
  it.each(['../evil.jar', 'mods/../../evil.jar', '/etc/passwd', 'C:/x.jar', 'mods\\a.jar', '', 'mods/', '..'])('rejects %s', (p) => {
    expect(() => safePackPath(p)).toThrow();
  });
});

describe('planPack', () => {
  const base = {
    formatVersion: 1, game: 'minecraft', versionId: '1', name: 'Pack',
    files: [
      { path: 'mods/a.jar', hashes: { sha1: sha }, downloads: ['https://cdn.modrinth.com/a.jar'], fileSize: 5 },
      { path: 'mods/server-only.jar', hashes: { sha1: sha }, env: { client: 'unsupported', server: 'required' }, downloads: ['https://cdn.modrinth.com/s.jar'] },
    ],
    dependencies: { minecraft: '1.20.1', 'fabric-loader': '0.15.7' },
  };
  it('reads loader, version and skips server-only files', () => {
    const plan = planPack(mrpackIndexSchema.parse(base));
    expect(plan.mcVersion).toBe('1.20.1');
    expect(plan.loader).toEqual({ type: 'fabric', version: '0.15.7' });
    expect(plan.files.map((f) => f.rel)).toEqual(['mods/a.jar']);
  });
  it('maps forge and neoforge', () => {
    expect(planPack(mrpackIndexSchema.parse({ ...base, dependencies: { minecraft: '1.20.1', forge: '47.2.0' } })).loader).toEqual({ type: 'forge', version: '47.2.0' });
    expect(planPack(mrpackIndexSchema.parse({ ...base, dependencies: { minecraft: '1.21.1', neoforge: '21.1.1' } })).loader.type).toBe('neoforge');
  });
  it('a pack without a loader is vanilla', () => {
    expect(planPack(mrpackIndexSchema.parse({ ...base, dependencies: { minecraft: '1.20.1' } })).loader).toEqual({ type: 'vanilla', version: null });
  });
  it('rejects two loaders, a missing Minecraft version and escaping paths', () => {
    expect(() => planPack(mrpackIndexSchema.parse({ ...base, dependencies: { minecraft: '1.20.1', forge: '1', 'fabric-loader': '2' } }))).toThrow(/нескольк/);
    expect(() => planPack(mrpackIndexSchema.parse({ ...base, dependencies: {} }))).toThrow(/версия Minecraft|версии Minecraft/);
    const bad = { ...base, files: [{ path: '../x.jar', hashes: { sha1: sha }, downloads: ['https://cdn.modrinth.com/x.jar'] }] };
    expect(() => planPack(mrpackIndexSchema.parse(bad))).toThrow();
  });
});

describe('mrpack reading and overrides', () => {
  async function makePack(entries: Record<string, string>): Promise<string> {
    const zip = new AdmZip();
    for (const [name, data] of Object.entries(entries)) zip.addFile(name, Buffer.from(data));
    const file = path.join(tmp, 'p.mrpack');
    zip.writeZip(file);
    return file;
  }
  const index = JSON.stringify({ formatVersion: 1, game: 'minecraft', name: 'P', files: [], dependencies: { minecraft: '1.20.1' } });

  it('reads the index', async () => {
    expect(readMrpackIndex(await makePack({ 'modrinth.index.json': index })).name).toBe('P');
  });
  it('fails without an index', async () => {
    expect(() => readMrpackIndex(path.join(tmp, 'missing.mrpack'))).toThrow();
    expect(() => readMrpackIndex(await_sync(makeBad()))).toThrow();
  });
  it('extracts overrides, client-overrides win', async () => {
    const pack = await makePack({
      'modrinth.index.json': index,
      'overrides/config/a.txt': 'base',
      'overrides/options.txt': 'o',
      'client-overrides/config/a.txt': 'client',
    });
    const game = path.join(tmp, 'game');
    expect(await extractOverrides(pack, game)).toBe(3);
    expect(await fs.readFile(path.join(game, 'config', 'a.txt'), 'utf8')).toBe('client');
    expect(await fs.readFile(path.join(game, 'options.txt'), 'utf8')).toBe('o');
  });
  it('refuses a zip-slip entry', async () => {
    const zip = new AdmZip();
    zip.addFile('modrinth.index.json', Buffer.from(index));
    zip.addFile('overrides/placeholder.txt', Buffer.from('x'));
    // AdmZip cleans names passed to addFile, so the hostile name is set afterwards, as a hand-made archive would have it
    zip.getEntry('overrides/placeholder.txt')!.entryName = 'overrides/../../evil.txt';
    const file = path.join(tmp, 'evil.mrpack');
    zip.writeZip(file);
    expect(new AdmZip(file).getEntries().some((e) => e.entryName.includes('..'))).toBe(true); // the archive really is hostile
    await expect(extractOverrides(file, path.join(tmp, 'game'))).rejects.toThrow();
    await expect(fs.access(path.join(tmp, 'evil.txt'))).rejects.toThrow();
  });

  function makeBad(): string {
    const f = path.join(tmp, 'bad.mrpack');
    const zip = new AdmZip();
    zip.addFile('readme.txt', Buffer.from('x'));
    zip.writeZip(f);
    return f;
  }
  function await_sync(f: string): string { return f; }
});

describe('planInstall (mods with dependencies)', () => {
  function stub(versions: Record<string, MrVersion[]>, titles: Record<string, string> = {}): ModrinthLike {
    return {
      async project(id) { return { id, title: titles[id] ?? id, description: '' }; },
      async version(id) {
        const v = Object.values(versions).flat().find((x) => x.id === id);
        if (!v) throw new Error('no version');
        return v;
      },
      async versions(id) { return versions[id] ?? []; },
    };
  }
  const gameDir = () => path.join(tmp, 'game');

  it('adds required dependencies once and skips optional ones', async () => {
    const api = stub({
      MODAAAAA: [ver({ id: 'v1', project_id: 'MODAAAAA', files: [{ url: 'https://cdn.modrinth.com/a.jar', filename: 'a.jar', primary: true, hashes: { sha1: sha } }],
        dependencies: [
          { project_id: 'LIBBBBBB', version_id: null, dependency_type: 'required' },
          { project_id: 'OPTCCCCC', version_id: null, dependency_type: 'optional' },
        ] })],
      LIBBBBBB: [ver({ id: 'v2', project_id: 'LIBBBBBB', files: [{ url: 'https://cdn.modrinth.com/lib.jar', filename: 'lib.jar', primary: true, hashes: { sha1: sha } }],
        dependencies: [{ project_id: 'MODAAAAA', version_id: null, dependency_type: 'required' }] })],
    });
    const plan = await planInstall(api, { gameDir: gameDir(), mcVersion: '1.20.1', loader: 'fabric', kind: 'mod' }, 'MODAAAAA');
    expect(plan.map((p) => path.basename(p.dest))).toEqual(['a.jar', 'lib.jar']);
    expect(plan[0]!.requested).toBe(true);
    expect(plan[1]!.requested).toBe(false);
    expect(plan[0]!.dest.startsWith(path.join(gameDir(), 'mods'))).toBe(true);
  });

  it('refuses vanilla instances', async () => {
    await expect(planInstall(stub({}), { gameDir: gameDir(), mcVersion: '1.20.1', loader: 'vanilla', kind: 'mod' }, 'MODAAAAA')).rejects.toThrow(/Vanilla/);
  });

  it('reports a missing compatible version', async () => {
    await expect(planInstall(stub({ MODAAAAA: [] }), { gameDir: gameDir(), mcVersion: '1.20.1', loader: 'fabric', kind: 'mod' }, 'MODAAAAA')).rejects.toThrow(/нет версии/);
  });

  it('rejects a wrong file type and a path-like file name', async () => {
    const wrongExt = stub({ MODAAAAA: [ver({ id: 'v1', project_id: 'MODAAAAA', files: [{ url: 'https://cdn.modrinth.com/a.exe', filename: 'a.exe', primary: true, hashes: { sha1: sha } }] })] });
    await expect(planInstall(wrongExt, { gameDir: gameDir(), mcVersion: '1.20.1', loader: 'fabric', kind: 'mod' }, 'MODAAAAA')).rejects.toThrow(/jar/);
    const traversal = stub({ MODAAAAA: [ver({ id: 'v1', project_id: 'MODAAAAA', files: [{ url: 'https://cdn.modrinth.com/a.jar', filename: '../a.jar', primary: true, hashes: { sha1: sha } }] })] });
    await expect(planInstall(traversal, { gameDir: gameDir(), mcVersion: '1.20.1', loader: 'fabric', kind: 'mod' }, 'MODAAAAA')).rejects.toThrow();
  });

  it('resource packs take no dependencies and go to resourcepacks', async () => {
    const api = stub({ PACKAAAA: [ver({ id: 'v1', project_id: 'PACKAAAA', loaders: ['minecraft'],
      files: [{ url: 'https://cdn.modrinth.com/p.zip', filename: 'p.zip', primary: true, hashes: { sha1: sha } }],
      dependencies: [{ project_id: 'LIBBBBBB', version_id: null, dependency_type: 'required' }] })] });
    const plan = await planInstall(api, { gameDir: gameDir(), mcVersion: '1.20.1', loader: 'vanilla', kind: 'resourcepack' }, 'PACKAAAA');
    expect(plan).toHaveLength(1);
    expect(plan[0]!.dest).toBe(path.join(gameDir(), 'resourcepacks', 'p.zip'));
  });

  it('says a mod is already installed when the index and the file exist', async () => {
    await fs.mkdir(path.join(gameDir(), 'mods'), { recursive: true });
    await fs.writeFile(path.join(gameDir(), 'mods', 'a.jar'), 'x');
    await fs.writeFile(path.join(gameDir(), '.chald-modrinth.json'), JSON.stringify({ projects: { MODAAAAA: { file: 'a.jar', versionId: 'v1' } } }));
    await expect(planInstall(stub({}), { gameDir: gameDir(), mcVersion: '1.20.1', loader: 'fabric', kind: 'mod' }, 'MODAAAAA')).rejects.toThrow(/уже установлен/);
  });

  it('lists installed projects: existing and disabled files count, missing ones do not', async () => {
    await fs.mkdir(path.join(gameDir(), 'mods'), { recursive: true });
    await fs.writeFile(path.join(gameDir(), 'mods', 'a.jar'), 'x');
    await fs.writeFile(path.join(gameDir(), 'mods', 'b.jar.disabled'), 'x');
    await fs.writeFile(path.join(gameDir(), '.chald-modrinth.json'), JSON.stringify({ projects: {
      AAAAAAAA: { file: 'a.jar', versionId: 'v1' }, BBBBBBBB: { file: 'b.jar', versionId: 'v2' }, CCCCCCCC: { file: 'gone.jar', versionId: 'v3' }, DDDDDDDD: { file: '../x.jar', versionId: 'v4' },
    } }));
    expect((await listInstalledProjects(gameDir(), 'mod')).sort()).toEqual(['AAAAAAAA', 'BBBBBBBB']);
    expect(await listInstalledProjects(gameDir(), 'resourcepack')).toEqual([]);
  });
});
