"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.LOADERS = void 0;
exports.isLicensedUuid = isLicensedUuid;
exports.mcHeadUrl = mcHeadUrl;
exports.LOADERS = [
    { id: 'vanilla', label: 'Vanilla', implemented: true },
    { id: 'fabric', label: 'Fabric', implemented: true },
    { id: 'quilt', label: 'Quilt', implemented: true },
    { id: 'forge', label: 'Forge', implemented: true },
    { id: 'neoforge', label: 'NeoForge', implemented: true },
];
/**
 * Microsoft (online-mode) UUIDs are random v4; offline-mode names get a v3 UUID from
 * `OfflinePlayer:<name>`. Used to decide whether mc-heads / skin services will return a real skin.
 */
function isLicensedUuid(uuid) {
    if (!uuid)
        return false;
    const u = uuid.replace(/-/g, '').toLowerCase();
    if (!/^[0-9a-f]{32}$/.test(u))
        return false;
    return u[12] === '4';
}
/** Prefer the real skin for licensed accounts (UUID), otherwise fall back to the name / Steve. */
function mcHeadUrl(name, uuid, size = 64) {
    if (uuid && isLicensedUuid(uuid)) {
        return `https://mc-heads.net/avatar/${uuid.replace(/-/g, '')}/${size}`;
    }
    const n = (name || 'MHF_Steve').trim() || 'MHF_Steve';
    return `https://mc-heads.net/avatar/${encodeURIComponent(n)}/${size}`;
}
//# sourceMappingURL=types.js.map