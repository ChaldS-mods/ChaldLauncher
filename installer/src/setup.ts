import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { execFile } from 'node:child_process';
import { extractPayload, readHeader, type PayloadMeta } from './payload';
import { buildUninstallScript } from './uninstall';

export const MARKER = '.chald-install.json';
export const UNINSTALL_SCRIPT = 'uninstall.ps1';

export interface InstallOptions {
  dir: string;
  desktopShortcut: boolean;
  startMenuShortcut: boolean;
}

export interface InstallProgress {
  phase: 'prepare' | 'extract' | 'finish';
  percent: number;
  file?: string;
}

export interface InstallEnv {
  payloadFile: string;
  platform: NodeJS.Platform;
  desktopDir: string;
  /** …\Start Menu\Programs */
  startMenuProgramsDir: string;
  createShortcut(lnk: string, target: string, cwd: string, description: string): boolean;
  /** Закрыть запущенный лаунчер (на Windows по умолчанию taskkill). */
  stopRunning?: (exe: string) => Promise<void>;
  /** Записать запись об удалении (на Windows по умолчанию reg.exe). */
  register?: (meta: PayloadMeta, dir: string, sizeKb: number) => Promise<void>;
}

export interface InstallResult {
  dir: string;
  exePath: string;
  version: string;
  warnings: string[];
}

export function defaultInstallDir(meta: PayloadMeta, env: NodeJS.ProcessEnv = process.env): string {
  const base = env.LOCALAPPDATA ?? path.join(os.homedir(), 'AppData', 'Local');
  return path.join(base, 'Programs', meta.productName);
}

export function uninstallKeyName(meta: PayloadMeta): string {
  return meta.productName.replace(/[^A-Za-z0-9._-]/g, '_');
}

export function registryKey(meta: PayloadMeta): string {
  return `HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\${uninstallKeyName(meta)}`;
}

export function readMarker(dir: string): { version: string } | null {
  try {
    const j = JSON.parse(fs.readFileSync(path.join(dir, MARKER), 'utf8')) as { version?: unknown };
    return typeof j.version === 'string' ? { version: j.version } : null;
  } catch {
    return null;
  }
}

/**
 * Папка, куда реально пойдёт установка. Чужую непустую папку и корень диска не трогаем:
 * в таких случаях ставим во вложенную папку с именем продукта.
 */
export function resolveInstallDir(chosen: string, productName: string): string {
  if (typeof chosen !== 'string' || chosen.includes('\0') || chosen.trim() === '') throw new Error('Не выбрана папка установки');
  const p = path.resolve(chosen);
  if (path.parse(p).root === p) return path.join(p, productName);
  let st: fs.Stats | null = null;
  try {
    st = fs.statSync(p);
  } catch {
    st = null;
  }
  if (!st) return p;
  if (!st.isDirectory()) throw new Error('Выбранный путь — это файл, а не папка');
  if (readMarker(p)) return p;
  if (fs.readdirSync(p).length === 0) return p;
  return path.join(p, productName);
}

/** Свободное место на диске, где лежит (или будет лежать) папка. */
export async function freeSpace(dir: string): Promise<number | null> {
  let p = path.resolve(dir);
  for (let i = 0; i < 64; i++) {
    try {
      const st = await fs.promises.statfs(p);
      return Number(st.bavail) * Number(st.bsize);
    } catch {
      const up = path.dirname(p);
      if (up === p) return null;
      p = up;
    }
  }
  return null;
}

function run(cmd: string, args: string[]): Promise<{ code: number; out: string }> {
  return new Promise((resolve) => {
    execFile(cmd, args, { windowsHide: true, timeout: 30_000 }, (err, stdout) => {
      const code = err && typeof (err as { code?: unknown }).code === 'number' ? ((err as { code: number }).code) : err ? 1 : 0;
      resolve({ code, out: String(stdout ?? '') });
    });
  });
}

export async function stopRunningWindows(exe: string): Promise<void> {
  await run('taskkill', ['/F', '/T', '/IM', exe]);
  await new Promise((r) => setTimeout(r, 600));
}

export async function registerWindows(meta: PayloadMeta, dir: string, sizeKb: number): Promise<void> {
  const key = registryKey(meta);
  const exePath = path.join(dir, meta.exe);
  const ps = path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
  const d = new Date();
  const date = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
  const values: Array<[string, 'REG_SZ' | 'REG_DWORD', string]> = [
    ['DisplayName', 'REG_SZ', meta.productName],
    ['DisplayVersion', 'REG_SZ', meta.version],
    ['Publisher', 'REG_SZ', meta.publisher],
    ['InstallLocation', 'REG_SZ', dir],
    ['DisplayIcon', 'REG_SZ', exePath],
    ['UninstallString', 'REG_SZ', `"${ps}" -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "${path.join(dir, UNINSTALL_SCRIPT)}"`],
    ['InstallDate', 'REG_SZ', date],
    ['EstimatedSize', 'REG_DWORD', String(sizeKb)],
    ['NoModify', 'REG_DWORD', '1'],
    ['NoRepair', 'REG_DWORD', '1'],
  ];
  for (const [name, type, value] of values) {
    const r = await run('reg', ['add', key, '/v', name, '/t', type, '/d', value, '/f']);
    if (r.code !== 0) throw new Error(`Не удалось записать ${name} в реестр`);
  }
}

