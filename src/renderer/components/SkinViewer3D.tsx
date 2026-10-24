import { useEffect, useRef, useState } from 'react';
import type { SkinVariant } from '../../shared/skin';
import type { SkinViewer3D as Viewer } from '../skinViewer3d';
import { SkinPreview } from './SkinPreview';

/** Turnable 3D model of a skin. Falls back to the flat picture when WebGL is not available. */
export function SkinViewer3D({ dataUrl, variant, walk, label }: { dataUrl: string; variant: SkinVariant; walk: boolean; label: string }) {
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
        // a skin that was chosen while the module was loading
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

  useEffect(() => { if (viewer.current) viewer.current.walk = walk; }, [walk]);

  if (failed) return <SkinPreview dataUrl={dataUrl} variant={variant} scale={10} label={label} />;
  return (
    <div className="viewer3d" data-silent>
      <canvas ref={ref} role="img" aria-label={`${label} (3D, тяни мышью, чтобы повернуть)`} />
    </div>
  );
}
