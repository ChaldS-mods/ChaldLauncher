import * as path from 'node:path';
import * as fs from 'node:fs/promises';
import * as http from 'node:http';
import { createHash, randomBytes } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import type { AccountMode, AuthState, DeviceCodeInfo } from '../shared/types';
import { offlineNameSchema } from '../shared/schemas';
import { AppError, isAbort } from './errors';
import type { LaunchAuth } from './launchArgs';
import { netRequest } from './net';
import { offlineUuid } from './offline';

/** Subset of Electron's safeStorage so the module stays testable. */
export interface SecretBox {
  isEncryptionAvailable(): boolean;
  encryptString(s: string): Buffer;
  decryptString(b: Buffer): string;
}

export interface AccountConfig { mode: AccountMode; offlineName: string; msClientId: string }

interface Stored { refreshToken: string; uuid: string; name: string; clientId: string }
interface Session { accessToken: string; expiresAt: number; uuid: string; name: string }

const SCOPE = 'XboxLive.signin offline_access';
const TENANT = 'https://login.microsoftonline.com/consumers/oauth2/v2.0';

interface TokenResponse { access_token: string; refresh_token?: string; error?: string; error_description?: string }

async function form<T>(url: string, body: Record<string, string>, purpose: string, signal?: AbortSignal): Promise<T> {
  const { res, entry } = await netRequest(url, {
    method: 'POST',
    purpose,
    signal,
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(body).toString(),
  });
  const text = await res.text();
  entry.bytes = Buffer.byteLength(text);
  return JSON.parse(text) as T;
}

