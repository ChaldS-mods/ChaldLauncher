"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.fitWindowSize = fitWindowSize;
/** Window size that fits the screen: on small displays (or with 125-150% scaling) a fixed minimum would push the bottom of the window off-screen. */
function fitWindowSize(work) {
    const minWidth = Math.min(1040, work.width);
    const minHeight = Math.min(660, work.height);
    return {
        width: Math.max(minWidth, Math.min(1280, work.width)),
        height: Math.max(minHeight, Math.min(780, work.height)),
        minWidth,
        minHeight,
    };
}
//# sourceMappingURL=windowSize.js.map