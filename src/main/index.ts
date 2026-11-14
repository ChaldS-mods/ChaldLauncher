import { app, BrowserWindow, safeStorage, screen, session, shell } from 'electron';
import { OverlayManager } from './overlay';
import * as fs from 'node:fs';
import * as path from 'node:path';
import type { IpcEvents } from '../shared/ipc';
import { registerIpc } from './ipc';
import { Services } from './services';
import { fitWindowSize } from './windowSize';

// Linux: the session decides (native Wayland on Wayland, X11 on X11). CHALD_OZONE=x11 forces X11/XWayland, where the overlay
// can be raised above a fullscreen game more reliably; CHALD_OZONE=wayland forces native Wayland.
if (process.platform === 'linux' && (process.env.CHALD_OZONE === 'x11' || process.env.CHALD_OZONE === 'wayland')) {
  app.commandLine.appendSwitch('ozone-platform', process.env.CHALD_OZONE);
}

const DEV_URL = process.env.VITE_DEV_SERVER_URL ?? '';
const isDev = !app.isPackaged && DEV_URL !== '';

/**
 * Второй экземпляр для тестов (звонки, друзья, чат между двумя аккаунтами):
 *   CHALD_PROFILE=test2 electron .      или      electron . --profile=test2
 * У профиля свои данные (userData), поэтому защита от второго запуска его не блокирует. Сборки и аккаунты у профиля свои.
 */
const PROFILE = (process.env.CHALD_PROFILE ?? process.argv.find((a) => a.startsWith('--profile='))?.slice('--profile='.length) ?? '')
  .replace(/[^A-Za-z0-9_-]/g, '')
  .slice(0, 24);
if (PROFILE) app.setPath('userData', path.join(app.getPath('appData'), `${app.getName()}-${PROFILE}`));

/**
 * Linux: if the GPU process keeps crashing (a broken Mesa/GBM install, for example an unreadable /usr/lib/gbm/dri_gbm.so),
 * remember it and start with software rendering next time instead of going through the crash loop on every launch.
 * CHALD_GPU=1 forces the hardware GPU again; deleting `gpu-crashed.flag` in the data folder does the same.
 */
const gpuFlagFile = path.join(app.getPath('userData'), 'gpu-crashed.flag');
if (process.platform === 'linux' && process.env.CHALD_GPU !== '1') {
  try {
    if (fs.existsSync(gpuFlagFile)) app.disableHardwareAcceleration();
  } catch { /* ignore */ }
}
let gpuCrashes = 0;
app.on('child-process-gone', (_e, details) => {
  if (details.type !== 'GPU' || details.reason === 'clean-exit') return;
  gpuCrashes++;
  if (gpuCrashes >= 2 && process.platform === 'linux') {
    try {
      fs.writeFileSync(gpuFlagFile, `${new Date().toISOString()} ${details.reason} ${details.exitCode}\n`, 'utf8');
      console.warn('[gpu] видеопроцесс падает: со следующего запуска включена программная отрисовка (CHALD_GPU=1 вернёт GPU)');
    } catch { /* ignore */ }
  }
});

let mainWindow: BrowserWindow | null = null;
let services: Services;
let overlay: OverlayManager;

function emit<K extends keyof IpcEvents>(channel: K, payload: IpcEvents[K]): void {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(channel, payload);
}

function openExternalSafe(url: string): void {
  try {
    const u = new URL(url);
    if (u.protocol === 'https:') void shell.openExternal(u.toString());
  } catch {
    /* ignore invalid URL */
  }
}

