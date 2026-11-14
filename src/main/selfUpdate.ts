import * as fsp from 'node:fs/promises';
import * as path from 'node:path';
import { AppError } from './errors';

/**
 * Replaces the AppImage the launcher is running from with the downloaded (already verified) one.
 *
 * The new file is copied next to the target first and then renamed over it: rename is atomic, so a crash or a full disk
 * never leaves a half-written launcher. A running AppImage keeps its old inode mounted, so replacing the file under it
 * is safe on Linux; the new version starts on the next launch.
 */
export async function replaceAppImage(source: string, target: string): Promise<void> {
  if (!path.isAbsolute(target) || !/\.appimage$/i.test(target)) {
    throw new AppError('UPDATE_BAD_TARGET', 'Не удалось определить файл AppImage, который нужно заменить.');
  }
  const tmp = `${target}.new-${process.pid}`;
  try {
    await fsp.copyFile(source, tmp);
    await fsp.chmod(tmp, 0o755);
    await fsp.rename(tmp, target);
  } catch (e) {
    await fsp.rm(tmp, { force: true }).catch(() => undefined);
    const code = (e as NodeJS.ErrnoException).code;
    if (code === 'EACCES' || code === 'EPERM' || code === 'EROFS') {
      throw new AppError('UPDATE_NO_WRITE', `Нет прав на запись в ${path.dirname(target)}: обнови лаунчер вручную.`);
    }
    throw e;
  }
}

/**
 * Environment for starting the new AppImage from the old one. AppRun of the running image exports APPDIR/APPIMAGE/…,
 * and a child that inherits them would try to run out of the old (soon unmounted) image.
 */
export function relaunchEnv(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const out = { ...env };
  for (const k of ['APPIMAGE', 'APPDIR', 'ARGV0', 'OWD', 'CHROME_DESKTOP']) delete out[k];
  return out;
}
