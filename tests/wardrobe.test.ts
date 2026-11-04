import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import * as fs from 'node:fs/promises';
import * as http from 'node:http';
import type { AddressInfo } from 'node:net';
import * as os from 'node:os';
import * as path from 'node:path';
import { deflateSync } from 'node:zlib';
import { __allowHostForTests } from '../src/main/net';
import { decodePngRgba, readPngHeader } from '../src/main/png';
import { MAX_SKIN_BYTES, WardrobeService, cleanSkinName, inspectSkin, pickActiveSkin, texturesUrl } from '../src/main/wardrobe';

// ---- tiny PNG encoder (RGBA, 8-bit) with selectable row filters ----
const CRC = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; }
  return t;
})();
function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (const b of buf) c = CRC[(c ^ b) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'latin1'), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}
function paeth(a: number, b: number, c: number): number {
  const p = a + b - c; const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
}
export function makePng(w: number, h: number, px: (x: number, y: number) => [number, number, number, number], filterFor: (y: number) => number = () => 0): Buffer {
  const stride = w * 4;
  const img = Buffer.alloc(h * stride);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) img.set(px(x, y), y * stride + x * 4);
  const rows: Buffer[] = [];
  for (let y = 0; y < h; y++) {
    const f = filterFor(y);
    const row = Buffer.alloc(stride + 1); row[0] = f;
    for (let x = 0; x < stride; x++) {
      const v = img[y * stride + x]!;
      const a = x >= 4 ? img[y * stride + x - 4]! : 0;
      const b = y > 0 ? img[(y - 1) * stride + x]! : 0;
      const c = x >= 4 && y > 0 ? img[(y - 1) * stride + x - 4]! : 0;
      const pred = f === 0 ? 0 : f === 1 ? a : f === 2 ? b : f === 3 ? (a + b) >> 1 : paeth(a, b, c);
      row[x + 1] = (v - pred) & 0xff;
    }
    rows.push(row);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(Buffer.concat(rows))), chunk('IEND', Buffer.alloc(0))]);
}

const pattern = (x: number, y: number): [number, number, number, number] => [(x * 4) & 255, (y * 4) & 255, (x + y) & 255, 255];
const classicSkin = () => makePng(64, 64, pattern);
const slimSkin = () => makePng(64, 64, (x, y) => ((x === 47 && y >= 20 && y <= 31) || (x === 39 && y >= 52)) ? [0, 0, 0, 0] : pattern(x, y));

describe('png decoder', () => {
  it('reads the header', () => {
    expect(readPngHeader(classicSkin())).toMatchObject({ width: 64, height: 64, bitDepth: 8, colorType: 6, interlace: 0 });
    expect(readPngHeader(Buffer.from('not a png at all, definitely not'))).toBeNull();
  });
  it('decodes pixels exactly, whatever the row filter is', () => {
    for (const filter of [0, 1, 2, 3, 4, 'mixed'] as const) {
      const png = makePng(64, 64, pattern, filter === 'mixed' ? (y) => y % 5 : () => filter);
      const d = decodePngRgba(png)!;
      expect(d.width).toBe(64);
      for (const [x, y] of [[0, 0], [63, 0], [17, 33], [63, 63], [40, 12]] as const) {
        expect([...d.rgba.slice((y * 64 + x) * 4, (y * 64 + x) * 4 + 4)]).toEqual(pattern(x, y));
      }
    }
  });
  it('refuses images bigger than the limit instead of inflating them', () => {
    expect(decodePngRgba(makePng(128, 128, pattern))).toBeNull();
  });
  it('returns null for damaged data', () => {
    const png = classicSkin();
    expect(decodePngRgba(png.subarray(0, png.length - 40))).toBeNull();
  });
});

describe('inspectSkin', () => {
  it('detects the model', () => {
    expect(inspectSkin(classicSkin()).variant).toBe('classic');
    expect(inspectSkin(slimSkin()).variant).toBe('slim');
    expect(inspectSkin(makePng(64, 32, pattern)).variant).toBe('classic');
  });
  it('rejects wrong files with a clear message', () => {
    expect(() => inspectSkin(Buffer.from('hello'))).toThrow(/не PNG/);
    expect(() => inspectSkin(makePng(128, 128, pattern))).toThrow(/64×64 или 64×32.*128×128/);
    expect(() => inspectSkin(Buffer.concat([classicSkin(), Buffer.alloc(MAX_SKIN_BYTES)]))).toThrow(/слишком большой/);
  });
});

