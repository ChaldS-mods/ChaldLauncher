import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import type { InstanceKind, LoaderType } from '../shared/types';
import { exists } from './storage';

/** What an instance is switched to: a Minecraft version and a loader (vanilla has no loader version). */
export interface VersionTarget {
  mcVersion: string;
  loader: { type: LoaderType; version: string | null };
}

export function sameTarget(a: VersionTarget, b: VersionTarget): boolean {
  return a.mcVersion === b.mcVersion && a.loader.type === b.loader.type && (a.loader.version ?? null) === (b.loader.version ?? null);
}

/** «Official» and «modded» follow the loader; a kind the user set to «custom» stays as it is. */
export function kindAfterChange(kind: InstanceKind, loader: LoaderType): InstanceKind {
  if (kind === 'custom') return kind;
  return loader === 'vanilla' ? 'official' : 'modded';
}

const MOD_SUFFIX = '.disabled';

/**
 * Copies saves/ to <instance>/backups/saves-<label>-<time> and returns that folder (null: there was nothing to copy).
 * The backup lives outside .minecraft so the game never sees it. A half-copied backup is removed, not left behind.
 */
export async function backupSaves(gameDir: string, label: string, now: Date = new Date()): Promise<string | null> {
  const src = path.join(gameDir, 'saves');
  let names: string[];
  try {
    names = await fs.readdir(src);
  } catch {
    return null;
  }
  if (names.length === 0) return null;
  const stamp = now.toISOString().slice(0, 19).replace(/[:T]/g, '-');
  const dest = path.join(path.dirname(gameDir), 'backups', `saves-${label.replace(/[^0-9A-Za-z._+-]/g, '_')}-${stamp}`);
  try {
    await fs.cp(src, dest, { recursive: true, errorOnExist: true });
  } catch (e) {
    await fs.rm(dest, { recursive: true, force: true }).catch(() => undefined);
    throw e;
  }
  return dest;
}

/**
 * Renames mods/*.jar to *.jar.disabled (the same marker the «Моды» page uses), so mods built for the old version or
 * loader do not stop the new one from starting. Nothing is deleted: a name that is already taken gets a number.
 * Returns how many mods were switched off.
 */
export async function disableMods(gameDir: string): Promise<number> {
  const dir = path.join(gameDir, 'mods');
  let entries: import('node:fs').Dirent[];
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return 0;
  }
  let n = 0;
  for (const e of entries) {
    if (e.isDirectory() || !e.name.endsWith('.jar')) continue;
    const from = path.join(dir, e.name);
    let to = from + MOD_SUFFIX;
    for (let i = 1; await exists(to); i++) to = path.join(dir, `${e.name.slice(0, -4)}-${i}.jar${MOD_SUFFIX}`);
    await fs.rename(from, to);
    n++;
  }
  return n;
}
