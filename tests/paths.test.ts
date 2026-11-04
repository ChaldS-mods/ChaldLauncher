import { describe, expect, it } from 'vitest';
import * as path from 'node:path';
import { isValidInstanceId, mavenPath, resolveInside, safeFileName, slugify } from '../src/main/paths';

describe('resolveInside', () => {
  const base = path.resolve('/tmp/chald/instances');
  it('allows nested paths', () => {
    expect(resolveInside(base, 'a', 'b.txt')).toBe(path.join(base, 'a', 'b.txt'));
  });
  it('blocks traversal', () => {
    expect(() => resolveInside(base, '..', 'x')).toThrow();
    expect(() => resolveInside(base, 'a/../../x')).toThrow();
    expect(() => resolveInside(base, '/etc/passwd')).toThrow();
  });
  it('blocks null bytes', () => {
    expect(() => resolveInside(base, 'a\0b')).toThrow();
  });
  it('does not confuse sibling prefixes', () => {
    expect(() => resolveInside(base, '..', 'instances-evil')).toThrow();
  });
  it('allows names that merely start with dots', () => {
    expect(resolveInside(base, '..foo')).toBe(path.join(base, '..foo'));
  });
});

describe('safeFileName', () => {
  it('accepts plain names', () => expect(safeFileName('mod-1.0.jar')).toBe('mod-1.0.jar'));
  it.each(['', '.', '..', 'a/b', 'a\\b', 'a\0b', 'a\nb'])('rejects %j', (n) => {
    expect(() => safeFileName(n)).toThrow();
  });
});

describe('ids', () => {
  it('validates instance ids', () => {
    expect(isValidInstanceId('chald-studio_1')).toBe(true);
    for (const bad of ['', '-x', 'A', '../x', 'a b', 'x'.repeat(65)]) expect(isValidInstanceId(bad)).toBe(false);
  });
  it('slugifies', () => {
    expect(slugify('Chald Studio 1.21.1')).toBe('chald-studio-1-21-1');
    expect(slugify('Сборка')).toBe('instance');
  });
});

describe('mavenPath', () => {
  it('builds paths', () => {
    expect(mavenPath('net.fabricmc:fabric-loader:0.16.9')).toBe('net/fabricmc/fabric-loader/0.16.9/fabric-loader-0.16.9.jar');
    expect(mavenPath('org.lwjgl:lwjgl:3.3.3:natives-linux')).toBe('org/lwjgl/lwjgl/3.3.3/lwjgl-3.3.3-natives-linux.jar');
  });
  it('rejects broken coordinates', () => expect(() => mavenPath('oops')).toThrow());
});
