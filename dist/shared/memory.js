"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.MEM_SCHEMA_MAX = exports.MEM_AUTO_CAP = exports.MEM_SLIDER_MIN = exports.MEM_STEP = void 0;
exports.wantedMemoryMb = wantedMemoryMb;
exports.reservedForSystemMb = reservedForSystemMb;
exports.recommendMemory = recommendMemory;
exports.memorySliderMax = memorySliderMax;
exports.memoryWarning = memoryWarning;
/** Slider and rounding step, MB. */
exports.MEM_STEP = 256;
/** The lowest value the sliders allow (the schema allows 256, but less than this does not start modern Minecraft). */
exports.MEM_SLIDER_MIN = 512;
/** Above this a bigger heap only makes garbage-collection pauses longer, so auto-pick never goes higher. */
exports.MEM_AUTO_CAP = 16384;
/** Same upper limit as in the settings schema. */
exports.MEM_SCHEMA_MAX = 65536;
const floorTo = (n, step) => Math.floor(n / step) * step;
const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));
/** What the instance would like: a vanilla game needs little, a big modpack a lot. */
function wantedMemoryMb(modCount, loader) {
    if (loader === 'vanilla' || modCount <= 0)
        return 3072;
    if (modCount <= 30)
        return 4096;
    if (modCount <= 100)
        return 6144;
    if (modCount <= 200)
        return 8192;
    return 10240;
}
/** RAM that is left for Windows/Linux, the browser and the Java process itself outside of the heap. */
function reservedForSystemMb(totalMb) {
    return Math.max(2048, Math.round(totalMb * 0.3));
}
function recommendMemory(i) {
    const total = Number.isFinite(i.totalMb) && i.totalMb > 0 ? Math.floor(i.totalMb) : 8192;
    const wantedMb = wantedMemoryMb(i.modCount, i.loader);
    // On small machines "total minus reserve" would leave nothing: never take less than half, never more than the cap.
    const machineCap = Math.min(exports.MEM_AUTO_CAP, Math.max(total - reservedForSystemMb(total), Math.floor(total / 2)));
    const maxMb = Math.max(exports.MEM_SLIDER_MIN, floorTo(Math.min(wantedMb, machineCap), exports.MEM_STEP));
    const minMb = Math.min(maxMb, clamp(floorTo(maxMb / 4, exports.MEM_STEP), exports.MEM_SLIDER_MIN, 2048));
    return { minMb, maxMb, wantedMb, limitedBy: machineCap < wantedMb ? 'machine' : 'workload' };
}
/** Upper end of the slider: the computer's RAM (a bigger heap than the RAM only swaps), rounded down to the step. */
function memorySliderMax(totalMb) {
    if (!totalMb || !Number.isFinite(totalMb))
        return 16384;
    return clamp(floorTo(totalMb, exports.MEM_STEP), 2048, exports.MEM_SCHEMA_MAX);
}
/** For the UI and the launch log: a heap bigger than the RAM swaps, one that leaves < 1.5 GB to the system makes the PC lag. */
function memoryWarning(maxMb, totalMb) {
    if (!totalMb || !Number.isFinite(totalMb))
        return null;
    if (maxMb > totalMb)
        return 'exceeds-ram';
    if (totalMb - maxMb < 1536)
        return 'tight';
    return null;
}
//# sourceMappingURL=memory.js.map