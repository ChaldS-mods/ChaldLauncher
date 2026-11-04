"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.MAX_DNS_SERVERS = exports.DOH_PRESETS = exports.DNS_PLAIN_PRESETS = exports.DEFAULT_DOH_URL = exports.DEFAULT_DNS_SERVERS = exports.DNS_MODES = void 0;
exports.isIpAddress = isIpAddress;
exports.parseDnsServers = parseDnsServers;
exports.isValidDohUrl = isValidDohUrl;
exports.DNS_MODES = ['system', 'plain', 'doh'];
exports.DEFAULT_DNS_SERVERS = '1.1.1.1, 8.8.8.8';
exports.DEFAULT_DOH_URL = 'https://cloudflare-dns.com/dns-query';
exports.DNS_PLAIN_PRESETS = [
    { id: 'cf-google', label: 'Cloudflare + Google', servers: '1.1.1.1, 8.8.8.8' },
    { id: 'cloudflare', label: 'Cloudflare', servers: '1.1.1.1, 1.0.0.1' },
    { id: 'google', label: 'Google', servers: '8.8.8.8, 8.8.4.4' },
    { id: 'quad9', label: 'Quad9', servers: '9.9.9.9, 149.112.112.112' },
];
exports.DOH_PRESETS = [
    { id: 'cloudflare', label: 'Cloudflare', url: 'https://cloudflare-dns.com/dns-query' },
    { id: 'google', label: 'Google', url: 'https://dns.google/dns-query' },
    { id: 'quad9', label: 'Quad9', url: 'https://dns.quad9.net/dns-query' },
];
exports.MAX_DNS_SERVERS = 4;
const IPV4 = /^(?:(?:25[0-5]|2[0-4]\d|1?\d?\d)\.){3}(?:25[0-5]|2[0-4]\d|1?\d?\d)$/;
function isIpv6(s) {
    if (s.length > 45 || !s.includes(':') || !/^[0-9a-fA-F:.]+$/.test(s))
        return false;
    const halves = s.split('::');
    if (halves.length > 2)
        return false;
    let count = 0;
    for (const half of halves) {
        if (half === '')
            continue;
        const groups = half.split(':');
        for (let i = 0; i < groups.length; i++) {
            const g = groups[i];
            const last = half === halves[halves.length - 1] && i === groups.length - 1;
            if (/^[0-9a-fA-F]{1,4}$/.test(g))
                count += 1;
            else if (last && IPV4.test(g))
                count += 2; // ::ffff:1.2.3.4
            else
                return false;
        }
    }
    return halves.length === 2 ? count <= 7 : count === 8;
}
function isIpAddress(s) {
    return IPV4.test(s) || isIpv6(s);
}
/** «1.1.1.1, 8.8.8.8» → ['1.1.1.1', '8.8.8.8']; null when empty, too many or something is not an IP address. */
function parseDnsServers(text) {
    const list = text.split(/[\s,;]+/).filter(Boolean);
    if (list.length === 0 || list.length > exports.MAX_DNS_SERVERS)
        return null;
    return list.every(isIpAddress) ? [...new Set(list)] : null;
}
/** DoH endpoint: an https:// URL without credentials (RFC 8484). */
function isValidDohUrl(text) {
    if (text.length > 256)
        return false;
    try {
        const u = new URL(text);
        return u.protocol === 'https:' && u.hostname.length > 0 && !u.username && !u.password && !u.hash;
    }
    catch {
        return false;
    }
}
//# sourceMappingURL=dns.js.map