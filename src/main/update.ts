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

export interface ReleaseAsset {
  name: string;
  size: number;
  url: string;
  /** SHA-256 in hex when GitHub reports it ("digest": "sha256:...") */
  sha256: string | null;
}

export interface ReleaseInfo {
  version: string;
  pageUrl: string;
  assets: ReleaseAsset[];
}

interface GhRelease {
  tag_name: string;
  html_url: string;
  assets?: { name: string; size: number; browser_download_url: string; digest?: string | null; state?: string }[];
}

export async function fetchLatestRelease(repo: string): Promise<ReleaseInfo> {
  const rel = await netJson<GhRelease>(`https://api.github.com/repos/${repo}/releases/latest`, {
    purpose: 'Проверка обновлений лаунчера',
    headers: { Accept: 'application/vnd.github+json' },
  });
  return {
    version: rel.tag_name.replace(/^v/, ''),
    pageUrl: rel.html_url,
    assets: (rel.assets ?? [])
      .filter((a) => a.state === undefined || a.state === 'uploaded')
      .map((a) => ({
        name: a.name,
        size: a.size,
        url: a.browser_download_url,
        sha256: /^sha256:([0-9a-f]{64})$/i.exec(a.digest ?? '')?.[1]?.toLowerCase() ?? null,
      })),
  };
}

export interface PickOptions {
  /** Linux: the launcher runs from an AppImage, so a new AppImage can replace it */
  appImage?: boolean;
  /** process.arch: picks the x64 or the arm64 AppImage */
  arch?: string;
}

/**
 * The file that updates the launcher. Windows has a self-made installer (ChaldLauncher-Setup.exe); on Linux only an
 * AppImage can replace itself. Other cases (tar.gz, a distro package, macOS) get no automatic download: the user is
 * pointed to the release page instead.
 */
export function pickInstallerAsset(assets: ReleaseAsset[], platform: string, opts: PickOptions = {}): ReleaseAsset | null {
  if (platform === 'win32') {
    const exes = assets.filter((a) => /\.exe$/i.test(a.name) && !/uninstall|portable|blockmap/i.test(a.name));
    return exes.find((a) => /setup|install/i.test(a.name)) ?? exes[0] ?? null;
  }
  if (platform === 'linux' && opts.appImage) {
    const wantArm = opts.arch === 'arm64';
    const images = assets.filter((a) => /\.appimage$/i.test(a.name));
    return images.find((a) => /arm64|aarch64/i.test(a.name) === wantArm) ?? null;
  }
  return null;
}

/** The download URL must point to this repository's own release files, whatever the API answered. */
export function isOwnReleaseUrl(url: string, repo: string): boolean {
  try {
    const u = new URL(url);
    return u.protocol === 'https:' && u.hostname === 'github.com' && u.pathname.toLowerCase().startsWith(`/${repo.toLowerCase()}/releases/download/`);
  } catch {
    return false;
  }
}

export function toUpdateInfo(release: ReleaseInfo, current: string, platform: string, state: { downloaded: boolean; downloading: boolean }, opts: PickOptions = {}): UpdateInfo {
  const hasUpdate = compareVersions(release.version, current) > 0;
  const asset = hasUpdate ? pickInstallerAsset(release.assets, platform, opts) : null;
  return {
    configured: true,
    current,
    latest: release.version,
    url: release.pageUrl,
    hasUpdate,
    assetName: asset?.name ?? null,
    downloaded: hasUpdate && state.downloaded,
    downloading: hasUpdate && state.downloading,
  };
}

export function noUpdateSource(current: string): UpdateInfo {
  return { configured: false, current, latest: null, url: null, hasUpdate: false, assetName: null, downloaded: false, downloading: false };
}

/** The repository exists but has no published release yet (GitHub answers 404 on /releases/latest). */
export function isNoReleaseError(e: unknown): boolean {
  return e instanceof Error && /\bHTTP 404\b/.test(e.message);
}

export function noReleasesYet(current: string): UpdateInfo {
  return { ...noUpdateSource(current), configured: true };
}
