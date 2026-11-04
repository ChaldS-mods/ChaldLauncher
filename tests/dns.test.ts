import { afterEach, describe, expect, it } from 'vitest';
import * as dgram from 'node:dgram';
import * as http from 'node:http';
import type { AddressInfo } from 'node:net';
import { Agent, fetch as undiciFetch } from 'undici';
import { decodeAnswer, encodeQuery, HostResolver, testDns, toLookup } from '../src/main/dns';
import { DEFAULT_DNS_SERVERS, DEFAULT_DOH_URL, isValidDohUrl, parseDnsServers } from '../src/shared/dns';
import { appSettingsPatchSchema } from '../src/shared/schemas';
import { DEFAULT_SETTINGS } from '../src/main/settings';

/** A DNS response with the given A records (and optionally a CNAME in front, using a compression pointer). */
function response(query: Buffer, ips: string[], ttl = 120, withCname = false): Buffer {
  const header = Buffer.from(query.subarray(0, 12));
  header.writeUInt16BE(0x8180, 2);
  header.writeUInt16BE(1, 4);
  header.writeUInt16BE(ips.length + (withCname ? 1 : 0), 6);
  const question = query.subarray(12);
  const parts: Buffer[] = [header, question];
  if (withCname) {
    const target = Buffer.from([3, 0x61, 0x62, 0x63, 0]); // "abc."
    const rr = Buffer.alloc(12);
    rr.writeUInt16BE(0xc00c, 0); rr.writeUInt16BE(5, 2); rr.writeUInt16BE(1, 4); rr.writeUInt32BE(ttl, 6); rr.writeUInt16BE(target.length, 10);
    parts.push(rr, target);
  }
  for (const ip of ips) {
    const rr = Buffer.alloc(16);
    rr.writeUInt16BE(0xc00c, 0); rr.writeUInt16BE(1, 2); rr.writeUInt16BE(1, 4); rr.writeUInt32BE(ttl, 6); rr.writeUInt16BE(4, 10);
    ip.split('.').forEach((n, i) => rr.writeUInt8(Number(n), 12 + i));
    parts.push(rr);
  }
  return Buffer.concat(parts);
}

describe('DNS wire format', () => {
  it('encodes a query: id 0, recursion desired, one question', () => {
    const q = encodeQuery('api.modrinth.com', 1);
    expect([...q.subarray(0, 12)]).toEqual([0, 0, 1, 0, 0, 1, 0, 0, 0, 0, 0, 0]);
    expect(q.subarray(12).toString('latin1')).toBe('\x03api\x08modrinth\x03com\x00\x00\x01\x00\x01');
    expect(encodeQuery('example.com.', 28).subarray(-4).readUInt16BE(0)).toBe(28);
  });
  it('rejects empty and over-long labels', () => {
    expect(() => encodeQuery('a..b', 1)).toThrow();
    expect(() => encodeQuery(`${'x'.repeat(64)}.com`, 1)).toThrow();
  });
  it('decodes A records, skips CNAME, takes the smallest TTL', () => {
    const q = encodeQuery('www.example.com', 1);
    const a = decodeAnswer(response(q, ['93.184.216.34', '1.2.3.4'], 77, true));
    expect(a.rcode).toBe(0);
    expect(a.addrs).toEqual([{ address: '93.184.216.34', family: 4 }, { address: '1.2.3.4', family: 4 }]);
    expect(a.ttl).toBe(77);
  });
  it('decodes AAAA records', () => {
    const q = encodeQuery('example.com', 28);
    const msg = Buffer.concat([Buffer.from(q.subarray(0, 12)), q.subarray(12)]);
    msg.writeUInt16BE(0x8180, 2); msg.writeUInt16BE(1, 4); msg.writeUInt16BE(1, 6);
    const rr = Buffer.alloc(28);
    rr.writeUInt16BE(0xc00c, 0); rr.writeUInt16BE(28, 2); rr.writeUInt16BE(1, 4); rr.writeUInt32BE(300, 6); rr.writeUInt16BE(16, 10);
    Buffer.from('260647000000000000000000681084e5', 'hex').copy(rr, 12);
    const a = decodeAnswer(Buffer.concat([msg, rr]));
    expect(a.addrs).toEqual([{ address: '2606:4700:0:0:0:0:6810:84e5', family: 6 }]);
  });
  it('reports NXDOMAIN and throws on garbage', () => {
    const q = encodeQuery('nope.example', 1);
    const nx = Buffer.from(q); nx.writeUInt16BE(0x8183, 2);
    expect(decodeAnswer(nx)).toMatchObject({ rcode: 3, addrs: [] });
    expect(() => decodeAnswer(Buffer.from([1, 2, 3]))).toThrow();
    const cut = response(q, ['1.2.3.4']).subarray(0, -3);
    expect(() => decodeAnswer(cut)).toThrow();
  });
});

