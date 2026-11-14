import { hatIsUsed, HEAD_FACE, HEAD_HAT } from '../shared/skin3d';

const loadImage = (src: string) =>
  new Promise<HTMLImageElement>((resolve, reject) => {
    const i = new Image();
    i.onload = () => resolve(i);
    i.onerror = () => reject(new Error('skin image'));
    i.src = src;
  });

/**
 * The player's head as a small PNG data URL: the face with the second (hat) layer on top, enlarged without smoothing.
 * Old 64x32 skins have a hat only when their hat area has a transparent pixel, as in the game.
 */
export async function headFromSkin(skinDataUrl: string, size = 64): Promise<string> {
  const img = await loadImage(skinDataUrl);
  if (img.width < 64 || img.height < 32) throw new Error('not a skin');
  const u = img.width / 64; // HD skins are the same layout scaled up
  const small = document.createElement('canvas');
  small.width = HEAD_FACE.w * u;
  small.height = HEAD_FACE.h * u;
  const ctx = small.getContext('2d', { willReadFrequently: true })!;
  ctx.imageSmoothingEnabled = false;
  const draw = (r: typeof HEAD_FACE) => ctx.drawImage(img, r.x * u, r.y * u, r.w * u, r.h * u, 0, 0, small.width, small.height);
  draw(HEAD_FACE);
  // the hat is read from its own canvas first (the face is already drawn on `small`)
  const hat = document.createElement('canvas');
  hat.width = small.width;
  hat.height = small.height;
  const hctx = hat.getContext('2d', { willReadFrequently: true })!;
  hctx.imageSmoothingEnabled = false;
  hctx.drawImage(img, HEAD_HAT.x * u, HEAD_HAT.y * u, HEAD_HAT.w * u, HEAD_HAT.h * u, 0, 0, hat.width, hat.height);
  const alpha: number[] = [];
  const px = hctx.getImageData(0, 0, hat.width, hat.height).data;
  for (let i = 3; i < px.length; i += 4) alpha.push(px[i]!);
  if (hatIsUsed(img.height === 32, alpha)) ctx.drawImage(hat, 0, 0);

  const out = document.createElement('canvas');
  out.width = size;
  out.height = size;
  const octx = out.getContext('2d')!;
  octx.imageSmoothingEnabled = false;
  octx.drawImage(small, 0, 0, size, size);
  return out.toDataURL('image/png');
}
