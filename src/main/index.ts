import { app, BrowserWindow, safeStorage, session, shell } from 'electron';
import * as path from 'node:path';
import type { IpcEvents } from '../shared/ipc';
import { registerIpc } from './ipc';
import { Services } from './services';

const DEV_URL = process.env.VITE_DEV_SERVER_URL ?? '';
const isDev = !app.isPackaged && DEV_URL !== '';

let mainWindow: BrowserWindow | null = null;
let services: Services;

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
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 780,
    minWidth: 1040,
    minHeight: 660,
    frame: false,
    show: false,
    backgroundColor: '#020D18',
    title: 'ChaldLauncher',
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload', 'index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
    },
  });
  mainWindow.once('ready-to-show', () => mainWindow?.show());

  // The renderer never navigates and never opens windows: external links go through the OS browser (https only).
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    openExternalSafe(url);
    return { action: 'deny' };
  });
  mainWindow.webContents.on('will-navigate', (e, url) => {
    const allowed = isDev ? url.startsWith(DEV_URL) : url.startsWith('file://');
    if (!allowed) e.preventDefault();
  });
  mainWindow.on('close', (e) => {
    if (services.closeBehavior === 'minimize-while-playing' && services.games.runningCount() > 0) {
      e.preventDefault();
      mainWindow?.minimize();
    }
  });
  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  if (isDev) void mainWindow.loadURL(DEV_URL);
  else void mainWindow.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  // Тот же идентификатор, что у ярлыков установщика (build.appId в package.json): иначе значок в панели задач не совпадёт с ярлыком.
  if (process.platform === 'win32') app.setAppUserModelId('studio.chald.launcher');

  void app.whenReady().then(async () => {
    session.defaultSession.setPermissionRequestHandler((_wc, _perm, cb) => cb(false));
    if (!isDev) {
      session.defaultSession.webRequest.onHeadersReceived((details, cb) => {
        cb({
          responseHeaders: {
            ...details.responseHeaders,
            'Content-Security-Policy': ["default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; font-src 'self' data:; script-src 'self'; connect-src 'none'; object-src 'none'; base-uri 'none'"],
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
    await services.init();
    registerIpc(services, isDev ? [DEV_URL] : ['file://']);
    createWindow();

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });
}
