import { execFile } from 'node:child_process';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import AdmZip from 'adm-zip';
import * as tar from 'tar';
import type { JavaInstall } from '../shared/types';
import { AppError } from './errors';
import type { SharedDirs } from './dirs';
import { downloadFile } from './download';
import { netJson } from './net';
import { resolveInside } from './paths';

const EXE = process.platform === 'win32' ? 'java.exe' : 'java';

export function parseJavaMajor(output: string): number | null {
  const m = /version "(\d+)(?:\.(\d+))?/.exec(output);
  if (!m) return null;
  const first = Number(m[1]);
  return first === 1 ? Number(m[2]) : first;
}

export function javaMajor(javaPath: string): Promise<number | null> {
  return new Promise((resolve) => {
    execFile(javaPath, ['-version'], { timeout: 8000, windowsHide: true }, (err, stdout, stderr) => {
      if (err && !stderr) return resolve(null);
      resolve(parseJavaMajor(`${stderr}\n${stdout}`));
    });
  });
}

async function subdirs(dir: string): Promise<string[]> {
  try {
    return (await fs.readdir(dir, { withFileTypes: true })).filter((d) => d.isDirectory()).map((d) => path.join(dir, d.name));
  } catch {
    return [];
  }
}

async function candidatePaths(runtimeDir: string): Promise<{ path: string; source: JavaInstall['source'] }[]> {
  const out: { path: string; source: JavaInstall['source'] }[] = [{ path: 'java', source: 'system' }];
  if (process.env.JAVA_HOME) out.push({ path: path.join(process.env.JAVA_HOME, 'bin', EXE), source: 'system' });
  const roots: string[] = [];
  if (process.platform === 'win32') {
    for (const base of [process.env['ProgramFiles'], process.env['ProgramFiles(x86)']].filter(Boolean) as string[]) {
      for (const vendor of ['Java', 'Eclipse Adoptium', 'Microsoft', 'Zulu', 'BellSoft', 'Amazon Corretto']) {
        roots.push(...(await subdirs(path.join(base, vendor))));
      }
    }
  } else if (process.platform === 'darwin') {
    for (const d of await subdirs('/Library/Java/JavaVirtualMachines')) roots.push(path.join(d, 'Contents', 'Home'));
  } else {
    roots.push(...(await subdirs('/usr/lib/jvm')));
  }
  for (const r of roots) out.push({ path: path.join(r, 'bin', EXE), source: 'system' });
  for (const v of await subdirs(runtimeDir)) {
    const found = await findJavaBinary(v);
    if (found) out.push({ path: found, source: 'launcher' });
  }
  return out;
}

export async function detectJava(dirs: SharedDirs): Promise<JavaInstall[]> {
  const seen = new Set<string>();
  const result: JavaInstall[] = [];
  for (const c of await candidatePaths(dirs.runtime)) {
    let real = c.path;
    if (path.isAbsolute(c.path)) {
      try {
        real = await fs.realpath(c.path);
      } catch {
        continue;
      }
    }
    if (seen.has(real)) continue;
    const major = await javaMajor(c.path);
    if (major == null) continue;
    seen.add(real);
    result.push({ path: path.isAbsolute(c.path) ? c.path : real, major, source: c.source });
  }
  return result.sort((a, b) => a.major - b.major);
}

/** Exact match first, then the lowest newer major. */
export function pickJava(required: number, installs: JavaInstall[]): JavaInstall | null {
  const exact = installs.find((j) => j.major === required);
  if (exact) return exact;
  return installs.filter((j) => j.major > required).sort((a, b) => a.major - b.major)[0] ?? null;
}

export async function findJavaBinary(root: string, depth = 5): Promise<string | null> {
  if (depth < 0) return null;
  let entries;
  try {
    entries = await fs.readdir(root, { withFileTypes: true });
  } catch {
    return null;
  }
  if (path.basename(root) === 'bin' && entries.some((e) => e.name === EXE)) return path.join(root, EXE);
  for (const e of entries) {
    if (e.isDirectory()) {
      const f = await findJavaBinary(path.join(root, e.name), depth - 1);
      if (f) return f;
    }
  }
  return null;
}

interface AdoptiumAsset {
  binary: { package: { link: string; checksum: string; size: number; name: string } };
}

/** Download Eclipse Temurin JRE (GPLv2+Classpath Exception) into the launcher's own runtime dir. */
export async function downloadJava(
  major: number,
  dirs: SharedDirs,
  report: (label: string, fraction: number | null) => void,
  signal: AbortSignal,
): Promise<string> {
  const target = path.join(dirs.runtime, `temurin-${major}`);
  const existing = await findJavaBinary(target);
  if (existing && (await javaMajor(existing)) === major) return existing;

  const os = process.platform === 'win32' ? 'windows' : process.platform === 'darwin' ? 'mac' : 'linux';
  const arch = process.arch === 'arm64' ? 'aarch64' : process.arch === 'x64' ? 'x64' : null;
  if (!arch) throw new AppError('JAVA_UNSUPPORTED', `Автозагрузка Java недоступна для архитектуры ${process.arch}`);

  report(`Поиск Java ${major}…`, null);
  const assets = await netJson<AdoptiumAsset[]>(
    `https://api.adoptium.net/v3/assets/latest/${major}/hotspot?architecture=${arch}&image_type=jre&os=${os}`,
    { purpose: `Поиск Java ${major}`, signal },
  );
  const pkg = assets[0]?.binary.package;
  if (!pkg) throw new AppError('JAVA_NOT_FOUND', `Java ${major} для этой системы не найдена`);

  const archive = path.join(dirs.runtime, '.downloads', pkg.name);
  let total = pkg.size;
  let done = 0;
  report(`Загрузка Java ${major}…`, 0);
  await downloadFile(
    { url: pkg.link, dest: archive, sha256: pkg.checksum, size: pkg.size, purpose: `Java ${major} (Eclipse Temurin)` },
    { signal, onBytes: (d) => { done += d; report(`Загрузка Java ${major}…`, total ? Math.min(1, done / total) : null); } },
  );

  report(`Распаковка Java ${major}…`, null);
  const tmp = `${target}.tmp`;
  await fs.rm(tmp, { recursive: true, force: true });
  await fs.mkdir(tmp, { recursive: true });
  if (pkg.name.endsWith('.zip')) {
    const zip = new AdmZip(archive);
    for (const e of zip.getEntries()) {
      if (e.isDirectory) continue;
      const dest = resolveInside(tmp, e.entryName); // zip-slip guard
      await fs.mkdir(path.dirname(dest), { recursive: true });
      await fs.writeFile(dest, e.getData(), { mode: 0o755 });
    }
  } else {
    await tar.x({ file: archive, cwd: tmp });
  }
  await fs.rm(target, { recursive: true, force: true });
  await fs.rename(tmp, target);
  await fs.rm(archive, { force: true });
  const bin = await findJavaBinary(target);
  if (!bin) throw new AppError('JAVA_NOT_FOUND', 'В распакованном архиве нет java');
  if (process.platform !== 'win32') await fs.chmod(bin, 0o755);
  return bin;
}
