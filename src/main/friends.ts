import type { ChaldFriendsList, ChaldGroup, ChaldMessage, ChaldSessionResult, ChaldUser } from '../shared/types';
import { AppError } from './errors';
import { netRequest } from './net';
import type { SettingsStore } from './settings';
import { allowFriendsHttpHost } from './net';

type TokenStore = {
  get: () => string | null;
  set: (token: string | null) => void;
};

/**
 * Client for the local Chald Friends server (see chald-friends-server).
 * Auth is a simple bearer token issued by POST /chaldfriends/v1/auth/session.
 */
export class FriendsService {
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;

  constructor(
    private settings: SettingsStore,
    private tokens: TokenStore,
  ) {}

  /** Fixed friends server — not user-configurable. */
  private static readonly SERVER_URL = 'https://chaldserver.dynmap.xyz';

  private async baseUrl(): Promise<string> {
    const u = FriendsService.SERVER_URL.replace(/\/+$/, '');
    try {
      const host = new URL(u).hostname;
      allowFriendsHttpHost(host);
    } catch { /* ignore bad url */ }
    return u;
  }

  private async request<T>(
    method: string,
    path: string,
    body?: unknown,
    auth = true,
  ): Promise<T> {
    const base = await this.baseUrl();
    const headers: Record<string, string> = { Accept: 'application/json' };
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    if (auth) {
      const token = this.tokens.get();
      if (!token) throw new AppError('FRIENDS_AUTH', 'Сначала войди через Microsoft — нужен Chald ID.');
      headers.Authorization = `Bearer ${token}`;
    }
    const { res, entry } = await netRequest(`${base}${path}`, {
      method,
      purpose: `Chald Friends: ${path}`,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    entry.bytes = Buffer.byteLength(text);
    let data: unknown = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      /* not json */
    }
    if (!res.ok) {
      const msg =
        data && typeof data === 'object' && data !== null && 'detail' in data
          ? String((data as { detail: unknown }).detail)
          : data && typeof data === 'object' && data !== null && 'error' in data
            ? String((data as { error: unknown }).error)
            : text.slice(0, 200) || `HTTP ${res.status}`;
      if (res.status === 401) throw new AppError('FRIENDS_AUTH', 'Сессия Chald истекла. Обнови вход.');
      if (res.status === 404) throw new AppError('FRIENDS_NOT_FOUND', msg || 'Не найдено');
      if (res.status === 409) throw new AppError('FRIENDS_CONFLICT', msg || 'Конфликт');
      if (res.status === 0 || res.status >= 500) {
        throw new AppError('FRIENDS_DOWN', `Сервер друзей недоступен (${base}). Запусти chald-friends-server.`);
      }
      throw new AppError('FRIENDS_HTTP', msg || `Ошибка сервера друзей (HTTP ${res.status})`);
    }
    return data as T;
  }

  /** Register / refresh Chald profile from the signed-in Minecraft account. */
  async session(mcUuid: string, mcName: string, chaldId?: string | null): Promise<ChaldSessionResult> {
    const r = await this.request<ChaldSessionResult>('POST', '/chaldfriends/v1/auth/session', {
      mcUuid,
      mcName,
      chaldId: chaldId || null,
    }, false);
    if (r?.user?.token) this.tokens.set(r.user.token);
    this.startHeartbeat();
    return r;
  }

  async me(): Promise<ChaldUser> {
    const r = await this.request<{ user: ChaldUser }>('GET', '/chaldfriends/v1/me');
    return r.user;
  }

  async updateMe(patch: { displayName?: string; bio?: string; chaldId?: string }): Promise<ChaldUser> {
    const r = await this.request<{ user: ChaldUser }>('PATCH', '/chaldfriends/v1/me', patch);
    return r.user;
  }

  async search(q: string): Promise<ChaldUser[]> {
    const r = await this.request<{ users: ChaldUser[] }>(
      'GET',
      `/chaldfriends/v1/users/search?q=${encodeURIComponent(q.trim())}`,
    );
    return r.users ?? [];
  }

  async list(): Promise<ChaldFriendsList> {
    const r = await this.request<Partial<ChaldFriendsList> | null>('GET', '/chaldfriends/v1/friends');
    return {
      friends: Array.isArray(r?.friends) ? r!.friends.filter(Boolean) : [],
      incoming: Array.isArray(r?.incoming) ? r!.incoming.filter(Boolean) : [],
      outgoing: Array.isArray(r?.outgoing) ? r!.outgoing.filter(Boolean) : [],
    };
  }

  async requestFriend(to: { toChaldId?: string; toMcName?: string; toUserId?: number }): Promise<unknown> {
    return this.request('POST', '/chaldfriends/v1/friends/request', to);
  }

  async accept(requestId: number): Promise<unknown> {
    return this.request('POST', `/chaldfriends/v1/friends/accept/${requestId}`);
  }

  async reject(requestId: number): Promise<unknown> {
    return this.request('POST', `/chaldfriends/v1/friends/reject/${requestId}`);
  }

  async remove(friendUserId: number): Promise<unknown> {
    return this.request('DELETE', `/chaldfriends/v1/friends/${friendUserId}`);
  }

  async inbox(): Promise<{ conversations: import('../shared/types').ChaldConversation[] }> {
    const r = await this.request<{ conversations?: import('../shared/types').ChaldConversation[] } | null>('GET', '/chaldfriends/v1/messages/inbox');
    return { conversations: Array.isArray(r?.conversations) ? r!.conversations.filter((c) => c && c.user) : [] };
  }

  async thread(peerId: number, afterId = 0): Promise<{
    messages: import('../shared/types').ChaldMessage[];
    peer: import('../shared/types').ChaldUser | null;
  }> {
    const r = await this.request<{
      messages?: import('../shared/types').ChaldMessage[];
      peer?: import('../shared/types').ChaldUser | null;
    } | null>('GET', `/chaldfriends/v1/messages/with/${peerId}?afterId=${afterId}&limit=80`);
    return {
      messages: Array.isArray(r?.messages) ? r!.messages.filter(Boolean) : [],
      peer: r?.peer ?? null,
    };
  }

  
  /** The login is the Chald ID: both fields carry the same name. */
  async registerAccount(login: string, password: string, mcUuid: string, mcName: string): Promise<ChaldSessionResult> {
    const body: Record<string, unknown> = { login, password, mcUuid, mcName, chaldId: login };
    const data = await this.request<ChaldSessionResult>('POST', '/chaldfriends/v1/auth/register', body, false);
    this.adoptSession(data);
    return data;
  }

  async loginAccount(login: string, password: string): Promise<ChaldSessionResult> {
    const data = await this.request<ChaldSessionResult>('POST', '/chaldfriends/v1/auth/login', { login, password }, false);
    this.adoptSession(data);
    return data;
  }

  /** Persist the token and start presence; never assign to `this.me` (that is a method). */
  private adoptSession(data: ChaldSessionResult): void {
    if (data?.user?.token) this.tokens.set(data.user.token);
    this.startHeartbeat();
  }

  async sendMessage(toUserId: number, body: string, kind: string = 'text', meta?: string | object): Promise<{ message: import('../shared/types').ChaldMessage }> {
    return this.request('POST', '/chaldfriends/v1/messages', { toUserId, body, kind, meta: meta ?? undefined });
  }

  private lastPresence: { status: 'launcher' | 'game' | 'idle'; activity: string } = {
    status: 'launcher',
    activity: '',
  };

  async heartbeat(
    status: 'launcher' | 'game' | 'idle' = 'launcher',
    activity = '',
  ): Promise<void> {
    if (!this.tokens.get()) return;
    this.lastPresence = { status, activity: activity.slice(0, 64) };
    try {
      await this.request('POST', '/chaldfriends/v1/presence/heartbeat', {
        status: this.lastPresence.status,
        activity: this.lastPresence.activity,
      });
    } catch {
      /* ignore offline server during heartbeat */
    }
  }

  /** Remember activity and keep sending it on the periodic timer. */
  setPresence(status: 'launcher' | 'game' | 'idle', activity = ''): void {
    void this.heartbeat(status, activity);
  }

  startHeartbeat(): void {
    this.stopHeartbeat();
    if (!this.tokens.get()) return;
    void this.heartbeat(this.lastPresence.status, this.lastPresence.activity);
    this.heartbeatTimer = setInterval(
      () => void this.heartbeat(this.lastPresence.status, this.lastPresence.activity),
      45_000,
    );
  }

  stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  clearSession(): void {
    this.stopHeartbeat();
    this.tokens.set(null);
  }

  hasToken(): boolean {
    return !!this.tokens.get();
  }

  async sendInvite(toUserId: number, instanceName: string, address = '', note = ''): Promise<unknown> {
    return this.request('POST', '/chaldfriends/v1/invites', { toUserId, instanceName, address, note });
  }

  async listInvites(): Promise<{ incoming: unknown[]; outgoing: unknown[] }> {
    return this.request('GET', '/chaldfriends/v1/invites');
  }

  async acceptInvite(inviteId: number): Promise<unknown> {
    return this.request('POST', `/chaldfriends/v1/invites/${inviteId}/accept`);
  }

  async declineInvite(inviteId: number): Promise<unknown> {
    return this.request('POST', `/chaldfriends/v1/invites/${inviteId}/decline`);
  }

  async sendCallSignal(toUserId: number, kind: string, payload: string, groupId?: number | null): Promise<unknown> {
    return this.request('POST', '/chaldfriends/v1/calls/signal', {
      toUserId,
      kind,
      payload,
      ...(groupId ? { groupId } : {}),
    });
  }

  async pollCallSignals(): Promise<{
    signals: { id: number; fromUserId: number; kind: string; payload: string; createdAt: number; groupId?: number | null }[];
  }> {
    return this.request('GET', '/chaldfriends/v1/calls/signals');
  }

  async uploadAvatar(dataUrl: string): Promise<boolean> {
    await this.request('POST', '/chaldfriends/v1/me/avatar', { dataUrl });
    return true;
  }

  async fetchAvatarDataUrl(userId: number): Promise<string | null> {
    const base = await this.baseUrl();
    try {
      const { res } = await netRequest(`${base}/chaldfriends/v1/avatars/${userId}`, {
        method: 'GET',
        purpose: 'Chald Friends avatar',
        headers: { Accept: 'image/png' },
      });
      if (!res.ok) return null;
      const buf = Buffer.from(await res.arrayBuffer());
      if (buf.length < 32) return null;
      return `data:image/png;base64,${buf.toString('base64')}`;
    } catch {
      return null;
    }
  }

  /* ---------- group chats ---------- */

  async listGroups(): Promise<ChaldGroup[]> {
    try {
      const r = await this.request<{ groups?: ChaldGroup[] } | null>('GET', '/chaldfriends/v1/groups');
      return Array.isArray(r?.groups) ? r!.groups.filter((g) => g && g.id) : [];
    } catch (e) {
      // Older friends servers without group support: treat as empty, do not break the whole Friends page.
      if (e instanceof AppError && (e.code === 'FRIENDS_NOT_FOUND' || e.code === 'FRIENDS_HTTP')) return [];
      throw e;
    }
  }

  async createGroup(name: string, memberIds: number[] = []): Promise<ChaldGroup> {
    const r = await this.request<{ group: ChaldGroup }>('POST', '/chaldfriends/v1/groups', {
      name: name.trim().slice(0, 64),
      memberIds: memberIds.filter((id) => Number.isFinite(id)),
    });
    return r.group;
  }

  async getGroup(groupId: number): Promise<ChaldGroup> {
    const r = await this.request<{ group: ChaldGroup }>('GET', `/chaldfriends/v1/groups/${groupId}`);
    return r.group;
  }

  async addGroupMember(groupId: number, userId: number): Promise<ChaldGroup> {
    const r = await this.request<{ group: ChaldGroup }>('POST', `/chaldfriends/v1/groups/${groupId}/members`, { userId });
    return r.group;
  }

  async removeGroupMember(groupId: number, userId: number): Promise<unknown> {
    return this.request('DELETE', `/chaldfriends/v1/groups/${groupId}/members/${userId}`);
  }

  /** Rename a group (owner only). Needs PATCH /chaldfriends/v1/groups/:id on the friends server. */
  async updateGroup(groupId: number, name: string): Promise<ChaldGroup> {
    const r = await this.request<{ group: ChaldGroup }>('PATCH', `/chaldfriends/v1/groups/${groupId}`, {
      name: name.trim().slice(0, 64),
    });
    return r.group;
  }

  /** Delete a group for everyone (owner only). Needs DELETE /chaldfriends/v1/groups/:id on the friends server. */
  async deleteGroup(groupId: number): Promise<unknown> {
    return this.request('DELETE', `/chaldfriends/v1/groups/${groupId}`);
  }

  async groupThread(groupId: number, afterId = 0): Promise<{ messages: ChaldMessage[]; group: ChaldGroup | null }> {
    const r = await this.request<{
      messages?: ChaldMessage[];
      group?: ChaldGroup | null;
    } | null>('GET', `/chaldfriends/v1/groups/${groupId}/messages?afterId=${afterId}&limit=80`);
    return {
      messages: Array.isArray(r?.messages) ? r!.messages.filter(Boolean) : [],
      group: r?.group ?? null,
    };
  }

  async sendGroupMessage(
    groupId: number,
    body: string,
    kind: string = 'text',
    meta?: string | object,
  ): Promise<{ message: ChaldMessage }> {
    return this.request('POST', `/chaldfriends/v1/groups/${groupId}/messages`, {
      body,
      kind,
      meta: meta ?? undefined,
    });
  }
}
