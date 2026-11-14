import { BrowserWindow, globalShortcut, screen, type Display } from 'electron';
import * as path from 'node:path';

/**
 * In-game overlay, in the style of the Discord / Steam ones.
 *
 * One transparent, frameless, always-on-top window the size of a whole display. It has three modes:
 *  - closed: hidden;
 *  - hud:    a call is going on and the overlay is closed: only the call HUD (heads of the speakers) is drawn
 *            in the top-left corner; the window is click-through and never takes focus, so the game keeps working;
 *  - open:   the full overlay: the screen is dimmed, the friends panel is in the middle, the mouse is captured.
 * Toggle with Ctrl+Shift+O (Cmd+Shift+O on macOS). Esc, a click on the dimmed area or leaving the window closes it.
 *
 * Windows/macOS: the 'screen-saver' always-on-top level keeps it over windowed and borderless-fullscreen games.
 * Linux (X11): a fullscreen game sits in the topmost layer, where "always on top" alone is not enough, so the overlay window
 * itself becomes a fullscreen window and is raised above the game (the most recently raised fullscreen window wins).
 * Like any overlay that is not injected into the game, it cannot be drawn over a game in true exclusive fullscreen on Windows.
 */
export type OverlayMode = 'closed' | 'hud' | 'open';
export type CallPhase = 'idle' | 'outgoing' | 'incoming' | 'connecting' | 'active';

export class OverlayManager {
  private win: BrowserWindow | null = null;
  private loaded = false;
  private open = false;
  private phase: CallPhase = 'idle';
  private mode: OverlayMode = 'closed';
  private display: Display | null = null;
  private openedAt = 0;
  private topTimer: ReturnType<typeof setInterval> | null = null;
  private pendingCall: {
    userId: number;
    name: string;
    mcName: string;
    groupId?: number | null;
    memberIds?: number[];
  } | null = null;
  private readonly linux = process.platform === 'linux';
  private readonly isDev: boolean;
  private readonly devUrl: string;

  constructor(isDev: boolean, devUrl: string) {
    this.isDev = isDev;
    this.devUrl = devUrl;
  }

