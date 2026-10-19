import type { NetEntry } from '../shared/types';
import { AppError } from './errors';

/**
 * Every outgoing request of the launcher goes through here.
 * Only hosts from this list are reachable; each request is logged for the UI.
 */
const ALLOWED_HOSTS: Record<string, string> = {
  'piston-meta.mojang.com': 'Список версий Minecraft',
  'piston-data.mojang.com': 'Файлы игры (jar)',
  'launchermeta.mojang.com': 'Метаданные Minecraft',
  'libraries.minecraft.net': 'Библиотеки Minecraft',
  'resources.download.minecraft.net': 'Ресурсы игры (звуки, языки)',
  'meta.fabricmc.net': 'Версии Fabric',
  'maven.fabricmc.net': 'Библиотеки Fabric',
  'meta.quiltmc.org': 'Версии Quilt',
  'maven.quiltmc.org': 'Библиотеки Quilt',
  'maven.minecraftforge.net': 'Forge: установщик и библиотеки',
  'files.minecraftforge.net': 'Forge: список версий',
  'maven.neoforged.net': 'NeoForge: установщик, версии и библиотеки',
  'repo1.maven.org': 'Maven Central (библиотеки загрузчиков)',
  'api.adoptium.net': 'Поиск Java (Eclipse Temurin)',
  'github.com': 'Скачивание Java / обновления',
  'objects.githubusercontent.com': 'Скачивание Java',
  'release-assets.githubusercontent.com': 'Скачивание Java',
  'api.github.com': 'Проверка обновлений лаунчера',
  'api.modrinth.com': 'Поиск модов и сборок (Modrinth)',
  'cdn.modrinth.com': 'Файлы модов и сборок (Modrinth)',
  'raw.githubusercontent.com': 'Файлы сборок (GitHub)',
  'gitlab.com': 'Файлы сборок (GitLab)',
  'login.microsoftonline.com': 'Вход Microsoft',
  'user.auth.xboxlive.com': 'Вход Xbox Live',
  'xsts.auth.xboxlive.com': 'Вход Xbox Live (XSTS)',
  'api.minecraftservices.com': 'Профиль Minecraft',
};

const extraHosts = new Set<string>();
/** Tests only: allow a local http server. */
export function __allowHostForTests(host: string): void {
  extraHosts.add(host);
}

export function allowedHosts(): string[] {
  return Object.keys(ALLOWED_HOSTS);
}

const MAX_LOG = 500;
const entries: NetEntry[] = [];
let counter = 0;

export function getNetLog(): NetEntry[] {
  return entries.slice();
}
export function clearNetLog(): void {
  entries.length = 0;
}

function push(entry: NetEntry): void {
  entries.push(entry);
  if (entries.length > MAX_LOG) entries.shift();
}

function checkUrl(u: URL): void {
  const host = u.hostname;
  if (extraHosts.has(host)) return;
  if (u.protocol !== 'https:') throw new AppError('NET_BLOCKED', `Заблокирован небезопасный протокол: ${u.protocol}`);
  if (!(host in ALLOWED_HOSTS)) throw new AppError('NET_BLOCKED', `Хост не в списке разрешённых: ${host}`);
}

export interface NetResult {
  res: Response;
  entry: NetEntry;
}

export async function netRequest(
  url: string,
  init: RequestInit & { purpose: string },
): Promise<NetResult> {
  const { purpose, ...rest } = init;
  let current = new URL(url);
  const method = (rest.method ?? 'GET').toUpperCase();
  for (let hop = 0; hop < 6; hop++) {
    checkUrl(current);
    const entry: NetEntry = {
      id: ++counter,
      time: new Date().toISOString(),
      method,
      host: current.host,
      path: current.pathname, // query is intentionally not logged
      status: null,
      bytes: null,
      purpose,
      error: null,
    };
    push(entry);
    let res: Response;
    try {
      res = await fetch(current, { ...rest, redirect: 'manual' });
    } catch (e) {
      entry.error = e instanceof Error ? e.message : String(e);
      throw e;
    }
    entry.status = res.status;
    if (res.status >= 300 && res.status < 400 && res.headers.get('location')) {
      current = new URL(res.headers.get('location')!, current);
      continue;
    }
    return { res, entry };
  }
  throw new AppError('NET_REDIRECTS', 'Слишком много перенаправлений');
}

export async function netJson<T>(url: string, init: RequestInit & { purpose: string }): Promise<T> {
  const { res, entry } = await netRequest(url, init);
  const text = await res.text();
  entry.bytes = Buffer.byteLength(text);
  if (!res.ok) throw new AppError('HTTP_ERROR', `HTTP ${res.status} от ${entry.host}`);
  return JSON.parse(text) as T;
}

export async function netText(url: string, purpose: string, signal?: AbortSignal): Promise<string> {
  const { res, entry } = await netRequest(url, { purpose, signal });
  const text = await res.text();
  entry.bytes = Buffer.byteLength(text);
  if (!res.ok) throw new AppError('HTTP_ERROR', `HTTP ${res.status} от ${entry.host}`);
  return text;
}
