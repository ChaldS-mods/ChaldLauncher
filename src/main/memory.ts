import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';

export interface SystemMemory { totalMb: number; freeMb: number }

export function systemMemory(): SystemMemory {
  return { totalMb: Math.floor(os.totalmem() / 1048576), freeMb: Math.floor(os.freemem() / 1048576) };
}

/** Number of enabled mods (.jar files) in <gameDir>/mods; 0 when the folder does not exist. */
export async function countModJars(gameDir: string): Promise<number> {
  try {
    return (await fs.readdir(path.join(gameDir, 'mods'), { withFileTypes: true })).filter((e) => !e.isDirectory() && e.name.toLowerCase().endsWith('.jar')).length;
  } catch {
    return 0;
  }
}
