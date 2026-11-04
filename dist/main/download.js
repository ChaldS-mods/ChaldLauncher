"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.hashFile = hashFile;
exports.isFileValid = isFileValid;
exports.downloadFile = downloadFile;
exports.runPool = runPool;
const fs = __importStar(require("node:fs"));
const fsp = __importStar(require("node:fs/promises"));
const path = __importStar(require("node:path"));
const node_crypto_1 = require("node:crypto");
const node_stream_1 = require("node:stream");
const promises_1 = require("node:stream/promises");
const errors_1 = require("./errors");
const net_1 = require("./net");
async function hashFile(file, algo) {
    const h = (0, node_crypto_1.createHash)(algo);
    await (0, promises_1.pipeline)(fs.createReadStream(file), h);
    return h.digest('hex');
}
/** True when the file exists and matches every check we know about. */
async function isFileValid(file, spec) {
    let st;
    try {
        st = await fsp.stat(file);
    }
    catch {
        return false;
    }
    if (!st.isFile())
        return false;
    if (spec.size != null && spec.size > 0 && st.size !== spec.size)
        return false;
    if (spec.sha256)
        return (await hashFile(file, 'sha256')) === spec.sha256.toLowerCase();
    if (spec.sha1)
        return (await hashFile(file, 'sha1')) === spec.sha1.toLowerCase();
    return st.size > 0;
}
class RetryableError extends Error {
}
async function attempt(spec, opts) {
    const { res, entry } = await (0, net_1.netRequest)(spec.url, { purpose: spec.purpose, signal: opts.signal });
    if (!res.ok || !res.body) {
        await res.body?.cancel().catch(() => undefined);
        const msg = `HTTP ${res.status} (${entry.host})`;
        // 4xx (except 408/429) will not get better by retrying
        if (res.status >= 400 && res.status < 500 && res.status !== 408 && res.status !== 429) {
            throw new errors_1.AppError('HTTP_ERROR', msg);
        }
        throw new RetryableError(msg);
    }
    await fsp.mkdir(path.dirname(spec.dest), { recursive: true });
    const part = `${spec.dest}.${(0, node_crypto_1.randomBytes)(4).toString('hex')}.part`;
    const sha1 = spec.sha1 ? (0, node_crypto_1.createHash)('sha1') : null;
    const sha256 = spec.sha256 ? (0, node_crypto_1.createHash)('sha256') : null;
    let received = 0;
    const counter = new node_stream_1.Transform({
        transform(chunk, _enc, cb) {
            received += chunk.length;
            sha1?.update(chunk);
            sha256?.update(chunk);
            opts.onBytes?.(chunk.length);
            cb(null, chunk);
        },
    });
    try {
        await (0, promises_1.pipeline)(node_stream_1.Readable.fromWeb(res.body), counter, fs.createWriteStream(part), {
            signal: opts.signal,
        });
        entry.bytes = received;
        if (spec.size != null && spec.size > 0 && received !== spec.size) {
            throw new RetryableError(`Размер файла не совпал (${received} вместо ${spec.size})`);
        }
        if (sha1 && sha1.digest('hex') !== spec.sha1.toLowerCase())
            throw new RetryableError('Контрольная сумма SHA-1 не совпала');
        if (sha256 && sha256.digest('hex') !== spec.sha256.toLowerCase())
            throw new RetryableError('Контрольная сумма SHA-256 не совпала');
        await fsp.rename(part, spec.dest);
    }
    catch (e) {
        opts.onBytes?.(-received);
        await fsp.rm(part, { force: true });
        throw e;
    }
}
async function downloadFile(spec, opts = {}) {
    if (await isFileValid(spec.dest, spec)) {
        opts.onBytes?.(spec.size ?? 0);
        return;
    }
    const retries = opts.retries ?? 3;
    const delay = opts.retryDelayMs ?? 500;
    let lastError;
    for (let i = 0; i <= retries; i++) {
        if (opts.signal?.aborted)
            throw new DOMException('Aborted', 'AbortError');
        try {
            await attempt(spec, opts);
            return;
        }
        catch (e) {
            if ((0, errors_1.isAbort)(e) || opts.signal?.aborted)
                throw e;
            lastError = e;
            const retryable = e instanceof RetryableError || !(e instanceof errors_1.AppError) || e.code === 'NET_FAILED';
            if (!retryable || i === retries)
                break;
            await new Promise((r) => setTimeout(r, delay * 2 ** i));
        }
    }
    const msg = lastError instanceof Error ? lastError.message : String(lastError);
    throw new errors_1.AppError('DOWNLOAD_FAILED', `Не удалось скачать ${path.basename(spec.dest)}: ${msg}`);
}
/** Runs `worker` over items with limited concurrency; stops taking new items after the first failure. */
async function runPool(items, concurrency, worker) {
    let next = 0;
    let failure = null;
    const lanes = Array.from({ length: Math.max(1, Math.min(concurrency, items.length)) }, async () => {
        while (failure === null && next < items.length) {
            const item = items[next++];
            try {
                await worker(item);
            }
            catch (e) {
                failure ??= e;
            }
        }
    });
    await Promise.all(lanes);
    if (failure !== null)
        throw failure;
}
//# sourceMappingURL=download.js.map