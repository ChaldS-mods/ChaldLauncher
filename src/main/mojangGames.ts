import * as path from 'node:path';
import { bedrockUri, parseBedrockServer, storeUri, type MojangGameId, type MojangStatus } from '../shared/mojang';
import { AppError } from './errors';

/** What PowerShell reports about an installed Store package. */
export interface AppxPkg {
  name: string;
  family: string;
  appId: string | null;
}

/** Everything that touches the system, so the logic can be tested without Windows. */
export interface MojangDeps {
  platform: NodeJS.Platform;
  env: NodeJS.ProcessEnv;
  /** runs PowerShell with the script and returns stdout */
  powershell(script: string): Promise<string>;
  exists(file: string): Promise<boolean>;
  /** opens a URI with its registered handler (minecraft:, ms-windows-store:) */
  openUri(uri: string): Promise<void>;
  /** starts a program and does not wait for it */
  spawnDetached(file: string, args: string[]): void;
}

/** Lists Minecraft-related Store packages with the first application id of each (needed to start a Store app). */
export const APPX_SCRIPT = `
$ErrorActionPreference = 'SilentlyContinue'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$list = @(Get-AppxPackage | Where-Object { $_.Name -match 'Minecraft|4297127D64EC6' } | ForEach-Object {
  $id = (Get-AppxPackageManifest -Package $_.PackageFullName).Package.Applications.Application | Select-Object -First 1 -ExpandProperty Id
  [pscustomobject]@{ Name = $_.Name; Family = $_.PackageFamilyName; AppId = $id }
})
ConvertTo-Json -InputObject $list -Compress
`;

const SAFE_PART = /^[A-Za-z0-9._-]{1,128}$/;

export function parseAppx(stdout: string): AppxPkg[] {
  const text = stdout.trim().replace(/^\uFEFF/, '');
  if (!text) return [];
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return [];
  }
  const items = Array.isArray(raw) ? raw : [raw];
  const out: AppxPkg[] = [];
  for (const it of items) {
    if (!it || typeof it !== 'object') continue;
    const o = it as Record<string, unknown>;
    if (typeof o.Name !== 'string' || typeof o.Family !== 'string' || !SAFE_PART.test(o.Family)) continue;
    out.push({ name: o.Name, family: o.Family, appId: typeof o.AppId === 'string' && SAFE_PART.test(o.AppId) ? o.AppId : null });
  }
  return out;
}

export const findBedrock = (pkgs: AppxPkg[]): AppxPkg | undefined => pkgs.find((p) => p.name === 'Microsoft.MinecraftUWP');
export const findStoreLauncher = (pkgs: AppxPkg[]): AppxPkg | undefined => pkgs.find((p) => /4297127D64EC6|MinecraftLauncher/i.test(p.name));

type LauncherTarget = { kind: 'exe'; file: string } | { kind: 'store'; aumid: string };

/** Standalone (MSI) installs of the official launcher live in Program Files. */
export function launcherExeCandidates(env: NodeJS.ProcessEnv): string[] {
  const roots = [env['ProgramFiles(x86)'], env['ProgramFiles']].filter((x): x is string => !!x);
  return roots.map((r) => path.win32.join(r, 'Minecraft Launcher', 'MinecraftLauncher.exe'));
}

export class MojangGames {
  constructor(private d: MojangDeps) {}

  private async scan(): Promise<{ bedrock: AppxPkg | undefined; launcher: LauncherTarget | null }> {
    let pkgs: AppxPkg[] = [];
    try {
      pkgs = parseAppx(await this.d.powershell(APPX_SCRIPT));
    } catch {
      pkgs = []; // PowerShell missing or blocked: the games are shown as "not found", the page still works
    }
    const bedrock = findBedrock(pkgs);
    const store = findStoreLauncher(pkgs);
    let launcher: LauncherTarget | null = null;
    for (const file of launcherExeCandidates(this.d.env)) {
      if (await this.d.exists(file).catch(() => false)) {
        launcher = { kind: 'exe', file };
        break;
      }
    }
    if (!launcher && store?.appId) launcher = { kind: 'store', aumid: `${store.family}!${store.appId}` };
    return { bedrock, launcher };
  }

  async status(): Promise<MojangStatus> {
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

  async launch(game: MojangGameId, server?: { name: string; host: string; port: number }): Promise<void> {
    this.requireWindows();
    if (game === 'bedrock') {
      const { bedrock } = await this.scan();
      if (!bedrock) throw new AppError('MOJANG_NOT_FOUND', 'Minecraft Bedrock не найден на этом компьютере. Получи его в Microsoft Store.');
      let uri = bedrockUri();
      if (server) {
        const s = parseBedrockServer(server);
        if (!s) throw new AppError('MOJANG_BAD_SERVER', 'Некорректный сервер: имя до 32 символов (латиница, цифры, пробел, _ . -), адрес — домен или IPv4, порт 1–65535.');
        uri = bedrockUri(s);
      }
      await this.d.openUri(uri);
      return;
    }
    // Dungeons and Legends are started from the official Minecraft Launcher
    const { launcher } = await this.scan();
    if (!launcher) throw new AppError('MOJANG_NOT_FOUND', 'Официальный Minecraft Launcher не найден на этом компьютере. Получи его в Microsoft Store.');
    if (launcher.kind === 'exe') this.d.spawnDetached(launcher.file, []);
    else this.d.spawnDetached('explorer.exe', [`shell:AppsFolder\\${launcher.aumid}`]);
  }

  async openStore(game: MojangGameId): Promise<void> {
    this.requireWindows();
    await this.d.openUri(storeUri(game === 'bedrock' ? 'bedrock' : 'launcher'));
  }

  private requireWindows(): void {
    if (this.d.platform !== 'win32') throw new AppError('MOJANG_UNSUPPORTED', 'Эти игры запускаются только в Windows.');
  }
}
