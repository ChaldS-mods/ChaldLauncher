import * as fs from 'node:fs';
import * as path from 'node:path';
import * as zlib from 'node:zlib';
import * as crypto from 'node:crypto';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';

/**
 * Формат данных установщика (.chpk), без внешних зависимостей:
 *   [файл 1, deflate][файл 2, deflate]...[заголовок JSON][u32 LE длина заголовка][MAGIC 8 байт]
 * Заголовок в конце, поэтому пакуем за один проход. У каждого файла есть размер и SHA-256, они проверяются при распаковке.
 */
export const MAGIC = Buffer.from([0x43, 0x48, 0x50, 0x4b, 0x01, 0x00, 0x00, 0x00]); // "CHPK", версия 1
const TRAILER = 4 + MAGIC.length;
const MAX_HEADER = 16 * 1024 * 1024;
const MAX_FILES = 200_000;
const MAX_TOTAL = 8 * 1024 ** 3;

export interface PayloadMeta {
  version: string;
  productName: string;
  exe: string;
  publisher: string;
  appId: string;
}
export interface PayloadFile {
  /** относительный путь с «/» */
  p: string;
  /** размер до сжатия */
  s: number;
  /** размер в архиве */
  c: number;
  /** sha256 содержимого, hex */
  h: string;
}
export interface PayloadHeader {
  meta: PayloadMeta;
  files: PayloadFile[];
  totalSize: number;
}
export interface Progress {
  done: number;
  total: number;
  file: string;
}

const RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;

/** Проверка относительного пути из архива: никаких выходов за папку, абсолютных путей и имён, запрещённых в Windows. */
export function checkRelPath(p: unknown): string {
  if (typeof p !== 'string' || p.length === 0 || p.length > 400) throw new Error('Некорректный путь в архиве');
  // eslint-disable-next-line no-control-regex
  if (/[\x00-\x1f<>"|?*\\:]/.test(p) || p.startsWith('/')) throw new Error(`Недопустимый путь в архиве: ${p}`);
  for (const seg of p.split('/')) {
    if (seg === '' || seg === '.' || seg === '..' || /[. ]$/.test(seg) || RESERVED.test(seg.split('.')[0] ?? '')) {
      throw new Error(`Недопустимый путь в архиве: ${p}`);
    }
  }
  return p;
}

function isSize(n: unknown): n is number {
  return typeof n === 'number' && Number.isSafeInteger(n) && n >= 0;
}

export function validateHeader(raw: unknown, dataBytes: number): PayloadHeader {
  const bad = (m: string): never => {
    throw new Error(`Файл установщика повреждён (${m})`);
  };
  if (typeof raw !== 'object' || raw === null) return bad('заголовок');
  const r = raw as Record<string, unknown>;
  const m = r.meta as Record<string, unknown> | undefined;
  if (!m || typeof m !== 'object') return bad('meta');
  for (const k of ['version', 'productName', 'exe', 'publisher', 'appId']) {
    const v = m[k];
    if (typeof v !== 'string' || v.length === 0 || v.length > 128) return bad(`meta.${k}`);
  }
  if (!/^[A-Za-z0-9._ -]+$/.test(m.productName as string)) return bad('meta.productName');
  if (!/^[A-Za-z0-9._ -]+\.exe$/i.test(m.exe as string)) return bad('meta.exe');
  if (!Array.isArray(r.files) || r.files.length === 0 || r.files.length > MAX_FILES) return bad('files');
  const seen = new Set<string>();
  let sumS = 0;
  let sumC = 0;
  const files: PayloadFile[] = [];
  for (const f of r.files as unknown[]) {
    const o = f as Record<string, unknown>;
    if (typeof o !== 'object' || o === null) return bad('file');
    const p = checkRelPath(o.p);
    const key = p.toLowerCase();
    if (seen.has(key)) return bad(`дубликат ${p}`);
    seen.add(key);
    if (!isSize(o.s) || !isSize(o.c) || o.c < 1) return bad(`размер ${p}`);
    if (typeof o.h !== 'string' || !/^[0-9a-f]{64}$/.test(o.h)) return bad(`хэш ${p}`);
    sumS += o.s;
    sumC += o.c;
    files.push({ p, s: o.s, c: o.c, h: o.h });
  }
  if (sumS > MAX_TOTAL) return bad('слишком большой размер');
  if (sumC !== dataBytes) return bad('размеры не сходятся');
  return {
    meta: {
      version: m.version as string,
      productName: m.productName as string,
      exe: m.exe as string,
      publisher: m.publisher as string,
      appId: m.appId as string,
    },
    files,
    totalSize: sumS,
  };
}

export async function readHeader(file: string): Promise<PayloadHeader> {
  const fh = await fs.promises.open(file, 'r');
  try {
    const { size } = await fh.stat();
    if (size < TRAILER + 2) throw new Error('Файл установщика повреждён (слишком короткий)');
    const tail = Buffer.alloc(TRAILER);
    await fh.read(tail, 0, TRAILER, size - TRAILER);
    if (!tail.subarray(4).equals(MAGIC)) throw new Error('Файл установщика повреждён (неверная подпись)');
    const len = tail.readUInt32LE(0);
    if (len === 0 || len > MAX_HEADER || len > size - TRAILER) throw new Error('Файл установщика повреждён (заголовок)');
    const buf = Buffer.alloc(len);
    await fh.read(buf, 0, len, size - TRAILER - len);
    let json: unknown;
    try {
      json = JSON.parse(buf.toString('utf8'));
    } catch {
      throw new Error('Файл установщика повреждён (заголовок)');
    }
    return validateHeader(json, size - TRAILER - len);
  } finally {
    await fh.close();
  }
}

function listFiles(root: string): string[] {
  const out: string[] = [];
  const walk = (rel: string): void => {
    const entries = fs.readdirSync(path.join(root, rel), { withFileTypes: true });
    entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    for (const e of entries) {
      const r = rel ? `${rel}/${e.name}` : e.name;
      if (e.isSymbolicLink()) throw new Error(`Символические ссылки не поддерживаются: ${r}`);
      if (e.isDirectory()) walk(r);
      else if (e.isFile()) out.push(r);
    }
  };
  walk('');
  return out;
}

function appendFile(abs: string, sink: fs.WriteStream): Promise<{ s: number; c: number; h: string }> {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    let s = 0;
    let c = 0;
    const rs = fs.createReadStream(abs);
    const def = zlib.createDeflateRaw({ level: 6 });
    const fail = (e: Error): void => reject(e);
    rs.on('error', fail);
    def.on('error', fail);
    sink.once('error', fail);
    rs.on('data', (ch) => {
      hash.update(ch as Buffer);
      s += (ch as Buffer).length;
    });
    def.on('data', (ch: Buffer) => {
      c += ch.length;
    });
    def.on('end', () => {
      sink.removeListener('error', fail);
      resolve({ s, c, h: hash.digest('hex') });
    });
    rs.pipe(def).pipe(sink, { end: false });
  });
}

