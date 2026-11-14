import { describe, expect, it } from 'vitest';
import * as path from 'node:path';
import { makeResolver, installerUrl } from '../src/main/forgeInstall';
import { compareVersions, forgeSupportsMc, neoforgePrefix, parseForgeMetadata } from '../src/main/versions';

describe('neoforgePrefix', () => {
  it('maps classic Minecraft versions', () => {
    expect(neoforgePrefix('1.21.1')).toBe('21.1.');
    expect(neoforgePrefix('1.21')).toBe('21.0.');
    expect(neoforgePrefix('1.20.4')).toBe('20.4.');
  });
  it('maps year-based versions', () => {
    expect(neoforgePrefix('26.1')).toBe('26.1.0.');
    expect(neoforgePrefix('26.1.2')).toBe('26.1.2.');
  });
  it('has nothing for unsupported versions', () => {
    expect(neoforgePrefix('1.20.1')).toBeNull();
    expect(neoforgePrefix('1.12.2')).toBeNull();
    expect(neoforgePrefix('24w14a')).toBeNull();
    expect(neoforgePrefix('26.1-snapshot-1')).toBeNull();
  });
});

describe('forge helpers', () => {
  it('supports Minecraft 1.13+', () => {
    expect(forgeSupportsMc('1.20.1')).toBe(true);
    expect(forgeSupportsMc('1.13')).toBe(true);
    expect(forgeSupportsMc('1.12.2')).toBe(false);
    expect(forgeSupportsMc('1.7.10')).toBe(false);
  });
  it('extracts versions for one Minecraft version from maven-metadata', () => {
    const xml = '<versions><version>1.20.1-47.2.0</version><version>1.20.1-47.3.0</version><version>1.21.1-52.0.40</version><version>1.20-46.0.1</version></versions>';
    expect(parseForgeMetadata(xml, '1.20.1')).toEqual(['47.2.0', '47.3.0']);
    expect(parseForgeMetadata(xml, '1.20')).toEqual(['46.0.1']);
  });
  it('builds installer urls', () => {
    expect(installerUrl('forge', '1.20.1', '47.2.0')).toBe('https://maven.minecraftforge.net/net/minecraftforge/forge/1.20.1-47.2.0/forge-1.20.1-47.2.0-installer.jar');
    expect(installerUrl('neoforge', '1.21.1', '21.1.233')).toBe('https://maven.neoforged.net/releases/net/neoforged/neoforge/21.1.233/neoforge-21.1.233-installer.jar');
  });
});

describe('compareVersions', () => {
  it('compares numerically and puts betas below releases', () => {
    expect(compareVersions('52.0.9', '52.0.40')).toBeLessThan(0);
    expect(compareVersions('21.1.233', '21.1.233-beta')).toBeGreaterThan(0);
    expect(['21.1.9', '21.1.100', '21.1.20'].sort((a, b) => compareVersions(b, a))).toEqual(['21.1.100', '21.1.20', '21.1.9']);
  });
});

describe('installer token resolver', () => {
  const lib = (c: string) => path.join('/libs', c.replace(/[:@]/g, '_'));
  const r = makeResolver({
    vars: { ROOT: '/root', SIDE: 'client', MINECRAFT_JAR: '/root/versions/1.21.1/1.21.1.jar' },
    data: { MAPPINGS: '[net.minecraft:client:1.21.1:mappings@txt]', PATCHED: "'literal'", BINPATCH: '/data/client.lzma' },
    libPath: lib,
    extract: (e) => `/tmp/${e}`,
  });
  it('resolves maven coordinates, literals, installer files and placeholders', () => {
    expect(r.arg('[a:b:1]')).toBe(lib('a:b:1'));
    expect(r.arg('{SIDE}')).toBe('client');
    expect(r.arg('{MAPPINGS}')).toBe(lib('net.minecraft:client:1.21.1:mappings@txt'));
    expect(r.arg('{PATCHED}')).toBe('literal');
    expect(r.arg('{BINPATCH}')).toBe('/tmp/data/client.lzma');
    expect(r.arg('--in={MINECRAFT_JAR}')).toBe('--in=/root/versions/1.21.1/1.21.1.jar');
    expect(r.dataValue("'abc'")).toBe('abc');
  });
  it('rejects unknown placeholders', () => {
    expect(() => r.arg('{NOPE}')).toThrow();
  });
});
