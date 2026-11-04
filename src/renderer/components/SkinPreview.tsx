import { useEffect, useRef } from 'react';
import { skinParts, type SkinSide, type SkinVariant } from '../../shared/skin';

/**
 * A flat "doll" built from the skin texture (front or back, base layer + hat/jacket/sleeves/pants).
 * It is drawn from the real PNG, so what you see is what Minecraft will show, just not in 3D.
 */
export function SkinPreview({ dataUrl, variant, side = 'front', scale = 6, label }: { dataUrl: string; variant: SkinVariant; side?: SkinSide; scale?: number; label: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    let cancelled = false;
    const img = new Image();
    img.onload = () => {
      if (cancelled) return;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.imageSmoothingEnabled = false;
      const legacy = img.height === 32;
      // Old 64x32 skins: if the hat area has no transparency at all, the game ignores it (the "Notch hack").
      let hatUsed = true;
      if (legacy) {
        const probe = document.createElement('canvas');
        probe.width = img.width; probe.height = img.height;
        const pc = probe.getContext('2d');
        if (pc) {
          pc.drawImage(img, 0, 0);
          const d = pc.getImageData(32, 0, 32, 16).data;
          hatUsed = false;
          for (let i = 3; i < d.length; i += 4) if (d[i]! < 128) { hatUsed = true; break; }
        }
      }
      const parts = skinParts(variant, side, legacy);
      for (const overlayPass of [false, true]) {
        for (const p of parts) {
          if (!!p.overlay !== overlayPass) continue;
          if (legacy && p.overlay && !hatUsed) continue;
          ctx.save();
          if (p.flip) {
            ctx.translate((p.dx + p.sw) * scale, 0);
            ctx.scale(-1, 1);
            ctx.drawImage(img, p.sx, p.sy, p.sw, p.sh, 0, p.dy * scale, p.sw * scale, p.sh * scale);
          } else {
            ctx.drawImage(img, p.sx, p.sy, p.sw, p.sh, p.dx * scale, p.dy * scale, p.sw * scale, p.sh * scale);
          }
          ctx.restore();
        }
      }
    };
    img.src = dataUrl;
    return () => { cancelled = true; };
  }, [dataUrl, variant, side, scale]);
  return <canvas ref={ref} width={16 * scale} height={32 * scale} className="doll" role="img" aria-label={label} />;
}
