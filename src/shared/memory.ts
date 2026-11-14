import type { LoaderType } from './types';

/** Slider and rounding step, MB. */
export const MEM_STEP = 256;
/** The lowest value the sliders allow (the schema allows 256, but less than this does not start modern Minecraft). */
export const MEM_SLIDER_MIN = 512;
/** Above this a bigger heap only makes garbage-collection pauses longer, so auto-pick never goes higher. */
export const MEM_AUTO_CAP = 16384;
/** Same upper limit as in the settings schema. */
export const MEM_SCHEMA_MAX = 65536;

export interface MemoryAdviceInput {
  /** physical RAM of the computer, MB */
  totalMb: number;
  /** number of .jar files in the instance's mods folder */
  modCount: number;
  loader: LoaderType;
}

export interface MemoryAdvice {
  minMb: number;
  maxMb: number;
  /** the heap the instance would like, before the computer's limit is applied */
  wantedMb: number;
  /** why maxMb is what it is: the instance is satisfied, or the computer is the limit */
  limitedBy: 'workload' | 'machine';
}

const floorTo = (n: number, step: number) => Math.floor(n / step) * step;
const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

/** What the instance would like: a vanilla game needs little, a big modpack a lot. */
export function wantedMemoryMb(modCount: number, loader: LoaderType): number {
  if (loader === 'vanilla' || modCount <= 0) return 3072;
  if (modCount <= 30) return 4096;
  if (modCount <= 100) return 6144;
  if (modCount <= 200) return 8192;
  return 10240;
}

/** RAM that is left for Windows/Linux, the browser and the Java process itself outside of the heap. */
export function reservedForSystemMb(totalMb: number): number {
  return Math.max(2048, Math.round(totalMb * 0.3));
}

export function recommendMemory(i: MemoryAdviceInput): MemoryAdvice {
  const total = Number.isFinite(i.totalMb) && i.totalMb > 0 ? Math.floor(i.totalMb) : 8192;
  const wantedMb = wantedMemoryMb(i.modCount, i.loader);
  // On small machines "total minus reserve" would leave nothing: never take less than half, never more than the cap.
  const machineCap = Math.min(MEM_AUTO_CAP, Math.max(total - reservedForSystemMb(total), Math.floor(total / 2)));
  const maxMb = Math.max(MEM_SLIDER_MIN, floorTo(Math.min(wantedMb, machineCap), MEM_STEP));
  const minMb = Math.min(maxMb, clamp(floorTo(maxMb / 4, MEM_STEP), MEM_SLIDER_MIN, 2048));
  return { minMb, maxMb, wantedMb, limitedBy: machineCap < wantedMb ? 'machine' : 'workload' };
}

/** Upper end of the slider: the computer's RAM (a bigger heap than the RAM only swaps), rounded down to the step. */
export function memorySliderMax(totalMb: number | null): number {
  if (!totalMb || !Number.isFinite(totalMb)) return 16384;
  return clamp(floorTo(totalMb, MEM_STEP), 2048, MEM_SCHEMA_MAX);
}

export type MemoryWarning = 'exceeds-ram' | 'tight' | null;

/** For the UI and the launch log: a heap bigger than the RAM swaps, one that leaves < 1.5 GB to the system makes the PC lag. */
export function memoryWarning(maxMb: number, totalMb: number | null): MemoryWarning {
  if (!totalMb || !Number.isFinite(totalMb)) return null;
  if (maxMb > totalMb) return 'exceeds-ram';
  if (totalMb - maxMb < 1536) return 'tight';
  return null;
}
