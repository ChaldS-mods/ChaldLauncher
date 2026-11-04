/** DNS used by the launcher's own network requests: the system one, plain DNS servers or DNS-over-HTTPS (DoH). */
export type DnsMode = 'system' | 'plain' | 'doh';
export const DNS_MODES: readonly DnsMode[] = ['system', 'plain', 'doh'];

export const DEFAULT_DNS_SERVERS = '1.1.1.1, 8.8.8.8';
export const DEFAULT_DOH_URL = 'https://cloudflare-dns.com/dns-query';

export const DNS_PLAIN_PRESETS: readonly { id: string; label: string; servers: string }[] = [
  { id: 'cf-google', label: 'Cloudflare + Google', servers: '1.1.1.1, 8.8.8.8' },
  { id: 'cloudflare', label: 'Cloudflare', servers: '1.1.1.1, 1.0.0.1' },
  { id: 'google', label: 'Google', servers: '8.8.8.8, 8.8.4.4' },
  { id: 'quad9', label: 'Quad9', servers: '9.9.9.9, 149.112.112.112' },
];

export const DOH_PRESETS: readonly { id: string; label: string; url: string }[] = [
  { id: 'cloudflare', label: 'Cloudflare', url: 'https://cloudflare-dns.com/dns-query' },
  { id: 'google', label: 'Google', url: 'https://dns.google/dns-query' },
  { id: 'quad9', label: 'Quad9', url: 'https://dns.quad9.net/dns-query' },
];

export const MAX_DNS_SERVERS = 4;

const IPV4 = /^(?:(?:25[0-5]|2[0-4]\d|1?\d?\d)\.){3}(?:25[0-5]|2[0-4]\d|1?\d?\d)$/;

function isIpv6(s: string): boolean {
  if (s.length > 45 || !s.includes(':') || !/^[0-9a-fA-F:.]+$/.test(s)) return false;
  const halves = s.split('::');
  if (halves.length > 2) return false;
  let count = 0;
  for (const half of halves) {
    if (half === '') continue;
    const groups = half.split(':');
    for (let i = 0; i < groups.length; i++) {
      const g = groups[i]!;
      const last = half === halves[halves.length - 1] && i === groups.length - 1;
      if (/^[0-9a-fA-F]{1,4}$/.test(g)) count += 1;
      else if (last && IPV4.test(g)) count += 2; // ::ffff:1.2.3.4
      else return false;
    }
  }
  return halves.length === 2 ? count <= 7 : count === 8;
}

export function isIpAddress(s: string): boolean {
  return IPV4.test(s) || isIpv6(s);
}

/** «1.1.1.1, 8.8.8.8» → ['1.1.1.1', '8.8.8.8']; null when empty, too many or something is not an IP address. */
export function parseDnsServers(text: string): string[] | null {
  const list = text.split(/[\s,;]+/).filter(Boolean);
  if (list.length === 0 || list.length > MAX_DNS_SERVERS) return null;
  return list.every(isIpAddress) ? [...new Set(list)] : null;
}

/** DoH endpoint: an https:// URL without credentials (RFC 8484). */
export function isValidDohUrl(text: string): boolean {
  if (text.length > 256) return false;
  try {
    const u = new URL(text);
    return u.protocol === 'https:' && u.hostname.length > 0 && !u.username && !u.password && !u.hash;
  } catch {
    return false;
  }
}
