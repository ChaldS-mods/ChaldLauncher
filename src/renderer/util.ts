import type { InstanceKind, InstanceView, LoaderType } from '../shared/types';
import { localeTag, t as translate, type Locale } from './i18n';
import { useStore } from './store';

export const LOADER_LABEL: Record<LoaderType, string> = {
  vanilla: 'Vanilla',
  fabric: 'Fabric',
  quilt: 'Quilt',
  forge: 'Forge',
  neoforge: 'NeoForge',
};

export const COVER_COLORS: [string, string][] = [
  ['#0a4a7a', '#00acff'], ['#0f5a4d', '#289d85'], ['#3b1f6e', '#8a5cff'], ['#6e1f4a', '#ff5c9a'],
  ['#6e4a1f', '#ffb347'], ['#1f3b6e', '#00d5ff'], ['#2a5a1f', '#7ddc5a'], ['#4a1f1f', '#ff6b6b'],
];

function currentLocale(): Locale {
  return (useStore.getState().settings?.language as Locale | undefined) ?? 'ru';
}

export function kindLabel(kind: InstanceKind, t: (k: string) => string = translate): string {
  return t(`kind.${kind}`);
}

/** @deprecated use kindLabel with t from useI18n */
export const KIND_LABEL: Record<InstanceKind, string> = {
  official: 'Official',
  modded: 'Modded',
  custom: 'Custom',
};

export function formatDate(iso: string | null, locale?: Locale): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime()) || d.getTime() === 0) return '—';
  const tag = localeTag(locale ?? currentLocale());
  return d.toLocaleString(tag, { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

export function formatSize(bytes: number, t: (k: string) => string = translate): string {
  if (bytes < 1024) return `${bytes} ${t('common.bytes')}`;
  if (bytes < 1048576) return `${(bytes / 1024).toFixed(0)} ${t('common.kb')}`;
  return `${(bytes / 1048576).toFixed(1)} ${t('common.mb')}`;
}

export function numOrNull(s: string): number | null {
  const trimmed = s.trim();
  if (trimmed === '') return null;
  const n = Number(trimmed);
  return Number.isFinite(n) ? Math.round(n) : NaN;
}

export function loaderText(i: Pick<InstanceView, 'loader'>): string {
  return i.loader.version ? `${LOADER_LABEL[i.loader.type]} ${i.loader.version}` : LOADER_LABEL[i.loader.type];
}

export function memoryText(mb: number, t: (k: string) => string = translate, locale?: Locale): string {
  if (mb < 1024) return `${mb} ${t('common.mb')}`;
  const tag = localeTag(locale ?? currentLocale());
  return `${(mb / 1024).toLocaleString(tag, { maximumFractionDigits: 2 })} ${t('common.gb')}`;
}

export function stateText(state: InstanceView['state'], t: (k: string) => string = translate): string {
  switch (state) {
    case 'ready': return t('state.ready');
    case 'not-installed': return t('state.notInstalled');
    case 'installing': return t('state.installing');
    case 'broken': return t('state.broken');
    default: return state;
  }
}

/** @deprecated use stateText with t from useI18n */
export const STATE_TEXT: Record<InstanceView['state'], string> = {
  ready: 'Ready',
  'not-installed': 'Not installed',
  installing: 'Installing…',
  broken: 'Broken',
};
