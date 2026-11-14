import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { spawn } from 'node:child_process';
import AdmZip from 'adm-zip';
import { AppError, isAbort } from './errors';
import type { SharedDirs } from './dirs';
import { downloadFile, isFileValid, runPool } from './download';
import { netText } from './net';
import { mavenPath, resolveInside } from './paths';
import { writeJsonAtomic } from './storage';
import { currentPlatform, rulesAllow, type LibraryEntry, type VersionJson } from './versionJson';
import { versionPaths } from './versions';

export type ForgeLike = 'forge' | 'neoforge';

interface Processor {
  sides?: string[];
  jar: string;
  classpath?: string[];
  args?: string[];
  outputs?: Record<string, string>;
}

interface InstallProfile {
  spec?: number;
  version?: string;
  json?: string;
  minecraft?: string;
  data?: Record<string, { client: string; server?: string }>;
  processors?: Processor[];
  libraries?: LibraryEntry[];
}

export function installerUrl(loader: ForgeLike, mcVersion: string, loaderVersion: string): string {
  if (loader === 'forge') {
    const v = `${mcVersion}-${loaderVersion}`;
    return `https://maven.minecraftforge.net/net/minecraftforge/forge/${v}/forge-${v}-installer.jar`;
  }
  return `https://maven.neoforged.net/releases/net/neoforged/neoforge/${loaderVersion}/neoforge-${loaderVersion}-installer.jar`;
}

export interface ResolverInput {
  /** built-in tokens: {ROOT}, {SIDE}, {MINECRAFT_JAR}, ... */
  vars: Record<string, string>;
  /** raw `client` values from install_profile.json "data" */
  data: Record<string, string>;
  /** Maven coordinate -> absolute library path */
  libPath: (coord: string) => string;
  /** file inside the installer jar -> absolute path of its extracted copy */
  extract: (entry: string) => string;
}

/** Token handling of Forge-style installers: [maven:coord], 'literal', /file/in/installer and {PLACEHOLDER}. */
export function makeResolver(i: ResolverInput): { arg: (raw: string) => string; dataValue: (raw: string) => string } {
  const dataValue = (raw: string): string => {
    if (raw.length >= 2 && raw.startsWith('[') && raw.endsWith(']')) return i.libPath(raw.slice(1, -1));
    if (raw.length >= 2 && raw.startsWith("'") && raw.endsWith("'")) return raw.slice(1, -1);
    if (raw.startsWith('/')) return i.extract(raw.slice(1));
    return raw;
  };
  const values: Record<string, string> = {};
  for (const [k, v] of Object.entries(i.data)) values[k] = dataValue(v);
  const arg = (raw: string): string => {
    if (raw.length >= 2 && raw.startsWith('[') && raw.endsWith(']')) return i.libPath(raw.slice(1, -1));
    return raw.replace(/\{([A-Za-z0-9_]+)\}/g, (_m, key: string) => {
      const v = i.vars[key] ?? values[key];
      if (v === undefined) throw new AppError('INSTALL_PROFILE', `Установщик использует неизвестный параметр {${key}}`);
      return v;
    });
  };
  return { arg, dataValue };
}

function mainClassOf(jar: string): string {
  const manifest = new AdmZip(jar).readAsText('META-INF/MANIFEST.MF');
  const m = /^Main-Class:\s*(\S+)/m.exec(manifest);
  if (!m) throw new AppError('INSTALL_PROFILE', `В ${path.basename(jar)} нет Main-Class`);
  return m[1]!;
}

