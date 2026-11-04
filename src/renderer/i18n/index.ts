import { useCallback, useMemo } from 'react';
import { useStore } from '../store';
import type { Locale, Messages } from './types';
import { DEFAULT_LOCALE, LOCALES } from './types';
import { en } from './en';
import { ru } from './ru';
import { kk } from './kk';
import { be } from './be';

export type { Locale, Messages };
export { LOCALES, DEFAULT_LOCALE };

const CATALOG: Record<Locale, Messages> = { en, ru, kk, be };

function interpolate(template: string, vars?: Record<string, string | number>): string {
  if (!vars) return template;
  return template.replace(/\{(\w+)\}/g, (_, key: string) => {
    const v = vars[key];
    return v === undefined || v === null ? `{${key}}` : String(v);
  });
}

/** Translate a key for a given locale (fallback: en → key). */
export function translate(locale: Locale, key: string, vars?: Record<string, string | number>): string {
  const msg =
    CATALOG[locale]?.[key] ??
    CATALOG.en[key] ??
    key;
  return interpolate(msg, vars);
}

/** BCP-47 tag for date/number formatting. */
export function localeTag(locale: Locale): string {
  switch (locale) {
    case 'en': return 'en-US';
    case 'ru': return 'ru-RU';
    case 'kk': return 'kk-KZ';
    case 'be': return 'be-BY';
    default: return 'en-US';
  }
}

/** Hook: current language + t() bound to it. Re-renders when language changes. */
export function useI18n() {
  const language = useStore((s) => (s.settings?.language as Locale | undefined) ?? DEFAULT_LOCALE);
  const t = useCallback(
    (key: string, vars?: Record<string, string | number>) => translate(language, key, vars),
    [language],
  );
  return useMemo(() => ({ language, t, localeTag: localeTag(language) }), [language, t]);
}

/** Non-React helper when store is already available. */
export function t(key: string, vars?: Record<string, string | number>): string {
  const language = (useStore.getState().settings?.language as Locale | undefined) ?? DEFAULT_LOCALE;
  return translate(language, key, vars);
}
