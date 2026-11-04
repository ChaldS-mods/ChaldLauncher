import {
  AmbientLight, BufferAttribute, BufferGeometry, CanvasTexture, DirectionalLight, Group, Mesh, MeshLambertMaterial, NearestFilter,
  PerspectiveCamera, Scene, SRGBColorSpace, WebGLRenderer,
} from 'three';
import type { SkinVariant } from '../shared/skin';
import { boxFaces, LEGACY_MIRROR_COPIES, PIVOTS, skinBoxes, type LimbGroup, type SkinBox } from '../shared/skin3d';

const TEX = 64;

/** A 64x64 canvas with the skin; old 64x32 skins get their left limbs mirrored from the right ones. */
export function skinCanvas(img: CanvasImageSource & { width: number; height: number }): { canvas: HTMLCanvasElement; hatUsed: boolean } {
  const canvas = document.createElement('canvas');
  canvas.width = TEX; canvas.height = TEX;
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(img, 0, 0);
  const legacy = img.height === 32;
  let hatUsed = true;
  if (legacy) {
    for (const [sx, sy, w, h, dx, dy] of LEGACY_MIRROR_COPIES) {
      ctx.save();
      ctx.translate(dx + w, dy);
      ctx.scale(-1, 1);
      ctx.drawImage(canvas, sx, sy, w, h, 0, 0, w, h);
      ctx.restore();
    }
    // the game ignores the hat of an old skin whose hat area has no transparent pixel at all
    const d = ctx.getImageData(32, 0, 32, 16).data;
    hatUsed = false;
    for (let i = 3; i < d.length; i += 4) if (d[i]! < 128) { hatUsed = true; break; }
  }
  return { canvas, hatUsed };
}

function boxGeometry(b: SkinBox, pivot: [number, number, number]): BufferGeometry {
  const pos: number[] = [], uv: number[] = [], nor: number[] = [], idx: number[] = [];
  for (const f of boxFaces(b)) {
    const base = pos.length / 3;
    const { x, y, w, h } = f.rect;
    const uvs = [[x, y], [x + w, y], [x, y + h], [x + w, y + h]];
    f.corners.forEach((c, i) => {
      pos.push(c[0] - pivot[0], c[1] - pivot[1], c[2] - pivot[2]);
      uv.push(uvs[i]![0]! / TEX, uvs[i]![1]! / TEX);
      nor.push(...f.normal);
    });
    idx.push(base, base + 2, base + 3, base, base + 3, base + 1); // counter-clockwise seen from outside
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(new Float32Array(pos), 3));
  g.setAttribute('uv', new BufferAttribute(new Float32Array(uv), 2));
  g.setAttribute('normal', new BufferAttribute(new Float32Array(nor), 3));
  g.setIndex(idx);
  return g;
}

/** A turnable 3D player model drawn from a skin PNG. Throws from the constructor when WebGL is not available. */
export class SkinViewer3D {
  private renderer: WebGLRenderer;
  private scene = new Scene();
  private camera = new PerspectiveCamera(30, 1, 1, 400);
  private pivot = new Group();
  private model: Group | null = null;
  private limbs: Partial<Record<LimbGroup, Group>> = {};
  private texture: CanvasTexture | null = null;
  private raf = 0;
  private t0 = performance.now();
  private yaw = -0.55;
  private pitch = 0.12;
  private dist = 74;
  private dragging = false;
  private lastX = 0;
  private lastY = 0;
  private swing = 0; // 0..1: how far the walking animation is faded in
  walk = true;
  autoRotate = true;
  private ro: ResizeObserver | null = null;
  private off: (() => void)[] = [];

