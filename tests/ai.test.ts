import { describe, expect, it, vi } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import AdmZip from 'adm-zip';

vi.mock('../src/main/versions', () => ({
  loaderVersions: vi.fn(async (loader: string, mc: string) => {
    if (loader === 'fabric' && mc === '1.21.1') return [{ version: '0.16.9', stable: true }, { version: '0.16.8', stable: true }];
    if (loader === 'forge' && mc === '1.21.1') return [{ version: '52.0.40', stable: true }, { version: '52.0.10', stable: true, recommended: true }];
    return [];
  }),
}));

import { AI_TOOL_DEFS, cleanDescription, runAiTool } from '../src/main/aiTools';
import { readLocalModDetails } from '../src/main/content';

function fakeServices() {
  const created: unknown[] = [];
  const instances = [
    { id: 'my-pack', name: 'Моя сборка', mcVersion: '1.21.1', loader: { type: 'fabric', version: '0.16.9' }, state: 'ready', settings: {}, modCount: 3, running: false },
  ];
  const s = {
    appVersion: '9.9.9',
    ctx: () => ({ running: new Set(), installing: new Set() }),
    installs: new Map(),
    lastOp: () => null,
    settings: { get: async () => ({ jvmArgs: '', memoryAuto: true, memoryMinMb: null, memoryMaxMb: null, language: 'ru' }) },
    catalog: {
      getManifest: async () => ({ versions: [
        { id: '1.21.4', type: 'release', releaseTime: '2024-12-03T00:00:00Z' },
        { id: '1.21.1', type: 'release', releaseTime: '2024-08-08T00:00:00Z' },
      ] }),
      minecraft: async () => [
        { id: '1.21.4', type: 'release', releaseTime: '2024-12-03T00:00:00Z' },
        { id: '1.21.1', type: 'release', releaseTime: '2024-08-08T00:00:00Z' },
      ],
    },
    instances: {
      list: async () => instances,
      create: async (input: { name: string; mcVersion: string; loader: unknown }) => {
        created.push(input);
        return { id: 'new-1', name: input.name, mcVersion: input.mcVersion, loader: input.loader, state: 'not-installed' };
      },
    },
    startInstall: vi.fn(),
  };
  return { s: s as never, created, startInstall: s.startInstall };
}

describe('runAiTool', () => {
  it('rejects invalid JSON arguments with a hint instead of guessing', async () => {
    const { s } = fakeServices();
    const r = JSON.parse(await runAiTool(s, 'get_instance', '{oops'));
    expect(r.code).toBe('AI_ARGS');
    expect(r.hint).toBeTruthy();
  });

  it('lists the available tools for an unknown tool name', async () => {
    const { s } = fakeServices();
    const r = JSON.parse(await runAiTool(s, 'install_mods', '{}'));
    expect(r.error).toContain('Unknown tool');
    expect(r.hint).toContain('install_mod');
  });

  it('finds an instance by name as well as by id, and accepts instanceId/id aliases', async () => {
    const { s } = fakeServices();
    for (const args of [{ instance: 'Моя сборка' }, { instance: 'my-pack' }, { instanceId: 'моя' }, { id: 'my-pack' }]) {
      const r = JSON.parse(await runAiTool(s, 'get_instance', JSON.stringify(args)));
      expect(r.id).toBe('my-pack');
    }
  });

  it('lists real instances in the error for an unknown instance', async () => {
    const { s } = fakeServices();
    const r = JSON.parse(await runAiTool(s, 'get_instance', JSON.stringify({ instance: 'zzz' })));
    expect(r.code).toBe('INSTANCE_NOT_FOUND');
    expect(r.error).toContain('my-pack');
  });

  it('create_instance picks the loader version itself and validates Minecraft', async () => {
    const { s, created, startInstall } = fakeServices();
    const r = JSON.parse(await runAiTool(s, 'create_instance', JSON.stringify({ name: 'Test', mcVersion: '1.21.1', loader: 'Fabric', install: true })));
    expect(r.ok).toBe(true);
    expect(r.loader).toEqual({ type: 'fabric', version: '0.16.9' });
    expect((created[0] as { loader: { version: string } }).loader.version).toBe('0.16.9');
    expect(startInstall).toHaveBeenCalledWith('new-1');

    const forge = JSON.parse(await runAiTool(s, 'create_instance', JSON.stringify({ name: 'F', mcVersion: '1.21.1', loader: 'forge' })));
    expect(forge.loader.version).toBe('52.0.10'); // the recommended build

    const bad = JSON.parse(await runAiTool(s, 'create_instance', JSON.stringify({ name: 'X', mcVersion: '1.99', loader: 'fabric' })));
    expect(bad.code).toBe('VERSION_UNKNOWN');
  });

  it('create_instance explains which loaders do work when the loader does not support the version', async () => {
    const { s } = fakeServices();
    const r = JSON.parse(await runAiTool(s, 'create_instance', JSON.stringify({ name: 'X', mcVersion: '1.21.4', loader: 'forge' })));
    expect(r.code).toBe('LOADER_INCOMPATIBLE');
  });

  it('create_instance reuses an identical instance instead of duplicating it', async () => {
    const { s, created } = fakeServices();
    const r = JSON.parse(await runAiTool(s, 'create_instance', JSON.stringify({ name: 'моя сборка', mcVersion: '1.21.1', loader: 'fabric' })));
    expect(r.reusedExisting).toBe(true);
    expect(created).toHaveLength(0);
  });

  it('get_loader_versions without a loader reports support for every loader', async () => {
    const { s } = fakeServices();
    const r = JSON.parse(await runAiTool(s, 'get_loader_versions', JSON.stringify({ mcVersion: '1.21.1' })));
    const by = Object.fromEntries(r.loaders.map((l: { loader: string; supported: boolean }) => [l.loader, l.supported]));
    expect(by).toEqual({ fabric: true, quilt: false, forge: true, neoforge: false });
  });

  it('list_minecraft_versions filters by prefix', async () => {
    const { s } = fakeServices();
    const r = JSON.parse(await runAiTool(s, 'list_minecraft_versions', JSON.stringify({ query: '1.21.1' })));
    expect(r.latestRelease).toBe('1.21.4');
    expect(r.versions.map((v: { id: string }) => v.id)).toEqual(['1.21.1']);
  });
});

