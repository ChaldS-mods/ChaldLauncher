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

export type LookSettings = Pick<AppSettings, 'uiScale' | 'cornerStyle' | 'glow' | 'fontMode' | 'animations' | 'compactSidebar' | 'sidebarSide' | 'panelSide' | 'panelWidth' | 'showStatusBar' | 'customCss'>;

const RADII: Record<LookSettings['cornerStyle'], [number, number, number]> = { sharp: [0, 0, 0], normal: [6, 10, 14], round: [10, 16, 24] };

/** Appearance options that are not colors: scale, corners, glow, font, animations, sidebar. */
export function applyLook(l: LookSettings): void {
  const root = document.documentElement;
  const st = root.style;
  const [sm, md, lg] = RADII[l.cornerStyle] ?? RADII.normal;
  st.setProperty('--r-sm', `${sm}px`);
  st.setProperty('--r-md', `${md}px`);
  st.setProperty('--r-lg', `${lg}px`);
  const g = Math.max(0, Math.min(100, l.glow)) / 100;
  st.setProperty('--glow', `0 0 14px rgba(var(--accent-rgb), ${(0.22 * g).toFixed(3)})`);
  st.setProperty('--glow-strong', `0 0 20px rgba(var(--accent-rgb), ${(0.42 * g).toFixed(3)})`);
  const font = l.fontMode === 'clean'
    ? "'Rubik', system-ui, -apple-system, 'Segoe UI', sans-serif"
    : "'ChaldPixel', 'Rubik', system-ui, -apple-system, 'Segoe UI', sans-serif";
  st.setProperty('--font-head', font);
  st.setProperty('--font-body', font);
  st.setProperty('--t-fast', l.animations ? '0.15s ease' : '0s');
  st.setProperty('--t-med', l.animations ? '0.25s ease' : '0s');
  st.setProperty('--sidebar-w', l.compactSidebar ? '76px' : '232px');
  root.classList.toggle('compact-side', l.compactSidebar);
  root.classList.toggle('side-right', l.sidebarSide === 'right');
  for (const side of ['left', 'bottom', 'hidden']) root.classList.toggle(`panel-${side}`, l.panelSide === side);
  st.setProperty('--panel-w', `${l.panelWidth}px`);
  root.classList.toggle('no-status', !l.showStatusBar);
  st.setProperty('--statusbar-h', l.showStatusBar ? '44px' : '0px');
  let css = document.getElementById('chald-custom-css');
  if (!css) { css = document.createElement('style'); css.id = 'chald-custom-css'; document.head.appendChild(css); }
  css.textContent = l.customCss ?? '';
  window.chald?.setZoom?.(l.uiScale / 100);
}

export const lookFromSettings = (s: AppSettings): LookSettings => ({
  uiScale: s.uiScale, cornerStyle: s.cornerStyle, glow: s.glow, fontMode: s.fontMode, animations: s.animations, compactSidebar: s.compactSidebar,
  sidebarSide: s.sidebarSide, panelSide: s.panelSide, panelWidth: s.panelWidth, showStatusBar: s.showStatusBar, customCss: s.customCss,
});
