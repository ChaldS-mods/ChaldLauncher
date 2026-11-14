import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import AdmZip from 'adm-zip';
import type { LoaderType } from '../shared/types';
import { AppError } from './errors';
import type { SharedDirs } from './dirs';
import { downloadFile, isFileValid, runPool, type DownloadSpec } from './download';
import { resolveInside } from './paths';
import { readJson, writeJsonAtomic } from './storage';
import { assertLoaderCompatible, isProfileLoader, profileUrl, versionPaths, type VersionCatalog } from './versions';
import { installForgeLike } from './forgeInstall';
import { netJson } from './net';
import {
  currentPlatform, mergeVersions, resolveLibraries, type Platform, type ResolvedLibrary, type VersionJson,
} from './versionJson';

export interface InstallProgress {
  label: string;
  fraction: number | null;
}

export interface InstallRequest {
  mcVersion: string;
  loader: { type: LoaderType; version: string | null };
}

export interface InstallHooks {
  /** Java able to run Forge/NeoForge processors; finds or downloads it */
  javaFor(requiredMajor: number): Promise<string>;
}

interface AssetIndex {
  objects: Record<string, { hash: string; size: number }>;
  map_to_resources?: boolean;
  virtual?: boolean;
}

/** Read a version json and resolve `inheritsFrom` into one merged description. */
export async function loadResolvedVersion(dirs: SharedDirs, versionId: string): Promise<VersionJson> {
  const file = versionPaths(dirs.versions, versionId).json;
  const json = await readJson<VersionJson>(file);
  if (!json) throw new AppError('VERSION_MISSING', `Нет файла версии ${versionId}`);
  if (!json.inheritsFrom) return json;
  const parent = await loadResolvedVersion(dirs, json.inheritsFrom);
  return mergeVersions(parent, json);
}

function formatMb(bytes: number): string {
  return (bytes / 1048576).toFixed(bytes > 10485760 ? 0 : 1);
}

export async function installVersion(
  req: InstallRequest,
  dirs: SharedDirs,
  catalog: VersionCatalog,
  report: (p: InstallProgress) => void,
  signal: AbortSignal,
  hooks?: InstallHooks,
): Promise<{ versionId: string }> {
  const platform = currentPlatform();

  report({ label: 'Получение метаданных версии…', fraction: null });
  const entry = await catalog.find(req.mcVersion);
  const vanilla = versionPaths(dirs.versions, entry.id);
  await downloadFile(
    { url: entry.url, dest: vanilla.json, sha1: entry.sha1, purpose: `Описание Minecraft ${entry.id}` },
    { signal },
  );

  let versionId = entry.id;
  const loaderType = req.loader.type;
  if (isProfileLoader(loaderType)) {
    const title = loaderType === 'fabric' ? 'Fabric' : 'Quilt';
    if (!req.loader.version) throw new AppError('LOADER_INCOMPATIBLE', `Не выбрана версия ${title}`);
    report({ label: `Проверка совместимости ${title}…`, fraction: null });
    await assertLoaderCompatible(loaderType, req.mcVersion, req.loader.version);
    const profile = await netJson<VersionJson>(profileUrl(loaderType, req.mcVersion, req.loader.version), { purpose: `Профиль ${title}`, signal });
    if (!profile.id || profile.inheritsFrom !== req.mcVersion) {
      throw new AppError('LOADER_INCOMPATIBLE', `Профиль ${title} не соответствует выбранной версии Minecraft`);
    }
    versionId = profile.id;
    await writeJsonAtomic(versionPaths(dirs.versions, versionId).json, profile);
  } else if (loaderType === 'forge' || loaderType === 'neoforge') {
    const title = loaderType === 'forge' ? 'Forge' : 'NeoForge';
    if (!req.loader.version) throw new AppError('LOADER_INCOMPATIBLE', `Не выбрана версия ${title}`);
    if (!hooks) throw new AppError('LOADER_UNSUPPORTED', `${title}: установка недоступна в этом режиме`);
    report({ label: `Проверка совместимости ${title}…`, fraction: null });
    await assertLoaderCompatible(loaderType, req.mcVersion, req.loader.version);

    // The installer's processors patch the vanilla client, so it has to be on disk first.
    const vanillaJson = await loadResolvedVersion(dirs, entry.id);
    const vanillaClient = vanillaJson.downloads?.client;
    if (!vanillaClient) throw new AppError('VERSION_INVALID', 'В описании версии нет клиента');
    let got = 0;
    await downloadFile(
      { url: vanillaClient.url, dest: vanilla.jar, sha1: vanillaClient.sha1, size: vanillaClient.size, purpose: `Клиент Minecraft ${entry.id}` },
      { signal, onBytes: (d) => { got += d; report({ label: `Клиент Minecraft: ${formatMb(Math.max(0, got))} МБ`, fraction: vanillaClient.size ? Math.min(1, Math.max(0, got) / vanillaClient.size) : null }); } },
    );
    const javaPath = await hooks.javaFor(vanillaJson.javaVersion?.majorVersion ?? 8);
    ({ versionId } = await installForgeLike({
      loader: loaderType, mcVersion: req.mcVersion, loaderVersion: req.loader.version, dirs, javaPath, report, signal,
    }));
  }

  const resolved = await loadResolvedVersion(dirs, versionId);
  const client = resolved.downloads?.client;
  if (!client) throw new AppError('VERSION_INVALID', 'В описании версии нет клиента');
  if (!resolved.assetIndex) throw new AppError('VERSION_INVALID', 'В описании версии нет индекса ресурсов');

  report({ label: 'Получение списка ресурсов…', fraction: null });
  const indexFile = path.join(dirs.assets, 'indexes', `${resolved.assetIndex.id}.json`);
  await downloadFile(
    { url: resolved.assetIndex.url, dest: indexFile, sha1: resolved.assetIndex.sha1, size: resolved.assetIndex.size, purpose: 'Индекс ресурсов' },
    { signal },
  );
  const index = (await readJson<AssetIndex>(indexFile))!;
  if (index.map_to_resources || index.virtual) {
    throw new AppError('VERSION_UNSUPPORTED', 'Очень старые версии Minecraft (до 1.7) пока не поддерживаются');
  }

  const libs = resolveLibraries(resolved, { platform, features: {} });
  const tasks: DownloadSpec[] = [
    { url: client.url, dest: versionPaths(dirs.versions, req.mcVersion).jar, sha1: client.sha1, size: client.size, purpose: `Клиент Minecraft ${req.mcVersion}` },
    // libraries with an empty url are produced by the Forge/NeoForge processors, not downloaded
    ...libs.filter((l) => l.artifact.url).map((l) => ({
      url: l.artifact.url,
      dest: resolveInside(dirs.libraries, l.artifact.path),
      sha1: l.artifact.sha1,
      size: l.artifact.size,
      purpose: 'Библиотека',
    })),
    ...Object.values(index.objects).map((o) => ({
      url: `https://resources.download.minecraft.net/${o.hash.slice(0, 2)}/${o.hash}`,
      dest: path.join(dirs.assets, 'objects', o.hash.slice(0, 2), o.hash),
      sha1: o.hash,
      size: o.size,
      purpose: 'Ресурсы игры',
    })),
  ];

  const totalBytes = tasks.reduce((s, t) => s + (t.size ?? 0), 0);
  let doneBytes = 0;
  let doneFiles = 0;
  let lastEmit = 0;
  const emit = (force = false) => {
    const now = Date.now();
    if (!force && now - lastEmit < 120) return;
    lastEmit = now;
    const fraction = totalBytes > 0 ? Math.min(1, doneBytes / totalBytes) : doneFiles / tasks.length;
    report({
      label: `Загрузка файлов ${doneFiles}/${tasks.length}` + (totalBytes > 0 ? ` · ${formatMb(doneBytes)} из ${formatMb(totalBytes)} МБ` : ''),
      fraction,
    });
  };
  emit(true);
  await runPool(tasks, 12, async (t) => {
    await downloadFile(t, { signal, onBytes: (d) => { doneBytes += d; emit(); } });
    doneFiles++;
    emit();
  });
  emit(true);
  return { versionId };
}

