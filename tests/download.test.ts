import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import * as fs from 'node:fs/promises';
import * as http from 'node:http';
import * as os from 'node:os';
import * as path from 'node:path';
import { createHash } from 'node:crypto';
import { downloadFile, isFileValid, runPool } from '../src/main/download';
import { __allowHostForTests, netRequest } from '../src/main/net';
import { parseJavaMajor, pickJava } from '../src/main/java';
import { compareVersions } from '../src/main/update';

const body = Buffer.from('hello chald launcher'.repeat(100));
const sha1 = createHash('sha1').update(body).digest('hex');
let server: http.Server;
let base: string;
let tmp: string;
let flaky = 0;
let hits = 0;

beforeAll(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'chald-d-'));
  server = http.createServer((req, res) => {
    hits++;
    if (req.url === '/ok') return void res.end(body);
    if (req.url === '/flaky') {
      if (flaky++ < 2) { res.statusCode = 503; return void res.end('no'); }
      return void res.end(body);
    }
    if (req.url === '/missing') { res.statusCode = 404; return void res.end('no'); }
    if (req.url === '/redirect') { res.statusCode = 302; res.setHeader('location', '/ok'); return void res.end(); }
    if (req.url === '/evil') { res.statusCode = 302; res.setHeader('location', 'https://evil.example.com/x'); return void res.end(); }
    res.statusCode = 400;
    res.end();
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const port = (server.address() as { port: number }).port;
  __allowHostForTests('127.0.0.1');
  base = `http://127.0.0.1:${port}`;
});
afterAll(async () => {
  server.close();
  await fs.rm(tmp, { recursive: true, force: true });
});

describe('downloadFile', () => {
  it('downloads, verifies sha1 and reports bytes', async () => {
    const dest = path.join(tmp, 'a', 'ok.bin');
    let bytes = 0;
    await downloadFile({ url: `${base}/ok`, dest, sha1, size: body.length, purpose: 't' }, { onBytes: (n) => (bytes += n) });
    expect((await fs.readFile(dest)).equals(body)).toBe(true);
    expect(bytes).toBe(body.length);
  });
  it('skips files that are already valid', async () => {
    const dest = path.join(tmp, 'skip.bin');
    await fs.writeFile(dest, body);
    const before = hits;
    await downloadFile({ url: `${base}/ok`, dest, sha1, purpose: 't' });
    expect(hits).toBe(before);
  });
  it('re-downloads a corrupted file', async () => {
    const dest = path.join(tmp, 'corrupt.bin');
    await fs.writeFile(dest, 'garbage');
    await downloadFile({ url: `${base}/ok`, dest, sha1, purpose: 't' });
    expect(await isFileValid(dest, { sha1 })).toBe(true);
  });
  it('retries on 5xx', async () => {
    const dest = path.join(tmp, 'flaky.bin');
    await downloadFile({ url: `${base}/flaky`, dest, sha1, purpose: 't' }, { retryDelayMs: 1 });
    expect(await isFileValid(dest, { sha1 })).toBe(true);
  });
  it('does not retry 404', async () => {
    const before = hits;
    await expect(downloadFile({ url: `${base}/missing`, dest: path.join(tmp, 'm.bin'), purpose: 't' }, { retryDelayMs: 1 })).rejects.toThrow(/404/);
    expect(hits - before).toBe(1);
  });
  it('fails on checksum mismatch and leaves no file or .part behind', async () => {
    const dest = path.join(tmp, 'bad.bin');
    let bytes = 0;
    await expect(
      downloadFile({ url: `${base}/ok`, dest, sha1: '0'.repeat(40), purpose: 't' }, { retries: 1, retryDelayMs: 1, onBytes: (n) => (bytes += n) }),
    ).rejects.toThrow(/SHA-1/);
    await expect(fs.stat(dest)).rejects.toThrow();
    expect((await fs.readdir(tmp)).filter((f) => f.endsWith('.part'))).toHaveLength(0);
    expect(bytes).toBe(0); // progress of failed attempts is reverted
  });
  it('honors abort', async () => {
    const ac = new AbortController();
    ac.abort();
    await expect(downloadFile({ url: `${base}/ok`, dest: path.join(tmp, 'ab.bin'), purpose: 't' }, { signal: ac.signal })).rejects.toThrow();
  });
  it('follows redirects inside the allowlist but blocks other hosts', async () => {
    const dest = path.join(tmp, 'r.bin');
    await downloadFile({ url: `${base}/redirect`, dest, sha1, purpose: 't' });
    expect(await isFileValid(dest, { sha1 })).toBe(true);
    await expect(netRequest(`${base}/evil`, { purpose: 't' })).rejects.toThrow(/не в списке/);
  });
});

describe('net policy', () => {
  it('blocks http and unknown hosts', async () => {
    await expect(netRequest('http://piston-meta.mojang.com/x', { purpose: 't' })).rejects.toThrow(/небезопасн/);
    await expect(netRequest('https://example.com/x', { purpose: 't' })).rejects.toThrow(/не в списке/);
  });
});

describe('runPool', () => {
  it('limits concurrency and processes everything', async () => {
    let active = 0, max = 0, done = 0;
    await runPool(Array.from({ length: 20 }, (_, i) => i), 4, async () => {
      active++; max = Math.max(max, active);
      await new Promise((r) => setTimeout(r, 5));
      active--; done++;
    });
    expect(done).toBe(20);
    expect(max).toBeLessThanOrEqual(4);
  });
  it('stops after the first failure and rethrows it', async () => {
    let started = 0;
    await expect(runPool(Array.from({ length: 50 }, (_, i) => i), 2, async (i) => {
      started++;
      if (i === 3) throw new Error('boom');
      await new Promise((r) => setTimeout(r, 2));
    })).rejects.toThrow('boom');
    expect(started).toBeLessThan(50);
  });
});

describe('java helpers', () => {
  it('parses versions', () => {
    expect(parseJavaMajor('openjdk version "21.0.4" 2024-07-16')).toBe(21);
    expect(parseJavaMajor('java version "1.8.0_392"')).toBe(8);
    expect(parseJavaMajor('nonsense')).toBeNull();
  });
  it('picks exact then lowest newer', () => {
    const j = (major: number) => ({ path: `/j${major}`, major, source: 'system' as const });
    expect(pickJava(17, [j(8), j(17), j(21)])?.major).toBe(17);
    expect(pickJava(17, [j(8), j(21), j(25)])?.major).toBe(21);
    expect(pickJava(21, [j(8), j(17)])).toBeNull();
  });
});

describe('update compare', () => {
  it('compares versions', () => {
    expect(compareVersions('v1.2.0', '1.1.9')).toBe(1);
    expect(compareVersions('1.0', '1.0.0')).toBe(0);
    expect(compareVersions('0.9.9', '1.0.0')).toBe(-1);
  });
});
