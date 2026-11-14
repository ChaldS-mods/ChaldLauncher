import { describe, expect, it } from 'vitest';
import * as path from 'node:path';
import { buildLaunchCommand, redact, splitArgs, type LaunchInput } from '../src/main/launchArgs';
import { mergeVersions, resolveLibraries, rulesAllow, type Platform, type VersionJson } from '../src/main/versionJson';

const linux: Platform = { name: 'linux', arch: 'x64', version: '6.1' };
const win: Platform = { name: 'windows', arch: 'x64', version: '10.0' };

const vanilla: VersionJson = {
  id: '1.21.1', type: 'release', mainClass: 'net.minecraft.client.main.Main',
  assetIndex: { id: '17', url: 'u', sha1: 's', size: 1 }, assets: '17',
  downloads: { client: { url: 'c', sha1: 'x', size: 5 } },
  javaVersion: { majorVersion: 21 },
  libraries: [
    { name: 'org.a:one:1.0', downloads: { artifact: { path: 'org/a/one/1.0/one-1.0.jar', url: 'u1' } } },
    { name: 'org.b:win:1.0', downloads: { artifact: { path: 'org/b/win/1.0/win-1.0.jar', url: 'u2' } }, rules: [{ action: 'allow', os: { name: 'windows' } }] },
  ],
  arguments: {
    jvm: [
      { rules: [{ action: 'allow', os: { name: 'osx' } }], value: '-XstartOnFirstThread' },
      '-Djava.library.path=${natives_directory}', '-cp', '${classpath}',
    ],
    game: [
      '--username', '${auth_player_name}', '--version', '${version_name}', '--gameDir', '${game_directory}',
      '--accessToken', '${auth_access_token}',
      { rules: [{ action: 'allow', features: { has_custom_resolution: true } }], value: ['--width', '${resolution_width}', '--height', '${resolution_height}'] },
      { rules: [{ action: 'allow', features: { is_demo_user: true } }], value: '--demo' },
    ],
  },
};

const base = (over: Partial<LaunchInput> = {}): LaunchInput => ({
  version: vanilla, platform: linux, javaPath: '/usr/bin/java', gameDir: '/g', assetsDir: '/a', librariesDir: '/l', nativesDir: '/n',
  clientJar: '/v/1.21.1.jar', auth: { name: 'Steve', uuid: 'u-u-i-d', accessToken: 'SECRET-TOKEN' },
  memoryMinMb: 512, memoryMaxMb: 2048, extraJvmArgs: ['-XX:+UseG1GC'], resolution: null, fullscreen: false,
  launcherName: 'ChaldLauncher', launcherVersion: '0.1.0', ...over,
});

describe('rules', () => {
  it('allows without rules, last match wins', () => {
    const ctx = { platform: linux, features: {} };
    expect(rulesAllow(undefined, ctx)).toBe(true);
    expect(rulesAllow([{ action: 'allow' }, { action: 'disallow', os: { name: 'linux' } }], ctx)).toBe(false);
    expect(rulesAllow([{ action: 'allow', os: { name: 'osx' } }], ctx)).toBe(false);
  });
  it('matches features exactly', () => {
    const rule = [{ action: 'allow' as const, features: { is_demo_user: true } }];
    expect(rulesAllow(rule, { platform: linux, features: {} })).toBe(false);
    expect(rulesAllow(rule, { platform: linux, features: { is_demo_user: true } })).toBe(true);
  });
});

