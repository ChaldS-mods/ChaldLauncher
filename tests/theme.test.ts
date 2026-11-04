import { describe, expect, it } from 'vitest';
import { appSettingsSchema } from '../src/shared/schemas';
import { DEFAULT_SETTINGS } from '../src/main/settings';
import { contrast, DEFAULT_THEME, deriveTheme, effectiveBg, isDefaultTheme, luminance, parseHex, THEME_PRESETS, toHex } from '../src/shared/theme';

describe('theme', () => {
  it('hex round-trips and defaults are valid settings', () => {
    expect(toHex(parseHex('#00acff'))).toBe('#00acff');
    expect(appSettingsSchema.safeParse(DEFAULT_SETTINGS).success).toBe(true);
    expect(isDefaultTheme({ ...DEFAULT_THEME, accent: '#00ACFF' })).toBe(true);
  });
  it('rejects malformed colors', () => {
    expect(appSettingsSchema.safeParse({ ...DEFAULT_SETTINGS, themeAccent: 'red' }).success).toBe(false);
    expect(appSettingsSchema.safeParse({ ...DEFAULT_SETTINGS, themeBg: '#fff' }).success).toBe(false);
  });
  it('a light background is darkened', () => {
    expect(luminance(effectiveBg('#ffffff'))).toBeLessThanOrEqual(0.1);
    expect(toHex(effectiveBg('#020d18'))).toBe('#020d18');
  });
  it('a dark accent is lightened until it reads on the background', () => {
    const v = deriveTheme({ ...DEFAULT_THEME, accent: '#101030' });
    expect(contrast(parseHex(v['--accent']!), parseHex(v['--bg']!))).toBeGreaterThanOrEqual(3);
  });
  it('every preset yields all variables, dark surfaces and legible text', () => {
    for (const p of THEME_PRESETS) {
      const v = deriveTheme(p.colors);
      for (const k of ['--bg', '--surface', '--accent', '--text', '--accent-rgb', '--glow']) expect(v[k]).toBeTruthy();
      expect(contrast(parseHex(v['--text']!), parseHex(v['--surface']!))).toBeGreaterThan(7);
      expect(contrast(parseHex(v['--text-faint']!), parseHex(v['--bg']!))).toBeGreaterThan(3);
    }
  });
  it('default colors derive close to the hand-made palette', () => {
    const v = deriveTheme(DEFAULT_THEME);
    const near = (a: string, b: string) => parseHex(a).every((x, i) => Math.abs(x - parseHex(b)[i]!) < 16);
    expect(near(v['--surface']!, '#041827')).toBe(true);
    expect(near(v['--surface-3']!, '#0a3050')).toBe(true);
    expect(near(v['--text']!, '#e6f4ff')).toBe(true);
  });
});
