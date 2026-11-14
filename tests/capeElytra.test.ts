import { describe, expect, it } from 'vitest';
import { Group, Vector3 } from 'three';
import {
  boxFaces, CAPE_BOX, CAPE_OUTER, CAPE_PIVOT, CAPE_REST_ANGLE, capeScale, ELYTRA_BOX, ELYTRA_PIVOT, ELYTRA_REST, faceRects, hatIsUsed, HEAD_FACE, HEAD_HAT, skinBoxes,
} from '../src/shared/skin3d';

/** Builds the same transform chain the viewer uses and returns a function: model-space point of the box -> world. */
function capeToWorld(angle = 0): (p: [number, number, number]) => Vector3 {
  const hang = new Group();
  hang.position.set(...CAPE_PIVOT);
  hang.rotation.x = angle;
  const flip = new Group();
  flip.rotation.y = Math.PI;
  hang.add(flip);
  hang.updateMatrixWorld(true);
  return (p) => flip.localToWorld(new Vector3(...p));
}

function wingToWorld(left: boolean): (p: [number, number, number]) => Vector3 {
  const holder = new Group();
  holder.position.set(0, ELYTRA_PIVOT[1], ELYTRA_PIVOT[2]);
  if (left) holder.scale.x = -1;
  const wing = new Group();
  wing.position.x = -ELYTRA_PIVOT[0];
  wing.rotation.order = 'ZYX';
  wing.rotation.set(ELYTRA_REST.x, 0, -ELYTRA_REST.z);
  holder.add(wing);
  holder.updateMatrixWorld(true);
  return (p) => wing.localToWorld(new Vector3(...p));
}

describe('texture layout', () => {
  it('the flat cape preview shows the outer face at (1, 1), 10x16', () => {
    expect(CAPE_OUTER).toEqual({ x: 1, y: 1, w: 10, h: 16 });
  });

  it('the elytra wing uses the area at (22, 0): outer face at (36, 2), inner face at (24, 2), 10x20 each', () => {
    const r = faceRects(...ELYTRA_BOX.uv, ...([ELYTRA_BOX.size[0], ELYTRA_BOX.size[1], ELYTRA_BOX.size[2]] as [number, number, number]));
    expect(r.back).toEqual({ x: 36, y: 2, w: 10, h: 20 });
    expect(r.front).toEqual({ x: 24, y: 2, w: 10, h: 20 });
    // the whole wing fits into 24x22 texels at (22, 0)
    for (const f of Object.values(r)) {
      expect(f.x).toBeGreaterThanOrEqual(22);
      expect(f.x + f.w).toBeLessThanOrEqual(46);
      expect(f.y + f.h).toBeLessThanOrEqual(22);
    }
  });

  it('capeScale: 64x32 -> 1, 128x64 -> 2, small cropped capes are used 1:1', () => {
    expect(capeScale(64, 32)).toBe(1);
    expect(capeScale(128, 64)).toBe(2);
    expect(capeScale(512, 256)).toBe(8);
    expect(capeScale(22, 17)).toBe(1);
    expect(capeScale(46, 22)).toBe(1);
  });
});

describe('cape', () => {
  it('hangs behind the body and its outer face shows the design to someone standing behind', () => {
    const w = capeToWorld();
    const front = boxFaces(CAPE_BOX).find((f) => f.face === 'front')!;
    // the outer face points backwards (-z), the same way as the back of the body
    const n = new Vector3(...front.normal).transformDirection(new Group().matrix.makeRotationY(Math.PI));
    expect(n.z).toBeCloseTo(-1);
    const [tl, tr, bl] = front.corners.map((c) => w(c));
    // everything is behind the body (the body's back is at z = -2) and hangs from the top of it
    for (const c of [tl!, tr!, bl!]) expect(c.z).toBeLessThanOrEqual(-2.99);
    expect(tl!.y).toBeCloseTo(24);
    expect(bl!.y).toBeCloseTo(8);
    // seen from behind the texture must not be mirrored: its left edge is on the character's left (+x)
    expect(tl!.x).toBeCloseTo(5);
    expect(tr!.x).toBeCloseTo(-5);
  });

  it('leans away from the body at the bottom', () => {
    const w = capeToWorld(CAPE_REST_ANGLE);
    const front = boxFaces(CAPE_BOX).find((f) => f.face === 'front')!;
    const [tl, , bl] = front.corners.map((c) => w(c));
    expect(bl!.z).toBeLessThan(tl!.z);
  });
});

describe('elytra', () => {
  const box = (face: 'back' | 'front') => boxFaces(ELYTRA_BOX).find((f) => f.face === face)!;

  it('the wings start at the shoulders on the back, left and right mirror each other', () => {
    const right = wingToWorld(false);
    const left = wingToWorld(true);
    const [rtl] = box('back').corners.map((c) => right(c));
    const [ltl] = box('back').corners.map((c) => left(c));
    expect(rtl!.y).toBeGreaterThan(23); // at the top of the body
    expect(Math.sign(rtl!.x)).toBe(-1); // the right wing is on the character's right (-x)
    expect(Math.sign(ltl!.x)).toBe(1);
    expect(ltl!.x).toBeCloseTo(-rtl!.x);
    expect(ltl!.y).toBeCloseTo(rtl!.y);
    expect(ltl!.z).toBeCloseTo(rtl!.z);
  });

  it('folded wings hang down, lean back and spread outward at the bottom', () => {
    const w = wingToWorld(false);
    const [tl, tr, bl, br] = box('back').corners.map((c) => w(c));
    // the outer edge of the right wing is the one with the smaller x
    const topOuter = tl!.x < tr!.x ? tl! : tr!;
    const bottomOuter = tl!.x < tr!.x ? bl! : br!;
    expect(bottomOuter.y).toBeLessThan(topOuter.y - 18); // hangs ~22 down
    expect(bottomOuter.z).toBeLessThan(topOuter.z); // leans back
    expect(bottomOuter.x).toBeLessThan(topOuter.x); // spreads outward (-x for the right wing)
    // behind the body
    expect(topOuter.z).toBeLessThanOrEqual(-2);
  });

  it('the outer face looks backwards, the inner face towards the body', () => {
    expect(box('back').normal).toEqual([0, 0, -1]);
    expect(box('front').normal).toEqual([0, 0, 1]);
  });
});

describe('head icon', () => {
  it('face and hat come from the same places of the skin', () => {
    expect(HEAD_FACE).toEqual({ x: 8, y: 8, w: 8, h: 8 });
    expect(HEAD_HAT).toEqual({ x: 40, y: 8, w: 8, h: 8 });
    const head = skinBoxes('classic').find((b) => b.id === 'head')!;
    const hat = skinBoxes('classic').find((b) => b.id === 'hat')!;
    expect(faceRects(...head.uv, 8, 8, 8).front).toEqual(HEAD_FACE);
    expect(faceRects(...hat.uv, 8, 8, 8).front).toEqual(HEAD_HAT);
  });

  it('an old 64x32 skin has a hat only if its hat area has a transparent pixel', () => {
    expect(hatIsUsed(false, [255, 255])).toBe(true);
    expect(hatIsUsed(true, [255, 255, 255])).toBe(false);
    expect(hatIsUsed(true, [255, 0, 255])).toBe(true);
  });
});
