import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { createHash } from 'node:crypto';
import AdmZip from 'adm-zip';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { listContent } from '../src/main/content';
import { exportInstance, inspectPack, installedIndexFor, packToPlan } from '../src/main/chaldpack';
import { extractOverrides, type MrVersion } from '../src/main/modrinth';
import type { InstanceMeta } from '../src/shared/types';

let tmp: string;
beforeEach(async () => { tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'chald-pack-')); });
afterEach(async () => { await fs.rm(tmp, { recursive: true, force: true }); });

const sha = (s: string) => createHash('sha1').update(s).digest('hex');
const meta: InstanceMeta = {
  schemaVersion: 1, id: 'x', name: 'Моя сборка', description: 'd', mcVersion: '1.20.1', loader: { type: 'fabric', version: '0.15.0' },
  kind: 'modded', versionId: null, installed: false, createdAt: '', lastPlayedAt: null, coverColor: 3, coverFile: null,
  settings: { javaPath: '', memoryMinMb: null, memoryMaxMb: null, jvmArgs: '', width: null, height: null, fullscreen: null },
};

function version(id: string, projectId: string, filename: string, content: string): MrVersion {
  return {
    id, project_id: projectId, name: '', version_number: '1', version_type: 'release', game_versions: ['1.20.1'], loaders: ['fabric'], dependencies: [],
    files: [{ url: `https://cdn.modrinth.com/data/${projectId}/${filename}`, filename, primary: true, size: content.length, hashes: { sha1: sha(content) } }],
  };
}

async function makeGameDir(): Promise<string> {
  const g = path.join(tmp, 'game');
  for (const f of [
    ['mods/sodium.jar', 'SODIUM'], ['mods/changed.jar', 'LOCAL-EDIT'], ['mods/own.jar', 'OWN'], ['mods/off.jar.disabled', 'OFF'], ['resourcepacks/pack.zip', 'PACK'],
    ['config/a.toml', 'cfg'], ['options.txt', 'opt'], ['logs/latest.log', 'log'], ['crash-reports/c.txt', 'c'], ['saves/W/level.dat', 'world'],
    ['.chald-modrinth.json', JSON.stringify({ projects: {
      AAAAAAAA: { file: 'sodium.jar', versionId: 'VERAAAAA' }, BBBBBBBB: { file: 'changed.jar', versionId: 'VERBBBBB' },
      CCCCCCCC: { file: 'off.jar', versionId: 'VERCCCCC' }, DDDDDDDD: { file: 'pack.zip', versionId: 'VERDDDDD' },
    } })],
  ] as const) {
    await fs.mkdir(path.dirname(path.join(g, f[0])), { recursive: true });
    await fs.writeFile(path.join(g, f[0]), f[1]);
  }
  return g;
}

const api = {
  async version(id: string): Promise<MrVersion> {
    const v: Record<string, MrVersion> = {
      VERAAAAA: version('VERAAAAA', 'AAAAAAAA', 'sodium.jar', 'SODIUM'),
      VERBBBBB: version('VERBBBBB', 'BBBBBBBB', 'changed.jar', 'ORIGINAL'),
      VERCCCCC: version('VERCCCCC', 'CCCCCCCC', 'off.jar', 'OFF'),
      VERDDDDD: version('VERDDDDD', 'DDDDDDDD', 'pack.zip', 'PACK'),
    };
    const r = v[id]; if (!r) throw new Error('404'); return r;
  },
};

async function doExport(includeWorlds = false) {
  const game = await makeGameDir();
  const out = path.join(tmp, 'out.chaldlauncher');
  const res = await exportInstance({ gameDir: game, meta, includeWorlds, out, api, report: () => undefined });
  return { game, out, res };
}

