import { DEFAULT_THEME, deriveTheme, isDefaultTheme, THEME_KEYS, type ThemeColors } from '../shared/theme';
import type { AppSettings } from '../shared/types';

const CACHE_KEY = 'chald-theme';
let applied: string[] = [];

export const themeFromSettings = (s: Pick<AppSettings, 'themeBg' | 'themeAccent' | 'themeSecondary' | 'themeHighlight'>): ThemeColors => ({
  bg: s.themeBg, accent: s.themeAccent, secondary: s.themeSecondary, highlight: s.themeHighlight,
});

/** Sets (or, for the default colors, removes) the CSS variables on <html>. */
export function applyTheme(colors: ThemeColors): void {
  const root = document.documentElement.style;
  for (const name of applied) root.removeProperty(name);
  applied = [];
  if (isDefaultTheme(colors)) return;
  for (const [name, value] of Object.entries(deriveTheme(colors))) {
    root.setProperty(name, value);
    applied.push(name);
  }
}

/** The last saved colors, so the first frame is already in the user's theme (settings arrive from the main process later). */
export function applyCachedTheme(): void {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return;
    const c = JSON.parse(raw) as Partial<ThemeColors>;
    if (THEME_KEYS.every((k) => typeof c[k] === 'string')) applyTheme(c as ThemeColors);
  } catch { /* cache is optional */ }
}

export function cacheTheme(colors: ThemeColors): void {
  try {
    if (isDefaultTheme(colors)) localStorage.removeItem(CACHE_KEY);
    else localStorage.setItem(CACHE_KEY, JSON.stringify(colors));
  } catch { /* cache is optional */ }
}

export { DEFAULT_THEME };