describe('tool definitions', () => {
  it('every instance tool uses the same `instance` argument', () => {
    for (const t of AI_TOOL_DEFS) {
      const props = Object.keys((t.parameters as { properties: object }).properties);
      expect(props, t.name).not.toContain('instanceId');
      expect(props, t.name).not.toContain('id');
    }
  });
});

describe('cleanDescription', () => {
  it('strips images, html and link targets but keeps the text', () => {
    const out = cleanDescription('# Title\n![shot](http://x/y.png)\n<p>Adds <b>sodium</b> support</p>\nSee [the wiki](https://w.example/x)');
    expect(out).not.toMatch(/http|<|!\[/);
    expect(out).toContain('Adds sodium support');
    expect(out).toContain('See the wiki');
  });
});

describe('readLocalModDetails', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'chald-ai-'));
  fs.mkdirSync(path.join(tmp, 'mods'));

  it('reads the description of a Fabric mod', async () => {
    const z = new AdmZip();
    z.addFile('fabric.mod.json', Buffer.from(JSON.stringify({
      id: 'cool', name: 'Cool Mod', version: '1.2.3', description: 'Makes things cool.',
      authors: ['Ann', { name: 'Bob' }], depends: { fabricloader: '*', minecraft: '1.21', 'fabric-api': '*' },
    })));
    z.writeZip(path.join(tmp, 'mods', 'cool.jar'));
    const d = await readLocalModDetails(tmp, 'cool.jar');
    expect(d).toMatchObject({ loader: 'fabric', modId: 'cool', name: 'Cool Mod', description: 'Makes things cool.', authors: ['Ann', 'Bob'], depends: ['fabric-api'] });
  });

  it('reads multi-line descriptions and required dependencies of a Forge mod', async () => {
    const toml = `modLoader="javafml"\nlicense="MIT"\n[[mods]]\nmodId="forgy"\nversion="2.0"\ndisplayName="Forgy"\nauthors="Zed"\ndescription='''\nLine one\nline two\n'''\n[[dependencies.forgy]]\nmodId="forge"\nmandatory=true\n[[dependencies.forgy]]\nmodId="geckolib"\nmandatory=true\n[[dependencies.forgy]]\nmodId="jei"\nmandatory=false\n`;
    const z = new AdmZip();
    z.addFile('META-INF/mods.toml', Buffer.from(toml));
    z.writeZip(path.join(tmp, 'mods', 'forgy.jar'));
    const d = await readLocalModDetails(tmp, 'forgy.jar');
    expect(d).toMatchObject({ loader: 'forge', modId: 'forgy', name: 'Forgy', description: 'Line one line two', license: 'MIT', depends: ['geckolib'] });
  });
});

import { retryAfterMs } from '../src/main/ai';
describe('retryAfterMs', () => {
  it('reads the wait time from a Groq rate-limit message', () => {
    expect(retryAfterMs('AI HTTP 429: Rate limit reached ... Please try again in 16.785s. Need more tokens?')).toBe(17_285 + 0);
    expect(retryAfterMs('try again in 1m3.5s')).toBe(64_000);
    expect(retryAfterMs('quota exceeded')).toBeNull();
  });
});
