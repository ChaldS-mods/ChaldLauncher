import { inflateSync } from 'node:zlib';

const SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

export interface PngHeader { width: number; height: number; bitDepth: number; colorType: number; interlace: number }

interface Chunk { type: string; data: Buffer }

function chunks(buf: Buffer): Chunk[] | null {
  if (buf.length < 8 || !buf.subarray(0, 8).equals(SIGNATURE)) return null;
  const out: Chunk[] = [];
  let pos = 8;
  while (pos + 12 <= buf.length) {
    const len = buf.readUInt32BE(pos);
    const type = buf.toString('latin1', pos + 4, pos + 8);
    if (pos + 12 + len > buf.length) return null;
    out.push({ type, data: buf.subarray(pos + 8, pos + 8 + len) });
    pos += 12 + len;
    if (type === 'IEND') break;
  }
  return out;
}

/** Reads only the IHDR chunk. Returns null when the data is not a PNG. */
export function readPngHeader(buf: Buffer): PngHeader | null {
  if (buf.length < 33 || !buf.subarray(0, 8).equals(SIGNATURE) || buf.toString('latin1', 12, 16) !== 'IHDR') return null;
  return {
    width: buf.readUInt32BE(16), height: buf.readUInt32BE(20),
    bitDepth: buf[24]!, colorType: buf[25]!, interlace: buf[28]!,
  };
}

const CHANNELS: Record<number, number> = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 };

function paeth(a: number, b: number, c: number): number {
  const p = a + b - c;
  const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
}

/**
 * Minimal PNG decoder for skins: 8-bit, not interlaced, any colour type. Returns RGBA, or null for anything else
 * (the caller then just does not know the pixels). `maxPixels` guards against decompression bombs.
 */
export function decodePngRgba(buf: Buffer, maxPixels = 64 * 64): { width: number; height: number; rgba: Uint8Array } | null {
  const h = readPngHeader(buf);
  if (!h || h.bitDepth !== 8 || h.interlace !== 0 || !(h.colorType in CHANNELS)) return null;
  if (h.width === 0 || h.height === 0 || h.width * h.height > maxPixels) return null;
  const list = chunks(buf);
  if (!list) return null;
  const idat = Buffer.concat(list.filter((c) => c.type === 'IDAT').map((c) => c.data));
  const plte = list.find((c) => c.type === 'PLTE')?.data;
  const trns = list.find((c) => c.type === 'tRNS')?.data;
  const ch = CHANNELS[h.colorType]!;
  const stride = h.width * ch;
  const expected = h.height * (stride + 1);
  let raw: Buffer;
  try {
    raw = inflateSync(idat, { maxOutputLength: expected + 1024 });
  } catch {
    return null;
  }
  if (raw.length < expected) return null;

  const px = Buffer.alloc(h.height * stride);
  for (let y = 0; y < h.height; y++) {
    const f = raw[y * (stride + 1)]!;
    const src = y * (stride + 1) + 1;
    const dst = y * stride;
    for (let x = 0; x < stride; x++) {
      const a = x >= ch ? px[dst + x - ch]! : 0;
      const b = y > 0 ? px[dst - stride + x]! : 0;
      const c = x >= ch && y > 0 ? px[dst - stride + x - ch]! : 0;
      const v = raw[src + x]!;
      let r: number;
      switch (f) {
        case 0: r = v; break;
        case 1: r = v + a; break;
        case 2: r = v + b; break;
        case 3: r = v + ((a + b) >> 1); break;
        case 4: r = v + paeth(a, b, c); break;
        default: return null;
      }
      px[dst + x] = r & 0xff;
    }
  }

  const rgba = new Uint8Array(h.width * h.height * 4);
  for (let i = 0; i < h.width * h.height; i++) {
    const o = i * 4;
    const s = i * ch;
    switch (h.colorType) {
      case 0: rgba[o] = rgba[o + 1] = rgba[o + 2] = px[s]!; rgba[o + 3] = 255; break;
      case 2: rgba[o] = px[s]!; rgba[o + 1] = px[s + 1]!; rgba[o + 2] = px[s + 2]!; rgba[o + 3] = 255; break;
      case 3: {
        const idx = px[s]!;
        if (!plte || idx * 3 + 2 >= plte.length) return null;
        rgba[o] = plte[idx * 3]!; rgba[o + 1] = plte[idx * 3 + 1]!; rgba[o + 2] = plte[idx * 3 + 2]!;
        rgba[o + 3] = trns && idx < trns.length ? trns[idx]! : 255;
        break;
      }
      case 4: rgba[o] = rgba[o + 1] = rgba[o + 2] = px[s]!; rgba[o + 3] = px[s + 1]!; break;
      default: rgba[o] = px[s]!; rgba[o + 1] = px[s + 1]!; rgba[o + 2] = px[s + 2]!; rgba[o + 3] = px[s + 3]!;
    }
  }
  return { width: h.width, height: h.height, rgba };
}
