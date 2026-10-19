import type { InstanceKind, InstanceView, LoaderType } from '../shared/types';

export const KIND_LABEL: Record<InstanceKind, string> = { official: 'Официальный', modded: 'Модифицированный', custom: 'Сборка' };
export const LOADER_LABEL: Record<LoaderType, string> = { vanilla: 'Vanilla', fabric: 'Fabric', quilt: 'Quilt', forge: 'Forge', neoforge: 'NeoForge' };

export const COVER_COLORS: [string, string][] = [
  ['#0a4a7a', '#00acff'], ['#0f5a4d', '#289d85'], ['#3b1f6e', '#8a5cff'], ['#6e1f4a', '#ff5c9a'],
  ['#6e4a1f', '#ffb347'], ['#1f3b6e', '#00d5ff'], ['#2a5a1f', '#7ddc5a'], ['#4a1f1f', '#ff6b6b'],
];

export function formatDate(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime()) || d.getTime() === 0) return '—';
  return d.toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} Б`;
  if (bytes < 1048576) return `${(bytes / 1024).toFixed(0)} КБ`;
  return `${(bytes / 1048576).toFixed(1)} МБ`;
}

export function numOrNull(s: string): number | null {
  const t = s.trim();
  if (t === '') return null;
  const n = Number(t);
  return Number.isFinite(n) ? Math.round(n) : NaN;
}

export function loaderText(i: Pick<InstanceView, 'loader'>): string {
  return i.loader.version ? `${LOADER_LABEL[i.loader.type]} ${i.loader.version}` : LOADER_LABEL[i.loader.type];
}

export function memoryText(mb: number): string {
  return mb % 1024 === 0 ? `${mb / 1024} ГБ` : `${mb} МБ`;
}

export const STATE_TEXT: Record<InstanceView['state'], string> = {
  ready: 'Готов к запуску',
  'not-installed': 'Не установлен',
  installing: 'Установка…',
  broken: 'Повреждён',
};
