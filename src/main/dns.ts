import * as dns from 'node:dns';
import * as net from 'node:net';
import { Agent, fetch as undiciFetch } from 'undici';
import { DEFAULT_DNS_SERVERS, DEFAULT_DOH_URL, isValidDohUrl, parseDnsServers, type DnsMode } from '../shared/dns';
import type { DnsTestResult } from '../shared/types';

/**
 * DNS for the launcher's own requests (everything that goes through net.ts).
 * 'system' leaves Node's fetch alone; 'plain' asks the given DNS servers directly (UDP/TCP);
 * 'doh' asks a DNS-over-HTTPS server (RFC 8484), so the provider and the network in between cannot read or rewrite the answers.
 * The game itself (Java) keeps using the system DNS.
 */
export interface DnsConfig {
  mode: DnsMode;
  /** «1.1.1.1, 8.8.8.8» (used in 'plain' mode) */
  servers: string;
  /** https://… DoH endpoint (used in 'doh' mode) */
  dohUrl: string;
}

interface Addr {
  address: string;
  family: 4 | 6;
}
interface Answer {
  addrs: Addr[];
  /** seconds */
  ttl: number;
}

const TYPE_A = 1;
const TYPE_AAAA = 28;
const DOH_TIMEOUT_MS = 6000;
const MIN_TTL = 30;
const MAX_TTL = 300;

function dnsError(code: string, message: string): NodeJS.ErrnoException {
  return Object.assign(new Error(message), { code });
}

/* ---------- DNS wire format (RFC 1035), just enough for A / AAAA ---------- */

export function encodeQuery(name: string, type: number): Buffer {
  const labels = name.replace(/\.$/, '').split('.');
  // id 0 (RFC 8484 §4.1: better for HTTP caches), flags: recursion desired, 1 question
  const parts: Buffer[] = [Buffer.from([0, 0, 0x01, 0x00, 0, 1, 0, 0, 0, 0, 0, 0])];
  for (const label of labels) {
    const b = Buffer.from(label, 'ascii');
    if (b.length === 0 || b.length > 63) throw dnsError('EBADNAME', `Некорректное имя хоста: ${name}`);
    parts.push(Buffer.from([b.length]), b);
  }
  parts.push(Buffer.from([0, (type >> 8) & 0xff, type & 0xff, 0, 1]));
  return Buffer.concat(parts);
}

export function decodeAnswer(msg: Buffer): Answer & { rcode: number } {
  if (msg.length < 12) throw dnsError('EBADRESP', 'DNS: слишком короткий ответ');
  const rcode = msg.readUInt16BE(2) & 0x0f;
  const qd = msg.readUInt16BE(4);
  const an = msg.readUInt16BE(6);
  let off = 12;
  const skipName = (): void => {
    for (;;) {
      if (off >= msg.length) throw dnsError('EBADRESP', 'DNS: повреждённый ответ');
      const len = msg[off]!;
      if (len === 0) { off += 1; return; }
      if ((len & 0xc0) === 0xc0) { off += 2; return; } // compression pointer ends the name
      off += 1 + len;
    }
  };
  for (let i = 0; i < qd; i++) { skipName(); off += 4; }
  const addrs: Addr[] = [];
  let ttl = Infinity;
  for (let i = 0; i < an; i++) {
    skipName();
    if (off + 10 > msg.length) throw dnsError('EBADRESP', 'DNS: повреждённый ответ');
    const type = msg.readUInt16BE(off);
    const t = msg.readUInt32BE(off + 4);
    const len = msg.readUInt16BE(off + 8);
    off += 10;
    if (off + len > msg.length) throw dnsError('EBADRESP', 'DNS: повреждённый ответ');
    if (type === TYPE_A && len === 4) {
      addrs.push({ address: [...msg.subarray(off, off + 4)].join('.'), family: 4 });
      ttl = Math.min(ttl, t);
    } else if (type === TYPE_AAAA && len === 16) {
      const groups: string[] = [];
      for (let g = 0; g < 8; g++) groups.push(msg.readUInt16BE(off + g * 2).toString(16));
      addrs.push({ address: groups.join(':'), family: 6 });
      ttl = Math.min(ttl, t);
    } // CNAME and the rest are skipped: the final A / AAAA records come in the same answer
    off += len;
  }
  return { rcode, addrs, ttl: Number.isFinite(ttl) ? ttl : MIN_TTL };
}