/** Найти уже установленную копию (запись в реестре + наш маркер). */
export async function findExistingInstall(meta: PayloadMeta, platform: NodeJS.Platform = process.platform): Promise<{ dir: string; version: string } | null> {
  if (platform !== 'win32') return null;
  const r = await run('reg', ['query', registryKey(meta), '/v', 'InstallLocation']);
  if (r.code !== 0) return null;
  const m = /InstallLocation\s+REG_SZ\s+(.+?)\s*$/m.exec(r.out);
  if (!m?.[1]) return null;
  const dir = m[1];
  const mk = readMarker(dir);
  return mk ? { dir, version: mk.version } : null;
}

export function humanizeError(e: unknown): string {
  const code = e && typeof e === 'object' && 'code' in e ? String((e as { code: unknown }).code) : '';
  switch (code) {
    case 'ENOSPC':
      return 'Недостаточно места на диске.';
    case 'EACCES':
    case 'EPERM':
      return 'Нет прав на запись в выбранную папку. Выберите другую папку или закройте программы, которые могут использовать файлы лаунчера.';
    case 'EBUSY':
      return 'Файл занят другой программой. Закройте ChaldLauncher и повторите.';
    default:
      return e instanceof Error ? e.message : String(e);
  }
}

async function exists(p: string): Promise<boolean> {
  try {
    await fs.promises.access(p);
    return true;
  } catch {
    return false;
  }
}

/** Заменить папку установки подготовленной папкой. При ошибке старая версия возвращается на место. */
async function swapIn(staging: string, finalDir: string): Promise<void> {
  const old = `${finalDir}.chald-old`;
  await fs.promises.rm(old, { recursive: true, force: true });
  if (await exists(finalDir)) {
    if (readMarker(finalDir)) await fs.promises.rename(finalDir, old);
    else await fs.promises.rmdir(finalDir); // пустая папка, см. resolveInstallDir
  }
  try {
    await fs.promises.rename(staging, finalDir);
  } catch (e) {
    if (await exists(old)) await fs.promises.rename(old, finalDir).catch(() => undefined);
    throw e;
  }
  await fs.promises.rm(old, { recursive: true, force: true }).catch(() => undefined);
}

export async function install(
  opts: InstallOptions,
  env: InstallEnv,
  onProgress: (p: InstallProgress) => void = () => undefined,
  signal?: AbortSignal,
): Promise<InstallResult> {
  const header = await readHeader(env.payloadFile);
  const meta = header.meta;
  const finalDir = resolveInstallDir(opts.dir, meta.productName);
  const staging = `${finalDir}.chald-new`;
  const warnings: string[] = [];

  onProgress({ phase: 'prepare', percent: 1 });
  const free = await freeSpace(finalDir);
  const need = Math.ceil(header.totalSize * 1.05) + 50 * 1024 * 1024;
  if (free !== null && free < need) throw Object.assign(new Error('Недостаточно места на диске.'), { code: 'ENOSPC' });

  try {
    signal?.throwIfAborted();
    await fs.promises.mkdir(path.dirname(finalDir), { recursive: true });
    await fs.promises.rm(staging, { recursive: true, force: true });

    onProgress({ phase: 'prepare', percent: 2 });
    await extractPayload(env.payloadFile, staging, {
      signal,
      onProgress: (p) => onProgress({ phase: 'extract', percent: 3 + Math.floor(92 * (p.done / Math.max(1, p.total))), file: p.file }),
    });
    signal?.throwIfAborted();

    if (!(await exists(path.join(staging, meta.exe)))) throw new Error(`После распаковки не найден ${meta.exe}`);
    onProgress({ phase: 'finish', percent: 96 });
    await fs.promises.writeFile(path.join(staging, MARKER), JSON.stringify({ product: meta.productName, version: meta.version, installedAt: new Date().toISOString() }, null, 2));
    await fs.promises.writeFile(path.join(staging, UNINSTALL_SCRIPT), buildUninstallScript({ productName: meta.productName, exe: meta.exe, keyName: uninstallKeyName(meta) }), 'utf8');

    // Точка невозврата: дальше старая версия заменяется новой.
    signal?.throwIfAborted();
    const stop = env.stopRunning ?? (env.platform === 'win32' ? stopRunningWindows : undefined);
    if (stop) await stop(meta.exe);
    await swapIn(staging, finalDir);
  } catch (e) {
    await fs.promises.rm(staging, { recursive: true, force: true }).catch(() => undefined);
    throw e;
  }

  const exePath = path.join(finalDir, meta.exe);
  onProgress({ phase: 'finish', percent: 98 });

  try {
    if (opts.desktopShortcut) {
      if (!env.createShortcut(path.join(env.desktopDir, `${meta.productName}.lnk`), exePath, finalDir, meta.productName)) warnings.push('Не удалось создать ярлык на рабочем столе.');
    }
    if (opts.startMenuShortcut) {
      const folder = path.join(env.startMenuProgramsDir, meta.productName);
      await fs.promises.mkdir(folder, { recursive: true });
      if (!env.createShortcut(path.join(folder, `${meta.productName}.lnk`), exePath, finalDir, meta.productName)) warnings.push('Не удалось создать ярлык в меню «Пуск».');
    }
  } catch (e) {
    warnings.push(`Ярлыки: ${humanizeError(e)}`);
  }

  const register = env.register ?? (env.platform === 'win32' ? registerWindows : undefined);
  if (register) {
    try {
      await register(meta, finalDir, Math.ceil(header.totalSize / 1024));
    } catch (e) {
      warnings.push(`Запись в «Приложения и возможности»: ${humanizeError(e)}`);
    }
  }

  onProgress({ phase: 'finish', percent: 100 });
  return { dir: finalDir, exePath, version: meta.version, warnings };
}
