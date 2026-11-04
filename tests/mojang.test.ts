import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { MojangPage } from '../src/renderer/pages/Mojang';
import { NAV_PAGES } from '../src/renderer/components/Shell';
import { PRESENCE_PAGES } from '../src/shared/presence';
import { PAGE_LABELS } from '../src/main/presence';
import { bedrockUri, parseBedrockServer, storeUri } from '../src/shared/mojang';
import { appSettingsPatchSchema, mojangLaunchSchema } from '../src/shared/schemas';
import { launcherExeCandidates, MojangGames, parseAppx, type MojangDeps } from '../src/main/mojangGames';

const BEDROCK = { Name: 'Microsoft.MinecraftUWP', Family: 'Microsoft.MinecraftUWP_8wekyb3d8bbwe', AppId: 'App' };
const LAUNCHER = { Name: 'Microsoft.4297127D64EC6', Family: 'Microsoft.4297127D64EC6_8wekyb3d8bbwe', AppId: 'Minecraft' };

function make(over: Partial<MojangDeps> & { pkgs?: unknown; files?: string[] } = {}) {
  const calls = { uri: [] as string[], spawn: [] as [string, string[]][] };
  const deps: MojangDeps = {
    platform: 'win32',
    env: { 'ProgramFiles(x86)': 'C:\\Program Files (x86)', ProgramFiles: 'C:\\Program Files' },
    powershell: async () => JSON.stringify(over.pkgs ?? []),
    exists: async (f) => (over.files ?? []).includes(f),
    openUri: async (u) => { calls.uri.push(u); },
    spawnDetached: (f, a) => { calls.spawn.push([f, a]); },
    ...over,
  };
  return { games: new MojangGames(deps), calls };
}

describe('parseAppx', () => {
  it('handles empty output, a single object, arrays and a BOM', () => {
    expect(parseAppx('')).toEqual([]);
    expect(parseAppx('  \n')).toEqual([]);
    expect(parseAppx(JSON.stringify(BEDROCK))).toEqual([{ name: 'Microsoft.MinecraftUWP', family: BEDROCK.Family, appId: 'App' }]);
    expect(parseAppx(`\uFEFF${JSON.stringify([BEDROCK, LAUNCHER])}`)).toHaveLength(2);
    expect(parseAppx(JSON.stringify([{ Name: 'X', Family: 'F', AppId: null }]))).toEqual([{ name: 'X', family: 'F', appId: null }]);
  });
  it('ignores garbage and unsafe values (they would end up in a command line)', () => {
    expect(parseAppx('not json')).toEqual([]);
    expect(parseAppx('[1,"a",null]')).toEqual([]);
    expect(parseAppx(JSON.stringify([{ Name: 'X', Family: 'a b&calc', AppId: 'x' }]))).toEqual([]);
    expect(parseAppx(JSON.stringify([{ Name: 'X', Family: 'Fam', AppId: '!evil && calc' }]))).toEqual([{ name: 'X', family: 'Fam', appId: null }]);
  });
});

describe('server validation', () => {
  it('accepts plain hosts, IPv4 and sane names', () => {
    expect(parseBedrockServer({ name: ' My server ', host: 'Play.Example.com', port: 19132 })).toEqual({ name: 'My server', host: 'play.example.com', port: 19132 });
    expect(parseBedrockServer({ name: 'x', host: '192.168.0.5', port: 1 })).not.toBeNull();
  });
  it('refuses anything that could change the URI', () => {
    for (const host of ['', 'a b', 'a.com&x=1', 'a.com|b', 'a.com/path', 'a.com:1', '-a.com', 'a..com', '[::1]', 'a.com#x']) {
      expect(parseBedrockServer({ name: 'ok', host, port: 19132 }), host).toBeNull();
    }
    for (const name of ['', 'a|b', 'a&b', 'a=b', '😀', 'x'.repeat(33), 'a\nb']) {
      expect(parseBedrockServer({ name, host: 'a.com', port: 19132 }), name).toBeNull();
    }
    for (const port of [0, 65536, -1, 1.5, NaN]) expect(parseBedrockServer({ name: 'ok', host: 'a.com', port }), String(port)).toBeNull();
  });
  it('builds the URIs', () => {
    expect(bedrockUri()).toBe('minecraft:');
    expect(bedrockUri({ name: 'My server', host: 'play.example.com', port: 19133 })).toBe('minecraft://?addExternalServer=My%20server|play.example.com:19133');
    expect(storeUri('bedrock')).toBe('ms-windows-store://pdp/?ProductId=9NBLGGH2JHXJ');
    expect(storeUri('launcher')).toBe('ms-windows-store://pdp/?ProductId=9PGW18NPBZV5');
  });
});

