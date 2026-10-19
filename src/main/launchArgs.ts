import * as path from 'node:path';
import { AppError } from './errors';
import { rulesAllow, resolveLibraries, type ArgItem, type Platform, type VersionJson } from './versionJson';

export interface LaunchAuth {
  name: string;
  uuid: string;
  accessToken: string;
  /** 'msa' for Microsoft accounts, 'legacy' for offline */
  userType?: 'msa' | 'legacy';
}

export interface LaunchInput {
  version: VersionJson;
  platform: Platform;
  javaPath: string;
  gameDir: string;
  assetsDir: string;
  librariesDir: string;
  nativesDir: string;
  clientJar: string;
  auth: LaunchAuth;
  memoryMinMb: number;
  memoryMaxMb: number;
  extraJvmArgs: string[];
  resolution: { width: number; height: number } | null;
  fullscreen: boolean;
  launcherName: string;
  launcherVersion: string;
  /** overrides ${version_name} (Forge-like loaders need the vanilla version id here) */
  versionName?: string;
}

export interface LaunchCommand {
  command: string;
  args: string[];
  cwd: string;
  secrets: string[];
}

/** Split an argument string honoring simple "double" and 'single' quotes. No shell is ever involved. */
export function splitArgs(input: string): string[] {
  const out: string[] = [];
  let cur = '';
  let quote: '"' | "'" | null = null;
  let has = false;
  for (const ch of input) {
    if (quote) {
      if (ch === quote) quote = null;
      else cur += ch;
    } else if (ch === '"' || ch === "'") {
      quote = ch;
      has = true;
    } else if (/\s/.test(ch)) {
      if (has || cur) out.push(cur);
      cur = '';
      has = false;
    } else {
      cur += ch;
      has = true;
    }
  }
  if (quote) throw new AppError('ARGS_INVALID', 'Незакрытая кавычка в аргументах JVM');
  if (has || cur) out.push(cur);
  return out;
}

function flatten(items: ArgItem[] | undefined, ctx: Parameters<typeof rulesAllow>[1]): string[] {
  const out: string[] = [];
  for (const it of items ?? []) {
    if (typeof it === 'string') out.push(it);
    else if (rulesAllow(it.rules, ctx)) out.push(...(Array.isArray(it.value) ? it.value : [it.value]));
  }
  return out;
}

function substitute(arg: string, vars: Record<string, string>): string {
  return arg.replace(/\$\{([^}]+)\}/g, (_m, key: string) => {
    if (!(key in vars)) throw new AppError('LAUNCH_PLACEHOLDER', `Неизвестный параметр запуска: \${${key}}`);
    return vars[key]!;
  });
}

export function buildClasspath(i: Pick<LaunchInput, 'version' | 'platform' | 'librariesDir' | 'clientJar'>): string[] {
  const ctx = { platform: i.platform, features: {} };
  const libs = resolveLibraries(i.version, ctx)
    .filter((l) => !l.native)
    .map((l) => path.join(i.librariesDir, ...l.artifact.path.split('/')));
  return [...new Set([...libs, i.clientJar])];
}

export function buildLaunchCommand(i: LaunchInput): LaunchCommand {
  const features: Record<string, boolean> = { has_custom_resolution: !!i.resolution };
  const ctx = { platform: i.platform, features };
  const classpath = buildClasspath(i).join(path.delimiter);
  const v = i.version;

  const vars: Record<string, string> = {
    auth_player_name: i.auth.name,
    auth_uuid: i.auth.uuid,
    auth_access_token: i.auth.accessToken,
    auth_session: `token:${i.auth.accessToken}:${i.auth.uuid}`,
    auth_xuid: '',
    clientid: '',
    user_type: i.auth.userType ?? 'msa',
    user_properties: '{}',
    version_name: i.versionName ?? v.id,
    version_type: v.type ?? 'release',
    game_directory: i.gameDir,
    assets_root: i.assetsDir,
    game_assets: i.assetsDir,
    assets_index_name: v.assets ?? v.assetIndex?.id ?? '',
    natives_directory: i.nativesDir,
    library_directory: i.librariesDir,
    classpath_separator: path.delimiter,
    launcher_name: i.launcherName,
    launcher_version: i.launcherVersion,
    classpath,
    resolution_width: String(i.resolution?.width ?? ''),
    resolution_height: String(i.resolution?.height ?? ''),
  };

  let jvm: string[];
  let game: string[];
  if (v.arguments) {
    jvm = flatten(v.arguments.jvm, ctx);
    game = flatten(v.arguments.game, ctx);
  } else if (v.minecraftArguments) {
    jvm = ['-Djava.library.path=${natives_directory}', '-Dminecraft.launcher.brand=${launcher_name}', '-Dminecraft.launcher.version=${launcher_version}', '-cp', '${classpath}'];
    game = splitArgs(v.minecraftArguments);
    if (i.resolution) game.push('--width', '${resolution_width}', '--height', '${resolution_height}');
  } else {
    throw new AppError('LAUNCH_NO_ARGS', 'В описании версии нет аргументов запуска');
  }
  if (!jvm.includes('-cp') && !jvm.includes('-classpath')) jvm.push('-cp', '${classpath}');
  if (i.fullscreen) game.push('--fullscreen');

  const args = [
    `-Xms${i.memoryMinMb}M`,
    `-Xmx${i.memoryMaxMb}M`,
    ...jvm.map((a) => substitute(a, vars)),
    ...i.extraJvmArgs,
    v.mainClass,
    ...game.map((a) => substitute(a, vars)),
  ];
  // Short placeholder tokens (offline: "0") are not secrets, and redacting them would garble the log.
  const secrets = i.auth.accessToken.length >= 8 ? [i.auth.accessToken] : [];
  return { command: i.javaPath, args, cwd: i.gameDir, secrets };
}

export function redact(text: string, secrets: string[]): string {
  let out = text;
  for (const s of secrets) if (s) out = out.split(s).join('***');
  return out;
}
