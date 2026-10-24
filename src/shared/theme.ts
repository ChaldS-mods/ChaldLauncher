/** Interface colors the user can change. Everything else (surfaces, borders, glow, text) is derived from these four. */
export interface ThemeColors {
  bg: string;
  accent: string;
  secondary: string;
  highlight: string;
}

export const DEFAULT_THEME: ThemeColors = { bg: '#020d18', accent: '#00acff', secondary: '#289d85', highlight: '#00d5ff' };

export const THEME_PRESETS: { id: string; label: string; colors: ThemeColors }[] = [
  { id: 'chald', label: 'Chald', colors: DEFAULT_THEME },
  { id: 'violet', label: 'Фиолет', colors: { bg: '#0c0716', accent: '#8a5cff', secondary: '#c04dd6', highlight: '#b794ff' } },
  { id: 'emerald', label: 'Изумруд', colors: { bg: '#03120d', accent: '#1fd18b', secondary: '#2f9e8f', highlight: '#5dffc0' } },
  { id: 'sunset', label: 'Закат', colors: { bg: '#150a05', accent: '#ff8a2b', secondary: '#e0a030', highlight: '#ffc266' } },
  { id: 'rose', label: 'Роза', colors: { bg: '#160812', accent: '#ff5c9a', secondary: '#c2457f', highlight: '#ff9ec4' } },
  { id: 'graphite', label: 'Графит', colors: { bg: '#0d0f12', accent: '#7da2ff', secondary: '#6b8cae', highlight: '#b5c7ff' } },
];

export const THEME_KEYS = ['bg', 'accent', 'secondary', 'highlight'] as const;
export type ThemeKey = (typeof THEME_KEYS)[number];

export const HEX_RE = /^#[0-9a-fA-F]{6}$/;

type RGB = [number, number, number];

export function parseHex(hex: string): RGB {
  const h = HEX_RE.test(hex) ? hex : '#000000';
  return [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
}

export function toHex([r, g, b]: RGB): string {
  const c = (v: number) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0');
  return `#${c(r)}${c(g)}${c(b)}`;
}

/** Mix a toward b: t = 0 gives a, t = 1 gives b. */
export function mix(a: RGB, b: RGB, t: number): RGB {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

/** WCAG relative luminance, 0..1. */
export function luminance([r, g, b]: RGB): number {
  const f = (v: number) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}

export function contrast(a: RGB, b: RGB): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

const BLACK: RGB = [0, 0, 0];
const WHITE: RGB = [255, 255, 255];
/** The interface is dark-only (white text, white glints): a lighter background is darkened to this luminance. */
export const MAX_BG_LUMINANCE = 0.1;

/** The background actually used: too light a color is darkened so text stays readable. */
export function effectiveBg(hex: string): RGB {
  let c = parseHex(hex);
  for (let i = 0; i < 20 && luminance(c) > MAX_BG_LUMINANCE; i++) c = mix(c, BLACK, 0.15);
  return c;
}

/** Lightens a color until it reads on the background (contrast at least 3:1). */
function readable(hex: string, bg: RGB): RGB {
  let c = parseHex(hex);
  for (let i = 0; i < 20 && contrast(c, bg) < 3; i++) c = mix(c, WHITE, 0.12);
  return c;
}

export function isDefaultTheme(t: ThemeColors): boolean {
  return THEME_KEYS.every((k) => t[k].toLowerCase() === DEFAULT_THEME[k]);
}

const rgbText = (c: RGB) => c.map((v) => Math.round(v)).join(', ');

/** CSS custom properties for the given colors. */
export function deriveTheme(colors: ThemeColors): Record<string, string> {
  const bg = effectiveBg(colors.bg);
  const accent = readable(colors.accent, bg);
  const teal = readable(colors.secondary, bg);
  const cyan = readable(colors.highlight, bg);
  const surface = mix(bg, accent, 0.07);
  const text: RGB = mix(WHITE, accent, 0.1);
  const darkInk = mix(accent, BLACK, 0.87);
  const ink = contrast(darkInk, accent) >= contrast(WHITE, accent) ? darkInk : WHITE;
  const a = rgbText(accent);
  return {
    '--bg': toHex(bg),
    '--bg-deep': toHex(mix(bg, BLACK, 0.3)),
    '--surface': toHex(surface),
    '--surface-2': toHex(mix(bg, accent, 0.145)),
    '--surface-3': toHex(mix(bg, accent, 0.23)),
    '--accent': toHex(accent),
    '--accent-hi': toHex(mix(accent, WHITE, 0.22)),
    '--accent-ink': toHex(ink),
    '--teal': toHex(teal),
    '--cyan': toHex(cyan),
    '--text': toHex(text),
    '--text-dim': toHex(mix(text, bg, 0.38)),
    '--text-faint': toHex(mix(text, bg, 0.6)),
    '--accent-rgb': a,
    '--teal-rgb': rgbText(teal),
    '--cyan-rgb': rgbText(cyan),
    '--bg-rgb': rgbText(bg),
    '--surface-rgb': rgbText(surface),
    '--border': `rgba(${a}, 0.28)`,
    '--border-soft': `rgba(${a}, 0.14)`,
    '--border-strong': `rgba(${a}, 0.6)`,
    '--glow': `0 0 14px rgba(${a}, 0.22)`,
    '--glow-strong': `0 0 20px rgba(${a}, 0.42)`,
  };
}
