import { useEffect, useRef } from 'react';
import { skinParts, type SkinVariant } from '../../shared/skin';
import { CAPE_OUTER, capeScale } from '../../shared/skin3d';

export type CapePreviewMode = 'cape' | 'with-skin';

/**
 * Preview of an official cape.
 * - mode "cape": only the cape panel (standalone object)
 * - mode "with-skin": back-view doll of the given skin + cape on the back
 */
export function CapePreview({
  capeDataUrl,
  skinDataUrl,
  skinVariant = 'classic',
  mode = 'cape',
  scale = 6,
  label,
}: {
  capeDataUrl: string;
  /** used only when mode === 'with-skin' */
  skinDataUrl?: string | null;
  skinVariant?: SkinVariant;
  mode?: CapePreviewMode;
  scale?: number;
  label: string;
}) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    let cancelled = false;

    const W = 16 * scale;
    const H = 32 * scale;
    canvas.width = W;
    canvas.height = H;

    const drawCapeOnly = (capeImg: HTMLImageElement) => {
      ctx.clearRect(0, 0, W, H);
      ctx.imageSmoothingEnabled = false;

      // the outer face of the cape is at (1, 1), 10x16 of the 64x32 layout (scaled for HD capes)
      const u = capeScale(capeImg.width, capeImg.height);
      const k = 1.5; // 10x16 units on a 16x32 canvas, same proportions as the real cape
      const dw = 10 * k * scale;
      const dh = 16 * k * scale;
      const dx = (W - dw) / 2;
      const dy = (H - dh) / 2;

      ctx.fillStyle = 'rgba(0,0,0,0.2)';
      ctx.fillRect(dx + scale, dy + scale, dw, dh);
      ctx.drawImage(capeImg, CAPE_OUTER.x * u, CAPE_OUTER.y * u, CAPE_OUTER.w * u, CAPE_OUTER.h * u, dx, dy, dw, dh);
    };

    const drawWithSkin = (capeImg: HTMLImageElement, skinImg: HTMLImageElement) => {
      ctx.clearRect(0, 0, W, H);
      ctx.imageSmoothingEnabled = false;

      const legacy = skinImg.height === 32;
      const parts = skinParts(skinVariant, 'back', legacy);

      for (const overlayPass of [false, true]) {
        for (const p of parts) {
          if (!!p.overlay !== overlayPass) continue;
          ctx.save();
          if (p.flip) {
            ctx.translate((p.dx + p.sw) * scale, 0);
            ctx.scale(-1, 1);
            ctx.drawImage(skinImg, p.sx, p.sy, p.sw, p.sh, 0, p.dy * scale, p.sw * scale, p.sh * scale);
          } else {
            ctx.drawImage(skinImg, p.sx, p.sy, p.sw, p.sh, p.dx * scale, p.dy * scale, p.sw * scale, p.sh * scale);
          }
          ctx.restore();
        }
      }

      const u = capeScale(capeImg.width, capeImg.height);
      const capeDx = 3;
      const capeDy = 7;
      const capeDw = CAPE_OUTER.w;
      const capeDh = CAPE_OUTER.h;

      ctx.fillStyle = 'rgba(0,0,0,0.22)';
      ctx.fillRect((capeDx + 1) * scale, (capeDy + 1) * scale, capeDw * scale, capeDh * scale);
      ctx.drawImage(
        capeImg,
        CAPE_OUTER.x * u, CAPE_OUTER.y * u, CAPE_OUTER.w * u, CAPE_OUTER.h * u,
        capeDx * scale, capeDy * scale, capeDw * scale, capeDh * scale,
      );
    };

    const loadImg = (src: string) =>
      new Promise<HTMLImageElement>((resolve, reject) => {
        const i = new Image();
        i.onload = () => resolve(i);
        i.onerror = () => reject(new Error('img'));
        i.src = src;
      });

    void (async () => {
      try {
        const capeImg = await loadImg(capeDataUrl);
        if (cancelled) return;

        if (mode === 'with-skin' && skinDataUrl) {
          try {
            const skinImg = await loadImg(skinDataUrl);
            if (cancelled) return;
            drawWithSkin(capeImg, skinImg);
            return;
          } catch {
            /* fall through */
          }
        }
        if (!cancelled) drawCapeOnly(capeImg);
      } catch {
        if (cancelled) return;
        ctx.clearRect(0, 0, W, H);
        ctx.fillStyle = '#333';
        ctx.fillRect(0, 0, W, H);
        ctx.fillStyle = '#888';
        ctx.font = `${Math.max(10, scale * 1.5)}px sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('?', W / 2, H / 2);
      }
    })();

    return () => { cancelled = true; };
  }, [capeDataUrl, skinDataUrl, skinVariant, mode, scale]);

  return (
    <canvas
      ref={ref}
      width={16 * scale}
      height={32 * scale}
      className="doll cape-doll"
      role="img"
      aria-label={label}
    />
  );
}
