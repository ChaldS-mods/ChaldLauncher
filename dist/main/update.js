"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.compareVersions = compareVersions;
exports.fetchLatestRelease = fetchLatestRelease;
exports.pickInstallerAsset = pickInstallerAsset;
exports.isOwnReleaseUrl = isOwnReleaseUrl;
exports.toUpdateInfo = toUpdateInfo;
exports.noUpdateSource = noUpdateSource;
const net_1 = require("./net");
function compareVersions(a, b) {
    const pa = a.replace(/^v/, '').split('.').map((n) => parseInt(n, 10) || 0);
    const pb = b.replace(/^v/, '').split('.').map((n) => parseInt(n, 10) || 0);
    for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
        const d = (pa[i] ?? 0) - (pb[i] ?? 0);
        if (d !== 0)
            return d > 0 ? 1 : -1;
    }
    return 0;
}
async function fetchLatestRelease(repo) {
    const rel = await (0, net_1.netJson)(`https://api.github.com/repos/${repo}/releases/latest`, {
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
/**
 * The file that updates the launcher. Only Windows has a self-made installer (ChaldLauncher-Setup.exe), so other
 * platforms get no automatic download (the user is pointed to the release page instead).
 */
function pickInstallerAsset(assets, platform) {
    if (platform !== 'win32')
        return null;
    const exes = assets.filter((a) => /\.exe$/i.test(a.name) && !/uninstall|portable|blockmap/i.test(a.name));
    return exes.find((a) => /setup|install/i.test(a.name)) ?? exes[0] ?? null;
}
/** The download URL must point to this repository's own release files, whatever the API answered. */
function isOwnReleaseUrl(url, repo) {
    try {
        const u = new URL(url);
        return u.protocol === 'https:' && u.hostname === 'github.com' && u.pathname.toLowerCase().startsWith(`/${repo.toLowerCase()}/releases/download/`);
    }
    catch {
        return false;
    }
}
function toUpdateInfo(release, current, platform, state) {
    const hasUpdate = compareVersions(release.version, current) > 0;
    const asset = hasUpdate ? pickInstallerAsset(release.assets, platform) : null;
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
function noUpdateSource(current) {
    return { configured: false, current, latest: null, url: null, hasUpdate: false, assetName: null, downloaded: false, downloading: false };
}
//# sourceMappingURL=update.js.map