describe('DNS settings validation', () => {
  it('parses lists of DNS servers', () => {
    expect(parseDnsServers('1.1.1.1, 8.8.8.8')).toEqual(['1.1.1.1', '8.8.8.8']);
    expect(parseDnsServers('1.1.1.1;8.8.8.8 1.1.1.1')).toEqual(['1.1.1.1', '8.8.8.8']);
    expect(parseDnsServers('2606:4700:4700::1111')).toEqual(['2606:4700:4700::1111']);
    expect(parseDnsServers('::1, 2001:4860:4860:0:0:0:0:8888, ::ffff:1.2.3.4')).toHaveLength(3);
    expect(parseDnsServers(DEFAULT_DNS_SERVERS)).not.toBeNull();
    for (const bad of ['', '   ', 'dns.google', '256.1.1.1', '1.1.1', '1.1.1.1:53', '1.1.1.1, x', '1.1.1.1 2.2.2.2 3.3.3.3 4.4.4.4 5.5.5.5', ':::', '1::2::3', '1:2:3:4:5:6:7', '1:2:3:4:5:6:7:8:9', 'g::1', '12345::1']) {
      expect(parseDnsServers(bad), bad).toBeNull();
    }
  });
  it('accepts only https DoH URLs without credentials', () => {
    expect(isValidDohUrl(DEFAULT_DOH_URL)).toBe(true);
    expect(isValidDohUrl('https://dns.google/dns-query')).toBe(true);
    expect(isValidDohUrl('https://doh.example.org:8443/resolve')).toBe(true);
    for (const bad of ['', 'http://dns.google/dns-query', 'dns.google', 'https://user:pw@dns.google/x', 'ftp://x/y', `https://x.io/${'a'.repeat(300)}`]) {
      expect(isValidDohUrl(bad), bad).toBe(false);
    }
  });
  it('is part of the settings: defaults keep the system DNS, invalid values are rejected', () => {
    expect(DEFAULT_SETTINGS).toMatchObject({ dnsMode: 'system', dnsServers: DEFAULT_DNS_SERVERS, dnsDohUrl: DEFAULT_DOH_URL });
    expect(appSettingsPatchSchema.safeParse({ dnsMode: 'doh', dnsDohUrl: 'https://dns.google/dns-query' }).success).toBe(true);
    expect(appSettingsPatchSchema.safeParse({ dnsMode: 'plain', dnsServers: '9.9.9.9' }).success).toBe(true);
    expect(appSettingsPatchSchema.safeParse({ dnsMode: 'magic' }).success).toBe(false);
    expect(appSettingsPatchSchema.safeParse({ dnsServers: 'not-an-ip' }).success).toBe(false);
    expect(appSettingsPatchSchema.safeParse({ dnsDohUrl: 'http://insecure/dns' }).success).toBe(false);
  });
});

