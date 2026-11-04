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
exports.MojangGames = exports.findStoreLauncher = exports.findBedrock = exports.APPX_SCRIPT = void 0;
exports.parseAppx = parseAppx;
exports.launcherExeCandidates = launcherExeCandidates;
const path = __importStar(require("node:path"));
const mojang_1 = require("../shared/mojang");
const errors_1 = require("./errors");
/** Lists Minecraft-related Store packages with the first application id of each (needed to start a Store app). */
exports.APPX_SCRIPT = `
$ErrorActionPreference = 'SilentlyContinue'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$list = @(Get-AppxPackage | Where-Object { $_.Name -match 'Minecraft|4297127D64EC6' } | ForEach-Object {
  $id = (Get-AppxPackageManifest -Package $_.PackageFullName).Package.Applications.Application | Select-Object -First 1 -ExpandProperty Id
  [pscustomobject]@{ Name = $_.Name; Family = $_.PackageFamilyName; AppId = $id }
})
ConvertTo-Json -InputObject $list -Compress
`;
const SAFE_PART = /^[A-Za-z0-9._-]{1,128}$/;
function parseAppx(stdout) {
    const text = stdout.trim().replace(/^\uFEFF/, '');
    if (!text)
        return [];
    let raw;
    try {
        raw = JSON.parse(text);
    }
    catch {
        return [];
    }
    const items = Array.isArray(raw) ? raw : [raw];
    const out = [];
    for (const it of items) {
        if (!it || typeof it !== 'object')
            continue;
        const o = it;
        if (typeof o.Name !== 'string' || typeof o.Family !== 'string' || !SAFE_PART.test(o.Family))
            continue;
        out.push({ name: o.Name, family: o.Family, appId: typeof o.AppId === 'string' && SAFE_PART.test(o.AppId) ? o.AppId : null });
    }
    return out;
}
const findBedrock = (pkgs) => pkgs.find((p) => p.name === 'Microsoft.MinecraftUWP');
exports.findBedrock = findBedrock;
const findStoreLauncher = (pkgs) => pkgs.find((p) => /4297127D64EC6|MinecraftLauncher/i.test(p.name));
exports.findStoreLauncher = findStoreLauncher;
/** Standalone (MSI) installs of the official launcher live in Program Files. */
function launcherExeCandidates(env) {
    const roots = [env['ProgramFiles(x86)'], env['ProgramFiles']].filter((x) => !!x);
    return roots.map((r) => path.win32.join(r, 'Minecraft Launcher', 'MinecraftLauncher.exe'));
}
class MojangGames {
    d;
    constructor(d) {
        this.d = d;
    }
    async scan() {
        let pkgs = [];
        try {
            pkgs = parseAppx(await this.d.powershell(exports.APPX_SCRIPT));
        }
        catch {
            pkgs = []; // PowerShell missing or blocked: the games are shown as "not found", the page still works
        }
        const bedrock = (0, exports.findBedrock)(pkgs);
        const store = (0, exports.findStoreLauncher)(pkgs);
        let launcher = null;
        for (const file of launcherExeCandidates(this.d.env)) {
            if (await this.d.exists(file).catch(() => false)) {
                launcher = { kind: 'exe', file };
                break;
            }
        }
        if (!launcher && store?.appId)
            launcher = { kind: 'store', aumid: `${store.family}!${store.appId}` };
        return { bedrock, launcher };
    }
    async status() {
        if (this.d.platform !== 'win32') {
            return { supported: false, launcherFound: false, games: [] };
        }
        const { bedrock, launcher } = await this.scan();
        return {
            supported: true,
            launcherFound: launcher !== null,
            games: [
                { id: 'bedrock', via: 'direct', state: bedrock ? 'ready' : 'missing' },
                { id: 'dungeons', via: 'launcher', state: launcher ? 'ready' : 'missing' },
                { id: 'legends', via: 'launcher', state: launcher ? 'ready' : 'missing' },
            ],
        };
    }
    async launch(game, server) {
        this.requireWindows();
        if (game === 'bedrock') {
            const { bedrock } = await this.scan();
            if (!bedrock)
                throw new errors_1.AppError('MOJANG_NOT_FOUND', 'Minecraft Bedrock не найден на этом компьютере. Получи его в Microsoft Store.');
            let uri = (0, mojang_1.bedrockUri)();
            if (server) {
                const s = (0, mojang_1.parseBedrockServer)(server);
                if (!s)
                    throw new errors_1.AppError('MOJANG_BAD_SERVER', 'Некорректный сервер: имя до 32 символов (латиница, цифры, пробел, _ . -), адрес — домен или IPv4, порт 1–65535.');
                uri = (0, mojang_1.bedrockUri)(s);
            }
            await this.d.openUri(uri);
            return;
        }
        // Dungeons and Legends are started from the official Minecraft Launcher
        const { launcher } = await this.scan();
        if (!launcher)
            throw new errors_1.AppError('MOJANG_NOT_FOUND', 'Официальный Minecraft Launcher не найден на этом компьютере. Получи его в Microsoft Store.');
        if (launcher.kind === 'exe')
            this.d.spawnDetached(launcher.file, []);
        else
            this.d.spawnDetached('explorer.exe', [`shell:AppsFolder\\${launcher.aumid}`]);
    }
    async openStore(game) {
        this.requireWindows();
        await this.d.openUri((0, mojang_1.storeUri)(game === 'bedrock' ? 'bedrock' : 'launcher'));
    }
    requireWindows() {
        if (this.d.platform !== 'win32')
            throw new errors_1.AppError('MOJANG_UNSUPPORTED', 'Эти игры запускаются только в Windows.');
    }
}
exports.MojangGames = MojangGames;
//# sourceMappingURL=mojangGames.js.map