/* ---------- lookup plumbing ---------- */

type Resolve = (host: string) => Promise<Addr[]>;

export function toLookup(resolve: Resolve): net.LookupFunction {
  return ((hostname: string, options: dns.LookupOptions | undefined, cb: (err: NodeJS.ErrnoException | null, address?: unknown, family?: number) => void) => {
    resolve(hostname).then(
      (list) => (options?.all ? cb(null, list) : cb(null, list[0]!.address, list[0]!.family)),
      (e: NodeJS.ErrnoException) => cb(e),
    );
  }) as net.LookupFunction;
}

/** The DoH server's own name must be resolved without DoH: well-known providers have built-in addresses, others use the system DNS. */
const DOH_BOOTSTRAP: Record<string, string[]> = {
  'cloudflare-dns.com': ['1.1.1.1', '1.0.0.1'],
  'dns.google': ['8.8.8.8', '8.8.4.4'],
  'dns.quad9.net': ['9.9.9.9', '149.112.112.112'],
};

const bootstrapResolve: Resolve = async (host) => {
  const known = DOH_BOOTSTRAP[host];
  if (known) return known.map((address) => ({ address, family: 4 as const }));
  const list = await dns.promises.lookup(host, { all: true });
  return list.map((a) => ({ address: a.address, family: a.family === 6 ? 6 : 4 }));
};

type DohLogger = (e: { host: string; path: string; status: number | null; bytes: number | null; error: string | null }) => void;
let dohLogger: DohLogger = () => undefined;
/** net.ts registers its log here so DoH requests show up in the launcher's network log too. */
export function setDnsLogger(fn: DohLogger): void {
  dohLogger = fn;
}

let bootstrapAgent: Agent | null = null;
function dohAgent(): Agent {
  return (bootstrapAgent ??= new Agent({ connect: { lookup: toLookup(bootstrapResolve) } }));
}

async function dohQuery(url: string, name: string, type: number): Promise<Answer & { rcode: number }> {
  const u = new URL(url);
  u.searchParams.set('dns', encodeQuery(name, type).toString('base64url'));
  const log = { host: u.host, path: u.pathname, status: null as number | null, bytes: null as number | null, error: null as string | null };
  try {
    const res = await undiciFetch(u, {
      headers: { accept: 'application/dns-message' },
      dispatcher: dohAgent(),
      signal: AbortSignal.timeout(DOH_TIMEOUT_MS),
      redirect: 'error',
    });
    log.status = res.status;
    if (!res.ok) throw dnsError('DOH_FAILED', `DoH: ${u.host} ответил HTTP ${res.status}`);
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length > 65535) throw dnsError('EBADRESP', 'DoH: слишком большой ответ');
    log.bytes = buf.length;
    return decodeAnswer(buf);
  } catch (e) {
    log.error = e instanceof Error ? e.message : String(e);
    if ((e as NodeJS.ErrnoException).code) throw e;
    throw dnsError('DOH_FAILED', `DoH: не удалось связаться с ${u.host}`);
  } finally {
    dohLogger(log);
  }
}

export class HostResolver {
  private cache = new Map<string, { addrs: Addr[]; exp: number }>();
  private inflight = new Map<string, Promise<Addr[]>>();
  private plainResolver: dns.promises.Resolver | null = null;

  constructor(private mode: 'plain' | 'doh', private servers: string[], private dohUrl: string) {
    if (mode === 'plain') {
      this.plainResolver = new dns.promises.Resolver({ timeout: 4000, tries: 2 });
      this.plainResolver.setServers(servers);
    }
  }

  resolve: Resolve = (host) => {
    const family = net.isIP(host);
    if (family) return Promise.resolve([{ address: host, family: family === 6 ? 6 : 4 }]);
    const hit = this.cache.get(host);
    if (hit && hit.exp > Date.now()) return Promise.resolve(hit.addrs);
    let p = this.inflight.get(host);
    if (!p) {
      p = this.query(host)
        .then((a) => {
          if (a.addrs.length === 0) throw dnsError('ENOTFOUND', `DNS: адрес ${host} не найден`);
          this.cache.set(host, { addrs: a.addrs, exp: Date.now() + Math.min(MAX_TTL, Math.max(MIN_TTL, a.ttl)) * 1000 });
          return a.addrs;
        })
        .finally(() => this.inflight.delete(host));
      this.inflight.set(host, p);
    }
    return p;
  };

