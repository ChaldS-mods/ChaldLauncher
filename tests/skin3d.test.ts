import { describe, expect, it } from 'vitest';
import { boxFaces, faceRects, LEGACY_MIRROR_COPIES, skinBoxes, type Rect } from '../src/shared/skin3d';

function cover(rects: Rect[]): { cells: Map<string, number>; outside: boolean } {
  const cells = new Map<string, number>();
  let outside = false;
  for (const r of rects) {
    if (r.x < 0 || r.y < 0 || r.x + r.w > 64 || r.y + r.h > 64) outside = true;
    for (let y = r.y; y < r.y + r.h; y++) for (let x = r.x; x < r.x + r.w; x++) cells.set(`${x},${y}`, (cells.get(`${x},${y}`) ?? 0) + 1);
  }
  return { cells, outside };
}

describe('skin3d geometry', () => {
  for (const variant of ['classic', 'slim'] as const) {
    it(`${variant}: every face is inside the 64x64 texture and no two boxes of one layer share texels`, () => {
      const boxes = skinBoxes(variant);
      for (const overlay of [false, true]) {
        const rects = boxes.filter((b) => b.overlay === overlay).flatMap((b) => boxFaces(b).map((f) => f.rect));
        const { cells, outside } = cover(rects);
        expect(outside).toBe(false);
        expect([...cells.values()].every((n) => n === 1)).toBe(true);
      }
    });
  }

  it('an unwrapped box takes (2d+2w) x (d+h) texels', () => {
    const r = faceRects(0, 0, 8, 8, 8);
    expect(r.back).toEqual({ x: 24, y: 8, w: 8, h: 8 });
    expect(r.top).toEqual({ x: 8, y: 0, w: 8, h: 8 });
    expect(r.bottom).toEqual({ x: 16, y: 0, w: 8, h: 8 });
  });

  it('slim arms are 3 wide and sit next to the body', () => {
    const slim = skinBoxes('slim').find((b) => b.id === 'rightArm')!;
    const classic = skinBoxes('classic').find((b) => b.id === 'rightArm')!;
    expect(slim.size[0]).toBe(3);
    expect(classic.size[0]).toBe(4);
    // the arm touches the body (x = -4) in both models
    expect(slim.center[0] + slim.size[0] / 2).toBeCloseTo(-4);
    expect(classic.center[0] + classic.size[0] / 2).toBeCloseTo(-4);
  });

  it('the model is 32 high and stands on y = 0', () => {
    const ys = skinBoxes('classic').filter((b) => !b.overlay).flatMap((b) => boxFaces(b).flatMap((f) => f.corners.map((c) => c[1])));
    expect(Math.min(...ys)).toBe(0);
    expect(Math.max(...ys)).toBe(32);
  });

  it('every face is wound outwards: its normal points away from the box centre', () => {
    for (const b of skinBoxes('classic')) {
      for (const f of boxFaces(b)) {
        const [tl, tr, bl] = f.corners;
        const u = [tr[0] - tl[0], tr[1] - tl[1], tr[2] - tl[2]];
        const v = [bl[0] - tl[0], bl[1] - tl[1], bl[2] - tl[2]];
        // triangle (tl, bl, br) is counter-clockwise seen from outside, so (bl - tl) x (tr - tl) points out
        const n = [v[1]! * u[2]! - v[2]! * u[1]!, v[2]! * u[0]! - v[0]! * u[2]!, v[0]! * u[1]! - v[1]! * u[0]!];
        const out = [(tl[0] - b.center[0]), (tl[1] - b.center[1]), (tl[2] - b.center[2])];
        const dot = n[0]! * out[0]! + n[1]! * out[1]! + n[2]! * out[2]!;
        expect(dot).toBeGreaterThan(0);
        expect(f.normal[0]! * out[0]! + f.normal[1]! * out[1]! + f.normal[2]! * out[2]!).toBeGreaterThan(0);
      }
    }
  });

  it('legacy copies fill the left limbs of a 64x32 skin and stay in bounds', () => {
    const { outside } = cover(LEGACY_MIRROR_COPIES.map(([, , w, h, dx, dy]) => ({ x: dx, y: dy, w, h })));
    expect(outside).toBe(false);
    const left = skinBoxes('classic').filter((b) => b.id === 'leftLeg' || b.id === 'leftArm').flatMap((b) => boxFaces(b).map((f) => f.rect));
    const filled = cover(LEGACY_MIRROR_COPIES.map(([, , w, h, dx, dy]) => ({ x: dx, y: dy, w, h }))).cells;
    for (const r of left) for (let y = r.y; y < r.y + r.h; y++) for (let x = r.x; x < r.x + r.w; x++) expect(filled.has(`${x},${y}`)).toBe(true);
  });
});
