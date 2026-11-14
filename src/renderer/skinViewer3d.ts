import {
  AmbientLight, BufferAttribute, BufferGeometry, CanvasTexture, DirectionalLight, Group, Mesh, MeshLambertMaterial, NearestFilter,
  PerspectiveCamera, Scene, SRGBColorSpace, WebGLRenderer,
} from 'three';
import type { SkinVariant } from '../shared/skin';
import {
  boxFaces, CAPE_BOX, CAPE_LAYOUT, CAPE_OUTER, CAPE_PIVOT, CAPE_REST_ANGLE, capeScale, ELYTRA_BOX, ELYTRA_PIVOT, ELYTRA_REST, hatIsUsed,
  LEGACY_MIRROR_COPIES, PIVOTS, skinBoxes, type LimbGroup, type SkinBox,
} from '../shared/skin3d';

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
    const alpha: number[] = [];
    for (let i = 3; i < d.length; i += 4) alpha.push(d[i]!);
    hatUsed = hatIsUsed(true, alpha);
  }
  return { canvas, hatUsed };
}

function boxGeometry(b: SkinBox, pivot: [number, number, number], texW = TEX, texH = TEX): BufferGeometry {
  const pos: number[] = [], uv: number[] = [], nor: number[] = [], idx: number[] = [];
  for (const f of boxFaces(b)) {
    const base = pos.length / 3;
    const { x, y, w, h } = f.rect;
    const uvs = [[x, y], [x + w, y], [x, y + h], [x + w, y + h]];
    f.corners.forEach((c, i) => {
      pos.push(c[0] - pivot[0], c[1] - pivot[1], c[2] - pivot[2]);
      uv.push(uvs[i]![0]! / texW, uvs[i]![1]! / texH);
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
  private capeTexture: CanvasTexture | null = null;
  private capeGroup: Group | null = null;
  /** the cape's hanging point: it tilts while the character walks */
  private capeHang: Group | null = null;
  private accessoryMode: 'none' | 'cape' | 'elytra' = 'none';
  private raf = 0;
  private t0 = performance.now();
  private yaw = -0.55;
  private pitch = 0.12;
  private dist = 74;
  private userZoomed = false; // the player used the wheel: stop choosing the distance for them
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
    const wheel = (e: WheelEvent) => { e.preventDefault(); this.userZoomed = true; this.dist = Math.max(42, Math.min(120, this.dist * (1 + Math.sign(e.deltaY) * 0.08))); };
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
    this.fitDistance();
  }

  /** Camera distance: the spread elytra wings (about ±22 texels wide, plus a margin) must fit whatever shape the window has. */
  private fitDistance(): void {
    if (this.userZoomed) return;
    const need = this.accessoryMode === 'elytra' ? Math.ceil(25 / (Math.tan(Math.PI / 12) * this.camera.aspect)) : 0;
    this.dist = Math.min(120, Math.max(74, need));
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


  /** Attach or replace the cape texture (the PNG also holds the elytra). Pass null to remove. */
  setCape(img: CanvasImageSource & { width: number; height: number } | null): void {
    this.clearCape();
    if (!img) return;
    // the layout is 64x32 units; an HD cape is the same layout scaled, so UVs are fractions of the layout
    const s = capeScale(img.width, img.height);
    const canvas = document.createElement('canvas');
    canvas.width = CAPE_LAYOUT.w * s;
    canvas.height = CAPE_LAYOUT.h * s;
    const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(img, 0, 0);
    this.paintMissingElytra(ctx, s);
    const tex = new CanvasTexture(canvas);
    tex.colorSpace = SRGBColorSpace;
    tex.magFilter = NearestFilter;
    tex.minFilter = NearestFilter;
    tex.generateMipmaps = false;
    tex.flipY = false;
    this.capeTexture = tex;
    this.rebuildCape();
  }

  /** A cape file without elytra wings (a cropped 22x17 cape): the wings get the cape's pattern instead of staying invisible. */
  private paintMissingElytra(ctx: CanvasRenderingContext2D, s: number): void {
    const { data } = ctx.getImageData(22 * s, 0, 24 * s, 22 * s);
    for (let i = 3; i < data.length; i += 4) if (data[i]! > 0) return; // the wings are there
    const o = CAPE_OUTER;
    for (const x of [24, 36]) ctx.drawImage(ctx.canvas, o.x * s, o.y * s, o.w * s, o.h * s, x * s, 2 * s, 10 * s, 20 * s);
  }

  /** Show the cape hanging on the back, the elytra wings, or nothing. */
  setAccessoryMode(mode: 'none' | 'cape' | 'elytra'): void {
    this.accessoryMode = mode;
    this.fitDistance(); // the spread wings are wider than the body: step back so they are not cut off
    this.rebuildCape();
  }

  private disposeCapeMeshes(): void {
    if (!this.capeGroup) return;
    this.pivot.remove(this.capeGroup);
    this.capeGroup.traverse((o) => {
      if (o instanceof Mesh) {
        o.geometry.dispose();
        (o.material as MeshLambertMaterial).dispose(); // the texture is shared and is disposed with the cape
      }
    });
    this.capeGroup = null;
    this.capeHang = null;
  }

  private rebuildCape(): void {
    this.disposeCapeMeshes();
    if (!this.capeTexture || this.accessoryMode === 'none') return;
    const mat = new MeshLambertMaterial({ map: this.capeTexture, alphaTest: 0.5 });
    const geo = (b: SkinBox) => boxGeometry(b, [0, 0, 0], CAPE_LAYOUT.w, CAPE_LAYOUT.h);
    const group = new Group();
    group.position.y = -16; // same offset as the body, so model coordinates match

    if (this.accessoryMode === 'cape') {
      // hangs from the top of the back; turned by 180° like in the game so its outer face shows the design
      const hang = new Group();
      hang.position.set(...CAPE_PIVOT);
      hang.rotation.x = CAPE_REST_ANGLE;
      const flip = new Group();
      flip.rotation.y = Math.PI;
      flip.add(new Mesh(geo(CAPE_BOX), mat));
      hang.add(flip);
      group.add(hang);
      this.capeHang = hang;
    } else {
      // two wings: the right one as in the texture, the left one is its mirror image
      for (const left of [false, true]) {
        const holder = new Group();
        holder.position.set(0, ELYTRA_PIVOT[1], ELYTRA_PIVOT[2]);
        if (left) holder.scale.x = -1;
        const wing = new Group();
        wing.position.x = -ELYTRA_PIVOT[0];
        wing.rotation.order = 'ZYX'; // tilt back first, then spread outward (the game's order)
        wing.rotation.set(ELYTRA_REST.x, 0, -ELYTRA_REST.z);
        wing.add(new Mesh(geo(ELYTRA_BOX), mat));
        holder.add(wing);
        group.add(holder);
      }
    }
    this.capeGroup = group;
    this.pivot.add(group);
  }

  private clearCape(): void {
    this.disposeCapeMeshes();
    this.capeTexture?.dispose();
    this.capeTexture = null;
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
    // the cape lifts a little with every step
    if (this.capeHang) this.capeHang.rotation.x = CAPE_REST_ANGLE + this.swing * (0.5 + 0.5 * Math.sin(t * 6.4)) * 0.22;
    this.pivot.rotation.set(this.pitch, this.yaw, 0, 'YXZ');
    this.camera.position.set(0, 16 + 2, this.dist);
    this.camera.lookAt(0, 16, 0);
    this.renderer.render(this.scene, this.camera);
  }

  dispose(): void {
    cancelAnimationFrame(this.raf);
    this.ro?.disconnect();
    this.off.forEach((f) => f());
    this.clearCape();
    this.clearModel();
    this.renderer.dispose();
    this.renderer.forceContextLoss();
  }
}