async function postJson<T>(url: string, body: unknown, purpose: string, signal?: AbortSignal, token?: string): Promise<T> {
  const { res, entry } = await netRequest(url, {
    method: 'POST',
    purpose,
    signal,
    headers: { 'Content-Type': 'application/json', Accept: 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  entry.bytes = Buffer.byteLength(text);
  if (!res.ok) {
    let xerr: number | undefined;
    try { xerr = (JSON.parse(text) as { XErr?: number }).XErr; } catch { /* not json */ }
    throw new AppError('AUTH_HTTP', xboxError(xerr) ?? `Ошибка авторизации (HTTP ${res.status}, ${entry.host})`);
  }
  return JSON.parse(text) as T;
}

function xboxError(code?: number): string | null {
  switch (code) {
    case 2148916233: return 'У этого аккаунта Microsoft нет профиля Xbox. Создай его на xbox.com.';
    case 2148916238: return 'Детский аккаунт: добавь его в семейную группу Microsoft, чтобы играть.';
    case 2148916235: return 'Xbox Live недоступен в твоей стране.';
    default: return null;
  }
}

/** Microsoft token -> Xbox Live -> XSTS -> Minecraft access token + profile. */
async function minecraftLogin(msToken: string, signal?: AbortSignal): Promise<Session> {
  const xbl = await postJson<{ Token: string }>('https://user.auth.xboxlive.com/user/authenticate', {
    Properties: { AuthMethod: 'RPS', SiteName: 'user.auth.xboxlive.com', RpsTicket: `d=${msToken}` },
    RelyingParty: 'http://auth.xboxlive.com',
    TokenType: 'JWT',
  }, 'Xbox Live: вход', signal);
  const xsts = await postJson<{ Token: string; DisplayClaims: { xui: { uhs: string }[] } }>('https://xsts.auth.xboxlive.com/xsts/authorize', {
    Properties: { SandboxId: 'RETAIL', UserTokens: [xbl.Token] },
    RelyingParty: 'rp://api.minecraftservices.com/',
    TokenType: 'JWT',
  }, 'Xbox Live: XSTS', signal);
  const uhs = xsts.DisplayClaims.xui[0]?.uhs;
  if (!uhs) throw new AppError('AUTH_HTTP', 'Xbox Live не вернул идентификатор пользователя');
  const mc = await postJson<{ access_token: string; expires_in: number }>('https://api.minecraftservices.com/authentication/login_with_xbox', {
    identityToken: `XBL3.0 x=${uhs};${xsts.Token}`,
  }, 'Minecraft: вход', signal);

  const { res, entry } = await netRequest('https://api.minecraftservices.com/minecraft/profile', {
    purpose: 'Minecraft: профиль',
    signal,
    headers: { Authorization: `Bearer ${mc.access_token}` },
  });
  const text = await res.text();
  entry.bytes = Buffer.byteLength(text);
  if (res.status === 404) throw new AppError('AUTH_NO_GAME', 'На этом аккаунте нет Minecraft Java Edition. Игра должна быть куплена.');
  if (!res.ok) throw new AppError('AUTH_HTTP', `Не удалось получить профиль Minecraft (HTTP ${res.status})`);
  const profile = JSON.parse(text) as { id: string; name: string };
  const uuid = profile.id.replace(/^(.{8})(.{4})(.{4})(.{4})(.{12})$/, '$1-$2-$3-$4-$5');
  return { accessToken: mc.access_token, expiresAt: Date.now() + mc.expires_in * 1000, uuid, name: profile.name };
}

export class AuthService {
  private session: Session | null = null;
  private stored: Stored | null = null;
  private loginAbort: AbortController | null = null;
  private loaded = false;

  constructor(
    private file: string,
    private box: SecretBox,
    private getConfig: () => Promise<AccountConfig>,
    private saveConfig: (patch: Partial<Pick<AccountConfig, 'mode' | 'offlineName'>>) => Promise<void>,
    private emitDeviceCode: (c: DeviceCodeInfo) => void,
    private openExternal: (url: string) => void,
    private onChange: (s: AuthState) => void,
  ) {}

  private async load(): Promise<void> {
    if (this.loaded) return;
    this.loaded = true;
    if (!this.box.isEncryptionAvailable()) return;
    try {
      const buf = await fs.readFile(this.file);
      this.stored = JSON.parse(this.box.decryptString(buf)) as Stored;
    } catch {
      this.stored = null;
    }
  }

  /** Tokens are only ever written encrypted. Without OS-level encryption nothing is persisted. */
  private async persist(): Promise<void> {
    if (!this.box.isEncryptionAvailable() || !this.stored) return;
    await fs.mkdir(path.dirname(this.file), { recursive: true });
    await fs.writeFile(this.file, this.box.encryptString(JSON.stringify(this.stored)), { mode: 0o600 });
  }

  async state(): Promise<AuthState> {
    await this.load();
    const cfg = await this.getConfig();
    const base = { configured: cfg.msClientId !== '', encryptionAvailable: this.box.isEncryptionAvailable() };
    if (cfg.mode === 'offline') {
      const ok = offlineNameSchema.safeParse(cfg.offlineName).success;
      return { mode: 'offline', loggedIn: ok, name: ok ? cfg.offlineName : null, uuid: ok ? offlineUuid(cfg.offlineName) : null, ...base };
    }
    const who = this.session ?? this.stored;
    return { mode: 'microsoft', loggedIn: !!who, name: who?.name ?? null, uuid: who?.uuid ?? null, ...base };
  }

  /** Re-emit the current state, e.g. after the account settings changed. */
  async refresh(): Promise<AuthState> {
    return this.notify();
  }

  /** Offline profile: a nickname and a deterministic UUID. No tokens, nothing is sent anywhere. */
  async setOffline(name: string): Promise<AuthState> {
    const parsed = offlineNameSchema.safeParse(name);
    if (!parsed.success) throw new AppError('OFFLINE_NAME_INVALID', parsed.error.issues[0]?.message ?? 'Некорректный ник');
    await this.saveConfig({ mode: 'offline', offlineName: parsed.data });
    return this.notify();
  }

  private async notify(): Promise<AuthState> {
    const s = await this.state();
    this.onChange(s);
    return s;
  }

  /**
   * method 'browser': system browser + PKCE on a loopback redirect (like the official launcher);
   * method 'code': device-code flow (type a code on microsoft.com), a fallback when the browser flow is blocked.
   */
  async login(method: 'browser' | 'code' = 'browser'): Promise<AuthState> {
    await this.load();
    const clientId = (await this.getConfig()).msClientId;
    if (!clientId) {
      throw new AppError('AUTH_NOT_CONFIGURED', 'Не указан Azure Client ID: без него вход через Microsoft невозможен. Укажи его в настройках или используй офлайн-режим.');
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
    } catch (e) {
      if (isAbort(e)) throw new AppError('AUTH_CANCELLED', 'Вход отменён');
      throw e;
    } finally {
      if (this.loginAbort === ac) this.loginAbort = null;
    }
  }

  private async deviceFlow(clientId: string, signal: AbortSignal): Promise<TokenResponse> {
    const dc = await form<{ device_code: string; user_code: string; verification_uri: string; expires_in: number; interval: number; error?: string; error_description?: string }>(
      `${TENANT}/devicecode`, { client_id: clientId, scope: SCOPE }, 'Вход Microsoft: код устройства', signal,
    );
    if (!dc.device_code) throw new AppError('AUTH_HTTP', dc.error_description ?? 'Microsoft отклонил запрос входа');
    this.emitDeviceCode({ userCode: dc.user_code, verificationUri: dc.verification_uri, expiresInSec: dc.expires_in });
    if (/^https:\/\/(www\.)?microsoft\.com\//.test(dc.verification_uri) || /^https:\/\/login\.live\.com\//.test(dc.verification_uri)) {
      this.openExternal(dc.verification_uri);
    }

    const deadline = Date.now() + dc.expires_in * 1000;
    let interval = Math.max(2, dc.interval) * 1000;
    while (Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, interval));
      if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
      const t = await form<TokenResponse>(`${TENANT}/token`, {
        grant_type: 'urn:ietf:params:oauth:grant-type:device_code', client_id: clientId, device_code: dc.device_code,
      }, 'Вход Microsoft: ожидание подтверждения', signal);
      if (t.access_token) return t;
      if (t.error === 'authorization_pending') continue;
      if (t.error === 'slow_down') { interval += 5000; continue; }
      throw new AppError('AUTH_DENIED', t.error === 'authorization_declined' ? 'Вход отклонён' : (t.error_description ?? 'Вход не удался'));
    }
    throw new AppError('AUTH_EXPIRED', 'Время ожидания входа истекло');
  }

  /** Authorization code + PKCE. The redirect goes to a one-shot server on 127.0.0.1 that lives only while we wait. */
  private async browserFlow(clientId: string, signal: AbortSignal): Promise<TokenResponse> {
    const b64url = (b: Buffer) => b.toString('base64url');
    const verifier = b64url(randomBytes(48));
    const challenge = b64url(createHash('sha256').update(verifier).digest());
    const state = b64url(randomBytes(16));

    const server = http.createServer();
    const port = await new Promise<number>((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', () => resolve((server.address() as AddressInfo).port));
    }).catch((e: unknown) => {
      throw new AppError('AUTH_LOOPBACK', `Не удалось открыть локальный порт для входа: ${e instanceof Error ? e.message : e}. Используй вход по коду.`);
    });
    const redirectUri = `http://localhost:${port}`;

    const page = (title: string, text: string) =>
      `<!doctype html><meta charset="utf-8"><title>ChaldLauncher</title><body style="font:16px system-ui;background:#020d18;color:#e6f4ff;display:grid;place-items:center;height:100vh;margin:0"><div style="text-align:center"><h2>${title}</h2><p>${text}</p></div>`;

    try {
      const result = await new Promise<{ code: string } | { error: string }>((resolve, reject) => {
        const timer = setTimeout(() => reject(new AppError('AUTH_EXPIRED', 'Время ожидания входа истекло')), 5 * 60_000);
        const finish = () => clearTimeout(timer);
        signal.addEventListener('abort', () => { finish(); reject(new DOMException('Aborted', 'AbortError')); }, { once: true });

        server.on('request', (req, res) => {
          const u = new URL(req.url ?? '/', redirectUri);
          const reply = (status: number, html: string) => { res.writeHead(status, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(html); };
          if (req.method !== 'GET' || u.pathname !== '/') return reply(404, '');
          const error = u.searchParams.get('error');
          const code = u.searchParams.get('code');
          if (u.searchParams.get('state') !== state) return reply(400, page('Неверный запрос', 'Вернись в ChaldLauncher и повтори вход.'));
          if (error) {
            reply(200, page('Вход не выполнен', 'Можно закрыть вкладку и вернуться в лаунчер.'));
            finish();
            return resolve({ error: u.searchParams.get('error_description') ?? error });
          }
          if (!code) return reply(400, page('Нет кода входа', 'Вернись в ChaldLauncher и повтори вход.'));
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

      if ('error' in result) throw new AppError('AUTH_DENIED', `Вход не удался: ${result.error}`);
      const t = await form<TokenResponse>(`${TENANT}/token`, {
        grant_type: 'authorization_code', client_id: clientId, code: result.code, redirect_uri: redirectUri,
        code_verifier: verifier, scope: SCOPE,
      }, 'Вход Microsoft: обмен кода', signal);
      if (!t.access_token) throw new AppError('AUTH_DENIED', t.error_description ?? 'Microsoft не выдал токен');
      return t;
    } finally {
      server.close();
      server.closeAllConnections?.();
    }
  }

  cancel(): void {
    this.loginAbort?.abort();
  }

  async logout(): Promise<AuthState> {
    this.session = null;
    this.stored = null;
    await fs.rm(this.file, { force: true });
    return this.notify();
  }

  /** Used only by the main process when launching the game. The token never goes to the renderer. */
  async getLaunchAuth(): Promise<LaunchAuth> {
    await this.load();
    const cfg = await this.getConfig();
    if (cfg.mode === 'offline') {
      if (!offlineNameSchema.safeParse(cfg.offlineName).success) {
        throw new AppError('AUTH_REQUIRED', 'Укажи ник для офлайн-режима в настройках.');
      }
      // Not a Microsoft session: placeholder token and the legacy user type, as for any offline launch.
      return { name: cfg.offlineName, uuid: offlineUuid(cfg.offlineName), accessToken: '0', userType: 'legacy' };
    }
    if (this.session && this.session.expiresAt - Date.now() > 5 * 60_000) {
      return { name: this.session.name, uuid: this.session.uuid, accessToken: this.session.accessToken, userType: 'msa' };
    }
    if (!this.stored?.refreshToken) throw new AppError('AUTH_REQUIRED', 'Войди в аккаунт Microsoft, чтобы запустить игру.');
    const clientId = this.stored.clientId || cfg.msClientId;
    const t = await form<TokenResponse>(`${TENANT}/token`, {
      grant_type: 'refresh_token', client_id: clientId, refresh_token: this.stored.refreshToken, scope: SCOPE,
    }, 'Вход Microsoft: обновление сессии');
    if (!t.access_token) throw new AppError('AUTH_REQUIRED', 'Сессия истекла. Войди в аккаунт заново.');
    this.session = await minecraftLogin(t.access_token);
    this.stored = { ...this.stored, refreshToken: t.refresh_token ?? this.stored.refreshToken, uuid: this.session.uuid, name: this.session.name };
    await this.persist();
    return { name: this.session.name, uuid: this.session.uuid, accessToken: this.session.accessToken, userType: 'msa' };
  }
}
