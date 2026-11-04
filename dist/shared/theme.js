"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.MAX_BG_LUMINANCE = exports.HEX_RE = exports.THEME_KEYS = exports.THEME_PRESETS = exports.DEFAULT_THEME = void 0;
exports.parseHex = parseHex;
exports.toHex = toHex;
exports.mix = mix;
exports.luminance = luminance;
exports.contrast = contrast;
exports.effectiveBg = effectiveBg;
exports.isDefaultTheme = isDefaultTheme;
exports.deriveTheme = deriveTheme;
exports.DEFAULT_THEME = { bg: '#020d18', accent: '#00acff', secondary: '#289d85', highlight: '#00d5ff' };
exports.THEME_PRESETS = [
    { id: 'chald', label: 'Chald', colors: exports.DEFAULT_THEME },
    { id: 'violet', label: 'Фиолет', colors: { bg: '#0c0716', accent: '#8a5cff', secondary: '#c04dd6', highlight: '#b794ff' } },
    { id: 'emerald', label: 'Изумруд', colors: { bg: '#03120d', accent: '#1fd18b', secondary: '#2f9e8f', highlight: '#5dffc0' } },
    { id: 'sunset', label: 'Закат', colors: { bg: '#150a05', accent: '#ff8a2b', secondary: '#e0a030', highlight: '#ffc266' } },
    { id: 'rose', label: 'Роза', colors: { bg: '#160812', accent: '#ff5c9a', secondary: '#c2457f', highlight: '#ff9ec4' } },
    { id: 'graphite', label: 'Графит', colors: { bg: '#0d0f12', accent: '#7da2ff', secondary: '#6b8cae', highlight: '#b5c7ff' } },
];
exports.THEME_KEYS = ['bg', 'accent', 'secondary', 'highlight'];
exports.HEX_RE = /^#[0-9a-fA-F]{6}$/;
function parseHex(hex) {
    const h = exports.HEX_RE.test(hex) ? hex : '#000000';
    return [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
}
function toHex([r, g, b]) {
    const c = (v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0');
    return `#${c(r)}${c(g)}${c(b)}`;
}
/** Mix a toward b: t = 0 gives a, t = 1 gives b. */
function mix(a, b, t) {
    return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}
/** WCAG relative luminance, 0..1. */
function luminance([r, g, b]) {
    const f = (v) => {
        const s = v / 255;
        return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
    };
    return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}
function contrast(a, b) {
    const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
    return (hi + 0.05) / (lo + 0.05);
}
const BLACK = [0, 0, 0];
const WHITE = [255, 255, 255];
/** The interface is dark-only (white text, white glints): a lighter background is darkened to this luminance. */
exports.MAX_BG_LUMINANCE = 0.1;
/** The background actually used: too light a color is darkened so text stays readable. */
function effectiveBg(hex) {
    let c = parseHex(hex);
    for (let i = 0; i < 20 && luminance(c) > exports.MAX_BG_LUMINANCE; i++)
        c = mix(c, BLACK, 0.15);
    return c;
}
/** Lightens a color until it reads on the background (contrast at least 3:1). */
function readable(hex, bg) {
    let c = parseHex(hex);
    for (let i = 0; i < 20 && contrast(c, bg) < 3; i++)
        c = mix(c, WHITE, 0.12);
    return c;
}
function isDefaultTheme(t) {
    return exports.THEME_KEYS.every((k) => t[k].toLowerCase() === exports.DEFAULT_THEME[k]);
}
const rgbText = (c) => c.map((v) => Math.round(v)).join(', ');
/** CSS custom properties for the given colors. */
function deriveTheme(colors) {
    const bg = effectiveBg(colors.bg);
    const accent = readable(colors.accent, bg);
    const teal = readable(colors.secondary, bg);
    const cyan = readable(colors.highlight, bg);
    const surface = mix(bg, accent, 0.07);
    const text = mix(WHITE, accent, 0.1);
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
//# sourceMappingURL=theme.js.map