describe('.chaldlauncher export', () => {
  it('lists unchanged Modrinth files and packs everything else', async () => {
    const { out, res } = await doExport();
    expect(res.downloads).toBe(3); // sodium, disabled mod, resource pack
    expect(res.notices.join('\n')).toContain('changed.jar');
    const zip = new AdmZip(out);
    const names = zip.getEntries().map((e) => e.entryName).sort();
    expect(names).toEqual(['chaldlauncher.json', 'overrides/config/a.toml', 'overrides/mods/changed.jar', 'overrides/mods/own.jar', 'overrides/options.txt']);
    const m = JSON.parse(zip.readAsText('chaldlauncher.json'));
    expect(m.files.map((f: { path: string }) => f.path)).toEqual(['mods/off.jar.disabled', 'mods/sodium.jar', 'resourcepacks/pack.zip']);
    expect(m.name).toBe('Моя сборка');
  });

  it('packs worlds only when asked', async () => {
    const { out } = await doExport(true);
    expect(new AdmZip(out).getEntry('overrides/saves/W/level.dat')).not.toBeNull();
  });

  it('round-trips through inspectPack and rebuilds the installed index', async () => {
    const { out } = await doExport();
    const { manifest, summary } = inspectPack(out);
    expect(summary).toMatchObject({ downloads: 3, overrideFiles: 4, mcVersion: '1.20.1' });
    expect(packToPlan(manifest).files[0]!.urls[0]).toMatch(/^https:\/\/cdn\.modrinth\.com\//);
    expect(installedIndexFor(manifest).projects.CCCCCCCC).toEqual({ file: 'off.jar', versionId: 'VERCCCCC' });
    const dest = path.join(tmp, 'restored');
    await extractOverrides(out, dest);
    expect(await fs.readFile(path.join(dest, 'mods/own.jar'), 'utf8')).toBe('OWN');
  });
});

describe('.chaldlauncher import is hostile-input safe', () => {
  const base = {
    format: 'chaldlauncher-instance', formatVersion: 1, name: 'N', description: '', mcVersion: '1.20.1',
    loader: { type: 'vanilla', version: null }, kind: 'custom', coverColor: 0, files: [] as unknown[],
  };
  async function pack(manifest: unknown, extra: Record<string, string> = {}): Promise<string> {
    const zip = new AdmZip();
    zip.addFile('chaldlauncher.json', Buffer.from(JSON.stringify(manifest)));
    for (const [k, v] of Object.entries(extra)) zip.addFile(k, Buffer.from(v));
    const f = path.join(tmp, `p${Math.random().toString(16).slice(2)}.chaldlauncher`);
    zip.writeZip(f);
    return f;
  }
  const file = (over: object) => ({ path: 'mods/a.jar', sha1: 'a'.repeat(40), url: 'https://cdn.modrinth.com/a.jar', projectId: 'AAAAAAAA', versionId: 'VERAAAAA', ...over });

  it('accepts a valid pack', async () => {
    expect(inspectPack(await pack({ ...base, files: [file({})] }, { 'overrides/config/x.toml': 'x' })).summary.overrideFiles).toBe(1);
  });
  it('rejects downloads from other hosts, http and odd paths', async () => {
    for (const bad of [{ url: 'https://evil.example/a.jar' }, { url: 'http://cdn.modrinth.com/a.jar' }, { path: '../a.jar' }, { path: 'config/a.jar' }, { path: 'mods/../../a.jar' }]) {
      const f = await pack({ ...base, files: [file(bad)] });
      expect(() => inspectPack(f), JSON.stringify(bad)).toThrow();
    }
  });
  it('rejects files outside overrides/', async () => {
    const outside = await pack(base, { 'client-overrides/a.txt': 'x' });
    expect(() => inspectPack(outside)).toThrow(/Лишний файл/);
  });
  it('rejects a file listed for download and also packed, and non-packs', async () => {
    const dup = await pack({ ...base, files: [file({})] }, { 'overrides/mods/a.jar': 'x' });
    expect(() => inspectPack(dup)).toThrow(/и в списке загрузки/);
    const junk = path.join(tmp, 'junk.chaldlauncher');
    await fs.writeFile(junk, 'not a zip');
    expect(() => inspectPack(junk)).toThrow();
  });
});

describe('mod icons and names in the mods tab', () => {
  const png = Buffer.from('89504e470d0a1a0a', 'hex');
  async function jar(name: string, files: Record<string, string | Buffer>): Promise<string> {
    const dir = path.join(tmp, 'g', 'mods');
    await fs.mkdir(dir, { recursive: true });
    const z = new AdmZip();
    for (const [k, v] of Object.entries(files)) z.addFile(k, Buffer.isBuffer(v) ? v : Buffer.from(v));
    z.writeZip(path.join(dir, name));
    return path.join(tmp, 'g');
  }

  it('reads a Fabric icon given as a string or as a size map', async () => {
    await jar('a.jar', { 'fabric.mod.json': JSON.stringify({ name: 'A', version: '1', icon: { '16': 'small.png', '128': 'assets/a/big.png' } }), 'assets/a/big.png': png, 'small.png': Buffer.from('x') });
    const [e] = await listContent(path.join(tmp, 'g'), 'mods', 'fabric');
    expect(e!.name).toBe('A');
    expect(e!.iconDataUrl).toBe(`data:image/png;base64,${png.toString('base64')}`);
  });

  it('reads name, version and logoFile from neoforge.mods.toml', async () => {
    const toml = 'modLoader="javafml"\nlicense="MIT"\n[[mods]]\nmodId="sodium"\nversion="${file.jarVersion}"\ndisplayName="Sodium"\nlogoFile="logo.png"\n[[dependencies.sodium]]\nmodId="x"\n';
    const g = await jar('s.jar', { 'META-INF/neoforge.mods.toml': toml, 'logo.png': png });
    const [e] = await listContent(g, 'mods', 'neoforge');
    expect(e).toMatchObject({ name: 'Sodium', version: null });
    expect(e!.iconDataUrl).toContain('data:image/png;base64,');
    expect(e!.warning).toBeNull();
  });

  it('ignores icons that are missing, not images or too big', async () => {
    const g = await jar('b.jar', { 'fabric.mod.json': JSON.stringify({ name: 'B', icon: 'evil.svg' }), 'evil.svg': '<svg/>' });
    expect((await listContent(g, 'mods', 'fabric'))[0]!.iconDataUrl).toBeNull();
  });
});

describe('network failures', () => {
  it('turn "fetch failed" into a readable error after retrying', async () => {
    const { __allowHostForTests, netRequest, getNetLog } = await import('../src/main/net');
    __allowHostForTests('127.0.0.1');
    const { createServer } = await import('node:net');
    const srv = createServer();
    await new Promise<void>((r) => srv.listen(0, '127.0.0.1', r));
    const port = (srv.address() as { port: number }).port;
    await new Promise((r) => srv.close(r)); // now nothing listens there
    const before = getNetLog().length;
    await expect(netRequest(`http://127.0.0.1:${port}/x`, { purpose: 'test' })).rejects.toMatchObject({ code: 'NET_FAILED', message: expect.stringMatching(/Нет связи с 127\.0\.0\.1:\d+.*отклонил/) });
    expect(getNetLog().length - before).toBe(3); // 3 attempts are visible in the log
  });
});
