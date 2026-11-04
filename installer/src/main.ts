import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron';
import type { IpcMainInvokeEvent } from 'electron';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { pathToFileURL } from 'node:url';
import { spawn } from 'node:child_process';
import { readHeader } from './payload';
import type { PayloadHeader } from './payload';
import { defaultInstallDir, findExistingInstall, freeSpace, humanizeError, install, resolveInstallDir } from './setup';
import type { InstallEnv, InstallOptions, InstallProgress } from './setup';

interface Cli {
  silent: boolean;
  dir?: string;
  desktop: boolean;
  startMenu: boolean;
  launch: boolean;
}

/** Параметры командной строки: --silent (или /S), --dir <папка>, --no-desktop, --no-start-menu, --launch. */
function parseArgs(args: string[]): Cli {
  const cli: Cli = { silent: false, desktop: true, startMenu: true, launch: false };
  for (let i = 0; i < args.length; i++) {
    const a = args[i] ?? '';
    if (a === '--silent' || a === '/S' || a === '/s') cli.silent = true;
    else if (a === '--no-desktop') cli.desktop = false;
    else if (a === '--no-start-menu') cli.startMenu = false;
    else if (a === '--launch') cli.launch = true;
    else if (a.startsWith('--dir=')) cli.dir = a.slice(6);
    else if (a === '--dir' && args[i + 1]) cli.dir = args[++i];
  }
  return cli;
}

const cli = parseArgs(process.argv.slice(app.isPackaged ? 1 : 2));
const UI_DIR = path.join(__dirname, 'ui');
const UI_URL = pathToFileURL(UI_DIR).href;

let win: BrowserWindow | null = null;
let header: PayloadHeader | null = null;
let abort: AbortController | null = null;
let lastInstall: { dir: string; exePath: string } | null = null;

function payloadFile(): string {
  return app.isPackaged ? path.join(process.resourcesPath, 'payload.chpk') : path.join(__dirname, '..', 'payload', 'payload.chpk');
}

async function loadHeader(): Promise<PayloadHeader> {
  if (!header) {
    if (!fs.existsSync(payloadFile())) throw new Error('Не найден файл с данными установщика (payload.chpk).');
    header = await readHeader(payloadFile());
  }
  return header;
}

function makeEnv(appId: string): InstallEnv {
  return {
    payloadFile: payloadFile(),
    platform: process.platform,
    desktopDir: app.getPath('desktop'),
    startMenuProgramsDir: path.join(app.getPath('appData'), 'Microsoft', 'Windows', 'Start Menu', 'Programs'),
    createShortcut: (lnk, target, cwd, description) =>
      shell.writeShortcutLink(lnk, 'create', { target, cwd, description, icon: target, iconIndex: 0, appUserModelId: appId }),
  };
}

/**
 * Electron считает файлы *.asar архивами и не даёт читать и писать их как обычные файлы («Invalid package»).
 * Лаунчер лежит в resources\app.asar, поэтому на время установки отключаем эту подмену в модуле fs.
 * Включать её надолго нельзя: интерфейс и preload самого установщика тоже лежат в app.asar.
 */
async function withoutAsar<T>(fn: () => Promise<T>): Promise<T> {
  process.noAsar = true;
  try {
    return await fn();
  } finally {
    process.noAsar = false;
  }
}

function launchApp(exePath: string, cwd: string): void {
  const child = spawn(exePath, [], { cwd, detached: true, stdio: 'ignore' });
  child.on('error', () => undefined);
  child.unref();
}

function trusted(e: IpcMainInvokeEvent): boolean {
  const url = e.senderFrame?.url ?? '';
  return url.startsWith(UI_URL);
}

function validDir(v: unknown): v is string {
  return typeof v === 'string' && v.length > 0 && v.length <= 240 && !v.includes('\0') && path.isAbsolute(v);
}

function createWindow(): void {
  win = new BrowserWindow({
    width: 780,
    height: 500,
    resizable: false,
    maximizable: false,
    fullscreenable: false,
    frame: false,
    show: false,
    center: true,
    backgroundColor: '#020D18',
    title: 'Установка ChaldLauncher',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
    },
  });
  win.once('ready-to-show', () => win?.show());
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', (e) => e.preventDefault());
  win.on('close', (e) => {
    if (abort) e.preventDefault(); // во время установки закрыть можно только кнопкой «Отмена»
  });
  win.on('closed', () => {
    win = null;
  });
  void win.loadFile(path.join(UI_DIR, 'index.html'));
}

