import { describe, expect, it } from 'vitest';
import { isSlimSkin, isValidSkinSize, skinParts, type SkinSide, type SkinVariant } from '../src/shared/skin';

function texture(w: number, h: number, fill: (x: number, y: number) => number): Uint8Array {
  const px = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) px[(y * w + x) * 4 + 3] = fill(x, y);
  return px;
}

describe('isSlimSkin', () => {
  const opaque = () => 255;
  it('classic: the 4th arm column is painted', () => {
    expect(isSlimSkin(texture(64, 64, opaque), 64, 64)).toBe(false);
  });
  it('slim: the 4th column of both arms is transparent', () => {
    const slim = texture(64, 64, (x, y) => ((x === 47 && y >= 20 && y <= 31) || (x === 39 && y >= 52)) ? 0 : 255);
    expect(isSlimSkin(slim, 64, 64)).toBe(true);
  });
  it('one transparent arm is not enough', () => {
    const half = texture(64, 64, (x, y) => (x === 47 && y >= 20 && y <= 31) ? 0 : 255);
    expect(isSlimSkin(half, 64, 64)).toBe(false);
  });
  it('old 64x32 skins are always classic', () => {
    expect(isSlimSkin(texture(64, 32, () => 0), 64, 32)).toBe(false);
  });
});

describe('isValidSkinSize', () => {
  it('accepts only 64x64 and 64x32', () => {
    expect(isValidSkinSize(64, 64)).toBe(true);
    expect(isValidSkinSize(64, 32)).toBe(true);
    expect(isValidSkinSize(128, 128)).toBe(false);
    expect(isValidSkinSize(32, 64)).toBe(false);
  });
});

describe('skinParts', () => {
  const variants: SkinVariant[] = ['classic', 'slim'];
  const sides: SkinSide[] = ['front', 'back'];
  it('every source rectangle lies inside the texture', () => {
    for (const v of variants) for (const side of sides) for (const legacy of [false, true]) {
      for (const p of skinParts(v, side, legacy)) {
        expect(p.sx).toBeGreaterThanOrEqual(0);
        expect(p.sy).toBeGreaterThanOrEqual(0);
        expect(p.sx + p.sw).toBeLessThanOrEqual(64);
        expect(p.sy + p.sh).toBeLessThanOrEqual(legacy ? 32 : 64);
      }
    }
  });
  it('the doll fits 16x32 and the base layers do not overlap each other', () => {
    for (const v of variants) for (const side of sides) {
      const base = skinParts(v, side, false).filter((p) => !p.overlay);
      expect(base).toHaveLength(6);
      for (const p of base) { expect(p.dx).toBeGreaterThanOrEqual(0); expect(p.dx + p.sw).toBeLessThanOrEqual(16); expect(p.dy + p.sh).toBeLessThanOrEqual(32); }
      for (let i = 0; i < base.length; i++) for (let j = i + 1; j < base.length; j++) {
        const a = base[i]!, b = base[j]!;
        const overlap = a.dx < b.dx + b.sw && b.dx < a.dx + a.sw && a.dy < b.dy + b.sh && b.dy < a.dy + a.sh;
        expect(overlap).toBe(false);
      }
    }
  });
  it('slim arms are 3 pixels wide, classic 4', () => {
    const arms = (v: SkinVariant) => skinParts(v, 'front', false).filter((p) => !p.overlay && p.dy === 8 && p.sh === 12 && p.sw !== 8).map((p) => p.sw);
    expect(arms('slim')).toEqual([3, 3]);
    expect(arms('classic')).toEqual([4, 4]);
  });
  it('old skins mirror the right limbs for the left ones and have no jacket/sleeves/pants', () => {
    const parts = skinParts('classic', 'front', true);
    expect(parts.filter((p) => p.flip)).toHaveLength(2);
    expect(parts.filter((p) => p.overlay)).toHaveLength(1); // the hat only
  });
});
