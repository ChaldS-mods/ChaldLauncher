export type Locale = 'en' | 'ru' | 'kk' | 'be';

export const LOCALES: { id: Locale; label: string; native: string }[] = [
  { id: 'en', label: 'English', native: 'English' },
  { id: 'ru', label: 'Russian', native: 'Русский' },
  { id: 'kk', label: 'Kazakh', native: 'Қазақша' },
  { id: 'be', label: 'Belarusian', native: 'Беларуская' },
];

export const DEFAULT_LOCALE: Locale = 'ru';

/** Flat key → string map. Interpolation: {name} */
export type Messages = Record<string, string>;