describe('buildLaunchCommand', () => {
  it('builds memory flags, classpath and game args', () => {
    const c = buildLaunchCommand(base());
    expect(c.args.slice(0, 2)).toEqual(['-Xms512M', '-Xmx2048M']);
    expect(c.args).toContain('-XX:+UseG1GC');
    expect(c.args).toContain('-Djava.library.path=/n');
    const cp = c.args[c.args.indexOf('-cp') + 1]!;
    expect(cp.split(path.delimiter)).toEqual([path.join('/l', 'org/a/one/1.0/one-1.0.jar'), '/v/1.21.1.jar']);
    expect(c.args.indexOf('net.minecraft.client.main.Main')).toBeGreaterThan(c.args.indexOf('-cp'));
    expect(c.args[c.args.indexOf('--username') + 1]).toBe('Steve');
    expect(c.cwd).toBe('/g');
    expect(c.args).not.toContain('--demo');
    expect(c.args).not.toContain('--width');
    expect(c.args).not.toContain('-XstartOnFirstThread');
  });
  it('applies resolution and fullscreen', () => {
    const c = buildLaunchCommand(base({ resolution: { width: 1920, height: 1080 }, fullscreen: true }));
    expect(c.args[c.args.indexOf('--width') + 1]).toBe('1920');
    expect(c.args[c.args.indexOf('--height') + 1]).toBe('1080');
    expect(c.args).toContain('--fullscreen');
  });
  it('filters libraries by OS', () => {
    const win64 = buildLaunchCommand(base({ platform: win }));
    expect(win64.args.join(' ')).toContain('win-1.0.jar');
    expect(buildLaunchCommand(base()).args.join(' ')).not.toContain('win-1.0.jar');
  });
  it('adds mac-only flag on osx', () => {
    const c = buildLaunchCommand(base({ platform: { name: 'osx', arch: 'arm64', version: '14' } }));
    expect(c.args).toContain('-XstartOnFirstThread');
  });
  it('supports legacy minecraftArguments', () => {
    const legacy: VersionJson = {
      id: '1.8.9', mainClass: 'net.minecraft.client.main.Main', libraries: [],
      minecraftArguments: '--username ${auth_player_name} --session ${auth_session} --gameDir ${game_directory}',
    };
    const c = buildLaunchCommand(base({ version: legacy }));
    expect(c.args).toContain('-Djava.library.path=/n');
    expect(c.args[c.args.indexOf('--session') + 1]).toBe('token:SECRET-TOKEN:u-u-i-d');
  });
  it('fails loudly on unknown placeholders', () => {
    const broken: VersionJson = { ...vanilla, arguments: { game: ['${totally_unknown}'], jvm: [] } };
    expect(() => buildLaunchCommand(base({ version: broken }))).toThrow(/totally_unknown/);
  });
  it('lists the token as a secret and redacts it', () => {
    const c = buildLaunchCommand(base());
    expect(c.secrets).toEqual(['SECRET-TOKEN']);
    expect(redact([c.command, ...c.args].join(' '), c.secrets)).not.toContain('SECRET-TOKEN');
  });
});

describe('splitArgs', () => {
  it('splits and honors quotes', () => {
    expect(splitArgs('-Xmx4G  -Dname="a b" \'c d\'')).toEqual(['-Xmx4G', '-Dname=a b', 'c d']);
    expect(splitArgs('')).toEqual([]);
  });
  it('rejects unclosed quotes', () => expect(() => splitArgs('-Da="b')).toThrow());
  it('never interprets shell syntax', () => expect(splitArgs('; rm -rf / && echo $HOME')).toEqual([';', 'rm', '-rf', '/', '&&', 'echo', '$HOME']));
});

describe('mergeVersions / resolveLibraries', () => {
  const fabric: VersionJson = {
    id: 'fabric-loader-0.16.9-1.21.1', inheritsFrom: '1.21.1', mainClass: 'net.fabricmc.loader.impl.launch.knot.KnotClient',
    libraries: [{ name: 'net.fabricmc:fabric-loader:0.16.9', url: 'https://maven.fabricmc.net/' }, { name: 'org.a:one:2.0', url: 'https://x/' }],
    arguments: { jvm: ['-DFabricMcEmu= net.minecraft.client.main.Main '], game: [] },
  };
  it('child main class and libraries win, args concatenate', () => {
    const m = mergeVersions(vanilla, fabric);
    expect(m.id).toBe(fabric.id);
    expect(m.mainClass).toContain('Knot');
    expect(m.assetIndex?.id).toBe('17');
    expect(m.libraries.filter((l) => l.name.startsWith('org.a:one'))).toHaveLength(1);
    expect(m.libraries.find((l) => l.name.startsWith('org.a:one'))?.name).toBe('org.a:one:2.0');
    expect(m.arguments?.jvm?.length).toBe((vanilla.arguments?.jvm?.length ?? 0) + 1);
    expect(m.javaVersion?.majorVersion).toBe(21);
  });
  it('computes Maven-style library urls', () => {
    const libs = resolveLibraries(fabric, { platform: linux, features: {} });
    expect(libs[0]!.artifact.url).toBe('https://maven.fabricmc.net/net/fabricmc/fabric-loader/0.16.9/fabric-loader-0.16.9.jar');
  });
  it('resolves legacy natives with classifier and excludes', () => {
    const legacy: VersionJson = {
      id: 'x', mainClass: 'm',
      libraries: [{
        name: 'org.lwjgl.lwjgl:lwjgl-platform:2.9.4', natives: { linux: 'natives-linux', windows: 'natives-windows-${arch}' },
        extract: { exclude: ['META-INF/'] },
        downloads: { classifiers: { 'natives-linux': { path: 'p/linux.jar', url: 'u' }, 'natives-windows-64': { path: 'p/win64.jar', url: 'u' } } },
      }],
    };
    const l = resolveLibraries(legacy, { platform: linux, features: {} });
    expect(l).toHaveLength(1);
    expect(l[0]).toMatchObject({ native: true, extractExclude: ['META-INF/'] });
    expect(resolveLibraries(legacy, { platform: win, features: {} })[0]!.artifact.path).toBe('p/win64.jar');
  });
});