describe('Mojang profile helpers', () => {
  it('picks the active skin and its model', () => {
    const profile = { skins: [{ state: 'INACTIVE', url: 'http://textures.minecraft.net/texture/old' }, { state: 'ACTIVE', url: 'http://textures.minecraft.net/texture/abc', variant: 'SLIM' }] };
    expect(pickActiveSkin(profile)).toEqual({ url: 'http://textures.minecraft.net/texture/abc', variant: 'slim' });
    expect(pickActiveSkin({ skins: [{ state: 'ACTIVE', url: 'http://textures.minecraft.net/texture/x', variant: 'CLASSIC' }] })?.variant).toBe('classic');
    expect(pickActiveSkin({ skins: [] })).toBeNull();
    expect(pickActiveSkin(null)).toBeNull();
  });
  it('only ever fetches textures.minecraft.net, over https', () => {
    expect(texturesUrl('http://textures.minecraft.net/texture/abc')).toBe('https://textures.minecraft.net/texture/abc');
    expect(() => texturesUrl('http://evil.example/texture/abc')).toThrow();
    expect(() => texturesUrl('https://textures.minecraft.net.evil.example/x')).toThrow();
    expect(() => texturesUrl('not a url')).toThrow();
  });
  it('cleans names', () => {
    expect(cleanSkinName('  Steve\u0000\n  ')).toBe('Steve');
    expect(cleanSkinName('x'.repeat(100))).toHaveLength(32);
  });
});

let tmp: string;
let svc: WardrobeService;
let server: http.Server;
let base: string;
let seen: { method?: string; url?: string; headers: http.IncomingHttpHeaders; body: Buffer }[] = [];
let respond: { status: number; body: string } = { status: 200, body: '{}' };
let token = 'tok-secret-123';

beforeAll(async () => {
  server = http.createServer((req, res) => {
    const parts: Buffer[] = [];
    req.on('data', (c: Buffer) => parts.push(c));
    req.on('end', () => {
      seen.push({ method: req.method, url: req.url, headers: req.headers, body: Buffer.concat(parts) });
      res.writeHead(respond.status, { 'Content-Type': 'application/json' });
      res.end(respond.body);
    });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  __allowHostForTests('127.0.0.1');
});
afterAll(() => { server.close(); server.closeAllConnections(); });
beforeEach(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'chald-w-'));
  seen = [];
  respond = { status: 200, body: '{}' };
  svc = new WardrobeService(path.join(tmp, 'wardrobe'), { apiBase: base, getToken: async () => token });
});
afterEach(async () => fs.rm(tmp, { recursive: true, force: true }));

async function file(name: string, data: Buffer): Promise<string> {
  const p = path.join(tmp, name);
  await fs.writeFile(p, data);
  return p;
}

