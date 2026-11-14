import { useCallback, useEffect, useRef, useState } from 'react';
import type { AccountSkin, ChaldConversation, ChaldFriendsList, ChaldGroup, ChaldMessage, ChaldUser, LoaderType } from '../../shared/types';
import { mcHeadUrl as sharedMcHeadUrl } from '../../shared/types';
import { call, errMsg } from '../api';
import { Icon } from '../components/Icon';
import { ShareBuildModal, type SharedBuild } from '../components/ShareBuildModal';
import { createInstanceSchema } from '../../shared/schemas';
import { ConfirmModal, Empty, Modal, Skeleton } from '../components/ui';
import { headFromSkin } from '../skinHead';
import { useI18n } from '../i18n';
import { useStore } from '../store';

function mcHeadUrl(name: string, uuid?: string | null): string {
  return sharedMcHeadUrl(name, uuid, 64);
}

function presenceLine(u: { online: boolean; presence?: string; activity?: string }, t: (k: string, p?: Record<string, string | number>) => string): string {
  if (!u.online) return t('friends.statusOffline');
  if (u.presence === 'game' && u.activity) return t('friends.statusPlaying', { name: u.activity });
  if (u.presence === 'game') return t('friends.statusInGame');
  if (u.presence === 'idle') return t('friends.statusIdle');
  return t('friends.statusLauncher');
}