/** Existence check of everything needed to start the game. Returns human-readable problems. */
export async function verifyInstall(dirs: SharedDirs, versionId: string, platform: Platform = currentPlatform()): Promise<string[]> {
  const problems: string[] = [];
  let resolved: VersionJson;
  try {
    resolved = await loadResolvedVersion(dirs, versionId);
  } catch {
    return [`Нет описания версии ${versionId}`];
  }
  const baseId = resolved.inheritsFrom ?? resolved.id;
  const jar = versionPaths(dirs.versions, baseId).jar;
  if (!(await isFileValid(jar, { size: resolved.downloads?.client?.size }))) problems.push('Нет файла клиента Minecraft');
  let missingLibs = 0;
  for (const l of resolveLibraries(resolved, { platform, features: {} })) {
    if (!(await isFileValid(resolveInside(dirs.libraries, l.artifact.path), { size: l.artifact.size }))) missingLibs++;
  }
  if (missingLibs) problems.push(`Не хватает библиотек: ${missingLibs}`);
  if (resolved.assetIndex) {
    const idx = await readJson<AssetIndex>(path.join(dirs.assets, 'indexes', `${resolved.assetIndex.id}.json`)).catch(() => null);
    if (!idx) problems.push('Нет индекса ресурсов');
    else {
      let missing = 0;
      for (const o of Object.values(idx.objects)) {
        try {
          await fs.access(path.join(dirs.assets, 'objects', o.hash.slice(0, 2), o.hash));
        } catch {
          missing++;
        }
      }
      if (missing) problems.push(`Не хватает файлов ресурсов: ${missing}`);
    }
  }
  return problems;
}

/** Unpack legacy natives (pre-1.19) into a fresh per-instance directory. */
export async function extractNatives(libs: ResolvedLibrary[], librariesDir: string, nativesDir: string): Promise<void> {
  await fs.rm(nativesDir, { recursive: true, force: true });
  await fs.mkdir(nativesDir, { recursive: true });
  for (const lib of libs.filter((l) => l.native)) {
    const zip = new AdmZip(resolveInside(librariesDir, lib.artifact.path));
    for (const e of zip.getEntries()) {
      if (e.isDirectory) continue;
      if (lib.extractExclude.some((x) => e.entryName.startsWith(x))) continue;
      const dest = resolveInside(nativesDir, e.entryName); // zip-slip guard
      await fs.mkdir(path.dirname(dest), { recursive: true });
      await fs.writeFile(dest, e.getData());
    }
  }
}