function runJava(java: string, args: string[], cwd: string, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) return reject(new DOMException('Aborted', 'AbortError'));
    const child = spawn(java, args, { cwd, windowsHide: true, shell: false, stdio: ['ignore', 'pipe', 'pipe'] });
    const tail: string[] = [];
    const keep = (chunk: Buffer) => {
      for (const line of chunk.toString('utf8').split(/\r?\n/)) if (line.trim()) tail.push(line.trim());
      if (tail.length > 30) tail.splice(0, tail.length - 30);
    };
    child.stdout.on('data', keep);
    child.stderr.on('data', keep);
    const onAbort = () => child.kill();
    signal.addEventListener('abort', onAbort, { once: true });
    child.once('error', (e) => {
      signal.removeEventListener('abort', onAbort);
      reject(new AppError('SPAWN_FAILED', `Не удалось запустить Java: ${e.message}`));
    });
    child.once('close', (code) => {
      signal.removeEventListener('abort', onAbort);
      if (signal.aborted) return reject(new DOMException('Aborted', 'AbortError'));
      if (code === 0) return resolve();
      reject(new AppError('INSTALL_FAILED', `Обработчик установщика завершился с кодом ${code}. ${tail.slice(-6).join(' | ')}`));
    });
  });
}

async function fetchInstaller(url: string, dest: string, signal: AbortSignal, onBytes: (d: number) => void): Promise<void> {
  let sha1: string | undefined;
  try {
    const t = (await netText(`${url}.sha1`, 'Контрольная сумма установщика', signal)).trim().split(/\s/)[0]?.toLowerCase();
    if (t && /^[0-9a-f]{40}$/.test(t)) sha1 = t;
  } catch (e) {
    if (isAbort(e) || signal.aborted) throw e;
    /* the checksum file is optional; the download itself is still over HTTPS from the official maven */
  }
  await downloadFile({ url, dest, sha1, purpose: 'Установщик загрузчика' }, { signal, onBytes });
}

export interface ForgeInstallInput {
  loader: ForgeLike;
  mcVersion: string;
  loaderVersion: string;
  dirs: SharedDirs;
  /** Java able to run the installer's processors (the one the game itself needs) */
  javaPath: string;
  report: (p: { label: string; fraction: number | null }) => void;
  signal: AbortSignal;
}

/**
 * Installs Forge / NeoForge into the shared directories without running the installer's GUI:
 * unpacks the installer, downloads the libraries of the profile through our own (allow-listed) network layer,
 * runs the installer's processors with Java and writes the resulting version json.
 * The vanilla client jar (versions/<mc>/<mc>.jar) must already be in place.
 */
