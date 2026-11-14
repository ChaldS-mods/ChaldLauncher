"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.OverlayManager = void 0;
const electron_1 = require("electron");
const path = __importStar(require("node:path"));
class OverlayManager {
    win = null;
    loaded = false;
    open = false;
    phase = 'idle';
    mode = 'closed';
    display = null;
    openedAt = 0;
    topTimer = null;
    pendingCall = null;
    linux = process.platform === 'linux';
    isDev;
    devUrl;
    constructor(isDev, devUrl) {
        this.isDev = isDev;
        this.devUrl = devUrl;
    }
    create() {
        if (this.win && !this.win.isDestroyed())
            return;
        const area = this.pickDisplay().bounds;
        this.loaded = false;
        this.win = new electron_1.BrowserWindow({
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
                if (!isMainFrame || code !== -102)
                    return;
                setTimeout(() => {
                    if (!win.isDestroyed())
                        void win.loadURL(overlayUrl);
                }, 1500);
            });
            void win.loadURL(overlayUrl);
        }
        else
            void win.loadFile(overlayUrl);
        win.webContents.on('did-finish-load', () => {
            this.loaded = true;
            this.sendMode();
            this.flushCall();
        });
        // leaving the overlay (Alt+Tab, another window) closes it, so a dimmed screen never stays behind
        win.on('blur', () => {
            // entering fullscreen on Linux can blur the window for a moment: give it more time
            if (this.open && Date.now() - this.openedAt > (this.linux ? 1500 : 500))
                this.setOpen(false);
        });
        win.on('closed', () => {
            this.stopTopTimer();
            this.win = null;
            this.loaded = false;
            this.mode = 'closed';
        });
    }
    /** The display the player is on: the one under the cursor (where the game is being played). */
    pickDisplay() {
        try {
            return electron_1.screen.getDisplayNearestPoint(electron_1.screen.getCursorScreenPoint());
        }
        catch {
            return electron_1.screen.getPrimaryDisplay();
        }
    }
    place() {
        if (!this.win || this.win.isDestroyed())
            return;
        // a fullscreen window cannot be moved to another display: leave fullscreen first, it is entered again after the move
        if (this.linux && this.win.isFullScreen())
            this.win.setFullScreen(false);
        const d = this.pickDisplay();
        this.display = d;
        const b = d.bounds;
        const cur = this.win.getBounds();
        if (cur.x !== b.x || cur.y !== b.y || cur.width !== b.width || cur.height !== b.height)
            this.win.setBounds(b);
    }
    raise() {
        if (!this.win || this.win.isDestroyed() || !this.win.isVisible())
            return;
        // a game can take the top spot back: claim it again
        this.win.setAlwaysOnTop(true, 'screen-saver');
        if (this.linux && !this.win.isFullScreen())
            this.win.setFullScreen(true);
        this.win.moveTop();
    }
    startTopTimer() {
        if (this.topTimer)
            return;
        this.topTimer = setInterval(() => this.raise(), 1500);
    }
    stopTopTimer() {
        if (!this.topTimer)
            return;
        clearInterval(this.topTimer);
        this.topTimer = null;
    }
    sendMode() {
        if (!this.win || this.win.isDestroyed() || !this.loaded)
            return;
        try {
            this.win.webContents.send('overlay:mode', this.mode);
        }
        catch { /* window gone */ }
    }
    flushCall() {
        if (!this.pendingCall || !this.win || this.win.isDestroyed() || !this.loaded)
            return;
        const payload = this.pendingCall;
        this.pendingCall = null;
        try {
            this.win.webContents.send('overlay:startCall', payload);
        }
        catch { /* window gone */ }
    }
    apply() {
        this.create();
        const win = this.win;
        if (!win || win.isDestroyed())
            return;
        const next = this.open ? 'open' : this.phase !== 'idle' ? 'hud' : 'closed';
        const prev = this.mode;
        this.mode = next;
        if (next === 'closed') {
            this.stopTopTimer();
            win.setIgnoreMouseEvents(true, { forward: true });
            if (this.linux && win.isFullScreen())
                win.setFullScreen(false);
            win.hide();
            this.sendMode();
            return;
        }
        if (prev === 'closed' || next === 'open')
            this.place();
        if (next === 'open') {
            this.openedAt = Date.now();
            win.setFocusable(true);
            win.setIgnoreMouseEvents(false);
            win.setAlwaysOnTop(true, 'screen-saver');
            win.show();
            if (this.linux)
                win.setFullScreen(true);
            win.setAlwaysOnTop(true, 'screen-saver');
            win.moveTop();
            win.focus();
        }
        else {
            // HUD: draws over the game but never takes focus or clicks
            win.setIgnoreMouseEvents(true, { forward: true });
            win.setFocusable(false);
            win.setAlwaysOnTop(true, 'screen-saver');
            win.showInactive();
            if (this.linux)
                win.setFullScreen(true);
            win.setAlwaysOnTop(true, 'screen-saver');
            win.moveTop();
        }
        this.startTopTimer();
        this.sendMode();
    }
    setOpen(open) {
        this.open = open;
        this.apply();
        return this.open;
    }
    toggle() {
        return this.setOpen(!this.open);
    }
    /** Opens the full overlay (kept for the old `overlay:show` channel). */
    showWindow() {
        return this.setOpen(true);
    }
    isVisible() {
        return this.mode !== 'closed';
    }
    /** The renderer reports the call phase: while a call is on, the HUD stays visible even when the overlay is closed. */
    setCallPhase(phase) {
        this.phase = phase;
        this.apply();
        return this.mode !== 'closed';
    }
    /** Ask the overlay renderer to place an outgoing WebRTC call. The overlay itself stays closed: only the HUD shows.
     *  For group calls pass `groupId` + `memberIds` (everyone except self); `userId` may be 0. */
    startCall(userId, name, mcName, groupId, memberIds) {
        this.create();
        if (!this.win || this.win.isDestroyed())
            return false;
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
    ensureBackground() {
        this.create();
    }
    registerHotkey(accelerator = 'CommandOrControl+Shift+O') {
        try {
            electron_1.globalShortcut.unregisterAll();
            electron_1.globalShortcut.register(accelerator, () => {
                this.toggle();
            });
        }
        catch {
            /* ignore if shortcut fails */
        }
    }
    dispose() {
        this.stopTopTimer();
        try {
            electron_1.globalShortcut.unregisterAll();
        }
        catch { /* ignore */ }
        if (this.win && !this.win.isDestroyed())
            this.win.destroy();
        this.win = null;
    }
}
exports.OverlayManager = OverlayManager;
//# sourceMappingURL=overlay.js.map