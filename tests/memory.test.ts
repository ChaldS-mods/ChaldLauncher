import { describe, expect, it } from 'vitest';
import { MEM_AUTO_CAP, MEM_SLIDER_MIN, MEM_STEP, memorySliderMax, memoryWarning, recommendMemory, reservedForSystemMb, wantedMemoryMb } from '../src/shared/memory';
import { appSettingsSchema } from '../src/shared/schemas';
import { DEFAULT_SETTINGS } from '../src/main/settings';

describe('recommendMemory', () => {
  it('scales with the number of mods', () => {
    const at = (modCount: number) => recommendMemory({ totalMb: 32768, modCount, loader: 'fabric' }).maxMb;
    expect([at(0), at(10), at(60), at(150), at(300)]).toEqual([3072, 4096, 6144, 8192, 10240]);
  });
  it('vanilla stays small however many files lie in mods/', () => {
    expect(recommendMemory({ totalMb: 32768, modCount: 500, loader: 'vanilla' }).maxMb).toBe(3072);
  });
  it('leaves the system a reserve on small computers', () => {
    const a4 = recommendMemory({ totalMb: 4096, modCount: 150, loader: 'neoforge' });
    expect(a4.maxMb).toBe(2048);
    expect(a4.limitedBy).toBe('machine');
    const a8 = recommendMemory({ totalMb: 8192, modCount: 150, loader: 'neoforge' });
    expect(a8.maxMb).toBe(5632);
    expect(8192 - a8.maxMb).toBeGreaterThanOrEqual(reservedForSystemMb(8192));
  });
  it('never takes more than the cap and reports when the instance is satisfied', () => {
    const a = recommendMemory({ totalMb: 131072, modCount: 999, loader: 'forge' });
    expect(a.maxMb).toBeLessThanOrEqual(MEM_AUTO_CAP);
    expect(a.limitedBy).toBe('workload');
  });
  it('always returns a valid, ordered, step-aligned pair accepted by the settings schema', () => {
    for (const totalMb of [512, 1024, 2048, 3072, 4096, 6144, 8192, 12288, 16384, 24576, 32768, 65536, 262144]) {
      for (const modCount of [0, 1, 30, 31, 100, 101, 200, 201, 800]) {
        for (const loader of ['vanilla', 'fabric', 'neoforge'] as const) {
          const a = recommendMemory({ totalMb, modCount, loader });
          expect(a.minMb).toBeLessThanOrEqual(a.maxMb);
          expect(a.minMb).toBeGreaterThanOrEqual(MEM_SLIDER_MIN);
          expect(a.maxMb % MEM_STEP).toBe(0);
          expect(a.minMb % MEM_STEP).toBe(0);
          expect(appSettingsSchema.safeParse({ ...DEFAULT_SETTINGS, memoryMinMb: a.minMb, memoryMaxMb: a.maxMb }).success).toBe(true);
          if (totalMb >= 1024) expect(a.maxMb).toBeLessThanOrEqual(Math.max(totalMb - reservedForSystemMb(totalMb), Math.floor(totalMb / 2)));
        }
      }
    }
  });
  it('falls back to sane numbers when the RAM size is unknown', () => {
    expect(recommendMemory({ totalMb: NaN, modCount: 0, loader: 'vanilla' }).maxMb).toBe(3072);
    expect(wantedMemoryMb(0, 'fabric')).toBe(3072);
  });
});

describe('slider helpers', () => {
  it('slider max follows the RAM of the computer', () => {
    expect(memorySliderMax(16384)).toBe(16384);
    expect(memorySliderMax(15999)).toBe(15872);
    expect(memorySliderMax(null)).toBe(16384);
    expect(memorySliderMax(1024)).toBe(2048);
  });
  it('warns about heaps that swap or starve the system', () => {
    expect(memoryWarning(9000, 8192)).toBe('exceeds-ram');
    expect(memoryWarning(7000, 8192)).toBe('tight');
    expect(memoryWarning(4096, 16384)).toBeNull();
    expect(memoryWarning(4096, null)).toBeNull();
  });
});

describe('memoryAuto setting', () => {
  it('is on by default and part of the schema', () => {
    expect(DEFAULT_SETTINGS.memoryAuto).toBe(true);
    expect(appSettingsSchema.safeParse({ ...DEFAULT_SETTINGS, memoryAuto: 'yes' }).success).toBe(false);
  });
});
