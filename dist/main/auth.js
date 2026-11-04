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
exports.AuthService = void 0;
const path = __importStar(require("node:path"));
const fs = __importStar(require("node:fs/promises"));
const http = __importStar(require("node:http"));
const node_crypto_1 = require("node:crypto");
const schemas_1 = require("../shared/schemas");
const errors_1 = require("./errors");
const net_1 = require("./net");
const offline_1 = require("./offline");
const SCOPE = 'XboxLive.signin offline_access';
const TENANT = 'https://login.microsoftonline.com/consumers/oauth2/v2.0';
async function form(url, body, purpose, signal) {
    const { res, entry } = await (0, net_1.netRequest)(url, {
        method: 'POST',
        purpose,
        signal,
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams(body).toString(),
    });
    const text = await res.text();
    entry.bytes = Buffer.byteLength(text);
    return JSON.parse(text);
}
async function postJson(url, body, purpose, signal, token) {
    const { res, entry } = await (0, net_1.netRequest)(url, {
        method: 'POST',
        purpose,
        signal,
        headers: { 'Content-Type': 'application/json', Accept: 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify(body),
    });
    const text = await res.text();
    entry.bytes = Buffer.byteLength(text);
    if (!res.ok) {
        let xerr;
        try {
            xerr = JSON.parse(text).XErr;
        }
        catch { /* not json */ }
        throw new errors_1.AppError('AUTH_HTTP', xboxError(xerr) ?? `Ошибка авторизации (HTTP ${res.status}, ${entry.host})`);
    }
    return JSON.parse(text);
}
function xboxError(code) {
    switch (code) {
        case 2148916233: return 'У этого аккаунта Microsoft нет профиля Xbox. Создай его на xbox.com.';
        case 2148916238: return 'Детский аккаунт: добавь его в семейную группу Microsoft, чтобы играть.';
        case 2148916235: return 'Xbox Live недоступен в твоей стране.';
        default: return null;
    }
}
/** Microsoft token -> Xbox Live -> XSTS -> Minecraft access token + profile. */
async function minecraftLogin(msToken, signal) {
    const xbl = await postJson('https://user.auth.xboxlive.com/user/authenticate', {
        Properties: { AuthMethod: 'RPS', SiteName: 'user.auth.xboxlive.com', RpsTicket: `d=${msToken}` },
        RelyingParty: 'http://auth.xboxlive.com',
        TokenType: 'JWT',
    }, 'Xbox Live: вход', signal);
    const xsts = await postJson('https://xsts.auth.xboxlive.com/xsts/authorize', {
        Properties: { SandboxId: 'RETAIL', UserTokens: [xbl.Token] },
        RelyingParty: 'rp://api.minecraftservices.com/',
        TokenType: 'JWT',
    }, 'Xbox Live: XSTS', signal);
    const uhs = xsts.DisplayClaims.xui[0]?.uhs;
    if (!uhs)
        throw new errors_1.AppError('AUTH_HTTP', 'Xbox Live не вернул идентификатор пользователя');
    const mc = await postJson('https://api.minecraftservices.com/authentication/login_with_xbox', {
        identityToken: `XBL3.0 x=${uhs};${xsts.Token}`,
    }, 'Minecraft: вход', signal);
    const { res, entry } = await (0, net_1.netRequest)('https://api.minecraftservices.com/minecraft/profile', {
        purpose: 'Minecraft: профиль',
        signal,
        headers: { Authorization: `Bearer ${mc.access_token}` },
    });
    const text = await res.text();
    entry.bytes = Buffer.byteLength(text);
    if (res.status === 404)
        throw new errors_1.AppError('AUTH_NO_GAME', 'На этом аккаунте нет Minecraft Java Edition. Игра должна быть куплена.');
    if (!res.ok)
        throw new errors_1.AppError('AUTH_HTTP', `Не удалось получить профиль Minecraft (HTTP ${res.status})`);
    const profile = JSON.parse(text);
    const uuid = profile.id.replace(/^(.{8})(.{4})(.{4})(.{4})(.{12})$/, '$1-$2-$3-$4-$5');
    return { accessToken: mc.access_token, expiresAt: Date.now() + mc.expires_in * 1000, uuid, name: profile.name };
}
class AuthService {
    file;
    box;
    getConfig;
    saveConfig;
    emitDeviceCode;
    openExternal;
    onChange;
    session = null;
    stored = null;
    loginAbort = null;
    loaded = false;
    constructor(file, box, getConfig, saveConfig, emitDeviceCode, openExternal, onChange) {
        this.file = file;
        this.box = box;
        this.getConfig = getConfig;
        this.saveConfig = saveConfig;
        this.emitDeviceCode = emitDeviceCode;
        this.openExternal = openExternal;
        this.onChange = onChange;
    }
    async load() {
        if (this.loaded)
            return;
        this.loaded = true;
        try {
            const buf = await fs.readFile(this.file);
            if (this.box.isEncryptionAvailable()) {
                this.stored = JSON.parse(this.box.decryptString(buf));
            }
            else {
                // fallback: plain JSON when keyring is unavailable (Linux without gnome-keyring/kwallet)
                this.stored = JSON.parse(buf.toString('utf8'));
            }
        }
        catch {
            this.stored = null;
        }
    }
    /** Tokens are written encrypted when possible.
     *  On Linux without keyring we fall back to plain JSON (still mode 0o600). */
    async persist() {
        if (!this.stored)
            return;
        await fs.mkdir(path.dirname(this.file), { recursive: true });
        if (this.box.isEncryptionAvailable()) {
            await fs.writeFile(this.file, this.box.encryptString(JSON.stringify(this.stored)), { mode: 0o600 });
        }
        else {
            await fs.writeFile(this.file, JSON.stringify(this.stored), { mode: 0o600 });
        }
    }
    async state() {
        await this.load();
        const cfg = await this.getConfig();
        const base = { configured: cfg.msClientId !== '', encryptionAvailable: this.box.isEncryptionAvailable() };
        if (cfg.mode === 'offline') {
            const ok = schemas_1.offlineNameSchema.safeParse(cfg.offlineName).success;
            return { mode: 'offline', loggedIn: ok, name: ok ? cfg.offlineName : null, uuid: ok ? (0, offline_1.offlineUuid)(cfg.offlineName) : null, ...base };
        }
        const who = this.session ?? this.stored;
        return { mode: 'microsoft', loggedIn: !!who, name: who?.name ?? null, uuid: who?.uuid ?? null, ...base };
    }
    /** Re-emit the current state, e.g. after the account settings changed. */
    async refresh() {
        return this.notify();
    }
    /** Offline profile: a nickname and a deterministic UUID. No tokens, nothing is sent anywhere. */
    async setOffline(name) {
        const parsed = schemas_1.offlineNameSchema.safeParse(name);
        if (!parsed.success)
            throw new errors_1.AppError('OFFLINE_NAME_INVALID', parsed.error.issues[0]?.message ?? 'Некорректный ник');
        await this.saveConfig({ mode: 'offline', offlineName: parsed.data });
        return this.notify();
    }
    async notify() {
        const s = await this.state();
        this.onChange(s);
        return s;
    }
    /**
     * method 'browser': system browser + PKCE on a loopback redirect (like the official launcher);
     * method 'code': device-code flow (type a code on microsoft.com), a fallback when the browser flow is blocked.
     */
    async login(method = 'browser') {
        await this.load();
        const clientId = (await this.getConfig()).msClientId;
        if (!clientId) {
            throw new errors_1.AppError('AUTH_NOT_CONFIGURED', 'Не указан Azure Client ID: без него вход через Microsoft невозможен. Укажи его в настройках или используй офлайн-режим.');
        }
        this.loginAbort?.abort();
        const ac = new AbortController();
        this.loginAbort = ac;
        try {
            const tokens = method === 'browser' ? await this.browserFlow(clientId, ac.signal) : await this.deviceFlow(clientId, ac.signal);
            const session = await minecraftLogin(tokens.access_token, ac.signal);
            this.session = session;
            this.stored = { refreshToken: tokens.refresh_token ?? '', uuid: session.uuid, name: session.name, clientId };
            await this.persist();
            await this.saveConfig({ mode: 'microsoft' });
            return await this.notify();
        }
        catch (e) {
            if ((0, errors_1.isAbort)(e))
                throw new errors_1.AppError('AUTH_CANCELLED', 'Вход отменён');
            throw e;
        }
        finally {
            if (this.loginAbort === ac)
                this.loginAbort = null;
        }
    }
    async deviceFlow(clientId, signal) {
        const dc = await form(`${TENANT}/devicecode`, { client_id: clientId, scope: SCOPE }, 'Вход Microsoft: код устройства', signal);
        if (!dc.device_code)
            throw new errors_1.AppError('AUTH_HTTP', dc.error_description ?? 'Microsoft отклонил запрос входа');
        this.emitDeviceCode({ userCode: dc.user_code, verificationUri: dc.verification_uri, expiresInSec: dc.expires_in });
        if (/^https:\/\/(www\.)?microsoft\.com\//.test(dc.verification_uri) || /^https:\/\/login\.live\.com\//.test(dc.verification_uri)) {
            this.openExternal(dc.verification_uri);
        }
        const deadline = Date.now() + dc.expires_in * 1000;
        let interval = Math.max(2, dc.interval) * 1000;
        while (Date.now() < deadline) {
            await new Promise((r) => setTimeout(r, interval));
            if (signal.aborted)
                throw new DOMException('Aborted', 'AbortError');
            const t = await form(`${TENANT}/token`, {
                grant_type: 'urn:ietf:params:oauth:grant-type:device_code', client_id: clientId, device_code: dc.device_code,
            }, 'Вход Microsoft: ожидание подтверждения', signal);
            if (t.access_token)
                return t;
            if (t.error === 'authorization_pending')
                continue;
            if (t.error === 'slow_down') {
                interval += 5000;
                continue;
            }
            throw new errors_1.AppError('AUTH_DENIED', t.error === 'authorization_declined' ? 'Вход отклонён' : (t.error_description ?? 'Вход не удался'));
        }
        throw new errors_1.AppError('AUTH_EXPIRED', 'Время ожидания входа истекло');
    }
    /** Authorization code + PKCE. The redirect goes to a one-shot server on 127.0.0.1 that lives only while we wait. */
    async browserFlow(clientId, signal) {
        const b64url = (b) => b.toString('base64url');
        const verifier = b64url((0, node_crypto_1.randomBytes)(48));
        const challenge = b64url((0, node_crypto_1.createHash)('sha256').update(verifier).digest());
        const state = b64url((0, node_crypto_1.randomBytes)(16));
        const server = http.createServer();
        const port = await new Promise((resolve, reject) => {
            server.once('error', reject);
            server.listen(0, '127.0.0.1', () => resolve(server.address().port));
        }).catch((e) => {
            throw new errors_1.AppError('AUTH_LOOPBACK', `Не удалось открыть локальный порт для входа: ${e instanceof Error ? e.message : e}. Используй вход по коду.`);
        });
        const redirectUri = `http://localhost:${port}`;
        const page = (title, text) => `<!doctype html><meta charset="utf-8"><title>ChaldLauncher</title><body style="font:16px system-ui;background:#020d18;color:#e6f4ff;display:grid;place-items:center;height:100vh;margin:0"><div style="text-align:center"><h2>${title}</h2><p>${text}</p></div>`;
        try {
            const result = await new Promise((resolve, reject) => {
                const timer = setTimeout(() => reject(new errors_1.AppError('AUTH_EXPIRED', 'Время ожидания входа истекло')), 5 * 60_000);
                const finish = () => clearTimeout(timer);
                signal.addEventListener('abort', () => { finish(); reject(new DOMException('Aborted', 'AbortError')); }, { once: true });
                server.on('request', (req, res) => {
                    const u = new URL(req.url ?? '/', redirectUri);
                    const reply = (status, html) => { res.writeHead(status, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(html); };
                    if (req.method !== 'GET' || u.pathname !== '/')
                        return reply(404, '');
                    const error = u.searchParams.get('error');
                    const code = u.searchParams.get('code');
                    if (u.searchParams.get('state') !== state)
                        return reply(400, page('Неверный запрос', 'Вернись в ChaldLauncher и повтори вход.'));
                    if (error) {
                        reply(200, page('Вход не выполнен', 'Можно закрыть вкладку и вернуться в лаунчер.'));
                        finish();
                        return resolve({ error: u.searchParams.get('error_description') ?? error });
                    }
                    if (!code)
                        return reply(400, page('Нет кода входа', 'Вернись в ChaldLauncher и повтори вход.'));
                    reply(200, page('Готово!', 'Можно закрыть вкладку и вернуться в ChaldLauncher.'));
                    finish();
                    resolve({ code });
                });
                const url = new URL(`${TENANT}/authorize`);
                url.search = new URLSearchParams({
                    client_id: clientId, response_type: 'code', redirect_uri: redirectUri, scope: SCOPE,
                    code_challenge: challenge, code_challenge_method: 'S256', state, prompt: 'select_account',
                }).toString();
                this.openExternal(url.toString());
            });
            if ('error' in result)
                throw new errors_1.AppError('AUTH_DENIED', `Вход не удался: ${result.error}`);
            const t = await form(`${TENANT}/token`, {
                grant_type: 'authorization_code', client_id: clientId, code: result.code, redirect_uri: redirectUri,
                code_verifier: verifier, scope: SCOPE,
            }, 'Вход Microsoft: обмен кода', signal);
            if (!t.access_token)
                throw new errors_1.AppError('AUTH_DENIED', t.error_description ?? 'Microsoft не выдал токен');
            return t;
        }
        finally {
            server.close();
            server.closeAllConnections?.();
        }
    }
    cancel() {
        this.loginAbort?.abort();
    }
    async logout() {
        this.session = null;
        this.stored = null;
        await fs.rm(this.file, { force: true });
        return this.notify();
    }
    /** Used only by the main process when launching the game. The token never goes to the renderer. */
    async getLaunchAuth() {
        await this.load();
        const cfg = await this.getConfig();
        if (cfg.mode === 'offline') {
            if (!schemas_1.offlineNameSchema.safeParse(cfg.offlineName).success) {
                throw new errors_1.AppError('AUTH_REQUIRED', 'Укажи ник для офлайн-режима в настройках.');
            }
            // Not a Microsoft session: placeholder token and the legacy user type, as for any offline launch.
            return { name: cfg.offlineName, uuid: (0, offline_1.offlineUuid)(cfg.offlineName), accessToken: '0', userType: 'legacy' };
        }
        if (this.session && this.session.expiresAt - Date.now() > 5 * 60_000) {
            return { name: this.session.name, uuid: this.session.uuid, accessToken: this.session.accessToken, userType: 'msa' };
        }
        if (!this.stored?.refreshToken)
            throw new errors_1.AppError('AUTH_REQUIRED', 'Войди в аккаунт Microsoft, чтобы запустить игру.');
        const clientId = this.stored.clientId || cfg.msClientId;
        const t = await form(`${TENANT}/token`, {
            grant_type: 'refresh_token', client_id: clientId, refresh_token: this.stored.refreshToken, scope: SCOPE,
        }, 'Вход Microsoft: обновление сессии');
        if (!t.access_token)
            throw new errors_1.AppError('AUTH_REQUIRED', 'Сессия истекла. Войди в аккаунт заново.');
        this.session = await minecraftLogin(t.access_token);
        this.stored = { ...this.stored, refreshToken: t.refresh_token ?? this.stored.refreshToken, uuid: this.session.uuid, name: this.session.name };
        await this.persist();
        return { name: this.session.name, uuid: this.session.uuid, accessToken: this.session.accessToken, userType: 'msa' };
    }
}
exports.AuthService = AuthService;
//# sourceMappingURL=auth.js.map