  constructor(private canvas: HTMLCanvasElement) {
    this.renderer = new WebGLRenderer({ canvas, antialias: true, alpha: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.outputColorSpace = SRGBColorSpace;
    this.scene.add(new AmbientLight(0xffffff, 2.1));
    const sun = new DirectionalLight(0xffffff, 1.1);
    sun.position.set(-30, 50, 60);
    this.scene.add(sun);
    this.scene.add(this.pivot);
    this.pivot.position.y = 16; // turn around the middle of the body

    const down = (e: PointerEvent) => { this.dragging = true; this.autoRotate = false; this.lastX = e.clientX; this.lastY = e.clientY; canvas.setPointerCapture(e.pointerId); };
    const move = (e: PointerEvent) => {
      if (!this.dragging) return;
      this.yaw += (e.clientX - this.lastX) * 0.012;
      this.pitch = Math.max(-0.7, Math.min(0.7, this.pitch + (e.clientY - this.lastY) * 0.008));
      this.lastX = e.clientX; this.lastY = e.clientY;
    };
    const up = () => { this.dragging = false; };
    const wheel = (e: WheelEvent) => { e.preventDefault(); this.dist = Math.max(42, Math.min(120, this.dist * (1 + Math.sign(e.deltaY) * 0.08))); };
    canvas.addEventListener('pointerdown', down);
    canvas.addEventListener('pointermove', move);
    canvas.addEventListener('pointerup', up);
    canvas.addEventListener('pointercancel', up);
    canvas.addEventListener('wheel', wheel, { passive: false });
    this.off.push(() => {
      canvas.removeEventListener('pointerdown', down); canvas.removeEventListener('pointermove', move);
      canvas.removeEventListener('pointerup', up); canvas.removeEventListener('pointercancel', up); canvas.removeEventListener('wheel', wheel);
    });
    if (typeof ResizeObserver !== 'undefined' && canvas.parentElement) {
      this.ro = new ResizeObserver(() => this.resize());
      this.ro.observe(canvas.parentElement);
    }
    this.resize();
    this.loop = this.loop.bind(this);
    this.raf = requestAnimationFrame(this.loop);
  }

  resize(): void {
    const box = this.canvas.parentElement ?? this.canvas;
    const w = Math.max(1, Math.round(box.clientWidth)), h = Math.max(1, Math.round(box.clientHeight));
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  /** Replaces the skin (and the arm model). */
  setSkin(img: CanvasImageSource & { width: number; height: number }, variant: SkinVariant): void {
    this.clearModel();
    const { canvas, hatUsed } = skinCanvas(img);
    const tex = new CanvasTexture(canvas);
    tex.colorSpace = SRGBColorSpace;
    tex.magFilter = NearestFilter; tex.minFilter = NearestFilter;
    tex.generateMipmaps = false;
    tex.flipY = false; // UVs are written in image rows, top row first
    this.texture = tex;
    const mat = new MeshLambertMaterial({ map: tex, alphaTest: 0.5 });
    const model = new Group();
    const groups: Partial<Record<LimbGroup, Group>> = {};
    for (const b of skinBoxes(variant)) {
      if (b.id === 'hat' && !hatUsed) continue;
      const pv = PIVOTS[b.group];
      let g = groups[b.group];
      if (!g) { g = new Group(); g.position.set(pv[0], pv[1], pv[2]); groups[b.group] = g; model.add(g); }
      g.add(new Mesh(boxGeometry(b, pv), mat));
    }
    // the model is placed so that its middle (y = 16) is the turning point of `pivot`
    model.position.y = -16;
    this.model = model;
    this.limbs = groups;
    this.pivot.add(model);
  }

  private clearModel(): void {
    if (this.model) {
      this.pivot.remove(this.model);
      this.model.traverse((o) => {
        if (o instanceof Mesh) { o.geometry.dispose(); (o.material as MeshLambertMaterial).dispose(); }
      });
    }
    this.texture?.dispose();
    this.model = null; this.texture = null; this.limbs = {};
  }

  private loop(): void {
    this.raf = requestAnimationFrame(this.loop);
    const t = (performance.now() - this.t0) / 1000;
    if (this.autoRotate) this.yaw += 0.008;
    this.swing += ((this.walk ? 1 : 0) - this.swing) * 0.12;
    const a = Math.sin(t * 3.2) * 0.55 * this.swing;
    const L = this.limbs;
    if (L.rightArm) L.rightArm.rotation.x = a;
    if (L.leftArm) L.leftArm.rotation.x = -a;
    if (L.rightLeg) L.rightLeg.rotation.x = -a;
    if (L.leftLeg) L.leftLeg.rotation.x = a;
    this.pivot.rotation.set(this.pitch, this.yaw, 0, 'YXZ');
    this.camera.position.set(0, 16 + 2, this.dist);
    this.camera.lookAt(0, 16, 0);
    this.renderer.render(this.scene, this.camera);
  }

  dispose(): void {
    cancelAnimationFrame(this.raf);
    this.ro?.disconnect();
    this.off.forEach((f) => f());
    this.clearModel();
    this.renderer.dispose();
    this.renderer.forceContextLoss();
  }
}
