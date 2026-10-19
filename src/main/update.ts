import type { UpdateInfo } from '../shared/types';
import { netJson } from './net';

export function compareVersions(a: string, b: string): number {
  const pa = a.replace(/^v/, '').split('.').map((n) => parseInt(n, 10) || 0);
  const pb = b.replace(/^v/, '').split('.').map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d !== 0) return d > 0 ? 1 : -1;
  }
  return 0;
}

export async function checkUpdate(repo: string, current: string): Promise<UpdateInfo> {
  if (!repo) return { configured: false, current, latest: null, url: null, hasUpdate: false };
  const rel = await netJson<{ tag_name: string; html_url: string }>(`https://api.github.com/repos/${repo}/releases/latest`, {
    purpose: 'Проверка обновлений лаунчера',
    headers: { Accept: 'application/vnd.github+json' },
  });
  return {
    configured: true,
    current,
    latest: rel.tag_name.replace(/^v/, ''),
    url: rel.html_url,
    hasUpdate: compareVersions(rel.tag_name, current) > 0,
  };
}
