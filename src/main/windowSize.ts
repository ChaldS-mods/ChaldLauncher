/** Window size that fits the screen: on small displays (or with 125-150% scaling) a fixed minimum would push the bottom of the window off-screen. */
export function fitWindowSize(work: { width: number; height: number }): { width: number; height: number; minWidth: number; minHeight: number } {
  // Keep titlebar + sidebar content + statusbar usable; never exceed the work area.
  const minWidth = Math.min(1100, work.width);
  const minHeight = Math.min(720, work.height);
  return {
    width: Math.max(minWidth, Math.min(1360, work.width)),
    height: Math.max(minHeight, Math.min(860, work.height)),
    minWidth,
    minHeight,
  };
}