/** Упаковать папку в .chpk. */
export async function packDir(srcDir: string, outFile: string, meta: PayloadMeta, onFile?: (rel: string, i: number, n: number) => void): Promise<PayloadHeader> {
  const rels = listFiles(srcDir);
  if (rels.length === 0) throw new Error(`Папка пуста: ${srcDir}`);
  if (!rels.some((r) => r.toLowerCase() === meta.exe.toLowerCase())) throw new Error(`В папке нет ${meta.exe}`);
  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  const sink = fs.createWriteStream(outFile);
  const files: PayloadFile[] = [];
  let total = 0;
  try {
    for (let i = 0; i < rels.length; i++) {
      const rel = checkRelPath(rels[i]);
      onFile?.(rel, i, rels.length);
      const r = await appendFile(path.join(srcDir, ...rel.split('/')), sink);
      files.push({ p: rel, s: r.s, c: r.c, h: r.h });
      total += r.s;
    }
    const header: PayloadHeader = { meta, files, totalSize: total };
    const json = Buffer.from(JSON.stringify(header), 'utf8');
    const len = Buffer.alloc(4);
    len.writeUInt32LE(json.length, 0);
    await new Promise<void>((resolve, reject) => {
      sink.once('error', reject);
      sink.end(Buffer.concat([json, len, MAGIC]), resolve);
    });
    return header;
  } catch (e) {
    sink.destroy();
    fs.rmSync(outFile, { force: true });
    throw e;
  }
}

/** Распаковать .chpk в destDir (папка должна быть пустой или новой). */
export async function extractPayload(
  file: string,
  destDir: string,
  opts: { onProgress?: (p: Progress) => void; signal?: AbortSignal } = {},
): Promise<PayloadHeader> {
  const header = await readHeader(file);
  const root = path.resolve(destDir);
  await fs.promises.mkdir(root, { recursive: true });
  let offset = 0;
  let done = 0;
  for (const f of header.files) {
    opts.signal?.throwIfAborted();
    const target = path.resolve(root, ...f.p.split('/'));
    const rel = path.relative(root, target);
    if (rel === '' || rel === '..' || rel.startsWith('..' + path.sep) || path.isAbsolute(rel)) {
      throw new Error(`Недопустимый путь в архиве: ${f.p}`);
    }
    await fs.promises.mkdir(path.dirname(target), { recursive: true });
    const start = offset;
    offset += f.c;
    const hash = crypto.createHash('sha256');
    let written = 0;
    const check = new Transform({
      transform(chunk: Buffer, _enc, cb) {
        written += chunk.length;
        if (written > f.s) return cb(new Error(`Файл повреждён: ${f.p}`));
        hash.update(chunk);
        done += chunk.length;
        opts.onProgress?.({ done, total: header.totalSize, file: f.p });
        cb(null, chunk);
      },
    });
    const input: Readable = fs.createReadStream(file, { start, end: start + f.c - 1 });
    try {
      await pipeline(input, zlib.createInflateRaw(), check, fs.createWriteStream(target, { flags: 'w' }), { signal: opts.signal });
    } catch (e) {
      if ((e as Error).name === 'AbortError') throw e;
      if (e && typeof e === 'object' && 'code' in e && String((e as { code: unknown }).code).startsWith('Z_')) {
        throw new Error(`Файл повреждён: ${f.p}`);
      }
      throw e;
    }
    if (written !== f.s || hash.digest('hex') !== f.h) throw new Error(`Файл повреждён: ${f.p}`);
  }
  opts.onProgress?.({ done: header.totalSize, total: header.totalSize, file: '' });
  return header;
}
