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
const electron_1 = require("electron");
const path = __importStar(require("node:path"));
const ipc_1 = require("./ipc");
const services_1 = require("./services");
const windowSize_1 = require("./windowSize");
const DEV_URL = process.env.VITE_DEV_SERVER_URL ?? '';
const isDev = !electron_1.app.isPackaged && DEV_URL !== '';
let mainWindow = null;
let services;
function emit(channel, payload) {
    if (mainWindow && !mainWindow.isDestroyed())
        mainWindow.webContents.send(channel, payload);
}
function openExternalSafe(url) {
    try {
        const u = new URL(url);
        if (u.protocol === 'https:')
            void electron_1.shell.openExternal(u.toString());
    }
    catch {
        /* ignore invalid URL */
    }
}
function createWindow() {
    mainWindow = new electron_1.BrowserWindow({
        ...(0, windowSize_1.fitWindowSize)(electron_1.screen.getPrimaryDisplay().workAreaSize),
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
        if (!allowed)
            e.preventDefault();
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
    if (isDev)
        void mainWindow.loadURL(DEV_URL);
    else
        void mainWindow.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
}
if (!electron_1.app.requestSingleInstanceLock()) {
    electron_1.app.quit();
}
else {
    electron_1.app.on('second-instance', () => {
        if (mainWindow) {
            if (mainWindow.isMinimized())
                mainWindow.restore();
            mainWindow.focus();
        }
    });
    // Тот же идентификатор, что у ярлыков установщика (build.appId в package.json): иначе значок в панели задач не совпадёт с ярлыком.
    if (process.platform === 'win32')
        electron_1.app.setAppUserModelId('studio.chald.launcher');
    void electron_1.app.whenReady().then(async () => {
        electron_1.session.defaultSession.setPermissionRequestHandler((_wc, _perm, cb) => cb(false));
        if (!isDev) {
            electron_1.session.defaultSession.webRequest.onHeadersReceived((details, cb) => {
                cb({
                    responseHeaders: {
                        ...details.responseHeaders,
                        'Content-Security-Policy': ["default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; font-src 'self' data:; script-src 'self'; connect-src 'none'; object-src 'none'; base-uri 'none'"],
                    },
                });
            });
        }
        services = new services_1.Services({
            dataDir: electron_1.app.getPath('userData'),
            appVersion: electron_1.app.getVersion(),
            box: electron_1.safeStorage,
            emit,
            openExternal: openExternalSafe,
        });
        await services.init();
        (0, ipc_1.registerIpc)(services, isDev ? [DEV_URL] : ['file://']);
        createWindow();
        electron_1.app.on('activate', () => {
            if (electron_1.BrowserWindow.getAllWindows().length === 0)
                createWindow();
        });
    });
    // clear the Discord status right away instead of leaving it hanging
    electron_1.app.on('will-quit', () => {
        if (services)
            services.presence.dispose();
    });
    electron_1.app.on('window-all-closed', () => {
        if (process.platform !== 'darwin')
            electron_1.app.quit();
    });
}
//# sourceMappingURL=index.js.map