export async function installForgeLike(i: ForgeInstallInput): Promise<{ versionId: string }> {
  const { dirs, signal, report } = i;
  const title = i.loader === 'forge' ? 'Forge' : 'NeoForge';
  const installerPath = path.join(dirs.root, 'installers', `${i.loader}-${i.mcVersion}-${i.loaderVersion}-installer.jar`);

  report({ label: `Загрузка установщика ${title}…`, fraction: null });
  await fetchInstaller(installerUrl(i.loader, i.mcVersion, i.loaderVersion), installerPath, signal, () => undefined);

  const zip = new AdmZip(installerPath);
  const readJson = <T>(name: string): T => {
    const e = zip.getEntry(name.replace(/^\//, ''));
    if (!e) throw new AppError('INSTALL_PROFILE', `В установщике ${title} нет файла ${name}`);
    return JSON.parse(e.getData().toString('utf8')) as T;
  };
  const profile = readJson<InstallProfile>('install_profile.json');
  if (!profile.json) throw new AppError('LOADER_UNSUPPORTED', `Этот установщик ${title} старого формата и не поддерживается`);
  const versionJson = readJson<VersionJson>(profile.json);
  if (versionJson.inheritsFrom !== i.mcVersion) {
    throw new AppError('LOADER_INCOMPATIBLE', `Профиль ${title} не соответствует Minecraft ${i.mcVersion}`);
  }

  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'chald-loader-'));
  try {
    // files the installer carries itself (maven/ folder)
    report({ label: 'Распаковка установщика…', fraction: null });
    for (const e of zip.getEntries()) {
      if (e.isDirectory || !e.entryName.startsWith('maven/')) continue;
      const dest = resolveInside(dirs.libraries, e.entryName.slice('maven/'.length));
      if (await isFileValid(dest, { size: e.header.size })) continue;
      await fs.mkdir(path.dirname(dest), { recursive: true });
      await fs.writeFile(dest, e.getData());
    }

    // libraries the processors need
    const platform = currentPlatform();
    const libTasks = (profile.libraries ?? [])
      .filter((l) => rulesAllow(l.rules, { platform, features: {} }))
      .flatMap((l) => {
        const art = l.downloads?.artifact;
        const rel = art?.path ?? mavenPath(l.name);
        const url = art ? art.url : l.url ? l.url.replace(/\/?$/, '/') + rel : '';
        return url ? [{ url, dest: resolveInside(dirs.libraries, rel), sha1: art?.sha1 ?? l.sha1, size: art?.size ?? l.size, purpose: `Библиотека ${title}` }] : [];
      });
    let done = 0;
    const emitLibs = () => report({ label: `Библиотеки ${title} ${done}/${libTasks.length}`, fraction: libTasks.length ? done / libTasks.length : 1 });
    emitLibs();
    await runPool(libTasks, 8, async (t) => {
      await downloadFile(t, { signal });
      done++;
      emitLibs();
    });

    const { arg, dataValue } = makeResolver({
      vars: {
        SIDE: 'client',
        ROOT: dirs.root,
        INSTALLER: installerPath,
        LIBRARY_DIR: dirs.libraries,
        MINECRAFT_JAR: versionPaths(dirs.versions, i.mcVersion).jar,
        MINECRAFT_VERSION: i.mcVersion,
      },
      data: Object.fromEntries(Object.entries(profile.data ?? {}).map(([k, v]) => [k, v.client])),
      libPath: (coord) => resolveInside(dirs.libraries, mavenPath(coord)),
      extract: (entry) => {
        const e = zip.getEntry(entry);
        if (!e) throw new AppError('INSTALL_PROFILE', `В установщике нет файла ${entry}`);
        const dest = resolveInside(tmp, entry);
        return dest;
      },
    });
    // `extract` only computes the target path; write the files that are actually referenced
    for (const v of Object.values(profile.data ?? {})) {
      if (v.client.startsWith('/')) {
        const entry = v.client.slice(1);
        const e = zip.getEntry(entry);
        if (!e) throw new AppError('INSTALL_PROFILE', `В установщике нет файла ${entry}`);
        const dest = resolveInside(tmp, entry);
        await fs.mkdir(path.dirname(dest), { recursive: true });
        await fs.writeFile(dest, e.getData());
      }
    }

    const procs = (profile.processors ?? []).filter((p) => !p.sides || p.sides.includes('client'));
    for (let n = 0; n < procs.length; n++) {
      const p = procs[n]!;
      report({ label: `Обработка файлов ${title} ${n + 1}/${procs.length}`, fraction: n / procs.length });
      const outputs = Object.entries(p.outputs ?? {}).map(([k, v]) => ({ file: arg(k), sha1: arg(dataValue(v)) }));
      if (outputs.length && (await Promise.all(outputs.map((o) => isFileValid(o.file, { sha1: o.sha1 })))).every(Boolean)) continue;

      const cp = [p.jar, ...(p.classpath ?? [])].map((c) => resolveInside(dirs.libraries, mavenPath(c)));
      const args = (p.args ?? []).map(arg);
      for (const o of outputs) await fs.mkdir(path.dirname(o.file), { recursive: true });
      await runJava(i.javaPath, ['-cp', cp.join(path.delimiter), mainClassOf(cp[0]!), ...args], dirs.root, signal);
      for (const o of outputs) {
        if (!(await isFileValid(o.file, { sha1: o.sha1 }))) {
          throw new AppError('INSTALL_FAILED', `Обработчик ${title} создал неверный файл: ${path.basename(o.file)}`);
        }
      }
    }

    await writeJsonAtomic(versionPaths(dirs.versions, versionJson.id).json, versionJson);
    report({ label: `${title} установлен`, fraction: 1 });
    return { versionId: versionJson.id };
  } finally {
    await fs.rm(tmp, { recursive: true, force: true }).catch(() => undefined);
  }
}