describe('wardrobe library', () => {
  it('imports skins, detects the model, and lists them', async () => {
    const r = await svc.importFiles([await file('Alex.png', slimSkin()), await file('Steve.png', classicSkin())]);
    expect(r.problems).toEqual([]);
    expect(r.added.map((s) => [s.name, s.variant]).sort()).toEqual([['Alex', 'slim'], ['Steve', 'classic']]);
    const list = await svc.list();
    expect(list).toHaveLength(2);
    expect(list[0]!.dataUrl.startsWith('data:image/png;base64,')).toBe(true);
    // survives a restart
    const again = new WardrobeService(path.join(tmp, 'wardrobe'), { apiBase: base, getToken: async () => token });
    expect(await again.list()).toHaveLength(2);
  });
  it('reports bad files and duplicates without failing the rest', async () => {
    await svc.importFiles([await file('a.png', classicSkin())]);
    const r = await svc.importFiles([
      await file('copy.png', classicSkin()),
      await file('huge.png', makePng(128, 128, pattern)),
      await file('text.png', Buffer.from('nope')),
      await file('ok.png', slimSkin()),
    ]);
    expect(r.added.map((s) => s.name)).toEqual(['ok']);
    expect(r.problems).toHaveLength(3);
    expect(r.problems.join('\n')).toMatch(/уже есть/);
    expect(r.problems.join('\n')).toMatch(/128×128/);
    expect(await svc.list()).toHaveLength(2);
  });
  it('renames, changes the model, removes', async () => {
    const { added } = await svc.importFiles([await file('a.png', classicSkin())]);
    const id = added[0]!.id;
    expect((await svc.update(id, { name: '  Новый скин ', variant: 'slim' }))).toMatchObject({ name: 'Новый скин', variant: 'slim' });
    await expect(svc.update(id, { name: '   ' })).rejects.toThrow(/название/);
    await svc.remove(id);
    expect(await svc.list()).toEqual([]);
    await expect(fs.stat(path.join(tmp, 'wardrobe', `${id}.png`))).rejects.toThrow();
  });
  it('never touches files outside its folder: ids are validated', async () => {
    await expect(svc.remove('../../etc/passwd')).rejects.toThrow(/идентификатор/);
    await expect(svc.update('..%2f..', { name: 'x' })).rejects.toThrow(/идентификатор/);
    await expect(svc.apply('../x')).rejects.toThrow();
  });
  it('survives a damaged index and a skin file deleted by hand', async () => {
    const { added } = await svc.importFiles([await file('a.png', classicSkin())]);
    await fs.rm(path.join(tmp, 'wardrobe', `${added[0]!.id}.png`));
    expect(await svc.list()).toEqual([]);
    await fs.writeFile(path.join(tmp, 'wardrobe', 'index.json'), '{broken');
    expect(await svc.list()).toEqual([]);
  });
});

describe('changing the skin on the account', () => {
  it('uploads the PNG with the model and the bearer token, and returns what is now worn', async () => {
    const { added } = await svc.importFiles([await file('Alex.png', slimSkin())]);
    const worn = await svc.apply(added[0]!.id);
    expect(worn.variant).toBe('slim');
    expect(seen).toHaveLength(1);
    const req = seen[0]!;
    expect(req.method).toBe('POST');
    expect(req.url).toBe('/minecraft/profile/skins');
    expect(req.headers.authorization).toBe(`Bearer ${token}`);
    expect(req.headers['content-type']).toMatch(/^multipart\/form-data; boundary=/);
    const body = req.body.toString('latin1');
    expect(body).toMatch(/name="variant"\r\n\r\nslim/);
    expect(body).toMatch(/name="file"; filename="skin\.png"/);
    expect(req.body.includes(slimSkin())).toBe(true);
  });
  it('resets to the default skin', async () => {
    await svc.reset();
    expect(seen[0]).toMatchObject({ method: 'DELETE', url: '/minecraft/profile/skins/active' });
    expect(seen[0]!.headers.authorization).toBe(`Bearer ${token}`);
  });
  it('turns Mojang errors into readable messages that never contain the token', async () => {
    const { added } = await svc.importFiles([await file('a.png', classicSkin())]);
    const id = added[0]!.id;
    const cases: [number, string, RegExp][] = [
      [401, '{}', /войди в аккаунт/i],
      [429, '{}', /частоту/],
      [400, '{"errorMessage":"Invalid skin"}', /Invalid skin/],
      [500, '{}', /HTTP 500/],
    ];
    for (const [status, body, re] of cases) {
      respond = { status, body };
      const err = await svc.apply(id).then(() => null, (e: Error) => e);
      expect(err?.message).toMatch(re);
      expect(err?.message).not.toContain(token);
    }
  });
  it('does not call Mojang when there is no Microsoft session', async () => {
    const offline = new WardrobeService(path.join(tmp, 'wardrobe'), { apiBase: base, getToken: async () => { throw new Error('нужен вход Microsoft'); } });
    const { added } = await offline.importFiles([await file('a.png', classicSkin())]);
    await expect(offline.apply(added[0]!.id)).rejects.toThrow(/Microsoft/);
    await expect(offline.reset()).rejects.toThrow(/Microsoft/);
    await expect(offline.current()).rejects.toThrow(/Microsoft/);
    expect(seen).toEqual([]);
  });
});