describe('MojangGames', () => {
  it('is unsupported (and does nothing) outside Windows', async () => {
    const { games, calls } = make({ platform: 'linux' });
    expect(await games.status()).toEqual({ supported: false, launcherFound: false, games: [] });
    await expect(games.launch('bedrock')).rejects.toMatchObject({ code: 'MOJANG_UNSUPPORTED' });
    await expect(games.openStore('bedrock')).rejects.toMatchObject({ code: 'MOJANG_UNSUPPORTED' });
    expect(calls.uri).toEqual([]);
  });

  it('reports what is installed', async () => {
    const none = await make().games.status();
    expect(none.games.map((g) => g.state)).toEqual(['missing', 'missing', 'missing']);
    const some = await make({ pkgs: [BEDROCK] }).games.status();
    expect(some.games.map((g) => `${g.id}:${g.state}:${g.via}`)).toEqual(['bedrock:ready:direct', 'dungeons:missing:launcher', 'legends:missing:launcher']);
    const all = await make({ pkgs: [BEDROCK, LAUNCHER] }).games.status();
    expect(all).toMatchObject({ supported: true, launcherFound: true });
    expect(all.games.every((g) => g.state === 'ready')).toBe(true);
  });

  it('a failing PowerShell does not break the page', async () => {
    const { games } = make({ powershell: async () => { throw new Error('blocked'); } });
    expect((await games.status()).games.every((g) => g.state === 'missing')).toBe(true);
  });

  it('starts Bedrock through the minecraft: protocol, optionally with a server', async () => {
    const { games, calls } = make({ pkgs: [BEDROCK] });
    await games.launch('bedrock');
    await games.launch('bedrock', { name: 'My server', host: 'play.example.com', port: 19132 });
    expect(calls.uri).toEqual(['minecraft:', 'minecraft://?addExternalServer=My%20server|play.example.com:19132']);
  });

  it('refuses a bad server before anything is opened, and a missing game', async () => {
    const { games, calls } = make({ pkgs: [BEDROCK] });
    await expect(games.launch('bedrock', { name: 'x', host: 'evil.com&a=b', port: 19132 })).rejects.toMatchObject({ code: 'MOJANG_BAD_SERVER' });
    expect(calls.uri).toEqual([]);
    await expect(make().games.launch('bedrock')).rejects.toMatchObject({ code: 'MOJANG_NOT_FOUND' });
  });

  it('Dungeons / Legends open the official launcher: the program file first, otherwise the Store app', async () => {
    const exe = launcherExeCandidates({ ProgramFiles: 'C:\\Program Files' })[0]!;
    const a = make({ files: [exe] });
    await a.games.launch('dungeons');
    expect(a.calls.spawn).toEqual([[exe, []]]);

    const b = make({ pkgs: [LAUNCHER] });
    await b.games.launch('legends');
    expect(b.calls.spawn).toEqual([['explorer.exe', ['shell:AppsFolder\\Microsoft.4297127D64EC6_8wekyb3d8bbwe!Minecraft']]]);

    await expect(make().games.launch('dungeons')).rejects.toMatchObject({ code: 'MOJANG_NOT_FOUND' });
  });

  it('a Store launcher without an application id cannot be started (no guessing)', async () => {
    const { games } = make({ pkgs: [{ ...LAUNCHER, AppId: null }] });
    expect((await games.status()).launcherFound).toBe(false);
  });

  it('opens the right Store page', async () => {
    const { games, calls } = make();
    await games.openStore('bedrock');
    await games.openStore('dungeons');
    await games.openStore('legends');
    expect(calls.uri).toEqual([storeUri('bedrock'), storeUri('launcher'), storeUri('launcher')]);
  });

  it('looks for the launcher in both Program Files folders', () => {
    expect(launcherExeCandidates({ 'ProgramFiles(x86)': 'C:\\A', ProgramFiles: 'C:\\B' })).toEqual(['C:\\A\\Minecraft Launcher\\MinecraftLauncher.exe', 'C:\\B\\Minecraft Launcher\\MinecraftLauncher.exe']);
    expect(launcherExeCandidates({})).toEqual([]);
  });
});

describe('IPC schemas', () => {
  it('the page can be hidden like the others', () => {
    expect(appSettingsPatchSchema.safeParse({ hiddenPages: ['mojang', 'console'] }).success).toBe(true);
    expect(appSettingsPatchSchema.safeParse({ hiddenPages: ['nope'] }).success).toBe(false);
  });
  it('launch takes only known games and a typed server', () => {
    expect(mojangLaunchSchema.safeParse({ game: 'bedrock' }).success).toBe(true);
    expect(mojangLaunchSchema.safeParse({ game: 'bedrock', server: { name: 'a', host: 'b.c', port: 19132 } }).success).toBe(true);
    expect(mojangLaunchSchema.safeParse({ game: 'java' }).success).toBe(false);
    expect(mojangLaunchSchema.safeParse({ game: 'bedrock', uri: 'file:///c:/x.exe' }).success).toBe(true); // extra keys are stripped, never used
  });
});

describe('the page', () => {
  it('renders its header, the Store note and the three games without a bridge to the main process', () => {
    const html = renderToString(createElement(MojangPage));
    expect(html).toContain('Другие игры Mojang');
    expect(html).toContain('Microsoft Store');
    for (const name of ['Minecraft Bedrock', 'Minecraft Dungeons', 'Minecraft Legends']) expect(html).toContain(name);
  });
  it('is in the sidebar, in the Discord statuses of every language, and can be hidden', () => {
    expect(NAV_PAGES.some((n) => n.page === 'mojang')).toBe(true);
    expect(PRESENCE_PAGES).toContain('mojang');
    for (const lang of ['en', 'ru', 'kk', 'be'] as const) expect(PAGE_LABELS[lang].mojang.length).toBeGreaterThan(2);
  });
});
