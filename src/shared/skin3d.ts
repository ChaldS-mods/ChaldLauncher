import type { SkinVariant } from './skin';

/**
 * Geometry of the Minecraft player model for a 3D preview. Units are texels: the model is 32 high, feet at y = 0,
 * x grows to the character's left (the viewer's right when looking at the face), z grows to the front.
 * Everything here is plain data so it can be tested without WebGL.
 */
export type FaceName = 'right' | 'front' | 'left' | 'back' | 'top' | 'bottom';
export type LimbGroup = 'head' | 'body' | 'rightArm' | 'leftArm' | 'rightLeg' | 'leftLeg';
export type Vec3 = [number, number, number];
export interface Rect { x: number; y: number; w: number; h: number }

export interface SkinBox {
  id: string;
  group: LimbGroup;
  overlay: boolean;
  /** width, height, depth in texels */
  size: Vec3;
  center: Vec3;
  /** the overlay layer is a slightly bigger box around the base one */
  inflate: number;
  /** top-left corner of the box's unwrapped texture */
  uv: [number, number];
}

/** Where a limb turns when it swings (shoulder / hip). */
export const PIVOTS: Record<LimbGroup, Vec3> = {
  head: [0, 24, 0],
  body: [0, 24, 0],
  rightArm: [-5, 22, 0],
  leftArm: [5, 22, 0],
  rightLeg: [-2, 12, 0],
  leftLeg: [2, 12, 0],
};

export function skinBoxes(variant: SkinVariant): SkinBox[] {
  const aw = variant === 'slim' ? 3 : 4;
  const boxes: SkinBox[] = [];
  const add = (id: string, group: LimbGroup, size: Vec3, center: Vec3, uv: [number, number], overlay: boolean, inflate: number) =>
    boxes.push({ id, group, overlay, size, center, inflate, uv });
  add('head', 'head', [8, 8, 8], [0, 28, 0], [0, 0], false, 0);
  add('hat', 'head', [8, 8, 8], [0, 28, 0], [32, 0], true, 0.5);
  add('body', 'body', [8, 12, 4], [0, 18, 0], [16, 16], false, 0);
  add('jacket', 'body', [8, 12, 4], [0, 18, 0], [16, 32], true, 0.25);
  add('rightArm', 'rightArm', [aw, 12, 4], [-(4 + aw / 2), 18, 0], [40, 16], false, 0);
  add('rightSleeve', 'rightArm', [aw, 12, 4], [-(4 + aw / 2), 18, 0], [40, 32], true, 0.25);
  add('leftArm', 'leftArm', [aw, 12, 4], [4 + aw / 2, 18, 0], [32, 48], false, 0);
  add('leftSleeve', 'leftArm', [aw, 12, 4], [4 + aw / 2, 18, 0], [48, 48], true, 0.25);
  add('rightLeg', 'rightLeg', [4, 12, 4], [-2, 6, 0], [0, 16], false, 0);
  add('rightPants', 'rightLeg', [4, 12, 4], [-2, 6, 0], [0, 32], true, 0.25);
  add('leftLeg', 'leftLeg', [4, 12, 4], [2, 6, 0], [16, 48], false, 0);
  add('leftPants', 'leftLeg', [4, 12, 4], [2, 6, 0], [0, 48], true, 0.25);
  return boxes;
}

/**
 * The six faces of an unwrapped box: right | front | left | back in one row, top and bottom above
 * (width w, height h, depth d, top-left corner u, v).
 */
export function faceRects(u: number, v: number, w: number, h: number, d: number): Record<FaceName, Rect> {
  return {
    top: { x: u + d, y: v, w, h: d },
    bottom: { x: u + d + w, y: v, w, h: d },
    right: { x: u, y: v + d, w: d, h },
    front: { x: u + d, y: v + d, w, h },
    left: { x: u + d + w, y: v + d, w: d, h },
    back: { x: u + 2 * d + w, y: v + d, w, h },
  };
}

export interface BoxFace {
  face: FaceName;
  /** corners as seen from outside: top-left, top-right, bottom-left, bottom-right */
  corners: [Vec3, Vec3, Vec3, Vec3];
  normal: Vec3;
  rect: Rect;
}

/** Faces of a box with their corners in model space and the texture rectangle each one shows. */
export function boxFaces(b: SkinBox): BoxFace[] {
  const [w, h, d] = b.size;
  const [cx, cy, cz] = b.center;
  const hx = w / 2 + b.inflate;
  const hy = h / 2 + b.inflate;
  const hz = d / 2 + b.inflate;
  const p = (x: number, y: number, z: number): Vec3 => [cx + x, cy + y, cz + z];
  const rects = faceRects(b.uv[0], b.uv[1], w, h, d);
  return [
    { face: 'front', normal: [0, 0, 1], rect: rects.front, corners: [p(-hx, hy, hz), p(hx, hy, hz), p(-hx, -hy, hz), p(hx, -hy, hz)] },
    { face: 'back', normal: [0, 0, -1], rect: rects.back, corners: [p(hx, hy, -hz), p(-hx, hy, -hz), p(hx, -hy, -hz), p(-hx, -hy, -hz)] },
    // the character's right side is at -x
    { face: 'right', normal: [-1, 0, 0], rect: rects.right, corners: [p(-hx, hy, -hz), p(-hx, hy, hz), p(-hx, -hy, -hz), p(-hx, -hy, hz)] },
    { face: 'left', normal: [1, 0, 0], rect: rects.left, corners: [p(hx, hy, hz), p(hx, hy, -hz), p(hx, -hy, hz), p(hx, -hy, -hz)] },
    { face: 'top', normal: [0, 1, 0], rect: rects.top, corners: [p(-hx, hy, -hz), p(hx, hy, -hz), p(-hx, hy, hz), p(hx, hy, hz)] },
    { face: 'bottom', normal: [0, -1, 0], rect: rects.bottom, corners: [p(hx, -hy, -hz), p(-hx, -hy, -hz), p(hx, -hy, hz), p(-hx, -hy, hz)] },
  ];
}

/** [sx, sy, w, h, dx, dy]: copies (mirrored) that turn a 64x32 skin into a 64x64 one (the left limbs reuse the right ones). */
export const LEGACY_MIRROR_COPIES: [number, number, number, number, number, number][] = [
  [4, 16, 4, 4, 20, 48], [8, 16, 4, 4, 24, 48], [0, 20, 4, 12, 24, 52], [4, 20, 4, 12, 20, 52], [8, 20, 4, 12, 16, 52], [12, 20, 4, 12, 28, 52],
  [44, 16, 4, 4, 36, 48], [48, 16, 4, 4, 40, 48], [40, 20, 4, 12, 32, 52], [44, 20, 4, 12, 36, 52], [48, 20, 4, 12, 40, 52], [52, 20, 4, 12, 44, 52],
];
