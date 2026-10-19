import * as fs from 'node:fs';
import * as fsp from 'node:fs/promises';
import * as path from 'node:path';
import { createHash, randomBytes } from 'node:crypto';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { AppError, isAbort } from './errors';
import { netRequest } from './net';

export interface DownloadSpec {
  url: string;
  dest: string;
  sha1?: string;
  sha256?: string;
  size?: number;
  purpose: string;
}

export interface DownloadOptions {
  signal?: AbortSignal;
  /** Called with byte deltas. Negative values revert bytes of a failed attempt. */
  onBytes?: (delta: number) => void;
  retries?: number;
  retryDelayMs?: number;
}

export async function hashFile(file: string, algo: 'sha1' | 'sha256'): Promise<string> {
  const h = createHash(algo);
  await pipeline(fs.createReadStream(file), h);
  return h.digest('hex');
}

/** True when the file exists and matches every check we know about. */
export async function isFileValid(file: string, spec: Pick<DownloadSpec, 'sha1' | 'sha256' | 'size'>): Promise<boolean> {
  let st: fs.Stats;
  try {
    st = await fsp.stat(file);
  } catch {
    return false;
  }
  if (!st.isFile()) return false;
  if (spec.size != null && spec.size > 0 && st.size !== spec.size) return false;
  if (spec.sha256) return (await hashFile(file, 'sha256')) === spec.sha256.toLowerCase();
  if (spec.sha1) return (await hashFile(file, 'sha1')) === spec.sha1.toLowerCase();
  return st.size > 0;
}

class RetryableError extends Error {}

async function attempt(spec: DownloadSpec, opts: DownloadOptions): Promise<void> {
  const { res, entry } = await netRequest(spec.url, { purpose: spec.purpose, signal: opts.signal });
  if (!res.ok || !res.body) {
    await res.body?.cancel().catch(() => undefined);
    const msg = `HTTP ${res.status} (${entry.host})`;
    // 4xx (except 408/429) will not get better by retrying
    if (res.status >= 400 && res.status < 500 && res.status !== 408 && res.status !== 429) {
      throw new AppError('HTTP_ERROR', msg);
    }
    throw new RetryableError(msg);
  }
  await fsp.mkdir(path.dirname(spec.dest), { recursive: true });
  const part = `${spec.dest}.${randomBytes(4).toString('hex')}.part`;
  const sha1 = spec.sha1 ? createHash('sha1') : null;
  const sha256 = spec.sha256 ? createHash('sha256') : null;
  let received = 0;
  const counter = new Transform({
    transform(chunk: Buffer, _enc, cb) {
      received += chunk.length;
      sha1?.update(chunk);
      sha256?.update(chunk);
      opts.onBytes?.(chunk.length);
      cb(null, chunk);
    },
  });
  try {
    await pipeline(Readable.fromWeb(res.body as never), counter, fs.createWriteStream(part), {
      signal: opts.signal,
    });
    entry.bytes = received;
    if (spec.size != null && spec.size > 0 && received !== spec.size) {
      throw new RetryableError(`Размер файла не совпал (${received} вместо ${spec.size})`);
    }
    if (sha1 && sha1.digest('hex') !== spec.sha1!.toLowerCase()) throw new RetryableError('Контрольная сумма SHA-1 не совпала');
    if (sha256 && sha256.digest('hex') !== spec.sha256!.toLowerCase()) throw new RetryableError('Контрольная сумма SHA-256 не совпала');
    await fsp.rename(part, spec.dest);
  } catch (e) {
    opts.onBytes?.(-received);
    await fsp.rm(part, { force: true });
    throw e;
  }
}

export async function downloadFile(spec: DownloadSpec, opts: DownloadOptions = {}): Promise<void> {
  if (await isFileValid(spec.dest, spec)) {
    opts.onBytes?.(spec.size ?? 0);
    return;
  }
  const retries = opts.retries ?? 3;
  const delay = opts.retryDelayMs ?? 500;
  let lastError: unknown;
  for (let i = 0; i <= retries; i++) {
    if (opts.signal?.aborted) throw new DOMException('Aborted', 'AbortError');
    try {
      await attempt(spec, opts);
      return;
    } catch (e) {
      if (isAbort(e) || opts.signal?.aborted) throw e;
      lastError = e;
      const retryable = e instanceof RetryableError || !(e instanceof AppError);
      if (!retryable || i === retries) break;
      await new Promise((r) => setTimeout(r, delay * 2 ** i));
    }
  }
  const msg = lastError instanceof Error ? lastError.message : String(lastError);
  throw new AppError('DOWNLOAD_FAILED', `Не удалось скачать ${path.basename(spec.dest)}: ${msg}`);
}

/** Runs `worker` over items with limited concurrency; stops taking new items after the first failure. */
export async function runPool<T>(
  items: T[],
  concurrency: number,
  worker: (item: T) => Promise<void>,
): Promise<void> {
  let next = 0;
  let failure: unknown = null;
  const lanes = Array.from({ length: Math.max(1, Math.min(concurrency, items.length)) }, async () => {
    while (failure === null && next < items.length) {
      const item = items[next++]!;
      try {
        await worker(item);
      } catch (e) {
        failure ??= e;
      }
    }
  });
  await Promise.all(lanes);
  if (failure !== null) throw failure;
}
