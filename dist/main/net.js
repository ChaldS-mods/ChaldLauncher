"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.__allowHostForTests = __allowHostForTests;
exports.allowedHosts = allowedHosts;
exports.getNetLog = getNetLog;
exports.clearNetLog = clearNetLog;
exports.allowFriendsHttpHost = allowFriendsHttpHost;
exports.netRequest = netRequest;
exports.netJson = netJson;
exports.netText = netText;
const errors_1 = require("./errors");
const dns_1 = require("./dns");
/**
 * Every outgoing request of the launcher goes through here.
 * Only hosts from this list are reachable; each request is logged for the UI.
 */
const ALLOWED_HOSTS = {
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
    'media.modrinth.com': 'Иконки и медиа (Modrinth)',
    'api.curseforge.com': 'Поиск модов (CurseForge)',
    'edge.forgecdn.net': 'Файлы модов (CurseForge CDN)',
    'media.forgecdn.net': 'Файлы и иконки (CurseForge CDN)',
    'mediafilez.forgecdn.net': 'Файлы модов (CurseForge CDN)',
    'raw.githubusercontent.com': 'Файлы сборок (GitHub)',
    'gitlab.com': 'Файлы сборок (GitLab)',
    'login.microsoftonline.com': 'Вход Microsoft',
    'user.auth.xboxlive.com': 'Вход Xbox Live',
    'xsts.auth.xboxlive.com': 'Вход Xbox Live (XSTS)',
    'api.minecraftservices.com': 'Профиль Minecraft и смена скина',
    'textures.minecraft.net': 'Скины Minecraft (текущий скин аккаунта)',
    // Local Chald Friends test server
    '127.0.0.1': 'Chald Friends (локальный сервер)',
    'localhost': 'Chald Friends (локальный сервер)',
    'chaldserver.dynmap.xyz': 'Chald Friends (сервер)',
};
/** Allow plain HTTP for these friends hosts (in addition to loopback). */
const FRIENDS_HTTP_HOSTS = new Set(['127.0.0.1', 'localhost', 'chaldserver.dynmap.xyz']);
const extraHosts = new Set();
/** Tests only: allow a local http server. */
function __allowHostForTests(host) {
    extraHosts.add(host);
}
function allowedHosts() {
    return Object.keys(ALLOWED_HOSTS);
}
const MAX_LOG = 500;
const entries = [];
let counter = 0;
function getNetLog() {
    return entries.slice();
}
function clearNetLog() {
    entries.length = 0;
}
function push(entry) {
    entries.push(entry);
    if (entries.length > MAX_LOG)
        entries.shift();
}
// DNS-over-HTTPS lookups are requests too: show them in the same log
(0, dns_1.setDnsLogger)((e) => push({ id: ++counter, time: new Date().toISOString(), method: 'GET', host: e.host, path: e.path, status: e.status, bytes: e.bytes, purpose: 'DNS-запрос (DoH)', error: e.error }));
function checkUrl(u) {
    const host = u.hostname;
    if (extraHosts.has(host))
        return;
    // Chald Friends: allow plain HTTP for loopback + configured public IP
    const friendsHttp = FRIENDS_HTTP_HOSTS.has(host) && u.protocol === 'http:';
    if (u.protocol !== 'https:' && !friendsHttp) {
        throw new errors_1.AppError('NET_BLOCKED', `Заблокирован небезопасный протокол: ${u.protocol}`);
    }
    if (!(host in ALLOWED_HOSTS) && !friendsHttp && !extraHosts.has(host)) {
        throw new errors_1.AppError('NET_BLOCKED', `Хост не в списке разрешённых: ${host}`);
    }
}
/** Call when friendsServerUrl changes — allows that host over HTTP. */
function allowFriendsHttpHost(host) {
    if (!host)
        return;
    FRIENDS_HTTP_HOSTS.add(host);
    if (!(host in ALLOWED_HOSTS)) {
        ALLOWED_HOSTS[host] = 'Chald Friends (из настроек)';
    }
}
/** Human-readable reason for a failed fetch (undici hides it in `cause`). */
function networkReason(e) {
    const cause = e?.cause;
    const code = cause?.code ?? '';
    if (code === 'DNS_FAILED')
        return cause?.message ?? 'DNS-сервер не отвечает (проверь настройки DNS)';
    if (code === 'ENOTFOUND' || code === 'EAI_AGAIN')
        return 'не удалось найти сервер (проверь интернет или DNS)';
    if (code === 'ETIMEDOUT' || code.includes('TIMEOUT'))
        return 'сервер не ответил вовремя';
    if (code === 'ECONNRESET' || code === 'UND_ERR_SOCKET')
        return 'соединение было разорвано';
    if (code === 'ECONNREFUSED')
        return 'сервер отклонил соединение';
    if (code.startsWith('CERT_') || code.includes('SSL') || code.includes('TLS'))
        return `ошибка защищённого соединения (${code})`;
    return cause?.message ?? code ?? (e instanceof Error ? e.message : String(e));
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function netRequest(url, init) {
    const { purpose, idempotent, ...rest } = init;
    let current = new URL(url);
    const method = (rest.method ?? 'GET').toUpperCase();
    for (let hop = 0; hop < 6; hop++) {
        checkUrl(current);
        let entry;
        let res;
        // A dropped connection is common on bad networks: a GET is safe to repeat, so try up to 3 times.
        for (let attempt = 0;; attempt++) {
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
                res = await (0, dns_1.dnsFetch)(current, { ...rest, redirect: 'manual' });
                break;
            }
            catch (e) {
                entry.error = e instanceof Error ? e.message : String(e);
                if (rest.signal?.aborted || (e instanceof Error && e.name === 'AbortError'))
                    throw e;
                if ((method !== 'GET' && !idempotent) || attempt >= 2) {
                    throw new errors_1.AppError('NET_FAILED', `Нет связи с ${current.host}: ${networkReason(e)}. Проверь интернет и повтори.`);
                }
                await sleep(400 * 2 ** attempt);
            }
        }
        entry.status = res.status;
        if (res.status >= 300 && res.status < 400 && res.headers.get('location')) {
            current = new URL(res.headers.get('location'), current);
            continue;
        }
        return { res, entry };
    }
    throw new errors_1.AppError('NET_REDIRECTS', 'Слишком много перенаправлений');
}
/** Seconds to wait before repeating a request that got 429 / 5xx (Retry-After, Modrinth's X-Ratelimit-Reset, or backoff). */
function retryDelayMs(res, attempt) {
    const hdr = Number(res.headers.get('retry-after') ?? res.headers.get('x-ratelimit-reset'));
    const sec = Number.isFinite(hdr) && hdr > 0 ? hdr : 1.5 * 2 ** attempt;
    return Math.min(sec, 30) * 1000;
}
async function netJson(url, init) {
    const safeToRepeat = (init.method ?? 'GET').toUpperCase() === 'GET' || init.idempotent === true;
    for (let attempt = 0;; attempt++) {
        const { res, entry } = await netRequest(url, init);
        const text = await res.text();
        entry.bytes = Buffer.byteLength(text);
        const transient = res.status === 429 || res.status === 502 || res.status === 503 || res.status === 504;
        if (transient && safeToRepeat && attempt < 4) {
            await sleep(retryDelayMs(res, attempt));
            if (init.signal?.aborted)
                throw new DOMException('Aborted', 'AbortError');
            continue;
        }
        if (!res.ok)
            throw new errors_1.AppError('HTTP_ERROR', `HTTP ${res.status} от ${entry.host}`);
        return JSON.parse(text);
    }
}
async function netText(url, purpose, signal) {
    const { res, entry } = await netRequest(url, { purpose, signal });
    const text = await res.text();
    entry.bytes = Buffer.byteLength(text);
    if (!res.ok)
        throw new errors_1.AppError('HTTP_ERROR', `HTTP ${res.status} от ${entry.host}`);
    return text;
}
//# sourceMappingURL=net.js.map