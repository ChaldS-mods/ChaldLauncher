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
  'api.minecraftservices.com': 'Профиль Minecraft и смена скина',
  'textures.minecraft.net': 'Скины Minecraft (текущий скин аккаунта)',
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

/** Human-readable reason for a failed fetch (undici hides it in `cause`). */
function networkReason(e: unknown): string {
  const cause = (e as { cause?: { code?: string; message?: string } } | null)?.cause;
  const code = cause?.code ?? '';
  if (code === 'ENOTFOUND' || code === 'EAI_AGAIN') return 'не удалось найти сервер (проверь интернет или DNS)';
  if (code === 'ETIMEDOUT' || code.includes('TIMEOUT')) return 'сервер не ответил вовремя';
  if (code === 'ECONNRESET' || code === 'UND_ERR_SOCKET') return 'соединение было разорвано';
  if (code === 'ECONNREFUSED') return 'сервер отклонил соединение';
  if (code.startsWith('CERT_') || code.includes('SSL') || code.includes('TLS')) return `ошибка защищённого соединения (${code})`;
  return cause?.message ?? code ?? (e instanceof Error ? e.message : String(e));
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function netRequest(
  url: string,
  init: RequestInit & { purpose: string },
): Promise<NetResult> {
  const { purpose, ...rest } = init;
  let current = new URL(url);
  const method = (rest.method ?? 'GET').toUpperCase();
  for (let hop = 0; hop < 6; hop++) {
    checkUrl(current);
    let entry!: NetEntry;
    let res!: Response;
    // A dropped connection is common on bad networks: a GET is safe to repeat, so try up to 3 times.
    for (let attempt = 0; ; attempt++) {
      entry = {
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
      try {
        res = await fetch(current, { ...rest, redirect: 'manual' });
        break;
      } catch (e) {
        entry.error = e instanceof Error ? e.message : String(e);
        if (rest.signal?.aborted || (e instanceof Error && e.name === 'AbortError')) throw e;
        if (method !== 'GET' || attempt >= 2) {
          throw new AppError('NET_FAILED', `Нет связи с ${current.host}: ${networkReason(e)}. Проверь интернет и повтори.`);
        }
        await sleep(400 * 2 ** attempt);
      }
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