function formatTime(ts: number): string {
  try {
    return new Date(ts * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  } catch {
    return '';
  }
}

type ShareMeta = { name?: string; mcVersion?: string; loader?: string; loaderType?: string; loaderVersion?: string | null; modCount?: number; mods?: string[] };

function parseMeta(raw: unknown): ShareMeta | null {
  try {
    const v = typeof raw === 'string' ? (raw ? JSON.parse(raw) : null) : raw;
    if (!v || typeof v !== 'object') return null;
    const o = v as Record<string, unknown>;
    return {
      name: typeof o.name === 'string' ? o.name : undefined,
      mcVersion: typeof o.mcVersion === 'string' ? o.mcVersion : undefined,
      loader: typeof o.loader === 'string' ? o.loader : undefined,
      loaderType: typeof o.loaderType === 'string' ? o.loaderType : undefined,
      loaderVersion: typeof o.loaderVersion === 'string' ? o.loaderVersion : null,
      modCount: typeof o.modCount === 'number' ? o.modCount : undefined,
      mods: Array.isArray(o.mods) ? o.mods.filter((x): x is string => typeof x === 'string') : undefined,
    };
  } catch {
    return null;
  }
}

const LOADER_TYPES: LoaderType[] = ['fabric', 'quilt', 'neoforge', 'forge'];

/** The loader of a shared build: the structured fields, or (older messages) the text like "Fabric 0.16.5". */
function sharedLoader(meta: ShareMeta): { type: LoaderType; version: string | null } {
  const text = (meta.loader ?? '').trim();
  const type = LOADER_TYPES.find((l) => l === meta.loaderType) ?? LOADER_TYPES.find((l) => text.toLowerCase().startsWith(l)) ?? 'vanilla';
  const fromText = text.includes(' ') ? text.slice(text.indexOf(' ') + 1).trim() : '';
  return { type, version: type === 'vanilla' ? null : meta.loaderVersion || fromText || null };
}

/** Short one-line text for the conversation list: never dump a 300 KB data URL into the DOM. */
function previewOf(m: ChaldMessage): { icon: string | null; text: string } {
  const kind = m.kind || 'text';
  const body = typeof m.body === 'string' ? m.body : '';
  if (kind === 'image' || body.startsWith('data:image/')) return { icon: 'image', text: 'Картинка' };
  if (kind === 'share') return { icon: 'package', text: body ? body.slice(0, 60) : 'Сборка' };
  return { icon: null, text: body.slice(0, 120) };
}

/** In-memory cache of server-hosted avatars (data URLs). */
const avatarCache = new Map<number, string>();

function Avatar({
  name,
  uuid,
  userId,
  hasAvatar,
  dataUrl,
  online,
  size = 40,
}: {
  name: string;
  /** Minecraft UUID — when licensed (v4) mc-heads can show the skin as a fallback */
  uuid?: string | null;
  /** Chald user id — when hasAvatar, the head is loaded from the friends server */
  userId?: number | null;
  hasAvatar?: boolean;
  dataUrl?: string | null;
  online?: boolean;
  size?: number;
}) {
  const [src, setSrc] = useState(() => dataUrl || (userId && avatarCache.get(userId)) || mcHeadUrl(name, uuid));
  useEffect(() => {
    if (dataUrl) {
      setSrc(dataUrl);
      return;
    }
    // Prefer server-hosted head; if missing, licensed UUID still gets the real skin via mc-heads
    if (userId && (hasAvatar || hasAvatar === undefined)) {
      const cached = avatarCache.get(userId);
      if (cached) {
        setSrc(cached);
        return;
      }
      if (hasAvatar) {
        let cancelled = false;
        void call('friends:avatarData', { userId })
          .then((url) => {
            if (cancelled) return;
            if (url) {
              avatarCache.set(userId, url);
              setSrc(url);
            } else {
              setSrc(mcHeadUrl(name, uuid));
            }
          })
          .catch(() => {
            if (!cancelled) setSrc(mcHeadUrl(name, uuid));
          });
        return () => { cancelled = true; };
      }
    }
    setSrc(mcHeadUrl(name, uuid));
  }, [name, uuid, userId, hasAvatar, dataUrl]);
  return (
    <div className={`friend-av${online ? ' is-on' : ''}`} style={{ width: size, height: size }}>
      <img src={src} alt="" onError={() => setSrc(mcHeadUrl(name, uuid))} />
    </div>
  );
}

const sameJson = (a: unknown, b: unknown): boolean => a === b || JSON.stringify(a) === JSON.stringify(b);

const GROUP_GRADIENTS = [
  'linear-gradient(135deg, #3b82f6, #6366f1)',
  'linear-gradient(135deg, #22c55e, #0ea5e9)',
  'linear-gradient(135deg, #f97316, #ec4899)',
  'linear-gradient(135deg, #a855f7, #3b82f6)',
  'linear-gradient(135deg, #eab308, #f97316)',
  'linear-gradient(135deg, #14b8a6, #22c55e)',
];

/** Group icon: first letter on a gradient picked by the group id (groups have no uploaded picture). */
function GroupAvatar({ group, size = 40 }: { group: { id: number; name: string }; size?: number }) {
  const letter = (Array.from((group.name || '?').trim())[0] ?? '?').toUpperCase();
  return (
    <div
      className="friend-av group-av"
      style={{ width: size, height: size, fontSize: Math.round(size * 0.44), background: GROUP_GRADIENTS[Math.abs(group.id) % GROUP_GRADIENTS.length] }}
      aria-hidden="true"
    >
      {letter}
    </div>
  );
}

function GroupSettingsModal({ group, me, friends, busy, onRename, onAdd, onRemove, onLeave, onDelete, onClose }: {
  group: ChaldGroup;
  me: ChaldUser | null;
  friends: ChaldUser[];
  busy: boolean;
  onRename: (name: string) => void;
  onAdd: (userId: number) => void;
  onRemove: (userId: number) => void;
  onLeave: () => void;
  onDelete: () => void;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const [name, setName] = useState(group.name);
  const [confirm, setConfirm] = useState<'leave' | 'delete' | null>(null);
  const isOwner = !!me && group.ownerId === me.id;
  const memberIds = group.memberIds?.length ? group.memberIds : (group.members ?? []).map((m) => m.id);
  const byId = new Map<number, ChaldUser>();
  for (const f of friends) byId.set(f.id, f);
  for (const m of group.members ?? []) byId.set(m.id, m);
  if (me) byId.set(me.id, me);
  const candidates = friends.filter((f) => !memberIds.includes(f.id));
  const trimmed = name.trim();

  if (confirm) {
    const isDelete = confirm === 'delete';
    return (
      <ConfirmModal
        title={isDelete ? t('friends.groupDelete') : t('friends.groupLeave')}
        confirmLabel={isDelete ? t('friends.groupDelete') : t('friends.groupLeave')}
        danger
        busy={busy}
        onConfirm={isDelete ? onDelete : onLeave}
        onClose={() => setConfirm(null)}
      >
        <p>{t(isDelete ? 'friends.groupDeleteConfirm' : 'friends.groupLeaveConfirm', { name: group.name })}</p>
      </ConfirmModal>
    );
  }

  return (
    <Modal
      title={t('friends.groupSettings')}
      onClose={onClose}
      footer={<button type="button" className="btn" onClick={onClose}>{t('action.close')}</button>}
    >
      <div className="gset">
        <section className="gset__sec">
          <div className="msg-section-label">{t('friends.groupName')}</div>
          <div className="msg-add">
            <input
              className="input"
              value={name}
              maxLength={64}
              readOnly={!isOwner}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && isOwner && trimmed && trimmed !== group.name && !busy && onRename(trimmed)}
            />
            {isOwner && (
              <button type="button" className="btn btn--sm btn--primary" disabled={busy || !trimmed || trimmed === group.name} onClick={() => onRename(trimmed)}>
                {t('action.save')}
              </button>
            )}
          </div>
        </section>

        <section className="gset__sec">
          <div className="msg-section-label">{t('friends.groupMembersTitle')} · {memberIds.length}</div>
          <div className="gset__list">
            {memberIds.map((id) => {
              const u = byId.get(id);
              const label = u?.displayName || u?.mcName || `#${id}`;
              return (
                <div key={id} className="gset__row">
                  <Avatar name={u?.mcName || 'Steve'} uuid={u?.mcUuid} userId={id} hasAvatar={u?.hasAvatar} online={u?.online} size={32} />
                  <span className="gset__name">
                    {label}
                    {id === group.ownerId && <span className="gset__tag"> · {t('friends.groupOwner')}</span>}
                    {id === me?.id && <span className="gset__tag"> · {t('friends.groupYou')}</span>}
                  </span>
                  {isOwner && id !== me?.id && (
                    <button type="button" className="btn btn--sm" disabled={busy} title={t('friends.groupRemoveMember')} aria-label={t('friends.groupRemoveMember')} onClick={() => onRemove(id)}>
                      <Icon name="trash" size={14} />
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        </section>

        <section className="gset__sec">
          <div className="msg-section-label">{t('friends.groupAddTitle')}</div>
          {candidates.length === 0 ? (
            <p className="muted" style={{ fontSize: 13 }}>{t('friends.groupNoFriendsToAdd')}</p>
          ) : (
            <div className="gset__list">
              {candidates.map((f) => (
                <div key={f.id} className="gset__row">
                  <Avatar name={f.mcName} uuid={f.mcUuid} userId={f.id} hasAvatar={f.hasAvatar} online={f.online} size={32} />
                  <span className="gset__name">{f.displayName || f.mcName}</span>
                  <button type="button" className="btn btn--sm btn--primary" disabled={busy} title={t('friends.groupAddMember', { name: f.displayName || f.mcName })} aria-label={t('friends.groupAddMember', { name: f.displayName || f.mcName })} onClick={() => onAdd(f.id)}>
                    <Icon name="plus" size={14} />
                  </button>
                </div>
              ))}
            </div>
          )}
        </section>

        <section className="gset__sec">
          {isOwner ? (
            <button type="button" className="btn btn--danger" disabled={busy} onClick={() => setConfirm('delete')}>
              <Icon name="trash" size={16} /> {t('friends.groupDelete')}
            </button>
          ) : (
            <button type="button" className="btn btn--danger" disabled={busy} onClick={() => setConfirm('leave')}>
              {t('friends.groupLeave')}
            </button>
          )}
        </section>
      </div>
    </Modal>
  );
}

export function FriendsPage() {
  const { t } = useI18n();
  const auth = useStore((s) => s.auth);
  const toast = useStore((s) => s.toast);
  const go = useStore((s) => s.go);
  /** Microsoft или offline-ник — оба могут пользоваться Friends / Chald ID */
  const accountReady = !!(auth?.loggedIn && auth.uuid && auth.name);

  const [busy, setBusy] = useState<string | null>(null);
  const [hasSession, setHasSession] = useState<boolean | null>(null);
  const [me, setMe] = useState<ChaldUser | null>(null);
  const [myHead, setMyHead] = useState<string | null>(null);
  const [list, setList] = useState<ChaldFriendsList | null>(null);
  const [convos, setConvos] = useState<ChaldConversation[]>([]);
  const [groups, setGroups] = useState<ChaldGroup[]>([]);
  const [peer, setPeer] = useState<ChaldUser | null>(null);
  /** When set, the chat pane is a group thread instead of a 1:1 DM */
  const [activeGroup, setActiveGroup] = useState<ChaldGroup | null>(null);
  const [messages, setMessages] = useState<ChaldMessage[]>([]);
  const [draft, setDraft] = useState('');
  const [addId, setAddId] = useState('');
  const [groupName, setGroupName] = useState('');
  const [creatingGroup, setCreatingGroup] = useState(false);
  const [groupSettingsOpen, setGroupSettingsOpen] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const [addedShares, setAddedShares] = useState<Set<number>>(() => new Set());
  const [addingShare, setAddingShare] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  /** Scroll only the message list: scrollIntoView would also scroll the app shell and push the title bar out of view. */
  const scrollToBottom = useCallback((smooth = true) => {
    const el = bottomRef.current?.parentElement;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: smooth ? 'smooth' : 'auto' });
  }, []);
  const lastMsgId = useRef(0);

  const run = async (key: string, fn: () => Promise<void>) => {
    setBusy(key);
    setError(null);
    try {
      await fn();
    } catch (e) {
      const msg = errMsg(e);
      setError(msg);
      toast('error', msg);
    } finally {
      setBusy(null);
    }
  };

  const loadMyHead = useCallback(async () => {
    try {
      const skin = (await call('wardrobe:current')) as AccountSkin | null;
      if (skin?.dataUrl) {
        const head = await headFromSkin(skin.dataUrl, 64);
        setMyHead(head);
        // Licensed: if server has no icon yet, upload head so chats show the real skin
        if (auth?.mode === 'microsoft' && auth.loggedIn) {
          void call('friends:uploadAvatar', { dataUrl: head })
            .then(() => setMe((prev) => (prev ? { ...prev, hasAvatar: true } : prev)))
            .catch(() => undefined);
        }
        return;
      }
    } catch { /* ignore */ }
    // No local skin file — licensed UUID still resolves via mc-heads
    if (auth?.name) setMyHead(mcHeadUrl(auth.name, auth.uuid));
  }, [auth?.name, auth?.uuid, auth?.mode, auth?.loggedIn]);

  const [regLogin, setRegLogin] = useState('');
  const [regPassword, setRegPassword] = useState('');
  const [authTab, setAuthTab] = useState<'register' | 'login'>('register');
  const [registering, setRegistering] = useState(false);

  const ensureSession = useCallback(async () => {
    if (!accountReady) {
      setHasSession(false);
      return;
    }
    const has = await call('friends:hasSession');
    if (!has) {
      setHasSession(false);
      setMe(null);
      return;
    }
    setHasSession(true);
    try {
      setMe(await call('friends:me'));
    } catch {
      const r = await call('friends:session', { chaldId: null });
      setMe(r.user);
      setHasSession(true);
    }
  }, [accountReady]);

  // the login is the nickname: it is filled in for signing in, and a different PC can still type it by hand
  useEffect(() => {
    if (auth?.name) setRegLogin((v) => v || auth.name!);
  }, [auth?.name]);

  const registerChald = async () => {
    if (!accountReady && authTab === 'register') return;
    setRegistering(true);
    setError(null);
    try {
      const login = regLogin.trim().replace(/^@/, '');
      const password = regPassword;
      if (authTab === 'login' && !/^[a-zA-Z0-9_]{3,20}$/.test(login)) throw new Error('Логин (он же Chald ID): 3–20 символов, латиница, цифры и «_»');
      if (password.length < 6) throw new Error('Пароль минимум 6 символов');
      if (authTab === 'login') {
        const r = await call('friends:login', { login, password }) as { user: ChaldUser };
        setMe(r.user);
        setHasSession(true);
        toast('ok', `Вход: ${r.user.chaldId}`);
      } else {
        const r = await call('friends:register', { password }) as { user: ChaldUser; created: boolean };
        setMe(r.user);
        setHasSession(true);
        toast('ok', r.created ? `Аккаунт создан: ${r.user.chaldId}` : `Привязан: ${r.user.chaldId}`);
      }
      await refreshList();
    } catch (e) {
      const msg = errMsg(e);
      setError(msg);
      toast('error', msg);
    } finally {
      setRegistering(false);
    }
  };

  const refreshList = useCallback(async () => {
    const [friends, inbox, groupList] = await Promise.all([
      call('friends:list'),
      call('friends:inbox').catch(() => ({ conversations: [] as ChaldConversation[] })),
      call('friends:groups').catch(() => [] as ChaldGroup[]),
    ]);
    const nextList: ChaldFriendsList = {
      friends: Array.isArray(friends?.friends) ? friends.friends.filter(Boolean) : [],
      incoming: Array.isArray(friends?.incoming) ? friends.incoming.filter(Boolean) : [],
      outgoing: Array.isArray(friends?.outgoing) ? friends.outgoing.filter(Boolean) : [],
    };
    const nextConvos = Array.isArray(inbox?.conversations) ? inbox.conversations.filter((c) => c && c.user) : [];
    const nextGroups = Array.isArray(groupList) ? groupList.filter((g) => g && g.id) : [];
    // the poll runs every 4 s: keep the old state (and skip a re-render) when the server data did not change
    setList((prev) => (sameJson(prev, nextList) ? prev : nextList));
    setConvos((prev) => (sameJson(prev, nextConvos) ? prev : nextConvos));
    setGroups((prev) => (sameJson(prev, nextGroups) ? prev : nextGroups));
  }, []);

  const openChat = useCallback(async (userId: number, fallbackPeer?: ChaldUser) => {
    const r = await call('friends:thread', { peerId: userId, afterId: 0 });
    const msgs = Array.isArray(r?.messages) ? r.messages.filter(Boolean) : [];
    // the server may answer without `peer`: still open the chat using the friend we already know
    const nextPeer = r?.peer ?? fallbackPeer ?? null;
    if (!nextPeer) throw new Error('Не удалось загрузить собеседника');
    setActiveGroup(null);
    setGroupSettingsOpen(false);
    setPeer(nextPeer);
    setMessages(msgs);
    lastMsgId.current = msgs.length ? msgs[msgs.length - 1]!.id : 0;
    setTimeout(() => scrollToBottom(), 50);
  }, [scrollToBottom]);

  const openGroupChat = useCallback(async (groupId: number, fallback?: ChaldGroup) => {
    const r = await call('friends:groupThread', { groupId, afterId: 0 });
    const msgs = Array.isArray(r?.messages) ? r.messages.filter(Boolean) : [];
    const g = r?.group ?? fallback ?? null;
    if (!g) throw new Error('Не удалось загрузить группу');
    setPeer(null);
    setGroupSettingsOpen(false);
    setActiveGroup(g);
    setMessages(msgs);
    lastMsgId.current = msgs.length ? msgs[msgs.length - 1]!.id : 0;
    setTimeout(() => scrollToBottom(), 50);
  }, [scrollToBottom]);

  const activeGroupId = activeGroup?.id ?? null;
  const peerId = peer?.id ?? null;
  const pollThread = useCallback(async () => {
    const merge = (fresh: ChaldMessage[]) => {
      if (!fresh.length) return;
      setMessages((prev) => {
        const seen = new Set(prev.map((m) => m.id));
        const add = fresh.filter((m) => !seen.has(m.id));
        return add.length ? [...prev, ...add] : prev;
      });
      lastMsgId.current = Math.max(lastMsgId.current, fresh[fresh.length - 1]!.id);
      setTimeout(() => scrollToBottom(), 30);
    };
    if (activeGroupId !== null) {
      try {
        const r = await call('friends:groupThread', { groupId: activeGroupId, afterId: lastMsgId.current });
        merge(Array.isArray(r?.messages) ? r.messages.filter(Boolean) : []);
        const g = r?.group;
        if (g) setActiveGroup((prev) => (prev && prev.id === g.id && sameJson(prev, g) ? prev : prev && prev.id !== g.id ? prev : g));
      } catch { /* ignore */ }
      return;
    }
    if (peerId === null) return;
    try {
      const r = await call('friends:thread', { peerId, afterId: lastMsgId.current });
      merge(Array.isArray(r?.messages) ? r.messages.filter(Boolean) : []);
      const p = r?.peer;
      if (p) setPeer((prev) => (prev && prev.id === p.id && sameJson(prev, p) ? prev : prev && prev.id !== p.id ? prev : p));
    } catch { /* ignore */ }
  }, [peerId, activeGroupId, scrollToBottom]);

  const load = useCallback(async () => {
    if (!accountReady) {
      setHasSession(false);
      setMe(null);
      setList(null);
      return;
    }
    await ensureSession();
    const has = await call('friends:hasSession');
    if (!has) {
      setList(null);
      return;
    }
    await Promise.all([refreshList(), loadMyHead()]);
  }, [accountReady, ensureSession, refreshList, loadMyHead]);

  useEffect(() => {
    void load().catch((e) => setError(errMsg(e)));
  }, [load]);

  useEffect(() => {
    const id = window.setInterval(() => {
      void refreshList().catch(() => undefined);
      void pollThread();
    }, 4000);
    return () => window.clearInterval(id);
  }, [refreshList, pollThread]);

  const onSendImage = () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/png,image/jpeg,image/webp,image/gif';
    input.onchange = () => {
      const file = input.files?.[0];
      if (!file || (!peer && !activeGroup)) return;
      if (file.size > 280_000) {
        toast('error', 'Картинка больше 280KB — сожми или выбери другую');
        return;
      }
      const reader = new FileReader();
      reader.onload = () => {
        const dataUrl = String(reader.result || '');
        void run('send', async () => {
          const r = activeGroup
            ? await call('friends:groupSend', { groupId: activeGroup.id, body: dataUrl, kind: 'image' })
            : await call('friends:send', { toUserId: peer!.id, body: dataUrl, kind: 'image' });
          setMessages((prev) => [...prev, r.message]);
          lastMsgId.current = r.message.id;
        });
      };
      reader.readAsDataURL(file);
    };
    input.click();
  };

  const onShareBuild = async (build: SharedBuild) => {
    if (!peer && !activeGroup) return;
    const r = activeGroup
      ? await call('friends:groupSend', {
          groupId: activeGroup.id,
          body: build.name,
          kind: 'share',
          meta: JSON.stringify(build),
        })
      : await call('friends:send', {
          toUserId: peer!.id,
          body: build.name,
          kind: 'share',
          meta: JSON.stringify(build),
        });
    setMessages((prev) => [...prev, r.message]);
    lastMsgId.current = r.message.id;
    setTimeout(() => scrollToBottom(), 30);
    toast('ok', 'Сборка отправлена в чат');
  };

  /**
   * «Добавить и установить» на карточке чужой сборки: создаёт такой же инстанс (версия Minecraft + загрузчик), ставит его,
   * а когда установка закончится, пробует поставить моды из списка с Modrinth (только точное совпадение названия).
   */
  const addSharedBuild = async (msgId: number, meta: ShareMeta, title: string) => {
    setAddingShare(msgId);
    try {
      const mc = meta.mcVersion;
      if (!mc) throw new Error('В сообщении нет версии Minecraft');
      const lo = sharedLoader(meta);
      let loaderVersion = lo.version;
      if (lo.type !== 'vanilla' && !loaderVersion) {
        const list = await call('versions:loaders', { loader: lo.type, mcVersion: mc });
        const pick = list.find((v) => v.recommended) ?? list.find((v) => v.stable) ?? list[0];
        if (!pick) throw new Error(`Для Minecraft ${mc} нет версий загрузчика ${lo.type}`);
        loaderVersion = pick.version;
      }
      const parsed = createInstanceSchema.safeParse({
        name: (meta.name || title || 'Сборка').slice(0, 48),
        description: '',
        mcVersion: mc,
        kind: lo.type === 'vanilla' ? 'official' : 'modded',
        coverColor: 0,
        settings: { javaPath: '', memoryMinMb: null, memoryMaxMb: null, jvmArgs: '', width: null, height: null, fullscreen: null },
        loader: { type: lo.type, version: lo.type === 'vanilla' ? null : loaderVersion },
      });
      if (!parsed.success) throw new Error(parsed.error.issues[0]?.message ?? 'Некорректные данные сборки');
      const inst = await call('instances:create', parsed.data);
      const st = useStore.getState();
      await st.refreshInstances();
      st.select(inst.id);
      setAddedShares((prev) => new Set(prev).add(msgId));
      toast('ok', `Сборка «${inst.name}» добавлена, идёт установка`);
      void st.install(inst.id).then(() => installSharedMods(inst.id, mc, lo.type, meta.mods ?? []));
    } catch (e) {
      toast('error', errMsg(e));
    } finally {
      setAddingShare(null);
    }
  };

  const installSharedMods = async (instId: string, mc: string, loader: LoaderType, mods: string[]) => {
    if (loader === 'vanilla' || mods.length === 0) return;
    // mods can be put in only after the instance has been installed
    for (let i = 0; i < 400; i++) {
      const row = (await call('instances:list').catch(() => [])).find((x) => x.id === instId);
      if (!row || row.state === 'broken') return;
      if (row.state === 'ready') break;
      if (row.state === 'not-installed' && i >= 5) return; // the installation did not start or was cancelled
      await new Promise((r) => setTimeout(r, 3000));
      if (i === 399) return;
    }
    let ok = 0;
    for (const name of mods.slice(0, 60)) {
      try {
        const r = await call('modrinth:search', { query: name, type: 'mod', mcVersion: mc, loader, sort: 'relevance', offset: 0 });
        const hit = r.hits.find((h) => h.title.trim().toLowerCase() === name.trim().toLowerCase());
        if (!hit) continue;
        await call('modrinth:install', { id: instId, projectId: hit.id, kind: 'mod', versionId: null });
        ok++;
      } catch { /* this mod is skipped: not found, or no version for this game */ }
    }
    void useStore.getState().refreshInstances();
    toast(ok > 0 ? 'ok' : 'info', ok > 0 ? `Моды с Modrinth: установлено ${ok} из ${Math.min(mods.length, 60)}` : 'Моды из списка на Modrinth не найдены: добавь их вручную');
  };

  const onSend = () => run('send', async () => {
    if (!draft.trim()) return;
    const text = draft.trim();
    setDraft('');
    if (activeGroup) {
      const r = await call('friends:groupSend', { groupId: activeGroup.id, body: text });
      setMessages((prev) => [...prev, r.message]);
      lastMsgId.current = r.message.id;
    } else if (peer) {
      const r = await call('friends:send', { toUserId: peer.id, body: text });
      setMessages((prev) => [...prev, r.message]);
      lastMsgId.current = r.message.id;
    } else {
      return;
    }
    setTimeout(() => scrollToBottom(), 30);
    await refreshList();
  });

  const onCreateGroup = () => run('group-create', async () => {
    const name = groupName.trim();
    if (!name) return;
    const g = await call('friends:groupCreate', { name, memberIds: [] });
    setGroupName('');
    setCreatingGroup(false);
    toast('ok', t('friends.groupCreated', { name: g.name }));
    await refreshList();
    await openGroupChat(g.id, g);
  });

  const onAddMemberToGroup = (userId: number) => run(`group-add-${userId}`, async () => {
    if (!activeGroup) return;
    const g = await call('friends:groupAddMember', { groupId: activeGroup.id, userId });
    setActiveGroup(g);
    toast('ok', t('friends.groupMemberAdded'));
    await refreshList();
  });

  const onRenameGroup = (name: string) => run('group-rename', async () => {
    if (!activeGroup) return;
    const g = await call('friends:groupUpdate', { groupId: activeGroup.id, name });
    setActiveGroup((prev) => (prev ? { ...prev, ...g, name: g?.name ?? name } : g));
    toast('ok', t('friends.groupRenamed'));
    await refreshList();
  });

  const onRemoveGroupMember = (userId: number) => run(`group-rm-${userId}`, async () => {
    if (!activeGroup) return;
    await call('friends:groupRemoveMember', { groupId: activeGroup.id, userId });
    setActiveGroup(await call('friends:groupGet', { groupId: activeGroup.id }));
    toast('ok', t('friends.groupMemberRemoved'));
    await refreshList();
  });

  const closeActiveGroup = () => {
    setGroupSettingsOpen(false);
    setActiveGroup(null);
    setMessages([]);
    lastMsgId.current = 0;
  };

  const onLeaveGroup = () => run('group-leave', async () => {
    if (!activeGroup || !me) return;
    await call('friends:groupRemoveMember', { groupId: activeGroup.id, userId: me.id });
    closeActiveGroup();
    toast('ok', t('friends.groupLeft'));
    await refreshList();
  });

  const onDeleteGroup = () => run('group-delete', async () => {
    if (!activeGroup) return;
    await call('friends:groupDelete', { groupId: activeGroup.id });
    closeActiveGroup();
    toast('ok', t('friends.groupDeleted'));
    await refreshList();
  });

  const onGroupCall = () => run('group-call', async () => {
    if (!activeGroup) return;
    const memberIds = (activeGroup.memberIds ?? activeGroup.members?.map((m) => m.id) ?? [])
      .filter((id) => id !== me?.id);
    await call('overlay:startCall', {
      userId: 0,
      name: activeGroup.name,
      mcName: '',
      groupId: activeGroup.id,
      memberIds,
    });
  });

  const onAdd = () => run('add', async () => {
    const id = addId.trim();
    if (!id) return;
    await call('friends:request', { toChaldId: id });
    setAddId('');
    toast('ok', t('friends.requestSent'));
    await refreshList();
  });

  const onAccept = (requestId: number) => run(`accept-${requestId}`, async () => {
    await call('friends:accept', { requestId });
    toast('ok', t('friends.accepted'));
    await refreshList();
  });

  const onReject = (requestId: number) => run(`reject-${requestId}`, async () => {
    await call('friends:reject', { requestId });
    await refreshList();
  });

  if (!accountReady) {
    return (
      <div className="page">
        <header className="page-head">
          <div>
            <h1>{t('friends.title')}</h1>
            <p className="muted">{t('friends.subtitle')}</p>
          </div>
        </header>
        <Empty
          icon="user"
          title={t('friends.needLogin')}
          text={auth?.mode === 'offline'
            ? 'Настройки → Аккаунт → Офлайн: зарегистрируйся по логину и паролю, чтобы пользоваться друзьями и чатом.'
            : t('friends.needLoginHint')}
          action={<button className="btn btn--primary" type="button" onClick={() => go('settings')}>{t('auth.account')}</button>}
        />
      </div>
    );
  }

  if (hasSession === false) {
    return (
      <div className="page">
        <header className="page-head">
          <div>
            <h1>{t('friends.title')}</h1>
            <p className="muted">Регистрация Chald ID — работает и для offline</p>
          </div>
        </header>
        <div className="card" style={{ maxWidth: 460, margin: '24px auto', padding: 24 }}>
          <p style={{ marginBottom: 12 }}>
            Minecraft: <strong>{auth?.name}</strong>
            <span className="muted"> · {auth?.mode === 'offline' ? 'offline' : 'Microsoft'}</span>
          </p>
          <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
            <button type="button" className={`btn btn--sm${authTab === 'register' ? ' btn--primary' : ''}`} onClick={() => setAuthTab('register')}>Регистрация</button>
            <button type="button" className={`btn btn--sm${authTab === 'login' ? ' btn--primary' : ''}`} onClick={() => setAuthTab('login')}>Вход</button>
          </div>
          {authTab === 'register' ? (
            <label className="field" style={{ display: 'block', marginBottom: 12 }}>
              <span className="field__label">Логин и Chald ID — твой ник</span>
              <input className="input mono" value={auth?.name ?? ''} readOnly aria-readonly="true" />
              <span className="muted" style={{ fontSize: 12 }}>Логин привязан к нику аккаунта. По нему друзья найдут тебя и добавят в друзья.</span>
            </label>
          ) : (
            <label className="field" style={{ display: 'block', marginBottom: 12 }}>
              <span className="field__label">Логин (он же Chald ID)</span>
              <input className="input mono" value={regLogin} onChange={(e) => setRegLogin(e.target.value)} placeholder="my_login" maxLength={20} spellCheck={false} autoComplete="username" />
            </label>
          )}
          <label className="field" style={{ display: 'block', marginBottom: 12 }}>
            <span className="field__label">Пароль</span>
            <input className="input" type="password" value={regPassword} onChange={(e) => setRegPassword(e.target.value)} placeholder="минимум 6 символов" maxLength={72} autoComplete={authTab === 'login' ? 'current-password' : 'new-password'} />
          </label>
          {error && (
            <p className="form-error" role="alert" style={{ marginBottom: 12 }}>
              <Icon name="alert" size={16} /> {error}
            </p>
          )}
          <button
            className="btn btn--primary"
            type="button"
            disabled={registering || (authTab === 'login' && !regLogin.trim()) || regPassword.length < 6}
            onClick={() => void registerChald()}
            style={{ width: '100%' }}
          >
            {registering ? '…' : authTab === 'login' ? 'Войти' : 'Зарегистрироваться'}
          </button>
          <p className="muted" style={{ marginTop: 12, fontSize: 12 }}>
            Логин — это твой Chald ID. Ник Minecraft берётся из аккаунта лаунчера.
          </p>
        </div>
      </div>
    );
  }

  const renderMessage = (m: ChaldMessage, showSender: boolean) => {
    const kind = m.kind || 'text';
    const meta = kind === 'share' ? parseMeta(m.meta) : null;
    const body = typeof m.body === 'string' ? m.body : '';
    const isImg = kind === 'image' || body.startsWith('data:image/');
    return (
      <div key={m.id} className={`msg-bubble${m.mine ? ' is-mine' : ''}${kind !== 'text' || isImg ? ' is-rich' : ''}`}>
        {showSender && !m.mine && (
          <div className="msg-bubble__meta" style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
            <Avatar name={m.fromMcName || m.fromName || '?'} uuid={m.fromMcUuid} userId={m.fromUserId} size={20} />
            <span className="muted" style={{ fontSize: 12 }}>{m.fromName || m.fromMcName || `#${m.fromUserId}`}</span>
          </div>
        )}
        {isImg ? (
          <img className="msg-bubble__img" src={body} alt="img" loading="lazy" />
        ) : kind === 'share' ? (
          <div className="msg-share">
            <div className="msg-share__title"><Icon name="package" size={16} /> {body || 'Сборка'}</div>
            {meta && (
              <div className="msg-share__meta">
                {meta.mcVersion && <div>Minecraft {meta.mcVersion}</div>}
                {meta.loader && <div>{meta.loader}</div>}
                {meta.modCount !== undefined && meta.modCount > 0 && <div>Модов: {meta.modCount}</div>}
                {meta.mods && meta.mods.length > 0 && (
                  <div className="msg-share__mods">{meta.mods.slice(0, 12).join(', ')}{meta.mods.length > 12 ? '…' : ''}</div>
                )}
              </div>
            )}
            {!m.mine && meta && meta.mcVersion && (
              <button
                type="button"
                className="btn btn--sm btn--primary msg-share__add"
                disabled={addingShare === m.id || addedShares.has(m.id)}
                onClick={() => void addSharedBuild(m.id, meta, body)}
              >
                <Icon name={addedShares.has(m.id) ? 'check' : 'download'} size={14} />{' '}
                {addedShares.has(m.id) ? 'Добавлено' : addingShare === m.id ? '…' : 'Добавить и установить'}
              </button>
            )}
          </div>
        ) : (
          <div className="msg-bubble__text">{body}</div>
        )}
        <div className="msg-bubble__time">{formatTime(m.createdAt)}</div>
      </div>
    );
  };

  const friendsById = new Map((list?.friends ?? []).map((f) => [f.id, f]));

  return (
    <div className="page page--friends">
      <header className="page-head">
        <div>
          <h1>{t('friends.title')}</h1>
          <p className="muted">{t('friends.messengerHint')}</p>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button className="btn" type="button" disabled={busy !== null} onClick={() => void run('reload', load)}>
            <Icon name="refresh" size={16} /> {t('action.refresh')}
          </button>
          <button className="btn" type="button" onClick={() => void call('overlay:toggle')}>
            <Icon name="overlay" size={16} /> Оверлей (Ctrl+Shift+O)
          </button>
        </div>
      </header>

      {error && (
        <p className="form-error" role="alert" style={{ marginBottom: 12 }}>
          <Icon name="alert" size={16} /> {error}
        </p>
      )}

      {hasSession === null || list === null ? (
        <Skeleton rows={6} />
      ) : (
        <div className="msg-layout">
          {/* Sidebar: me + add + conversations */}
          <aside className="msg-side">
            <div className="msg-me">
              <Avatar
                name={me?.mcName || auth?.name || 'Steve'}
                uuid={me?.mcUuid || auth?.uuid}
                userId={me?.id}
                hasAvatar={me?.hasAvatar}
                dataUrl={myHead}
                online
                size={44}
              />
              <div>
                <div className="msg-me__name">{me?.displayName || auth?.name}</div>
                <div className="msg-me__status">{presenceLine(me || { online: true, presence: 'launcher' }, t)}</div>
              </div>
            </div>

            <div className="msg-add">
              <input
                className="input"
                value={addId}
                placeholder={t('friends.addPlaceholder')}
                onChange={(e) => setAddId(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && void onAdd()}
              />
              <button className="btn btn--sm btn--primary" type="button" disabled={!addId.trim() || busy !== null} onClick={() => void onAdd()}>
                +
              </button>
            </div>

            {list.incoming.length > 0 && (
              <div className="msg-reqs">
                <div className="msg-section-label">{t('friends.incoming')}</div>
                {list.incoming.map((u) => (
                  <div key={u.requestId} className="msg-req">
                    <Avatar name={u.mcName} uuid={u.mcUuid} userId={u.id} hasAvatar={u.hasAvatar} online={u.online} size={32} />
                    <span className="msg-req__name">{u.displayName}</span>
                    <button className="btn btn--sm btn--primary" type="button" onClick={() => void onAccept(u.requestId!)}>✓</button>
                    <button className="btn btn--sm" type="button" onClick={() => void onReject(u.requestId!)}>✕</button>
                  </div>
                ))}
              </div>
            )}

            {/* Groups: render only when there is at least one group */}
            {groups.length > 0 && (
              <>
                <div className="msg-section-label" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <span>{t('friends.groups')}</span>
                  <button className="btn btn--sm" type="button" onClick={() => setCreatingGroup((v) => !v)} title={t('friends.createGroup')}>
                    +
                  </button>
                </div>
                <div className="msg-convos msg-convos--groups">
                  {groups.map((g) => {
                    const active = activeGroup?.id === g.id;
                    return (
                      <button
                        key={g.id}
                        type="button"
                        className={`msg-convo${active ? ' is-active' : ''}`}
                        onClick={() => void run(`group-${g.id}`, () => openGroupChat(g.id, g))}
                      >
                        <GroupAvatar group={g} size={40} />
                        <div className="msg-convo__body">
                          <div className="msg-convo__top">
                            <span className="msg-convo__name">{g.name}</span>
                            {g.lastMessage && (
                              <span className="msg-convo__time">{formatTime(g.lastMessage.createdAt)}</span>
                            )}
                          </div>
                          <div className="msg-convo__preview">
                            {g.lastMessage ? (() => {
                              const pv = previewOf(g.lastMessage);
                              return <>{pv.icon && <Icon name={pv.icon} size={12} />} {pv.text}</>;
                            })() : t('friends.groupMembers', { n: g.memberIds?.length ?? g.members?.length ?? 0 })}
                          </div>
                        </div>
                        {(g.unread ?? 0) > 0 && <span className="msg-badge">{g.unread}</span>}
                      </button>
                    );
                  })}
                </div>
              </>
            )}
            {creatingGroup && (
              <div className="msg-add" style={{ marginBottom: 8 }}>
                <input
                  className="input"
                  value={groupName}
                  placeholder={t('friends.groupNamePlaceholder')}
                  onChange={(e) => setGroupName(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && void onCreateGroup()}
                />
                <button className="btn btn--sm btn--primary" type="button" disabled={!groupName.trim() || busy !== null} onClick={() => void onCreateGroup()}>
                  OK
                </button>
                <button className="btn btn--sm" type="button" onClick={() => { setCreatingGroup(false); setGroupName(''); }}>
                  ✕
                </button>
              </div>
            )}

            <div className="msg-section-label" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <span>{t('friends.chats')}</span>
              {groups.length === 0 && !creatingGroup && (
                <button className="btn btn--sm" type="button" onClick={() => setCreatingGroup(true)} title={t('friends.createGroup')}>
                  + {t('friends.createGroup')}
                </button>
              )}
            </div>
            <div className="msg-convos">
              {list.friends.length === 0 ? (
                <p className="muted" style={{ padding: '8px 4px', fontSize: 13 }}>{t('friends.emptyHint')}</p>
              ) : (
                list.friends.map((f) => {
                  const c = convos.find((x) => x?.user?.id === f.id);
                  const active = peer?.id === f.id;
                  return (
                    <button
                      key={f.id}
                      type="button"
                      className={`msg-convo${active ? ' is-active' : ''}`}
                      onClick={() => void run(`chat-${f.id}`, () => openChat(f.id, f))}
                    >
                      <Avatar name={f.mcName} uuid={f.mcUuid} userId={f.id} hasAvatar={f.hasAvatar} online={f.online} size={40} />
                      <div className="msg-convo__body">
                        <div className="msg-convo__top">
                          <span className="msg-convo__name">{f.displayName}</span>
                          {c?.lastMessage && (
                            <span className="msg-convo__time">{formatTime(c.lastMessage.createdAt)}</span>
                          )}
                        </div>
                        <div className="msg-convo__preview">
                          {c?.lastMessage ? (() => {
                            const pv = previewOf(c.lastMessage);
                            return (
                              <>
                                {c.lastMessage.mine ? `${t('friends.you')}: ` : ''}
                                {pv.icon && <Icon name={pv.icon} size={12} />} {pv.text}
                              </>
                            );
                          })() : presenceLine(f, t)}
                        </div>
                      </div>
                      {(c?.unread ?? 0) > 0 && <span className="msg-badge">{c!.unread}</span>}
                    </button>
                  );
                })
              )}
            </div>
          </aside>

          {/* Chat pane */}
          <section className="msg-chat">
            {!peer && !activeGroup ? (
              <div className="msg-chat__empty">
                <Icon name="user" size={40} />
                <p>{t('friends.pickChat')}</p>
              </div>
            ) : activeGroup ? (
              <>
                <div className="msg-chat__head">
                  <GroupAvatar group={activeGroup} size={36} />
                  <div className="msg-chat__titles">
                    <div className="msg-chat__name">{activeGroup.name}</div>
                    <div className="msg-chat__status">
                      {t('friends.groupMembers', { n: activeGroup.memberIds?.length ?? activeGroup.members?.length ?? 0 })}
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: 6 }}>
                    <button
                      className="btn btn--sm btn--primary"
                      type="button"
                      title={t('friends.groupCall')}
                      aria-label={t('friends.groupCall')}
                      onClick={() => void onGroupCall()}
                    >
                      <Icon name="phone" size={14} /> {t('friends.groupCall')}
                    </button>
                    <button
                      className="btn btn--sm"
                      type="button"
                      title={t('friends.groupSettings')}
                      aria-label={t('friends.groupSettings')}
                      onClick={() => setGroupSettingsOpen(true)}
                    >
                      <Icon name="gear" size={16} />
                    </button>
                  </div>
                </div>
                <div className="msg-chat__body">
                  {messages.length === 0 ? (
                    <p className="muted msg-chat__hint">{t('friends.noMessages')}</p>
                  ) : (
                    messages.filter(Boolean).map((m) => renderMessage(m, true))
                  )}
                  <div ref={bottomRef} />
                </div>
                <div className="msg-chat__compose">
                  <button className="btn btn--sm" type="button" title="Отправить картинку" aria-label="Отправить картинку" disabled={busy === 'send'} onClick={() => onSendImage()}><Icon name="image" size={16} /></button>
                  <button className="btn btn--sm" type="button" title="Поделиться сборкой" aria-label="Поделиться сборкой" disabled={busy === 'send'} onClick={() => setShareOpen(true)}><Icon name="package" size={16} /></button>
                  <input
                    className="input"
                    value={draft}
                    placeholder={t('friends.messagePlaceholder')}
                    maxLength={2000}
                    onChange={(e) => setDraft(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && !e.shiftKey) {
                        e.preventDefault();
                        void onSend();
                      }
                    }}
                  />
                  <button className="btn btn--primary" type="button" disabled={!draft.trim() || busy === 'send'} onClick={() => void onSend()}>
                    {t('friends.send')}
                  </button>
                </div>
              </>
            ) : peer ? (
              <>
                <div className="msg-chat__head">
                  <Avatar name={peer.mcName} uuid={peer.mcUuid} userId={peer.id} hasAvatar={peer.hasAvatar} online={peer.online} size={36} />
                  <div style={{ flex: 1 }}>
                    <div className="msg-chat__name">{peer.displayName}</div>
                    <div className="msg-chat__status">{presenceLine(peer, t)}</div>
                  </div>
                  <div style={{ display: 'flex', gap: 6 }}>
                    <button
                      className="btn btn--sm"
                      type="button"
                      title="Инвайт в игру" aria-label="Инвайт в игру"
                      onClick={() => void run('invite', async () => {
                        await call('friends:invite', {
                          toUserId: peer.id,
                          instanceName: 'Моя игра',
                          address: '',
                          note: '',
                        });
                        toast('ok', 'Инвайт отправлен');
                      })}
                    >
                      <Icon name="mail" size={16} />
                    </button>
                    <button
                      className="btn btn--sm btn--primary"
                      type="button"
                      title="Голосовой звонок" aria-label="Голосовой звонок"
                      onClick={() => void run('call', async () => {
                        await call('overlay:startCall', {
                          userId: peer.id,
                          name: peer.displayName || peer.mcName,
                          mcName: peer.mcName,
                        });
                        toast('ok', 'Звонок… Разреши микрофон, если спросит система');
                      })}
                    >
                      <Icon name="phone" size={16} />
                    </button>
                  </div>
                </div>
                <div className="msg-chat__body">
                  {messages.length === 0 ? (
                    <p className="muted msg-chat__hint">{t('friends.noMessages')}</p>
                  ) : (
                    messages.filter(Boolean).map((m) => renderMessage(m, false))
                  )}
                  <div ref={bottomRef} />
                </div>
                <div className="msg-chat__compose">
                  <button className="btn btn--sm" type="button" title="Отправить картинку" aria-label="Отправить картинку" disabled={!peer || busy === 'send'} onClick={() => onSendImage()}><Icon name="image" size={16} /></button>
                  <button className="btn btn--sm" type="button" title="Поделиться сборкой" aria-label="Поделиться сборкой" disabled={!peer || busy === 'send'} onClick={() => setShareOpen(true)}><Icon name="package" size={16} /></button>
                  <input
                    className="input"
                    value={draft}
                    placeholder={t('friends.messagePlaceholder')}
                    maxLength={2000}
                    onChange={(e) => setDraft(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && !e.shiftKey) {
                        e.preventDefault();
                        void onSend();
                      }
                    }}
                  />
                  <button className="btn btn--primary" type="button" disabled={!draft.trim() || busy === 'send'} onClick={() => void onSend()}>
                    {t('friends.send')}
                  </button>
                </div>
              </>
            ) : null}
          </section>
        </div>
      )}

      {shareOpen && (peer || activeGroup) && (
        <ShareBuildModal
          peerName={peer?.displayName || peer?.mcName || activeGroup?.name || ''}
          onShare={onShareBuild}
          onClose={() => setShareOpen(false)}
        />
      )}

      {groupSettingsOpen && activeGroup && (
        <GroupSettingsModal
          group={activeGroup}
          me={me}
          friends={list?.friends ?? []}
          busy={busy !== null}
          onRename={(name) => void onRenameGroup(name)}
          onAdd={(id) => void onAddMemberToGroup(id)}
          onRemove={(id) => void onRemoveGroupMember(id)}
          onLeave={() => void onLeaveGroup()}
          onDelete={() => void onDeleteGroup()}
          onClose={() => setGroupSettingsOpen(false)}
        />
      )}

      <style>{`
        .page--friends { display: flex; flex-direction: column; min-height: 0; height: 100%; }
        .page--friends > .page-head { flex: none; }
        .msg-layout {
          flex: 1 1 auto;
          display: grid;
          grid-template-columns: minmax(260px, 320px) minmax(0, 1fr);
          grid-template-rows: minmax(0, 1fr);
          gap: 12px;
          min-height: 0;
        }
        @media (max-width: 800px) {
          .msg-layout { grid-template-columns: minmax(0, 1fr); grid-template-rows: minmax(0, 40%) minmax(0, 1fr); }
        }
        .msg-side {
          display: flex; flex-direction: column; gap: 10px;
          background: var(--surface, #162038);
          border: 1px solid rgba(255,255,255,0.08);
          border-radius: 16px;
          padding: 12px;
          overflow: hidden;
          min-height: 0;
        }
        .msg-me {
          display: flex; align-items: center; gap: 10px;
          padding: 8px; border-radius: 12px;
          background: linear-gradient(135deg, rgba(59,130,246,0.2), rgba(168,85,247,0.12));
        }
        .msg-me__name { font-weight: 700; font-size: 14px; }
        .msg-me__status { font-size: 11px; color: #86efac; }
        .msg-add { display: flex; gap: 6px; }
        .msg-add .input { flex: 1; font-size: 13px; }
        .msg-section-label {
          font-size: 11px; text-transform: uppercase; letter-spacing: 0.06em;
          color: var(--muted, #8b9bb8); margin-top: 4px;
        }
        .msg-reqs { display: flex; flex-direction: column; gap: 6px; }
        .msg-req { display: flex; align-items: center; gap: 6px; }
        .msg-req__name { flex: 1; font-size: 13px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .msg-convos { flex: 1; overflow-y: auto; display: flex; flex-direction: column; gap: 4px; min-height: 0; }
        .msg-convo {
          display: grid; grid-template-columns: 40px 1fr auto; gap: 10px; align-items: center;
          padding: 8px; border-radius: 12px; border: 1px solid transparent;
          background: transparent; color: inherit; text-align: left; cursor: pointer;
          width: 100%;
        }
        .msg-convo:hover { background: rgba(255,255,255,0.04); }
        .msg-convo.is-active { background: rgba(59,130,246,0.15); border-color: rgba(59,130,246,0.35); }
        .msg-convo__top { display: flex; justify-content: space-between; gap: 6px; }
        .msg-convo__name { font-weight: 650; font-size: 13px; }
        .msg-convo__time { font-size: 10px; color: var(--muted, #8b9bb8); }
        .msg-convo__preview {
          font-size: 12px; color: var(--muted, #8b9bb8);
          overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 160px;
        }
        .msg-badge {
          min-width: 20px; height: 20px; border-radius: 999px;
          background: #3b82f6; color: #fff; font-size: 11px; font-weight: 700;
          display: grid; place-items: center; padding: 0 6px;
        }
        .friend-av {
          border-radius: 10px; overflow: hidden; background: #0b1220;
          border: 2px solid transparent; flex-shrink: 0;
        }
        .friend-av.is-on { border-color: #22c55e; box-shadow: 0 0 0 2px rgba(34,197,94,0.2); }
        .friend-av img { width: 100%; height: 100%; object-fit: cover; image-rendering: pixelated; display: block; }

        .msg-chat {
          display: flex; flex-direction: column;
          background: var(--surface, #162038);
          border: 1px solid rgba(255,255,255,0.08);
          border-radius: 16px;
          min-height: 0;
          overflow: hidden;
        }
        .msg-chat__empty {
          flex: 1; display: grid; place-content: center; gap: 10px; text-align: center;
          color: var(--muted, #8b9bb8);
        }
        .msg-chat__head {
          display: flex; align-items: center; gap: 10px;
          padding: 12px 14px; border-bottom: 1px solid rgba(255,255,255,0.08);
        }
        .msg-chat__name { font-weight: 700; }
        .msg-chat__status { font-size: 12px; color: #86efac; }
        .msg-chat__body {
          flex: 1; min-height: 0; overflow-y: auto; overscroll-behavior: contain; padding: 14px;
          display: flex; flex-direction: column; gap: 8px;
          background: rgba(0,0,0,0.15);
        }
        .msg-chat__hint { text-align: center; margin: auto; }
        .msg-bubble {
          max-width: 75%;
          align-self: flex-start;
          background: rgba(255,255,255,0.08);
          border-radius: 14px 14px 14px 4px;
          padding: 8px 12px;
        }
        .msg-bubble.is-mine {
          align-self: flex-end;
          background: linear-gradient(135deg, #2563eb, #4f46e5);
          border-radius: 14px 14px 4px 14px;
        }
        .msg-bubble__text { font-size: 14px; white-space: pre-wrap; word-break: break-word; }
        .msg-share__title { display: flex; align-items: center; gap: 6px; font-weight: 700; }
        .msg-share__add { margin-top: 10px; width: 100%; justify-content: center; }
        .msg-share__meta { margin-top: 6px; font-size: 12px; opacity: 0.85; display: flex; flex-direction: column; gap: 2px; }
        .msg-convo__preview .icon { vertical-align: -2px; }
        .msg-chat__compose .btn svg, .msg-chat__head .btn svg { display: block; }
        .msg-bubble__time { font-size: 10px; opacity: 0.7; margin-top: 4px; text-align: right; }
        .msg-chat__compose {
          display: flex; gap: 8px; padding: 12px;
          border-top: 1px solid rgba(255,255,255,0.08);
        }
        .msg-chat__compose .input { flex: 1; }
        .msg-convos--groups { flex: 0 1 auto; max-height: 38%; }
        .group-av { display: grid; place-items: center; color: #fff; font-weight: 700; line-height: 1; border-color: transparent; user-select: none; }
        .msg-chat__titles { flex: 1; min-width: 0; }
        .msg-chat__name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .msg-chat__head .btn { flex: none; }
        .gset { display: flex; flex-direction: column; gap: 18px; }
        .gset__sec { display: flex; flex-direction: column; gap: 8px; }
        .gset__list { display: flex; flex-direction: column; gap: 6px; max-height: 220px; overflow-y: auto; }
        .gset__row { display: flex; align-items: center; gap: 10px; }
        .gset__name { flex: 1; min-width: 0; font-size: 14px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .gset__tag { color: var(--muted, #8b9bb8); font-size: 12px; }
      `}</style>
    </div>
  );
}
