import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { createHash } from 'node:crypto';
import AdmZip from 'adm-zip';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { checkInstalledMods, findUpdate, updateInstalledMod, type ModCheckApi } from '../src/main/modUpdates';
import { ModrinthApi, type MrVersionDetail } from '../src/main/modrinth';

let tmp: string;
beforeEach(async () => { tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'chald-upd-')); });
afterEach(async () => { await fs.rm(tmp, { recursive: true, force: true }); });

// the real client must satisfy the interface the update checker is written against
const _real: ModCheckApi = new ModrinthApi('test');
void _real;

const sha = (b: Buffer) => createHash('sha1').update(b).digest('hex');

function detail(id: string, type: 'release' | 'beta' | 'alpha', file: string, content: Buffer): MrVersionDetail {
  return {
    id, project_id: 'PROJAAAA', name: id, version_number: id, version_type: type, game_versions: ['1.21.1'], loaders: ['neoforge'],
    files: [{ url: `https://cdn.modrinth.com/data/PROJAAAA/${file}`, filename: file, primary: true, size: content.length, hashes: { sha1: sha(content) } }],
    dependencies: [], date_published: '2026-01-01T00:00:00Z', downloads: 1, changelog: 'log',
  };
}

const oldJar = (() => { const z = new AdmZip(); z.addFile('META-INF/neoforge.mods.toml', Buffer.from('[[mods]]\nmodId="a"\ndisplayName="A"\n')); return z.toBuffer(); })();
const newJar = Buffer.from('NEW-JAR');

function fakeApi(versions: MrVersionDetail[], oldHash: string): ModCheckApi {
  const [latest] = versions;
  return {
    async project() { return { id: 'PROJAAAA', title: 'A', description: '' }; },
    async version(id: string) { const v = versions.find((x) => x.id === id); if (!v) throw new Error('404'); return v; },
    async versions() { return versions; },
    async identify(h: string[]) { return h.includes(oldHash) ? { [oldHash]: versions.find((v) => v.id === 'v1')! } : {}; },
    async latest(h: string[]) { return h.includes(oldHash) ? { [oldHash]: latest! } : {}; },
    async projectsLite() { return [{ id: 'PROJAAAA', slug: 'a', title: 'Mod A', icon_url: null }]; },
    async versionDetails() { return versions; },
    async iconData() { return null; },
  } as unknown as ModCheckApi;
}

describe('mod update check', () => {
  it('finds updates by hash and never replaces a release with a beta', async () => {
    const v1 = detail('v1', 'release', 'a-1.jar', oldJar);
    const v2beta = detail('v2', 'beta', 'a-2b.jar', newJar);
    const v3 = detail('v3', 'release', 'a-3.jar', Buffer.from('R3'));
    const api = fakeApi([v2beta, v1], sha(oldJar));
    expect(await findUpdate(api, v1, v2beta, { mcVersion: '1.21.1', loader: 'neoforge' })).toBeNull(); // only a beta is newer
    const api2 = fakeApi([v3, v2beta, v1], sha(oldJar));
    expect((await findUpdate(api2, v1, v2beta, { mcVersion: '1.21.1', loader: 'neoforge' }))?.id).toBe('v3');
  });

  it('reports the mods of an instance with their Modrinth data and the update', async () => {
    const mods = path.join(tmp, 'mods');
    await fs.mkdir(mods);
    await fs.writeFile(path.join(mods, 'a-1.jar'), oldJar);
    await fs.writeFile(path.join(mods, 'own.jar'), 'own');
    const v1 = detail('v1', 'release', 'a-1.jar', oldJar);
    const v2 = detail('v2', 'release', 'a-2.jar', newJar);
    const r = await checkInstalledMods(fakeApi([v2, v1], sha(oldJar)), { gameDir: tmp, mcVersion: '1.21.1', loader: 'neoforge' });
    expect(r.error).toBeNull();
    const a = r.mods.find((m) => m.file === 'a-1.jar')!;
    expect(a).toMatchObject({ source: 'modrinth', projectId: 'PROJAAAA', name: 'Mod A', update: { versionId: 'v2', fileName: 'a-2.jar' } });
    expect(r.mods.find((m) => m.file === 'own.jar')).toMatchObject({ source: 'unknown', update: null });
  });

  it('keeps the local list when Modrinth fails', async () => {
    const mods = path.join(tmp, 'mods');
    await fs.mkdir(mods);
    await fs.writeFile(path.join(mods, 'a-1.jar'), oldJar);
    const api = { ...fakeApi([], 'x'), identify: async () => { throw new Error('offline'); } } as unknown as ModCheckApi;
    const r = await checkInstalledMods(api, { gameDir: tmp, mcVersion: '1.21.1', loader: 'neoforge' });
    expect(r.error).toBe('offline');
    expect(r.mods).toHaveLength(1);
  });

  it('refuses to update a mod that is not on Modrinth', async () => {
    const mods = path.join(tmp, 'mods');
    await fs.mkdir(mods);
    await fs.writeFile(path.join(mods, 'own.jar'), 'own');
    await expect(updateInstalledMod(fakeApi([], 'x'), { gameDir: tmp, mcVersion: '1.21.1', loader: 'neoforge' }, 'own.jar', () => undefined)).rejects.toMatchObject({ code: 'NOT_ON_MODRINTH' });
  });
});
