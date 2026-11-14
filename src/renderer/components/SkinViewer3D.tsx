import { useEffect, useRef, useState } from 'react';
import type { SkinVariant } from '../../shared/skin';
import type { SkinViewer3D as Viewer } from '../skinViewer3d';
import { SkinPreview } from './SkinPreview';

export type AccessoryMode = 'none' | 'cape' | 'elytra';

/** Turnable 3D model of a skin (+ optional cape / elytra). Falls back to flat picture when WebGL is unavailable. */
export function SkinViewer3D({
  dataUrl,
  variant,
  walk,
  label,
  capeDataUrl,
  accessoryMode = 'none',
}: {
  dataUrl: string;
  variant: SkinVariant;
  walk: boolean;
  label: string;
  capeDataUrl?: string | null;
  accessoryMode?: AccessoryMode;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  const viewer = useRef<Viewer | null>(null);
  const [failed, setFailed] = useState(false);
  const walkRef = useRef(walk);
  walkRef.current = walk;

  useEffect(() => {
    let dead = false;
    const canvas = ref.current;
    if (!canvas) return;
    void import('../skinViewer3d').then(({ SkinViewer3D: V }) => {
      if (dead) return;
      try {
        const v = new V(canvas);
        if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) { v.autoRotate = false; v.walk = false; }
        v.walk = walkRef.current && v.walk;
        viewer.current = v;
        window.dispatchEvent(new Event('chald:viewer-ready'));
      } catch { setFailed(true); }
    }).catch(() => setFailed(true));
    return () => { dead = true; viewer.current?.dispose(); viewer.current = null; };
  }, []);

  useEffect(() => {
    let dead = false;
    const apply = () => {
      const v = viewer.current;
      if (!v || dead) return;
      const img = new Image();
      img.onload = () => { if (!dead && viewer.current) viewer.current.setSkin(img, variant); };
      img.src = dataUrl;
    };
    apply();
    window.addEventListener('chald:viewer-ready', apply);
    return () => { dead = true; window.removeEventListener('chald:viewer-ready', apply); };
  }, [dataUrl, variant]);

  useEffect(() => {
    let dead = false;
    const apply = () => {
      const v = viewer.current;
      if (!v || dead) return;
      if (!capeDataUrl) {
        v.setCape(null);
        v.setAccessoryMode('none');
        return;
      }
      const img = new Image();
      img.onload = () => {
        if (dead || !viewer.current) return;
        viewer.current.setCape(img);
        viewer.current.setAccessoryMode(accessoryMode === 'none' ? 'cape' : accessoryMode);
      };
      img.src = capeDataUrl;
    };
    apply();
    window.addEventListener('chald:viewer-ready', apply);
    return () => { dead = true; window.removeEventListener('chald:viewer-ready', apply); };
  }, [capeDataUrl, accessoryMode]);

  useEffect(() => { if (viewer.current) viewer.current.walk = walk; }, [walk]);

  if (failed) return <SkinPreview dataUrl={dataUrl} variant={variant} scale={10} label={label} />;
  return (
    <div className="viewer3d" data-silent>
      <canvas ref={ref} role="img" aria-label={`${label} (3D)`} />
    </div>
  );
}
