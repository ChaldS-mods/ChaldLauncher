import type { LoaderType } from './types';

/** Launchers whose instances can be imported. `custom` is a folder the user picked by hand. */
export type LauncherId = 'prism' | 'multimc' | 'polymc' | 'modrinth' | 'curseforge' | 'official';

export const LAUNCHER_IDS: LauncherId[] = ['prism', 'multimc', 'polymc', 'modrinth', 'curseforge', 'official'];

export const LAUNCHER_NAMES: Record<LauncherId, string> = {
  prism: 'Prism Launcher',
  multimc: 'MultiMC',
  polymc: 'PolyMC',
  modrinth: 'Modrinth App',
  curseforge: 'CurseForge',
  official: 'Minecraft Launcher',
};

/** One instance found in another launcher. Paths stay in the main process: the UI only sees the token. */
export interface ImportCandidate {
  token: string;
  name: string;
  mcVersion: string;
  loader: { type: LoaderType; version: string | null };
  mods: number;
  worlds: number;
  /** already imported into ChaldLauncher earlier */
  imported: boolean;
  /** why it cannot be imported (unsupported loader, unreadable data…); null = fine */
  problem: string | null;
}

export interface LauncherSource {
  /** `custom` = a folder picked by hand */
  id: LauncherId | 'custom';
  name: string;
  /** folder it was found in (shown as a hint); null when the launcher is not installed */
  path: string | null;
  found: boolean;
  candidates: ImportCandidate[];
}
