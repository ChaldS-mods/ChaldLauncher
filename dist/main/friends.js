"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.FriendsService = void 0;
const errors_1 = require("./errors");
const net_1 = require("./net");
const net_2 = require("./net");
/**
 * Client for the local Chald Friends server (see chald-friends-server).
 * Auth is a simple bearer token issued by POST /chaldfriends/v1/auth/session.
 */
class FriendsService {
    settings;
    tokens;
    heartbeatTimer = null;
    constructor(settings, tokens) {
        this.settings = settings;
        this.tokens = tokens;
    }
    /** Fixed friends server — not user-configurable. */
    static SERVER_URL = 'https://chaldserver.dynmap.xyz';
    async baseUrl() {
        const u = FriendsService.SERVER_URL.replace(/\/+$/, '');
        try {
            const host = new URL(u).hostname;
            (0, net_2.allowFriendsHttpHost)(host);
        }
        catch { /* ignore bad url */ }
        return u;
    }
    async request(method, path, body, auth = true) {
        const base = await this.baseUrl();
        const headers = { Accept: 'application/json' };
        if (body !== undefined)
            headers['Content-Type'] = 'application/json';
        if (auth) {
            const token = this.tokens.get();
            if (!token)
                throw new errors_1.AppError('FRIENDS_AUTH', 'Сначала войди через Microsoft — нужен Chald ID.');
            headers.Authorization = `Bearer ${token}`;
        }
        const { res, entry } = await (0, net_1.netRequest)(`${base}${path}`, {
            method,
            purpose: `Chald Friends: ${path}`,
            headers,
            body: body !== undefined ? JSON.stringify(body) : undefined,
        });
        const text = await res.text();
        entry.bytes = Buffer.byteLength(text);
        let data = null;
        try {
            data = text ? JSON.parse(text) : null;
        }
        catch {
            /* not json */
        }
        if (!res.ok) {
            const msg = data && typeof data === 'object' && data !== null && 'detail' in data
                ? String(data.detail)
                : data && typeof data === 'object' && data !== null && 'error' in data
                    ? String(data.error)
                    : text.slice(0, 200) || `HTTP ${res.status}`;
            if (res.status === 401)
                throw new errors_1.AppError('FRIENDS_AUTH', 'Сессия Chald истекла. Обнови вход.');
            if (res.status === 404)
                throw new errors_1.AppError('FRIENDS_NOT_FOUND', msg || 'Не найдено');
            if (res.status === 409)
                throw new errors_1.AppError('FRIENDS_CONFLICT', msg || 'Конфликт');
            if (res.status === 0 || res.status >= 500) {
                throw new errors_1.AppError('FRIENDS_DOWN', `Сервер друзей недоступен (${base}). Запусти chald-friends-server.`);
            }
            throw new errors_1.AppError('FRIENDS_HTTP', msg || `Ошибка сервера друзей (HTTP ${res.status})`);
        }
        return data;
    }
    /** Register / refresh Chald profile from the signed-in Minecraft account. */
    async session(mcUuid, mcName, chaldId) {
        const r = await this.request('POST', '/chaldfriends/v1/auth/session', {
            mcUuid,
            mcName,
            chaldId: chaldId || null,
        }, false);
        if (r?.user?.token)
            this.tokens.set(r.user.token);
        this.startHeartbeat();
        return r;
    }
    async me() {
        const r = await this.request('GET', '/chaldfriends/v1/me');
        return r.user;
    }
    async updateMe(patch) {
        const r = await this.request('PATCH', '/chaldfriends/v1/me', patch);
        return r.user;
    }
    async search(q) {
        const r = await this.request('GET', `/chaldfriends/v1/users/search?q=${encodeURIComponent(q.trim())}`);
        return r.users ?? [];
    }
    async list() {
        const r = await this.request('GET', '/chaldfriends/v1/friends');
        return {
            friends: Array.isArray(r?.friends) ? r.friends.filter(Boolean) : [],
            incoming: Array.isArray(r?.incoming) ? r.incoming.filter(Boolean) : [],
            outgoing: Array.isArray(r?.outgoing) ? r.outgoing.filter(Boolean) : [],
        };
    }
    async requestFriend(to) {
        return this.request('POST', '/chaldfriends/v1/friends/request', to);
    }
    async accept(requestId) {
        return this.request('POST', `/chaldfriends/v1/friends/accept/${requestId}`);
    }
    async reject(requestId) {
        return this.request('POST', `/chaldfriends/v1/friends/reject/${requestId}`);
    }
    async remove(friendUserId) {
        return this.request('DELETE', `/chaldfriends/v1/friends/${friendUserId}`);
    }
    async inbox() {
        const r = await this.request('GET', '/chaldfriends/v1/messages/inbox');
        return { conversations: Array.isArray(r?.conversations) ? r.conversations.filter((c) => c && c.user) : [] };
    }
    async thread(peerId, afterId = 0) {
        const r = await this.request('GET', `/chaldfriends/v1/messages/with/${peerId}?afterId=${afterId}&limit=80`);
        return {
            messages: Array.isArray(r?.messages) ? r.messages.filter(Boolean) : [],
            peer: r?.peer ?? null,
        };
    }
    /** The login is the Chald ID: both fields carry the same name. */
    async registerAccount(login, password, mcUuid, mcName) {
        const body = { login, password, mcUuid, mcName, chaldId: login };
        const data = await this.request('POST', '/chaldfriends/v1/auth/register', body, false);
        this.adoptSession(data);
        return data;
    }
    async loginAccount(login, password) {
        const data = await this.request('POST', '/chaldfriends/v1/auth/login', { login, password }, false);
        this.adoptSession(data);
        return data;
    }
    /** Persist the token and start presence; never assign to `this.me` (that is a method). */
    adoptSession(data) {
        if (data?.user?.token)
            this.tokens.set(data.user.token);
        this.startHeartbeat();
    }
    async sendMessage(toUserId, body, kind = 'text', meta) {
        return this.request('POST', '/chaldfriends/v1/messages', { toUserId, body, kind, meta: meta ?? undefined });
    }
    lastPresence = {
        status: 'launcher',
        activity: '',
    };
    async heartbeat(status = 'launcher', activity = '') {
        if (!this.tokens.get())
            return;
        this.lastPresence = { status, activity: activity.slice(0, 64) };
        try {
            await this.request('POST', '/chaldfriends/v1/presence/heartbeat', {
                status: this.lastPresence.status,
                activity: this.lastPresence.activity,
            });
        }
        catch {
            /* ignore offline server during heartbeat */
        }
    }
    /** Remember activity and keep sending it on the periodic timer. */
    setPresence(status, activity = '') {
        void this.heartbeat(status, activity);
    }
    startHeartbeat() {
        this.stopHeartbeat();
        if (!this.tokens.get())
            return;
        void this.heartbeat(this.lastPresence.status, this.lastPresence.activity);
        this.heartbeatTimer = setInterval(() => void this.heartbeat(this.lastPresence.status, this.lastPresence.activity), 45_000);
    }
    stopHeartbeat() {
        if (this.heartbeatTimer) {
            clearInterval(this.heartbeatTimer);
            this.heartbeatTimer = null;
        }
    }
    clearSession() {
        this.stopHeartbeat();
        this.tokens.set(null);
    }
    hasToken() {
        return !!this.tokens.get();
    }
    async sendInvite(toUserId, instanceName, address = '', note = '') {
        return this.request('POST', '/chaldfriends/v1/invites', { toUserId, instanceName, address, note });
    }
    async listInvites() {
        return this.request('GET', '/chaldfriends/v1/invites');
    }
    async acceptInvite(inviteId) {
        return this.request('POST', `/chaldfriends/v1/invites/${inviteId}/accept`);
    }
    async declineInvite(inviteId) {
        return this.request('POST', `/chaldfriends/v1/invites/${inviteId}/decline`);
    }
    async sendCallSignal(toUserId, kind, payload, groupId) {
        return this.request('POST', '/chaldfriends/v1/calls/signal', {
            toUserId,
            kind,
            payload,
            ...(groupId ? { groupId } : {}),
        });
    }
    async pollCallSignals() {
        return this.request('GET', '/chaldfriends/v1/calls/signals');
    }
    async uploadAvatar(dataUrl) {
        await this.request('POST', '/chaldfriends/v1/me/avatar', { dataUrl });
        return true;
    }
    async fetchAvatarDataUrl(userId) {
        const base = await this.baseUrl();
        try {
            const { res } = await (0, net_1.netRequest)(`${base}/chaldfriends/v1/avatars/${userId}`, {
                method: 'GET',
                purpose: 'Chald Friends avatar',
                headers: { Accept: 'image/png' },
            });
            if (!res.ok)
                return null;
            const buf = Buffer.from(await res.arrayBuffer());
            if (buf.length < 32)
                return null;
            return `data:image/png;base64,${buf.toString('base64')}`;
        }
        catch {
            return null;
        }
    }
    /* ---------- group chats ---------- */
    async listGroups() {
        try {
            const r = await this.request('GET', '/chaldfriends/v1/groups');
            return Array.isArray(r?.groups) ? r.groups.filter((g) => g && g.id) : [];
        }
        catch (e) {
            // Older friends servers without group support: treat as empty, do not break the whole Friends page.
            if (e instanceof errors_1.AppError && (e.code === 'FRIENDS_NOT_FOUND' || e.code === 'FRIENDS_HTTP'))
                return [];
            throw e;
        }
    }
    async createGroup(name, memberIds = []) {
        const r = await this.request('POST', '/chaldfriends/v1/groups', {
            name: name.trim().slice(0, 64),
            memberIds: memberIds.filter((id) => Number.isFinite(id)),
        });
        return r.group;
    }
    async getGroup(groupId) {
        const r = await this.request('GET', `/chaldfriends/v1/groups/${groupId}`);
        return r.group;
    }
    async addGroupMember(groupId, userId) {
        const r = await this.request('POST', `/chaldfriends/v1/groups/${groupId}/members`, { userId });
        return r.group;
    }
    async removeGroupMember(groupId, userId) {
        return this.request('DELETE', `/chaldfriends/v1/groups/${groupId}/members/${userId}`);
    }
    /** Rename a group (owner only). Needs PATCH /chaldfriends/v1/groups/:id on the friends server. */
    async updateGroup(groupId, name) {
        const r = await this.request('PATCH', `/chaldfriends/v1/groups/${groupId}`, {
            name: name.trim().slice(0, 64),
        });
        return r.group;
    }
    /** Delete a group for everyone (owner only). Needs DELETE /chaldfriends/v1/groups/:id on the friends server. */
    async deleteGroup(groupId) {
        return this.request('DELETE', `/chaldfriends/v1/groups/${groupId}`);
    }
    async groupThread(groupId, afterId = 0) {
        const r = await this.request('GET', `/chaldfriends/v1/groups/${groupId}/messages?afterId=${afterId}&limit=80`);
        return {
            messages: Array.isArray(r?.messages) ? r.messages.filter(Boolean) : [],
            group: r?.group ?? null,
        };
    }
    async sendGroupMessage(groupId, body, kind = 'text', meta) {
        return this.request('POST', `/chaldfriends/v1/groups/${groupId}/messages`, {
            body,
            kind,
            meta: meta ?? undefined,
        });
    }
}
exports.FriendsService = FriendsService;
//# sourceMappingURL=friends.js.map