  create(): void {
    if (this.win && !this.win.isDestroyed()) return;
    const area = this.pickDisplay().bounds;
    this.loaded = false;
    this.win = new BrowserWindow({
      x: area.x,
      y: area.y,
      width: area.width,
      height: area.height,
      frame: false,
      transparent: true,
      thickFrame: false,
      hasShadow: false,
      alwaysOnTop: true,
      skipTaskbar: true,
      resizable: false,
      movable: false,
      minimizable: false,
      maximizable: false,
      // on Linux the overlay becomes a fullscreen window to get above a fullscreen game
      fullscreenable: process.platform === 'linux',
      show: false,
      backgroundColor: '#00000000',
      title: 'Chald Overlay',
      webPreferences: {
        preload: path.join(__dirname, '..', 'preload', 'index.js'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        webSecurity: true,
        // the call (WebRTC, audio) must keep running while the window is hidden
        backgroundThrottling: false,
      },
    });
    const win = this.win;
    win.setAlwaysOnTop(true, 'screen-saver');
    win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    win.setIgnoreMouseEvents(true, { forward: true });

    const overlayUrl = this.isDev
      ? `${this.devUrl.replace(/\/$/, '')}/overlay.html`
      : path.join(__dirname, '..', 'renderer', 'overlay.html');
    if (this.isDev) {
      // dev: wait for Vite instead of leaving the overlay blank (ERR_CONNECTION_REFUSED)
      win.webContents.on('did-fail-load', (_e, code, _desc, _url, isMainFrame) => {
        if (!isMainFrame || code !== -102) return;
        setTimeout(() => {
          if (!win.isDestroyed()) void win.loadURL(overlayUrl);
        }, 1500);
      });
      void win.loadURL(overlayUrl);
    } else void win.loadFile(overlayUrl);

    win.webContents.on('did-finish-load', () => {
      this.loaded = true;
      this.sendMode();
      this.flushCall();
    });
    // leaving the overlay (Alt+Tab, another window) closes it, so a dimmed screen never stays behind
    win.on('blur', () => {
      // entering fullscreen on Linux can blur the window for a moment: give it more time
      if (this.open && Date.now() - this.openedAt > (this.linux ? 1500 : 500)) this.setOpen(false);
    });
    win.on('closed', () => {
      this.stopTopTimer();
      this.win = null;
      this.loaded = false;
      this.mode = 'closed';
    });
  }

  /** The display the player is on: the one under the cursor (where the game is being played). */
  private pickDisplay(): Display {
    try {
      return screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
    } catch {
      return screen.getPrimaryDisplay();
    }
  }

  private place(): void {
    if (!this.win || this.win.isDestroyed()) return;
    // a fullscreen window cannot be moved to another display: leave fullscreen first, it is entered again after the move
    if (this.linux && this.win.isFullScreen()) this.win.setFullScreen(false);
    const d = this.pickDisplay();
    this.display = d;
    const b = d.bounds;
    const cur = this.win.getBounds();
    if (cur.x !== b.x || cur.y !== b.y || cur.width !== b.width || cur.height !== b.height) this.win.setBounds(b);
  }

  private raise(): void {
    if (!this.win || this.win.isDestroyed() || !this.win.isVisible()) return;
    // a game can take the top spot back: claim it again
    this.win.setAlwaysOnTop(true, 'screen-saver');
    if (this.linux && !this.win.isFullScreen()) this.win.setFullScreen(true);
    this.win.moveTop();
  }

  private startTopTimer(): void {
    if (this.topTimer) return;
    this.topTimer = setInterval(() => this.raise(), 1500);
  }

  private stopTopTimer(): void {
    if (!this.topTimer) return;
    clearInterval(this.topTimer);
    this.topTimer = null;
  }

  private sendMode(): void {
    if (!this.win || this.win.isDestroyed() || !this.loaded) return;
    try {
      this.win.webContents.send('overlay:mode', this.mode);
    } catch { /* window gone */ }
  }

  private flushCall(): void {
    if (!this.pendingCall || !this.win || this.win.isDestroyed() || !this.loaded) return;
    const payload = this.pendingCall;
    this.pendingCall = null;
    try {
      this.win.webContents.send('overlay:startCall', payload);
    } catch { /* window gone */ }
  }

  private apply(): void {
    this.create();
    const win = this.win;
    if (!win || win.isDestroyed()) return;
    const next: OverlayMode = this.open ? 'open' : this.phase !== 'idle' ? 'hud' : 'closed';
    const prev = this.mode;
    this.mode = next;

    if (next === 'closed') {
      this.stopTopTimer();
      win.setIgnoreMouseEvents(true, { forward: true });
      if (this.linux && win.isFullScreen()) win.setFullScreen(false);
      win.hide();
      this.sendMode();
      return;
    }

    if (prev === 'closed' || next === 'open') this.place();
    if (next === 'open') {
      this.openedAt = Date.now();
      win.setFocusable(true);
      win.setIgnoreMouseEvents(false);
      win.setAlwaysOnTop(true, 'screen-saver');
      win.show();
      if (this.linux) win.setFullScreen(true);
      win.setAlwaysOnTop(true, 'screen-saver');
      win.moveTop();
      win.focus();
    } else {
      // HUD: draws over the game but never takes focus or clicks
      win.setIgnoreMouseEvents(true, { forward: true });
      win.setFocusable(false);
      win.setAlwaysOnTop(true, 'screen-saver');
      win.showInactive();
      if (this.linux) win.setFullScreen(true);
      win.setAlwaysOnTop(true, 'screen-saver');
      win.moveTop();
    }
    this.startTopTimer();
    this.sendMode();
  }

  setOpen(open: boolean): boolean {
    this.open = open;
    this.apply();
    return this.open;
  }

  toggle(): boolean {
    return this.setOpen(!this.open);
  }

  /** Opens the full overlay (kept for the old `overlay:show` channel). */
  showWindow(): boolean {
    return this.setOpen(true);
  }

  isVisible(): boolean {
    return this.mode !== 'closed';
  }

  /** The renderer reports the call phase: while a call is on, the HUD stays visible even when the overlay is closed. */
  setCallPhase(phase: CallPhase): boolean {
    this.phase = phase;
    this.apply();
    return this.mode !== 'closed';
  }

  /** Ask the overlay renderer to place an outgoing WebRTC call. The overlay itself stays closed: only the HUD shows.
   *  For group calls pass `groupId` + `memberIds` (everyone except self); `userId` may be 0. */
  startCall(
    userId: number,
    name?: string,
    mcName?: string,
    groupId?: number | null,
    memberIds?: number[],
  ): boolean {
    this.create();
    if (!this.win || this.win.isDestroyed()) return false;
    this.pendingCall = {
      userId,
      name: name ?? '',
      mcName: mcName ?? '',
      groupId: groupId ?? null,
      memberIds: memberIds ?? [],
    };
    if (this.loaded) {
      // small delay so the overlay has subscribed
      setTimeout(() => this.flushCall(), 150);
    }
    return true;
  }

  ensureBackground(): void {
    this.create();
  }

  registerHotkey(accelerator = 'CommandOrControl+Shift+O'): void {
    try {
      globalShortcut.unregisterAll();
      globalShortcut.register(accelerator, () => {
        this.toggle();
      });
    } catch {
      /* ignore if shortcut fails */
    }
  }

  dispose(): void {
    this.stopTopTimer();
    try {
      globalShortcut.unregisterAll();
    } catch { /* ignore */ }
    if (this.win && !this.win.isDestroyed()) this.win.destroy();
    this.win = null;
  }
}