function registerIpc(): void {
  ipcMain.handle('setup:info', async (e) => {
    if (!trusted(e)) return { error: 'Запрещено' };
    try {
      const h = await loadHeader();
      const existing = await findExistingInstall(h.meta);
      return {
        productName: h.meta.productName,
        version: h.meta.version,
        publisher: h.meta.publisher,
        totalSize: h.totalSize,
        defaultDir: existing?.dir ?? defaultInstallDir(h.meta),
        existing,
        cli: { desktop: cli.desktop, startMenu: cli.startMenu },
      };
    } catch (err) {
      return { error: humanizeError(err) };
    }
  });

  ipcMain.handle('setup:chooseDir', async (e, current: unknown) => {
    if (!trusted(e)) return null;
    const h = await loadHeader();
    const opts = { title: 'Папка установки', properties: ['openDirectory', 'createDirectory'] as Array<'openDirectory' | 'createDirectory'>, defaultPath: validDir(current) ? current : undefined };
    const r = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts);
    const picked = r.filePaths[0];
    if (r.canceled || !picked) return null;
    // Как в обычных установщиках: к выбранной папке добавляем имя программы.
    return path.basename(picked).toLowerCase() === h.meta.productName.toLowerCase() ? picked : path.join(picked, h.meta.productName);
  });

  ipcMain.handle('setup:checkDir', async (e, dir: unknown) => {
    if (!trusted(e) || !validDir(dir)) return { error: 'Некорректная папка' };
    try {
      const h = await loadHeader();
      const finalDir = resolveInstallDir(dir, h.meta.productName);
      const need = Math.ceil(h.totalSize * 1.05) + 50 * 1024 * 1024;
      const free = await freeSpace(finalDir);
      return { dir: finalDir, need, free, enough: free === null || free >= need };
    } catch (err) {
      return { error: humanizeError(err) };
    }
  });

  ipcMain.handle('setup:install', async (e, raw: unknown) => {
    if (!trusted(e)) return { ok: false, error: 'Запрещено' };
    if (abort) return { ok: false, error: 'Установка уже идёт' };
    const o = raw as Partial<InstallOptions> | null;
    if (!o || !validDir(o.dir)) return { ok: false, error: 'Некорректная папка установки' };
    const opts: InstallOptions = { dir: o.dir, desktopShortcut: o.desktopShortcut === true, startMenuShortcut: o.startMenuShortcut === true };
    abort = new AbortController();
    let last = 0;
    let lastPhase = '';
    const report = (p: InstallProgress): void => {
      const now = Date.now();
      if (p.phase === lastPhase && p.percent < 100 && now - last < 60) return;
      last = now;
      lastPhase = p.phase;
      if (win && !win.isDestroyed()) win.webContents.send('setup:progress', p);
    };
    try {
      const h = await loadHeader();
      const signal = abort.signal;
      const r = await withoutAsar(() => install(opts, makeEnv(h.meta.appId), report, signal));
      lastInstall = { dir: r.dir, exePath: r.exePath };
      return { ok: true, dir: r.dir, warnings: r.warnings };
    } catch (err) {
      if (abort?.signal.aborted) return { ok: false, cancelled: true, error: 'Установка отменена' };
      return { ok: false, error: humanizeError(err) };
    } finally {
      abort = null;
    }
  });

  ipcMain.handle('setup:cancel', (e) => {
    if (trusted(e)) abort?.abort();
  });

  ipcMain.handle('setup:launch', (e) => {
    if (!trusted(e) || !lastInstall) return;
    launchApp(lastInstall.exePath, lastInstall.dir);
    app.quit();
  });

  ipcMain.handle('setup:minimize', (e) => {
    if (trusted(e)) win?.minimize();
  });
  ipcMain.handle('setup:close', (e) => {
    if (trusted(e) && !abort) win?.close();
  });
}

async function runSilent(): Promise<void> {
  const log = path.join(app.getPath('temp'), 'ChaldLauncher-Setup.log');
  const write = (m: string): void => fs.appendFileSync(log, `${new Date().toISOString()} ${m}\n`);
  try {
    const h = await loadHeader();
    const existing = await findExistingInstall(h.meta);
    const dir = cli.dir ?? existing?.dir ?? defaultInstallDir(h.meta);
    if (!path.isAbsolute(dir)) throw new Error('--dir должен быть абсолютным путём');
    const r = await withoutAsar(() => install({ dir, desktopShortcut: cli.desktop, startMenuShortcut: cli.startMenu }, makeEnv(h.meta.appId)));
    write(`OK ${r.version} -> ${r.dir}${r.warnings.length ? ` (${r.warnings.join('; ')})` : ''}`);
    if (cli.launch) launchApp(r.exePath, r.dir);
    app.exit(0);
  } catch (e) {
    write(`ERROR ${humanizeError(e)}`);
    app.exit(1);
  }
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (win) {
      if (win.isMinimized()) win.restore();
      win.focus();
    }
  });
  void app.whenReady().then(() => {
    app.setAppUserModelId('studio.chald.installer');
    if (cli.silent) {
      void runSilent();
      return;
    }
    registerIpc();
    createWindow();
  });
  app.on('window-all-closed', () => {
    if (!cli.silent) app.quit();
  });
}