describe('resolving through a DNS server', () => {
  const closers: (() => Promise<void>)[] = [];
  afterEach(async () => { while (closers.length) await closers.pop()!(); });

  async function fakeDns(ips: string[], seen: string[] = []): Promise<string> {
    const sock = dgram.createSocket('udp4');
    sock.on('message', (msg, rinfo) => {
      const qtype = msg.readUInt16BE(msg.length - 4);
      seen.push(`${qtype}`);
      sock.send(response(msg, qtype === 1 ? ips : []), rinfo.port, rinfo.address);
    });
    await new Promise<void>((r) => sock.bind(0, '127.0.0.1', () => r()));
    closers.push(() => new Promise((r) => sock.close(() => r())));
    return `127.0.0.1:${(sock.address() as AddressInfo).port}`;
  }

  it('plain DNS: resolves a name, ignores a missing AAAA, caches the answer', async () => {
    const seen: string[] = [];
    const server = await fakeDns(['127.0.0.1'], seen);
    const r = new HostResolver('plain', [server], '');
    expect(await r.resolve('launcher.test')).toEqual([{ address: '127.0.0.1', family: 4 }]);
    const asked = seen.length;
    await r.resolve('launcher.test');
    expect(seen.length).toBe(asked); // second call is served from the cache
  });

  it('plain DNS: an IP literal is not looked up', async () => {
    const r = new HostResolver('plain', ['127.0.0.1:1'], '');
    expect(await r.resolve('10.1.2.3')).toEqual([{ address: '10.1.2.3', family: 4 }]);
  });

  it('plain DNS: a dead server gives a clear error', async () => {
    const r = new HostResolver('plain', ['127.0.0.1:9'], '');
    await expect(r.resolve('launcher.test')).rejects.toMatchObject({ code: expect.stringMatching(/DNS_FAILED|ENOTFOUND/) });
  }, 20000);

  it('plugs into an undici agent: the request goes to the address the DNS server gave', async () => {
    const web = http.createServer((_q, res) => res.end('hello from the right host'));
    await new Promise<void>((r) => web.listen(0, '127.0.0.1', () => r()));
    closers.push(() => new Promise((r) => web.close(() => r())));
    const server = await fakeDns(['127.0.0.1']);
    const agent = new Agent({ connect: { lookup: toLookup(new HostResolver('plain', [server], '').resolve) } });
    closers.push(() => agent.close());
    const res = await undiciFetch(`http://only-our-dns-knows.test:${(web.address() as AddressInfo).port}/`, { dispatcher: agent });
    expect(await res.text()).toBe('hello from the right host');
  });

  it('DoH: asks the endpoint with GET ?dns=<base64url> and reads the wire-format answer', async () => {
    const asked: { type: number; accept: string | undefined }[] = [];
    const doh = http.createServer((req, res) => {
      const u = new URL(req.url!, 'http://x');
      const q = Buffer.from(u.searchParams.get('dns') ?? '', 'base64url');
      const qtype = q.readUInt16BE(q.length - 4);
      asked.push({ type: qtype, accept: req.headers.accept });
      if (u.pathname !== '/dns-query') { res.statusCode = 404; return res.end(); }
      res.setHeader('content-type', 'application/dns-message');
      res.end(response(q, qtype === 1 ? ['127.0.0.1'] : [], 90));
    });
    await new Promise<void>((r) => doh.listen(0, '127.0.0.1', () => r()));
    closers.push(() => new Promise((r) => doh.close(() => r())));
    const url = `http://127.0.0.1:${(doh.address() as AddressInfo).port}/dns-query`;
    const r = new HostResolver('doh', [], url);
    expect(await r.resolve('launcher.test')).toEqual([{ address: '127.0.0.1', family: 4 }]);
    expect(asked.map((a) => a.type).sort()).toEqual([1, 28]);
    expect(asked.every((a) => a.accept === 'application/dns-message')).toBe(true);
  });

  it('DoH: an unreachable or failing endpoint gives a DNS error, not a hang', async () => {
    const r = new HostResolver('doh', [], 'http://127.0.0.1:9/dns-query');
    await expect(r.resolve('launcher.test')).rejects.toMatchObject({ code: 'DNS_FAILED' });
    const bad = http.createServer((_q, res) => { res.statusCode = 500; res.end(); });
    await new Promise<void>((ok) => bad.listen(0, '127.0.0.1', () => ok()));
    closers.push(() => new Promise((ok) => bad.close(() => ok())));
    const r2 = new HostResolver('doh', [], `http://127.0.0.1:${(bad.address() as AddressInfo).port}/dns-query`);
    await expect(r2.resolve('launcher.test')).rejects.toThrow(/HTTP 500/);
  });

  it('testDns reports the system DNS for localhost and failures as data, not exceptions', async () => {
    const ok = await testDns({ mode: 'system', servers: '', dohUrl: '' }, 'localhost');
    expect(ok).toMatchObject({ ok: true, host: 'localhost' });
    expect(ok.addresses.length).toBeGreaterThan(0);
    const bad = await testDns({ mode: 'plain', servers: '127.0.0.1', dohUrl: '' }, 'launcher.test');
    expect(bad.ok).toBe(false);
    expect(bad.error).toBeTruthy();
  }, 20000);
});
