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
exports.SettingsStore = exports.DEFAULT_SETTINGS = void 0;
const path = __importStar(require("node:path"));
const dns_1 = require("../shared/dns");
const theme_1 = require("../shared/theme");
const schemas_1 = require("../shared/schemas");
const errors_1 = require("./errors");
const storage_1 = require("./storage");
exports.DEFAULT_SETTINGS = {
    instancesDir: '',
    downloadsDir: '',
    javaPath: '',
    memoryMinMb: 1024,
    memoryMaxMb: 4096,
    memoryAuto: true,
    jvmArgs: '-XX:+UseG1GC',
    width: 1280,
    height: 720,
    fullscreen: false,
    closeBehavior: 'quit',
    checkUpdates: true,
    autoDownloadUpdates: true,
    updateRepo: '',
    uiSounds: true,
    soundVolume: 50,
    discordRpc: true,
    discordShowInstance: true,
    themeBg: theme_1.DEFAULT_THEME.bg,
    themeAccent: theme_1.DEFAULT_THEME.accent,
    themeSecondary: theme_1.DEFAULT_THEME.secondary,
    themeHighlight: theme_1.DEFAULT_THEME.highlight,
    uiScale: 100,
    cornerStyle: 'normal',
    glow: 100,
    fontMode: 'pixel',
    animations: true,
    compactSidebar: false,
    hiddenPages: [],
    sidebarSide: 'left',
    panelSide: 'right',
    panelWidth: 380,
    showStatusBar: true,
    customCss: '',
    customHtml: '',
    dnsMode: 'system',
    dnsServers: dns_1.DEFAULT_DNS_SERVERS,
    dnsDohUrl: dns_1.DEFAULT_DOH_URL,
    msClientId: '',
    accountMode: 'microsoft',
    offlineName: '',
    lastInstanceId: null,
    language: 'ru',
};
class SettingsStore {
    file;
    cache = null;
    constructor(file) {
        this.file = file;
    }
    async get() {
        if (this.cache)
            return this.cache;
        let stored = null;
        try {
            stored = await (0, storage_1.readJson)(this.file);
        }
        catch {
            stored = null; // corrupted file: fall back to defaults, do not crash
        }
        const merged = { ...exports.DEFAULT_SETTINGS, ...(typeof stored === 'object' && stored ? stored : {}) };
        const parsed = schemas_1.appSettingsSchema.safeParse(merged);
        this.cache = parsed.success ? parsed.data : { ...exports.DEFAULT_SETTINGS };
        return this.cache;
    }
    async set(patch) {
        const p = schemas_1.appSettingsPatchSchema.safeParse(patch);
        if (!p.success)
            throw new errors_1.AppError('SETTINGS_INVALID', p.error.issues[0]?.message ?? 'Некорректные настройки');
        const next = { ...(await this.get()), ...p.data };
        const full = schemas_1.appSettingsSchema.safeParse(next);
        if (!full.success)
            throw new errors_1.AppError('SETTINGS_INVALID', full.error.issues[0]?.message ?? 'Некорректные настройки');
        for (const key of ['instancesDir', 'downloadsDir']) {
            const v = full.data[key];
            if (v && !path.isAbsolute(v))
                throw new errors_1.AppError('SETTINGS_INVALID', 'Путь к папке должен быть абсолютным');
        }
        if (full.data.javaPath && !path.isAbsolute(full.data.javaPath)) {
            throw new errors_1.AppError('SETTINGS_INVALID', 'Путь к Java должен быть абсолютным');
        }
        await (0, storage_1.writeJsonAtomic)(this.file, full.data);
        this.cache = full.data;
        return full.data;
    }
}
exports.SettingsStore = SettingsStore;
//# sourceMappingURL=settings.js.map