"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.HEAD_HAT = exports.HEAD_FACE = exports.ELYTRA_REST = exports.ELYTRA_PIVOT = exports.ELYTRA_BOX = exports.CAPE_REST_ANGLE = exports.CAPE_PIVOT = exports.CAPE_BOX = exports.CAPE_OUTER = exports.CAPE_LAYOUT = exports.LEGACY_MIRROR_COPIES = exports.PIVOTS = void 0;
exports.skinBoxes = skinBoxes;
exports.faceRects = faceRects;
exports.boxFaces = boxFaces;
exports.capeScale = capeScale;
exports.hatIsUsed = hatIsUsed;
/** Where a limb turns when it swings (shoulder / hip). */
exports.PIVOTS = {
    head: [0, 24, 0],
    body: [0, 24, 0],
    rightArm: [-5, 22, 0],
    leftArm: [5, 22, 0],
    rightLeg: [-2, 12, 0],
    leftLeg: [2, 12, 0],
};
function skinBoxes(variant) {
    const aw = variant === 'slim' ? 3 : 4;
    const boxes = [];
    const add = (id, group, size, center, uv, overlay, inflate) => boxes.push({ id, group, overlay, size, center, inflate, uv });
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
function faceRects(u, v, w, h, d) {
    return {
        top: { x: u + d, y: v, w, h: d },
        bottom: { x: u + d + w, y: v, w, h: d },
        right: { x: u, y: v + d, w: d, h },
        front: { x: u + d, y: v + d, w, h },
        left: { x: u + d + w, y: v + d, w: d, h },
        back: { x: u + 2 * d + w, y: v + d, w, h },
    };
}
/** Faces of a box with their corners in model space and the texture rectangle each one shows. */
function boxFaces(b) {
    const [w, h, d] = b.size;
    const [cx, cy, cz] = b.center;
    const hx = w / 2 + b.inflate;
    const hy = h / 2 + b.inflate;
    const hz = d / 2 + b.inflate;
    const p = (x, y, z) => [cx + x, cy + y, cz + z];
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
exports.LEGACY_MIRROR_COPIES = [
    [4, 16, 4, 4, 20, 48], [8, 16, 4, 4, 24, 48], [0, 20, 4, 12, 24, 52], [4, 20, 4, 12, 20, 52], [8, 20, 4, 12, 16, 52], [12, 20, 4, 12, 28, 52],
    [44, 16, 4, 4, 36, 48], [48, 16, 4, 4, 40, 48], [40, 20, 4, 12, 32, 52], [44, 20, 4, 12, 36, 52], [48, 20, 4, 12, 40, 52], [52, 20, 4, 12, 44, 52],
];
// ---------------------------------------------------------------- cape and elytra
/**
 * The cape PNG is a 64x32 layout (HD capes are the same layout scaled up). It holds both the cape and the elytra:
 *  - cape: a 10x16x1 box at (0, 0); its OUTER face (the one seen from behind) is the «front» rectangle at (1, 1);
 *  - elytra: a 10x20x2 box at (22, 0), inflated by 1 texel (drawn 12x22x4).
 */
exports.CAPE_LAYOUT = { w: 64, h: 32 };
/** Pixels per layout unit of a cape image (1 for 64x32, 2 for 128x64 …). Small images (22x17 …) are used 1:1. */
function capeScale(width, height) {
    return width >= exports.CAPE_LAYOUT.w && height >= exports.CAPE_LAYOUT.h ? Math.max(1, Math.round(width / exports.CAPE_LAYOUT.w)) : 1;
}
/** The cape's outer face in layout units (what a flat preview of the cape shows). */
exports.CAPE_OUTER = faceRects(0, 0, 10, 16, 1).front;
/**
 * Cape box relative to its hanging point (the top of the back). It is built facing +z and the viewer turns it by 180°
 * around Y (as the game does), so the outer face ends up on the character's back.
 */
exports.CAPE_BOX = { id: 'cape', group: 'body', overlay: false, size: [10, 16, 1], center: [0, -8, 0.5], inflate: 0, uv: [0, 0] };
/** Where the cape hangs from: top of the back, touching the body. */
exports.CAPE_PIVOT = [0, 24, -2];
/** At rest the cape leans away from the body by 6 degrees. */
exports.CAPE_REST_ANGLE = (6 * Math.PI) / 180;
/**
 * Right elytra wing relative to its shoulder joint (the left wing is the mirror image).
 * The joint is at x = ±5 on the top of the back; the wing is 10x20x2 and hangs outward and down.
 */
exports.ELYTRA_BOX = { id: 'elytra', group: 'body', overlay: false, size: [10, 20, 2], center: [-5, -10, -1], inflate: 1, uv: [22, 0] };
exports.ELYTRA_PIVOT = [5, 24, -2];
/** Folded wings at rest: tilted back by 15° and spread outward by 15° at the bottom. */
exports.ELYTRA_REST = { x: Math.PI / 12, z: Math.PI / 12 };
/** An old 64x32 skin's hat layer counts only when its area has at least one transparent pixel (as in the game). */
function hatIsUsed(legacy, hatAlpha) {
    if (!legacy)
        return true;
    for (let i = 0; i < hatAlpha.length; i++)
        if (hatAlpha[i] < 128)
            return true;
    return false;
}
/** Face of a player skin (8x8 at 8,8) and its hat layer (8x8 at 40,8): what a head icon is made of. */
exports.HEAD_FACE = { x: 8, y: 8, w: 8, h: 8 };
exports.HEAD_HAT = { x: 40, y: 8, w: 8, h: 8 };
//# sourceMappingURL=skin3d.js.map