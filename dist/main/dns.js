"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.HostResolver = void 0;
exports.encodeQuery = encodeQuery;
exports.decodeAnswer = decodeAnswer;
exports.toLookup = toLookup;
exports.setDnsLogger = setDnsLogger;
exports.configureDns = configureDns;
exports.dnsFetch = dnsFetch;
exports.testDns = testDns;
const dns = __importStar(require("node:dns"));
const net = __importStar(require("node:net"));
const undici_1 = require("undici");
const dns_1 = require("../shared/dns");
const TYPE_A = 1;
const TYPE_AAAA = 28;
const DOH_TIMEOUT_MS = 6000;
const MIN_TTL = 30;
const MAX_TTL = 300;
function dnsError(code, message) {
    return Object.assign(new Error(message), { code });
}
/* ---------- DNS wire format (RFC 1035), just enough for A / AAAA ---------- */
function encodeQuery(name, type) {
    const labels = name.replace(/\.$/, '').split('.');
    // id 0 (RFC 8484 §4.1: better for HTTP caches), flags: recursion desired, 1 question
    const parts = [Buffer.from([0, 0, 0x01, 0x00, 0, 1, 0, 0, 0, 0, 0, 0])];
    for (const label of labels) {
        const b = Buffer.from(label, 'ascii');
        if (b.length === 0 || b.length > 63)
            throw dnsError('EBADNAME', `Некорректное имя хоста: ${name}`);
        parts.push(Buffer.from([b.length]), b);
    }
    parts.push(Buffer.from([0, (type >> 8) & 0xff, type & 0xff, 0, 1]));
    return Buffer.concat(parts);
}
function decodeAnswer(msg) {
    if (msg.length < 12)
        throw dnsError('EBADRESP', 'DNS: слишком короткий ответ');
    const rcode = msg.readUInt16BE(2) & 0x0f;
    const qd = msg.readUInt16BE(4);
    const an = msg.readUInt16BE(6);
    let off = 12;
    const skipName = () => {
        for (;;) {
            if (off >= msg.length)
                throw dnsError('EBADRESP', 'DNS: повреждённый ответ');
            const len = msg[off];
            if (len === 0) {
                off += 1;
                return;
            }
            if ((len & 0xc0) === 0xc0) {
                off += 2;
                return;
            } // compression pointer ends the name
            off += 1 + len;
        }
    };
    for (let i = 0; i < qd; i++) {
        skipName();
        off += 4;
    }
    const addrs = [];
    let ttl = Infinity;
    for (let i = 0; i < an; i++) {
        skipName();
        if (off + 10 > msg.length)
            throw dnsError('EBADRESP', 'DNS: повреждённый ответ');
        const type = msg.readUInt16BE(off);
        const t = msg.readUInt32BE(off + 4);
        const len = msg.readUInt16BE(off + 8);
        off += 10;
        if (off + len > msg.length)
            throw dnsError('EBADRESP', 'DNS: повреждённый ответ');
        if (type === TYPE_A && len === 4) {
            addrs.push({ address: [...msg.subarray(off, off + 4)].join('.'), family: 4 });
            ttl = Math.min(ttl, t);
        }
        else if (type === TYPE_AAAA && len === 16) {
            const groups = [];
            for (let g = 0; g < 8; g++)
                groups.push(msg.readUInt16BE(off + g * 2).toString(16));
            addrs.push({ address: groups.join(':'), family: 6 });
            ttl = Math.min(ttl, t);
        } // CNAME and the rest are skipped: the final A / AAAA records come in the same answer
        off += len;
    }
    return { rcode, addrs, ttl: Number.isFinite(ttl) ? ttl : MIN_TTL };
}
function toLookup(resolve) {
    return ((hostname, options, cb) => {
        resolve(hostname).then((list) => (options?.all ? cb(null, list) : cb(null, list[0].address, list[0].family)), (e) => cb(e));
    });
}
/** The DoH server's own name must be resolved without DoH: well-known providers have built-in addresses, others use the system DNS. */
const DOH_BOOTSTRAP = {
    'cloudflare-dns.com': ['1.1.1.1', '1.0.0.1'],
    'dns.google': ['8.8.8.8', '8.8.4.4'],
    'dns.quad9.net': ['9.9.9.9', '149.112.112.112'],
};
const bootstrapResolve = async (host) => {
    const known = DOH_BOOTSTRAP[host];
    if (known)
        return known.map((address) => ({ address, family: 4 }));
    const list = await dns.promises.lookup(host, { all: true });
    return list.map((a) => ({ address: a.address, family: a.family === 6 ? 6 : 4 }));
};
let dohLogger = () => undefined;
/** net.ts registers its log here so DoH requests show up in the launcher's network log too. */
function setDnsLogger(fn) {
    dohLogger = fn;
}
let bootstrapAgent = null;
function dohAgent() {
    return (bootstrapAgent ??= new undici_1.Agent({ connect: { lookup: toLookup(bootstrapResolve) } }));
}
async function dohQuery(url, name, type) {
    const u = new URL(url);
    u.searchParams.set('dns', encodeQuery(name, type).toString('base64url'));
    const log = { host: u.host, path: u.pathname, status: null, bytes: null, error: null };
    try {
        const res = await (0, undici_1.fetch)(u, {
            headers: { accept: 'application/dns-message' },
            dispatcher: dohAgent(),
            signal: AbortSignal.timeout(DOH_TIMEOUT_MS),
            redirect: 'error',
        });
        log.status = res.status;
        if (!res.ok)
            throw dnsError('DOH_FAILED', `DoH: ${u.host} ответил HTTP ${res.status}`);
        const buf = Buffer.from(await res.arrayBuffer());
        if (buf.length > 65535)
            throw dnsError('EBADRESP', 'DoH: слишком большой ответ');
        log.bytes = buf.length;
        return decodeAnswer(buf);
    }
    catch (e) {
        log.error = e instanceof Error ? e.message : String(e);
        if (e.code)
            throw e;
        throw dnsError('DOH_FAILED', `DoH: не удалось связаться с ${u.host}`);
    }
    finally {
        dohLogger(log);
    }
}
class HostResolver {
    mode;
    servers;
    dohUrl;
    cache = new Map();
    inflight = new Map();
    plainResolver = null;
    constructor(mode, servers, dohUrl) {
        this.mode = mode;
        this.servers = servers;
        this.dohUrl = dohUrl;
        if (mode === 'plain') {
            this.plainResolver = new dns.promises.Resolver({ timeout: 4000, tries: 2 });
            this.plainResolver.setServers(servers);
        }
    }
    resolve = (host) => {
        const family = net.isIP(host);
        if (family)
            return Promise.resolve([{ address: host, family: family === 6 ? 6 : 4 }]);
        const hit = this.cache.get(host);
        if (hit && hit.exp > Date.now())
            return Promise.resolve(hit.addrs);
        let p = this.inflight.get(host);
        if (!p) {
            p = this.query(host)
                .then((a) => {
                if (a.addrs.length === 0)
                    throw dnsError('ENOTFOUND', `DNS: адрес ${host} не найден`);
                this.cache.set(host, { addrs: a.addrs, exp: Date.now() + Math.min(MAX_TTL, Math.max(MIN_TTL, a.ttl)) * 1000 });
                return a.addrs;
            })
                .finally(() => this.inflight.delete(host));
            this.inflight.set(host, p);
        }
        return p;
    };
    async query(host) {
        const [a, aaaa] = await Promise.allSettled(this.mode === 'plain'
            ? [this.plain4(host), this.plain6(host)]
            : [dohQuery(this.dohUrl, host, TYPE_A), dohQuery(this.dohUrl, host, TYPE_AAAA)]);
        const ok = [a, aaaa].filter((r) => r.status === 'fulfilled').map((r) => r.value);
        if (ok.length === 0) {
            const reason = [a, aaaa].find((r) => r.status === 'rejected')?.reason;
            // ENOTFOUND / ENODATA from a DNS server mean "no such host", anything else is a broken DNS server
            if (reason?.code === 'ENOTFOUND' || reason?.code === 'ENODATA')
                throw dnsError('ENOTFOUND', `DNS: адрес ${host} не найден`);
            throw dnsError('DNS_FAILED', `DNS-сервер не отвечает (${this.mode === 'doh' ? this.dohUrl : this.servers.join(', ')}): ${reason?.message ?? 'нет ответа'}`);
        }
        return {
            addrs: ok.flatMap((r) => r.addrs),
            ttl: Math.min(...ok.map((r) => r.ttl)),
        };
    }
    async plain4(host) {
        const r = await this.plainResolver.resolve4(host, { ttl: true });
        return { addrs: r.map((x) => ({ address: x.address, family: 4 })), ttl: Math.min(...r.map((x) => x.ttl), MAX_TTL) };
    }
    async plain6(host) {
        // many hosts have no AAAA record: query() ignores that as long as the A query worked
        const r = await this.plainResolver.resolve6(host, { ttl: true });
        return { addrs: r.map((x) => ({ address: x.address, family: 6 })), ttl: Math.min(...r.map((x) => x.ttl), MAX_TTL) };
    }
}
exports.HostResolver = HostResolver;
/* ---------- public API ---------- */
function normalize(cfg) {
    if (cfg.mode === 'plain')
        return { mode: 'plain', servers: (0, dns_1.parseDnsServers)(cfg.servers) ?? (0, dns_1.parseDnsServers)(dns_1.DEFAULT_DNS_SERVERS) };
    if (cfg.mode === 'doh')
        return { mode: 'doh', url: (0, dns_1.isValidDohUrl)(cfg.dohUrl) ? cfg.dohUrl : dns_1.DEFAULT_DOH_URL };
    return { mode: 'system' };
}
function build(cfg) {
    const n = normalize(cfg);
    if (n.mode === 'plain')
        return new HostResolver('plain', n.servers, '');
    if (n.mode === 'doh')
        return new HostResolver('doh', [], n.url);
    return null;
}
let active = null;
/** Applies the DNS settings to every following request of the launcher. */
function configureDns(cfg) {
    const old = active;
    const resolver = build(cfg);
    active = resolver ? { resolver, agent: new undici_1.Agent({ connect: { lookup: toLookup(resolver.resolve) } }) } : null;
    if (old)
        void old.agent.close().catch(() => undefined);
}
/** `fetch` that honours the DNS settings. */
async function dnsFetch(url, init) {
    const a = active;
    if (!a)
        return fetch(url, init);
    return (await (0, undici_1.fetch)(url, { ...init, dispatcher: a.agent }));
}
/** Tries a DNS configuration on a real host (the settings page «Проверить»), without touching the active one. */
async function testDns(cfg, host = 'api.modrinth.com') {
    const started = Date.now();
    try {
        const resolver = build(cfg);
        const addrs = resolver
            ? await resolver.resolve(host)
            : (await dns.promises.lookup(host, { all: true })).map((a) => ({ address: a.address, family: a.family === 6 ? 6 : 4 }));
        return { ok: true, host, addresses: addrs.map((a) => a.address).slice(0, 6), ms: Date.now() - started, error: null };
    }
    catch (e) {
        return { ok: false, host, addresses: [], ms: Date.now() - started, error: e instanceof Error ? e.message : String(e) };
    }
}
//# sourceMappingURL=dns.js.map