function createWindow(): void {
  // Already open: just focus (second-instance / activate must not spawn a second main window).
  if (mainWindow && !mainWindow.isDestroyed()) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
    return;
  }
  mainWindow = new BrowserWindow({
    ...fitWindowSize(screen.getPrimaryDisplay().workAreaSize),
    frame: false,
    show: false,
    backgroundColor: '#020D18',
    title: PROFILE ? `ChaldLauncher [${PROFILE}]` : 'ChaldLauncher',
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload', 'index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
    },
  });
  mainWindow.once('ready-to-show', () => mainWindow?.show());
  // Fallback: some environments never fire ready-to-show and the window stays invisible forever.
  setTimeout(() => {
    if (mainWindow && !mainWindow.isDestroyed() && !mainWindow.isVisible()) {
      console.warn('[window] ready-to-show не сработал — показываю окно принудительно');
      mainWindow.show();
    }
  }, 4000);

  // The renderer never navigates and never opens windows: external links go through the OS browser (https only).
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    openExternalSafe(url);
    return { action: 'deny' };
  });
  mainWindow.webContents.on('will-navigate', (e, url) => {
    const allowed = isDev ? url.startsWith(DEV_URL) : url.startsWith('file://');
    if (!allowed) e.preventDefault();
  });
  mainWindow.webContents.on('did-fail-load', (_e, code, desc, url, isMainFrame) => {
    if (!isMainFrame) return;
    if (mainWindow && !mainWindow.isDestroyed() && !mainWindow.isVisible()) mainWindow.show();
    if (isDev && code === -102) {
      setTimeout(() => {
        if (mainWindow && !mainWindow.isDestroyed()) void mainWindow.loadURL(DEV_URL);
      }, 1500);
      return;
    }
    console.error(`[window] load failed (${code}): ${desc} — ${url}`);
  });
  mainWindow.on('close', (e) => {
    if (services?.closeBehavior === 'minimize-while-playing' && services.games.runningCount() > 0) {
      e.preventDefault();
      mainWindow?.minimize();
    }
  });
  mainWindow.on('closed', () => {
    mainWindow = null;
    // The overlay keeps a hidden BrowserWindow alive, so `window-all-closed` never fires.
    // On Windows/Linux closing the main window must quit the app.
    if (process.platform !== 'darwin') app.quit();
  });

  if (isDev) {
    void mainWindow.loadURL(DEV_URL);
  } else {
    void mainWindow.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
  }
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (app.isReady()) createWindow();
  });

  // Тот же идентификатор, что у ярлыков установщика (build.appId в package.json): иначе значок в панели задач не совпадёт с ярлыком.
  if (process.platform === 'win32') app.setAppUserModelId('studio.chald.launcher');

  void app.whenReady().then(async () => {
    session.defaultSession.setPermissionRequestHandler((_wc, perm, cb) => {
      if (perm === 'media') cb(true);
      else cb(false);
    });
    if (!isDev) {
      session.defaultSession.webRequest.onHeadersReceived((details, cb) => {
        cb({
          responseHeaders: {
            ...details.responseHeaders,
            'Content-Security-Policy': ["default-src 'self'; img-src 'self' data: https://mc-heads.net; style-src 'self' 'unsafe-inline'; font-src 'self' data:; script-src 'self'; connect-src 'none'; object-src 'none'; base-uri 'none'"],
          },
        });
      });
    }

    services = new Services({
      dataDir: app.getPath('userData'),
      appVersion: app.getVersion(),
      box: safeStorage,
      emit,
      openExternal: openExternalSafe,
    });
    try {
      await services.init();
    } catch (err) {
      console.error('[boot] services.init failed', err);
    }
    overlay = new OverlayManager(isDev, DEV_URL);
    const { updater } = registerIpc(services, isDev ? [DEV_URL] : ['file://'], {
      toggleOverlay: () => overlay.toggle(),
      showOverlay: () => overlay.showWindow(),
      startCallOverlay: (userId, name, mcName, groupId, memberIds) =>
        overlay.startCall(userId, name, mcName, groupId, memberIds),
      setCallPhase: (phase) => overlay.setCallPhase(phase),
    });
    createWindow();
    // у профиля своя горячая клавиша, чтобы два оверлея не спорили за Ctrl+Shift+O
    overlay.registerHotkey(PROFILE ? 'CommandOrControl+Alt+O' : 'CommandOrControl+Shift+O');
    overlay.ensureBackground();

    // A downloaded update is applied when the launcher is closed (if the user did not switch that off).
    // Closing is held for a moment, but never longer than 15 s: a stuck update must not trap the launcher open.
    let closing = false;
    app.on('before-quit', (e) => {
      overlay?.dispose();
      if (closing || isDev) return;
      closing = true;
      e.preventDefault();
      const timeout = new Promise<void>((resolve) => setTimeout(resolve, 15000));
      void Promise.race([updater.installOnQuit().then(() => undefined), timeout]).finally(() => app.quit());
    });

    app.on('activate', () => {
      createWindow();
    });
  });

  // clear the Discord status right away instead of leaving it hanging
  app.on('will-quit', () => {
    if (services) services.presence.dispose();
  });

  // Overlay is a persistent BrowserWindow, so this event is unreliable; mainWindow 'closed' handles quit on Win/Linux.
  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin' && (!mainWindow || mainWindow.isDestroyed())) app.quit();
  });
}
