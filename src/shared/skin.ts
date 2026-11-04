export type SkinVariant = 'classic' | 'slim';
export type SkinSide = 'front' | 'back';

export interface SkinPart {
  /** source rectangle in the texture */
  sx: number; sy: number; sw: number; sh: number;
  /** destination in "doll" units (the doll is 16 wide, 32 tall) */
  dx: number; dy: number;
  /** mirror horizontally (left limbs of old 64x32 skins reuse the right limb) */
  flip?: boolean;
  /** overlay layer (hat, jacket, sleeves, pants): drawn after the base layer */
  overlay?: boolean;
}

/** Texture sizes the Minecraft services accept. */
export function isValidSkinSize(w: number, h: number): boolean {
  return w === 64 && (h === 64 || h === 32);
}

/**
 * 1.8+ skins have a 64x64 texture. A "slim" (Alex) skin has 3-pixel arms: the 4th pixel column of both arms is
 * transparent. Old 64x32 skins can only be classic.
 */
export function isSlimSkin(rgba: ArrayLike<number>, width: number, height: number): boolean {
  if (width !== 64 || height !== 64) return false;
  const alphaAt = (x: number, y: number) => rgba[(y * width + x) * 4 + 3] ?? 255;
  const columnEmpty = (x: number, y0: number, y1: number) => {
    for (let y = y0; y <= y1; y++) if (alphaAt(x, y) !== 0) return false;
    return true;
  };
  // right arm front: x 44..47, y 20..31; left arm front: x 36..39, y 52..63
  return columnEmpty(47, 20, 31) && columnEmpty(39, 52, 63);
}

/**
 * Where each body part lives in the texture and where it is drawn on the doll (front or back view).
 * Layout of a 64x64 skin: head 8x8 at (8,8) front / (24,8) back, body 8x12 at (20,20) / (32,20),
 * right arm front (44,20), right leg (4,20) / (12,20), left arm front (36,52), left leg (20,52) / (28,52);
 * the overlay layers (hat, jacket, sleeves, pants) are the same shapes at +32 in x (head) or +16 in y.
 * The back of an arm sits after its front and the 4-pixel inner side, so it is one column further left on slim skins.
 */
export function skinParts(variant: SkinVariant, side: SkinSide, legacy: boolean): SkinPart[] {
  const arm = variant === 'slim' ? 3 : 4;
  const front = side === 'front';
  const parts: SkinPart[] = [];

  // Seen from the front, the character's right arm/leg is on the viewer's left; seen from the back it is on the right.
  const rightArmDx = front ? 4 - arm : 12;
  const leftArmDx = front ? 12 : 4 - arm;
  const rightLegDx = front ? 4 : 8;
  const leftLegDx = front ? 8 : 4;

  parts.push({ sx: front ? 8 : 24, sy: 8, sw: 8, sh: 8, dx: 4, dy: 0 });
  parts.push({ sx: front ? 40 : 56, sy: 8, sw: 8, sh: 8, dx: 4, dy: 0, overlay: true });

  const bodySx = front ? 20 : 32;
  parts.push({ sx: bodySx, sy: 20, sw: 8, sh: 12, dx: 4, dy: 8 });
  if (!legacy) parts.push({ sx: bodySx, sy: 36, sw: 8, sh: 12, dx: 4, dy: 8, overlay: true });

  const rArmSx = front ? 44 : 44 + arm + 4;
  const rLegSx = front ? 4 : 12;
  parts.push({ sx: rArmSx, sy: 20, sw: arm, sh: 12, dx: rightArmDx, dy: 8 });
  parts.push({ sx: rLegSx, sy: 20, sw: 4, sh: 12, dx: rightLegDx, dy: 20 });
  if (!legacy) {
    parts.push({ sx: rArmSx, sy: 36, sw: arm, sh: 12, dx: rightArmDx, dy: 8, overlay: true });
    parts.push({ sx: rLegSx, sy: 36, sw: 4, sh: 12, dx: rightLegDx, dy: 20, overlay: true });
    parts.push({ sx: front ? 36 : 36 + arm + 4, sy: 52, sw: arm, sh: 12, dx: leftArmDx, dy: 8 });
    parts.push({ sx: front ? 20 : 28, sy: 52, sw: 4, sh: 12, dx: leftLegDx, dy: 20 });
    parts.push({ sx: front ? 52 : 52 + arm + 4, sy: 52, sw: arm, sh: 12, dx: leftArmDx, dy: 8, overlay: true });
    parts.push({ sx: front ? 4 : 12, sy: 52, sw: 4, sh: 12, dx: leftLegDx, dy: 20, overlay: true });
  } else {
    // 64x32 skins have no separate left limbs: the right ones are mirrored
    parts.push({ sx: rArmSx, sy: 20, sw: arm, sh: 12, dx: leftArmDx, dy: 8, flip: true });
    parts.push({ sx: rLegSx, sy: 20, sw: 4, sh: 12, dx: leftLegDx, dy: 20, flip: true });
  }
  return parts;
}