  private async query(host: string): Promise<Answer> {
    const [a, aaaa] = await Promise.allSettled(
      this.mode === 'plain'
        ? [this.plain4(host), this.plain6(host)]
        : [dohQuery(this.dohUrl, host, TYPE_A), dohQuery(this.dohUrl, host, TYPE_AAAA)],
    );
    const ok = [a, aaaa].filter((r): r is PromiseFulfilledResult<Answer> => r.status === 'fulfilled').map((r) => r.value);
    if (ok.length === 0) {
      const reason = [a, aaaa].find((r): r is PromiseRejectedResult => r.status === 'rejected')?.reason as NodeJS.ErrnoException | undefined;
      // ENOTFOUND / ENODATA from a DNS server mean "no such host", anything else is a broken DNS server
      if (reason?.code === 'ENOTFOUND' || reason?.code === 'ENODATA') throw dnsError('ENOTFOUND', `DNS: адрес ${host} не найден`);
      throw dnsError('DNS_FAILED', `DNS-сервер не отвечает (${this.mode === 'doh' ? this.dohUrl : this.servers.join(', ')}): ${reason?.message ?? 'нет ответа'}`);
    }
    return {
      addrs: ok.flatMap((r) => r.addrs),
      ttl: Math.min(...ok.map((r) => r.ttl)),
    };
  }

  private async plain4(host: string): Promise<Answer> {
    const r = await this.plainResolver!.resolve4(host, { ttl: true });
    return { addrs: r.map((x) => ({ address: x.address, family: 4 as const })), ttl: Math.min(...r.map((x) => x.ttl), MAX_TTL) };
  }
  private async plain6(host: string): Promise<Answer> {
    // many hosts have no AAAA record: query() ignores that as long as the A query worked
    const r = await this.plainResolver!.resolve6(host, { ttl: true });
    return { addrs: r.map((x) => ({ address: x.address, family: 6 as const })), ttl: Math.min(...r.map((x) => x.ttl), MAX_TTL) };
  }
}

/* ---------- public API ---------- */

function normalize(cfg: DnsConfig): { mode: 'system' } | { mode: 'plain'; servers: string[] } | { mode: 'doh'; url: string } {
  if (cfg.mode === 'plain') return { mode: 'plain', servers: parseDnsServers(cfg.servers) ?? parseDnsServers(DEFAULT_DNS_SERVERS)! };
  if (cfg.mode === 'doh') return { mode: 'doh', url: isValidDohUrl(cfg.dohUrl) ? cfg.dohUrl : DEFAULT_DOH_URL };
  return { mode: 'system' };
}

function build(cfg: DnsConfig): HostResolver | null {
  const n = normalize(cfg);
  if (n.mode === 'plain') return new HostResolver('plain', n.servers, '');
  if (n.mode === 'doh') return new HostResolver('doh', [], n.url);
  return null;
}

let active: { resolver: HostResolver; agent: Agent } | null = null;

/** Applies the DNS settings to every following request of the launcher. */
export function configureDns(cfg: DnsConfig): void {
  const old = active;
  const resolver = build(cfg);
  active = resolver ? { resolver, agent: new Agent({ connect: { lookup: toLookup(resolver.resolve) } }) } : null;
  if (old) void old.agent.close().catch(() => undefined);
}

/** `fetch` that honours the DNS settings. */
export async function dnsFetch(url: URL, init: RequestInit): Promise<Response> {
  const a = active;
  if (!a) return fetch(url, init);
  return (await undiciFetch(url as never, { ...init, dispatcher: a.agent } as never)) as unknown as Response;
}

/** Tries a DNS configuration on a real host (the settings page «Проверить»), without touching the active one. */
export async function testDns(cfg: DnsConfig, host = 'api.modrinth.com'): Promise<DnsTestResult> {
  const started = Date.now();
  try {
    const resolver = build(cfg);
    const addrs = resolver
      ? await resolver.resolve(host)
      : (await dns.promises.lookup(host, { all: true })).map((a) => ({ address: a.address, family: a.family === 6 ? 6 : 4 }));
    return { ok: true, host, addresses: addrs.map((a) => a.address).slice(0, 6), ms: Date.now() - started, error: null };
  } catch (e) {
    return { ok: false, host, addresses: [], ms: Date.now() - started, error: e instanceof Error ? e.message : String(e) };
  }
}
