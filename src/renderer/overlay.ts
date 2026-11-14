import './tokens.css';
import './overlay.css';
import { call, errMsg } from './api';
import { applyTheme, themeFromSettings } from './theme';
import type { ChaldUser } from '../shared/types';

/* ---------- types & state ---------- */
interface Invite {
  id: number;
  from?: { displayName?: string; mcName?: string };
  instanceName?: string;
  address?: string;
  note?: string;
}
type Tab = 'friends' | 'invites';
type Phase = 'idle' | 'outgoing' | 'incoming' | 'connecting' | 'active';

let tab: Tab = 'friends';
let friends: ChaldUser[] = [];
let invites: Invite[] = [];
let session: boolean | null = null;
let loaded = false;
let loadError = '';

const callState = { phase: 'idle' as Phase, peer: 0, name: '', mc: '', since: 0, muted: false, groupId: 0 as number, memberIds: [] as number[] };
let pc: RTCPeerConnection | null = null;
let localStream: MediaStream | null = null;
let pendingOffer: RTCSessionDescriptionInit | null = null;
let remoteSet = false;
let iceQueue: RTCIceCandidateInit[] = [];
let tick: number | undefined;
type Mode = 'closed' | 'hud' | 'open';
let mode: Mode = 'closed';
let myMc = '';
const speaking = { me: false, peer: false };

/* ---------- helpers ---------- */
const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const esc = (s: unknown) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

const ICONS: Record<string, string> = {
  phone: 'M5 4h4l2 5-2.5 1.5a11 11 0 005 5L15 13l5 2v4a2 2 0 01-2 2A16 16 0 013 6a2 2 0 012-2z',
  mail: 'M3 6h18v12H3zM3 7l9 7 9-7',
  mic: 'M12 3a3 3 0 00-3 3v6a3 3 0 006 0V6a3 3 0 00-3-3zM6 11a6 6 0 0012 0M12 17v4',
  micoff: 'M12 3a3 3 0 00-3 3v6a3 3 0 006 0V6a3 3 0 00-3-3zM6 11a6 6 0 0012 0M12 17v4M4 4l16 16',
  users: 'M9 11a3.5 3.5 0 100-7 3.5 3.5 0 000 7zM2 20c0-3.5 3-5.5 7-5.5s7 2 7 5.5M17 5a3 3 0 010 6M19 15c2 .8 3 2.4 3 5',
  inbox: 'M3 13l3-8h12l3 8v6H3zM3 13h5l1 3h6l1-3h5',
  lock: 'M6 11h12v9H6zM8 11V8a4 4 0 018 0v3',
  copy: 'M8 8h12v12H8zM4 16V4h12',
  check: 'M5 12.5l4.5 4.5L19 7.5',
  x: 'M6 6l12 12M18 6L6 18',
};
const icon = (n: string, size = 16, extra = '') =>
  `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" ${extra} aria-hidden="true"><path d="${ICONS[n]}"/></svg>`;

/** Licensed (v4) UUIDs get the real skin from mc-heads; offline names fall back to the name / Steve. */
const head = (mc?: string, uuid?: string | null) => {
  const u = (uuid || '').replace(/-/g, '').toLowerCase();
  if (/^[0-9a-f]{32}$/.test(u) && u[12] === '4') {
    return `https://mc-heads.net/avatar/${u}/64`;
  }
  return `https://mc-heads.net/avatar/${encodeURIComponent(mc || 'MHF_Steve')}/64`;
};
const avatar = (mc: string | undefined, dot?: 'game' | 'on' | 'off', label?: string, uuid?: string | null) =>
  `<div class="ov-ava" data-ch="${esc((label || mc || '?').trim().charAt(0).toUpperCase())}"><img src="${head(mc, uuid)}" alt="" draggable="false" />${dot ? `<i class="ov-dot${dot === 'game' ? ' ov-dot--game' : dot === 'off' ? ' ov-dot--off' : ''}"></i>` : ''}</div>`;

function statusOf(u: ChaldUser): { text: string; cls: string } {
  if (!u.online) return { text: 'не в сети', cls: '' };
  if (u.presence === 'game') return { text: u.activity ? `играет: ${u.activity}` : 'в игре', cls: 'ov-status--game' };
  if (u.presence === 'idle') return { text: 'отошёл', cls: '' };
  return { text: 'в лаунчере', cls: 'ov-status--launcher' };
}

let toastTimer: number | undefined;
function toast(text: string, isErr = false): void {
  const el = $('toast');
  el.textContent = text;
  el.classList.toggle('is-err', isErr);
  el.classList.add('is-show');
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => el.classList.remove('is-show'), 2600);
}

const nameOf = (id: number) => friends.find((f) => f.id === id);

/* ---------- rendering ---------- */
function setSub(text: string, state: 'live' | 'err' | '' = ''): void {
  const el = $('sub');
  el.textContent = text;
  el.className = 'ov-sub' + (state ? ` is-${state}` : '');
}

function emptyState(ic: string, title: string, hint: string): string {
  return `<div class="ov-empty">${icon(ic, 34)}<strong>${esc(title)}</strong><small>${esc(hint)}</small></div>`;
}

function friendCard(u: ChaldUser, idx: number): string {
  const st = statusOf(u);
  const dot = !u.online ? 'off' : u.presence === 'game' ? 'game' : 'on';
  const acts = u.online
    ? `<div class="ov-acts">
         <button class="ov-act ov-act--call" type="button" data-act="call" data-id="${u.id}" title="Позвонить" aria-label="Позвонить">${icon('phone')}</button>
         <button class="ov-act" type="button" data-act="invite" data-id="${u.id}" title="Пригласить в игру" aria-label="Пригласить в игру">${icon('mail')}</button>
       </div>`
    : '<span></span>';
  return `<div class="ov-card" style="animation-delay:${Math.min(idx, 8) * 25}ms${u.online ? '' : ';opacity:.6'}">
    ${avatar(u.mcName, dot, u.displayName || u.mcName, u.mcUuid)}
    <div class="ov-info"><div class="ov-name">${esc(u.displayName || u.mcName)}</div><div class="ov-status ${st.cls}">${esc(st.text)}</div></div>
    ${acts}
  </div>`;
}

function renderBody(): void {
  const body = $('body');
  const keep = body.scrollTop;
  if (!loaded) {
    body.innerHTML = '<div class="ov-skel"></div><div class="ov-skel"></div><div class="ov-skel"></div>';
  } else if (session === false) {
    body.innerHTML = emptyState('lock', 'Нет сессии Chald', 'Войди через Microsoft в лаунчере — и друзья появятся здесь');
  } else if (loadError) {
    body.innerHTML = emptyState('x', 'Не удалось загрузить', loadError);
  } else if (tab === 'friends') {
    const online = friends.filter((f) => f.online);
    const inGame = online.filter((f) => f.presence === 'game');
    const inLauncher = online.filter((f) => f.presence !== 'game');
    const offline = friends.filter((f) => !f.online);
    let i = 0;
    const group = (title: string, list: ChaldUser[]) =>
      list.length ? `<div class="ov-group">${title} · ${list.length}</div>${list.map((u) => friendCard(u, i++)).join('')}` : '';
    const html = group('В игре', inGame) + group('В лаунчере', inLauncher) + group('Не в сети', offline);
    body.innerHTML = html || emptyState('users', 'Список друзей пуст', 'Добавь друзей по Chald ID в разделе «Друзья» лаунчера');
  } else {
    body.innerHTML = invites.length
      ? invites.map((inv, i) => {
          const who = inv.from?.displayName || inv.from?.mcName || 'Друг';
          return `<div class="ov-invite" style="animation-delay:${Math.min(i, 8) * 25}ms">
            <div class="ov-invite__top">${avatar(inv.from?.mcName, undefined, who)}
              <div class="ov-invite__text"><b>${esc(who)}</b> приглашает в <em>${esc(inv.instanceName || 'игру')}</em></div>
            </div>
            ${inv.address ? `<div class="ov-chip"><span>${esc(inv.address)}</span><button type="button" data-act="copy" data-text="${esc(inv.address)}" title="Скопировать" aria-label="Скопировать адрес">${icon('copy', 13)}</button></div>` : ''}
            ${inv.note ? `<div class="ov-note">${esc(inv.note)}</div>` : ''}
            <div class="ov-invite__acts">
              <button class="ov-btn ov-btn--primary" type="button" data-act="accept" data-id="${inv.id}">${icon('check', 15)} Принять</button>
              <button class="ov-btn" type="button" data-act="decline" data-id="${inv.id}">Отклонить</button>
            </div>
          </div>`;
        }).join('')
      : emptyState('inbox', 'Нет входящих инвайтов', 'Когда друг позовёт тебя в игру, приглашение появится здесь');
  }
  body.scrollTop = keep;
}

function renderHeader(): void {
  $('cnt-friends').textContent = String(friends.filter((f) => f.online).length);
  const ci = $('cnt-invites');
  ci.textContent = String(invites.length);
  ci.classList.toggle('has', invites.length > 0);
  for (const t of document.querySelectorAll<HTMLButtonElement>('.ov-tab')) {
    const on = t.dataset.tab === tab;
    t.classList.toggle('is-active', on);
    t.setAttribute('aria-selected', String(on));
  }
  if (!loaded) setSub('подключение…');
  else if (session === false) setSub('нет сессии', 'err');
  else if (loadError) setSub('ошибка сети', 'err');
  else setSub(`${friends.filter((f) => f.online).length} онлайн`, 'live');
}

const fmt = (ms: number) => {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
};

function renderCall(): void {
  renderCallBar();
  renderHud();
}

function renderCallBar(): void {
  const el = $('call');
  const c = callState;
  if (c.phase === 'idle') {
    el.hidden = true;
    el.innerHTML = '';
    return;
  }
  const state =
    c.phase === 'incoming' ? 'входящий звонок…'
      : c.phase === 'outgoing' ? 'вызов…'
        : c.phase === 'connecting' ? 'соединение…'
          : `разговор · ${fmt(Date.now() - c.since)}`;
  const acts =
    c.phase === 'incoming'
      ? `<button class="ov-act ov-act--ok" type="button" data-act="answer" title="Принять" aria-label="Принять">${icon('phone', 17)}</button>
         <button class="ov-act ov-act--end" type="button" data-act="hangup" title="Отклонить" aria-label="Отклонить">${icon('phone', 17, 'style="transform:rotate(135deg)"')}</button>`
      : `${c.phase === 'active' ? `<button class="ov-act${c.muted ? ' is-on' : ''}" type="button" data-act="mute" title="${c.muted ? 'Включить микрофон' : 'Выключить микрофон'}" aria-label="Микрофон">${icon(c.muted ? 'micoff' : 'mic', 17)}</button>` : ''}
         <button class="ov-act ov-act--end" type="button" data-act="hangup" title="Завершить" aria-label="Завершить">${icon('phone', 17, 'style="transform:rotate(135deg)"')}</button>`;
  const html = `${avatar(c.mc, undefined, c.name)}<div class="ov-call__who"><div class="ov-name">${esc(c.name)}</div><div class="ov-call__state">${esc(state)}</div></div><div class="ov-call__acts">${acts}</div>`;
  el.hidden = false;
  el.className = 'ov-call' + (c.phase === 'incoming' ? ' is-incoming' : '');
  // Update only the timer text while the layout is unchanged, so buttons are not rebuilt under the cursor.
  const stateEl = el.querySelector('.ov-call__state');
  if (stateEl && el.dataset.phase === `${c.phase}:${c.muted}:${c.peer}`) stateEl.textContent = state;
  else {
    el.innerHTML = html;
    el.dataset.phase = `${c.phase}:${c.muted}:${c.peer}`;
  }
}

/* ---------- call HUD: heads in the top-left corner, a golden frame around whoever speaks ---------- */
function hudRow(who: 'me' | 'peer', mc: string, name: string, state: string, opts: { live?: boolean; muted?: boolean; ringing?: boolean; hint?: string } = {}): string {
  const cls = `hud-row${speaking[who] ? ' is-speaking' : ''}${opts.ringing ? ' is-ringing' : ''}`;
  return `<div class="${cls}" data-hud="${who}">
    <div class="hud-ava${speaking[who] ? ' is-speaking' : ''}" data-ch="${esc((name || mc || '?').trim().charAt(0).toUpperCase())}"><img src="${head(mc)}" alt="" draggable="false" /></div>
    <div class="hud-pill"><div class="hud-name">${opts.muted ? icon('micoff', 14) : ''}<span>${esc(name)}</span></div><div class="hud-state${opts.live ? ' is-live' : ''}" data-hud-state>${esc(state)}</div>${opts.hint ? `<div class="hud-hint">${esc(opts.hint)}</div>` : ''}</div>
  </div>`;
}

function renderHud(): void {
  const hud = $('hud');
  const c = callState;
  if (c.phase === 'idle') {
    if (hud.dataset.key) { hud.innerHTML = ''; hud.dataset.key = ''; }
    return;
  }
  const key = `${mode}:${c.phase}:${c.peer}:${c.name}:${c.mc}:${c.muted}:${myMc}`;
  const peerState = c.phase === 'incoming' ? 'звонит…' : c.phase === 'outgoing' ? 'вызов…' : c.phase === 'connecting' ? 'соединение…' : `разговор · ${fmt(Date.now() - c.since)}`;
  if (hud.dataset.key !== key) {
    const ringing = c.phase === 'incoming' || c.phase === 'outgoing';
    const hint = c.phase === 'incoming' ? (mode === 'open' ? 'Ответь в панели ниже' : `${/Mac|iPhone|iPad/.test(navigator.platform) ? '⌘' : 'Ctrl'}+Shift+O — ответить`) : undefined;
    let html = hudRow('peer', c.mc, c.name, peerState, { live: c.phase === 'active', ringing, hint });
    if (c.phase === 'connecting' || c.phase === 'active') html += hudRow('me', myMc, 'Вы', c.muted ? 'микрофон выключен' : 'микрофон включён', { muted: c.muted });
    hud.innerHTML = html;
    hud.dataset.key = key;
    return;
  }
  const st = hud.querySelector('[data-hud="peer"] [data-hud-state]');
  if (st && st.textContent !== peerState) st.textContent = peerState;
}

function setSpeaking(who: 'me' | 'peer', on: boolean): void {
  if (speaking[who] === on) return;
  speaking[who] = on;
  const row = document.querySelector(`[data-hud="${who}"]`);
  row?.classList.toggle('is-speaking', on);
  row?.querySelector('.hud-ava')?.classList.toggle('is-speaking', on);
}

/** Voice activity: an analyser on the stream; "speaking" lasts a moment after the last loud frame so the frame does not flicker. */
const watchers = new Map<'me' | 'peer', { ctx: AudioContext; timer: number }>();
function unwatch(who: 'me' | 'peer'): void {
  const w = watchers.get(who);
  if (w) {
    clearInterval(w.timer);
    try { void w.ctx.close(); } catch { /* */ }
    watchers.delete(who);
  }
  setSpeaking(who, false);
}
function watchSpeaking(who: 'me' | 'peer', stream: MediaStream): void {
  unwatch(who);
  try {
    const ctx = new AudioContext();
    void ctx.resume().catch(() => undefined);
    const an = ctx.createAnalyser();
    an.fftSize = 512;
    ctx.createMediaStreamSource(stream).connect(an); // not connected to the speakers: the call audio is played elsewhere
    const buf = new Uint8Array(an.fftSize);
    let until = 0;
    const timer = window.setInterval(() => {
      an.getByteTimeDomainData(buf);
      let sum = 0;
      for (const v of buf) { const x = (v - 128) / 128; sum += x * x; }
      const loud = Math.sqrt(sum / buf.length) > 0.03 && !(who === 'me' && callState.muted);
      const now = performance.now();
      if (loud) until = now + 350;
      setSpeaking(who, now < until);
    }, 80);
    watchers.set(who, { ctx, timer });
  } catch { /* no audio context: the frame simply stays off */ }
}

function setMode(m: Mode): void {
  mode = m;
  document.body.dataset.mode = m;
  if (callState.phase !== 'idle') renderHud();
  if (m === 'open') {
    closeSheet();
    void refresh();
  }
}

function renderAll(): void {
  renderHeader();
  renderBody();
}

/* ---------- data ---------- */
let refreshing = false;
async function refresh(manual = false): Promise<void> {
  if (refreshing) return;
  refreshing = true;
  const btn = document.querySelector('[data-act="refresh"]');
  if (manual) btn?.classList.add('is-spin');
  try {
    try {
      applyTheme(themeFromSettings(await call('settings:get')));
    } catch { /* the default theme is fine */ }
    try { myMc = (await call('auth:state')).name ?? myMc; } catch { /* keep the previous name */ }
    session = await call('friends:hasSession');
    if (session) {
      const [list, inv] = await Promise.all([call('friends:list'), call('friends:invites')]);
      friends = list.friends ?? [];
      invites = (inv.incoming ?? []) as Invite[];
      loadError = '';
    } else {
      friends = [];
      invites = [];
    }
  } catch (e) {
    loadError = errMsg(e);
  } finally {
    loaded = true;
    refreshing = false;
    btn?.classList.remove('is-spin');
    renderAll();
  }
}

/* ---------- invites ---------- */
function openInviteSheet(userId: number): void {
  const f = nameOf(userId);
  const sheet = $('sheet');
  sheet.hidden = false;
  sheet.innerHTML = `<form class="ov-sheet__box" id="invite-form" autocomplete="off">
    <div class="ov-sheet__title">Пригласить <span>${esc(f?.displayName || f?.mcName || 'друга')}</span></div>
    <div class="ov-field"><label for="inv-name">Инстанс / сервер</label><input id="inv-name" maxlength="64" value="Моя игра" /></div>
    <div class="ov-field"><label for="inv-addr">Адрес (необязательно)</label><input id="inv-addr" maxlength="128" placeholder="IP:порт" /></div>
    <div class="ov-sheet__acts">
      <button class="ov-btn ov-btn--primary" type="submit">${icon('mail', 15)} Отправить</button>
      <button class="ov-btn" type="button" data-act="close-sheet">Отмена</button>
    </div>
  </form>`;
  const form = $<HTMLFormElement>('invite-form');
  form.addEventListener('submit', (ev) => {
    ev.preventDefault();
    const instanceName = $<HTMLInputElement>('inv-name').value.trim() || 'Моя игра';
    const address = $<HTMLInputElement>('inv-addr').value.trim();
    closeSheet();
    void call('friends:invite', { toUserId: userId, instanceName, address, note: '' })
      .then(() => toast('Инвайт отправлен'))
      .catch((e) => toast(errMsg(e), true));
  });
  $<HTMLInputElement>('inv-name').select();
}
function closeSheet(): void {
  const sheet = $('sheet');
  sheet.hidden = true;
  sheet.innerHTML = '';
}

/* ---------- calls (WebRTC, signalling through the friends server) ---------- */
const signal = (toUserId: number, kind: 'ring' | 'offer' | 'answer' | 'ice' | 'hangup', payload = '{}') =>
  call('friends:callSignal', {
    toUserId,
    kind,
    payload,
    ...(callState.groupId ? { groupId: callState.groupId } : {}),
  });

function setPhase(p: Phase): void {
  callState.phase = p;
  if (p === 'active' || p === 'idle') stopRingtone();
  if (p === 'active') {
    playConnectTone();
    callState.since = Date.now();
    if (!tick) tick = window.setInterval(renderCall, 1000);
  } else if (p === 'idle') {
    if (tick) {
      clearInterval(tick);
      tick = undefined;
    }
  }
  renderCall();
  renderHeader();
  void call('overlay:callState', { phase: p }).catch(() => undefined);
}


/* ---------- ringtone + better audio ---------- */
let ringTimer: ReturnType<typeof setInterval> | undefined;
let ringCtx: AudioContext | null = null;

function stopRingtone(): void {
  if (ringTimer) {
    clearInterval(ringTimer);
    ringTimer = undefined;
  }
  if (ringCtx) {
    try { void ringCtx.close(); } catch { /* */ }
    ringCtx = null;
  }
}

/** Soft two-tone ring (not a harsh beep), loops until stopRingtone(). */
function playTone(freqs: number[], dur = 0.12, vol = 0.07): void {
  try {
    const ctx = new AudioContext();
    const now = ctx.currentTime;
    freqs.forEach((freq, i) => {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = 'sine';
      o.frequency.value = freq;
      g.gain.setValueAtTime(0.0001, now + i * dur);
      g.gain.exponentialRampToValueAtTime(vol, now + i * dur + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, now + i * dur + dur);
      o.connect(g); g.connect(ctx.destination);
      o.start(now + i * dur);
      o.stop(now + i * dur + dur + 0.02);
    });
    setTimeout(() => void ctx.close(), (freqs.length * dur + 0.3) * 1000);
  } catch { /* */ }
}
function playConnectTone(): void { playTone([523.25, 659.25, 783.99], 0.1, 0.06); }
function playHangupTone(): void { playTone([392, 330, 262], 0.11, 0.05); }

function playRingtone(): void {
  stopRingtone();
  try {
    const ctx = new AudioContext();
    ringCtx = ctx;
    const beat = () => {
      if (!ringCtx) return;
      const now = ringCtx.currentTime;
      // gentle "marimba-like" pair of notes
      const notes = [523.25, 659.25, 523.25, 0]; // C5 E5 C5 pause
      notes.forEach((freq, i) => {
        if (!freq) return;
        const o = ringCtx!.createOscillator();
        const g = ringCtx!.createGain();
        o.type = 'sine';
        o.frequency.value = freq;
        g.gain.setValueAtTime(0.0001, now + i * 0.18);
        g.gain.exponentialRampToValueAtTime(0.09, now + i * 0.18 + 0.03);
        g.gain.exponentialRampToValueAtTime(0.0001, now + i * 0.18 + 0.16);
        o.connect(g);
        g.connect(ringCtx!.destination);
        o.start(now + i * 0.18);
        o.stop(now + i * 0.18 + 0.18);
      });
    };
    beat();
    ringTimer = setInterval(beat, 2200);
  } catch {
    /* autoplay / AudioContext blocked */
  }
}

async function ensurePc(): Promise<RTCPeerConnection> {
  if (pc) return pc;
  const conn = new RTCPeerConnection({
    iceServers: [
      { urls: 'stun:stun.l.google.com:19302' },
      { urls: 'stun:stun1.l.google.com:19302' },
    ],
  });
  pc = conn;
  conn.onicecandidate = (ev) => {
    if (ev.candidate && callState.peer) void signal(callState.peer, 'ice', JSON.stringify(ev.candidate)).catch(() => undefined);
  };
  conn.ontrack = (ev) => {
    let audio = document.getElementById('remote-audio') as HTMLAudioElement | null;
    if (!audio) {
      audio = document.createElement('audio');
      audio.id = 'remote-audio';
      audio.autoplay = true;
      audio.setAttribute('playsinline', 'true');
      document.body.appendChild(audio);
    }
    audio.srcObject = ev.streams[0] ?? null;
    if (ev.streams[0]) watchSpeaking('peer', ev.streams[0]);
    audio.volume = 1;
    void audio.play().catch(() => undefined);
  };
  conn.onconnectionstatechange = () => {
    if (conn.connectionState === 'connected') {
      stopRingtone();
    }
    if (conn.connectionState === 'failed') {
      toast('Не удалось соединиться', true);
      void endCall(true);
    }
  };
  // Voice-optimized constraints: echo cancel + noise suppress (big quality win vs default)
  localStream = await navigator.mediaDevices.getUserMedia({
    audio: {
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true,
      channelCount: 1,
      sampleRate: 48000,
    },
    video: false,
  });
  for (const track of localStream.getTracks()) {
    conn.addTrack(track, localStream);
  }
  watchSpeaking('me', localStream);
  // Prefer Opus / limit bitrate for speech
  try {
    const sender = conn.getSenders().find((s) => s.track?.kind === 'audio');
    if (sender) {
      const params = sender.getParameters();
      if (!params.encodings || params.encodings.length === 0) params.encodings = [{}];
      params.encodings[0]!.maxBitrate = 48_000; // 48 kbps voice
      await sender.setParameters(params);
    }
  } catch { /* optional */ }
  return conn;
}

async function flushIce(): Promise<void> {
  const list = iceQueue;
  iceQueue = [];
  for (const c of list) {
    try { await pc?.addIceCandidate(c); } catch { /* stale candidate */ }
  }
}

function beginCall(peer: number, phase: Phase): void {
  const f = nameOf(peer);
  Object.assign(callState, { peer, name: f?.displayName || f?.mcName || `Друг #${peer}`, mc: f?.mcName ?? '', muted: false });
  document.getElementById('call')!.dataset.phase = '';
  setPhase(phase);
  if (!f) void refresh().then(() => {
    const nf = nameOf(peer);
    if (nf && callState.peer === peer) { Object.assign(callState, { name: nf.displayName || nf.mcName, mc: nf.mcName }); renderCall(); }
  });
}

async function startCall(userId: number, opts?: { groupId?: number | null; memberIds?: number[]; name?: string }): Promise<void> {
  if (callState.phase !== 'idle') return toast('Сначала заверши текущий звонок', true);
  const memberIds = (opts?.memberIds ?? []).filter((id) => id && id !== userId);
  const groupId = opts?.groupId ?? 0;
  callState.groupId = groupId || 0;
  callState.memberIds = memberIds;
  // 1:1 uses userId; group uses the first member as primary signalling peer (mesh: ring all).
  const primary = userId || memberIds[0] || 0;
  if (!primary) return toast('Нет участников для звонка', true);
  beginCall(primary, 'outgoing');
  if (opts?.name) callState.name = opts.name;
  playRingtone();
  try {
    const targets = groupId && memberIds.length ? memberIds : [primary];
    for (const tid of targets) {
      await signal(tid, 'ring');
    }
    // Full mesh for every remote: one RTCPeerConnection is shared for the primary; others get ring only until they answer (server fans out).
    const conn = await ensurePc();
    const offer = await conn.createOffer({ offerToReceiveAudio: true, offerToReceiveVideo: false });
    await conn.setLocalDescription(offer);
    for (const tid of targets) {
      await signal(tid, 'offer', JSON.stringify(offer));
    }
  } catch (e) {
    toast(e instanceof DOMException ? 'Нет доступа к микрофону' : errMsg(e), true);
    await endCall(true);
  }
}

async function answerOffer(): Promise<void> {
  if (!pendingOffer) return;
  const offer = pendingOffer;
  pendingOffer = null;
  try {
    const conn = await ensurePc();
    await conn.setRemoteDescription(offer);
    remoteSet = true;
    await flushIce();
    const answer = await conn.createAnswer();
    await conn.setLocalDescription(answer);
    await signal(callState.peer, 'answer', JSON.stringify(answer));
    setPhase('active');
  } catch (e) {
    toast(e instanceof DOMException ? 'Нет доступа к микрофону' : errMsg(e), true);
    await endCall(true);
  }
}

async function acceptCall(): Promise<void> {
  if (callState.phase !== 'incoming') return;
  setPhase('connecting');
  if (pendingOffer) await answerOffer(); // otherwise the offer is answered as soon as it arrives
}

async function endCall(notify: boolean): Promise<void> {
  stopRingtone();
  if (callState.phase !== 'idle') playHangupTone();
  const peer = callState.peer;
  const targets = callState.memberIds.length
    ? Array.from(new Set([peer, ...callState.memberIds].filter(Boolean)))
    : (peer ? [peer] : []);
  if (notify) {
    for (const tid of targets) {
      try { await signal(tid, 'hangup'); } catch { /* the other side may already be gone */ }
    }
  }
  unwatch('me');
  unwatch('peer');
  pc?.close();
  pc = null;
  localStream?.getTracks().forEach((t) => t.stop());
  localStream = null;
  pendingOffer = null;
  remoteSet = false;
  iceQueue = [];
  callState.peer = 0;
  callState.groupId = 0;
  callState.memberIds = [];
  setPhase('idle');
}

let polling = false;
async function pollSignals(): Promise<void> {
  if (polling || !session) return;
  polling = true;
  try {
    const { signals } = await call('friends:callPoll');
    for (const s of signals ?? []) {
      const busyWithOther = callState.phase !== 'idle' && s.fromUserId !== callState.peer;
      if (busyWithOther) continue;
      if (s.kind === 'ring' && callState.phase === 'idle') {
        beginCall(s.fromUserId, 'incoming');
        toast(`Входящий: ${callState.name}`);
        playRingtone();
      } else if (s.kind === 'offer') {
        if (callState.phase === 'idle') beginCall(s.fromUserId, 'incoming');
        try { pendingOffer = JSON.parse(s.payload) as RTCSessionDescriptionInit; } catch { continue; }
        if (callState.phase === 'connecting') await answerOffer();
      } else if (s.kind === 'answer' && pc && callState.phase === 'outgoing') {
        await pc.setRemoteDescription(JSON.parse(s.payload) as RTCSessionDescriptionInit);
        remoteSet = true;
        await flushIce();
        setPhase('active');
      } else if (s.kind === 'ice') {
        try {
          const cand = JSON.parse(s.payload) as RTCIceCandidateInit;
          if (pc && remoteSet) await pc.addIceCandidate(cand);
          else iceQueue.push(cand); // arrived before the remote description: hold it
        } catch { /* ignore broken candidate */ }
      } else if (s.kind === 'hangup') {
        await endCall(false);
        toast('Звонок завершён');
      }
    }
  } catch { /* transient network error: the next tick retries */ } finally {
    polling = false;
  }
}

/* ---------- events ---------- */
document.addEventListener('click', (ev) => {
  const hit = (ev.target as HTMLElement).id;
  if (hit === 'sheet') return closeSheet(); // click on the dimmed backdrop of the invite sheet
  if (hit === 'stage' || hit === 'dim' || hit === 'root') { void call('overlay:toggle'); return; } // click on the dimmed game
  const target = (ev.target as HTMLElement).closest<HTMLElement>('[data-act],[data-tab]');
  if (!target) return;
  if (target.dataset.tab) {
    tab = target.dataset.tab as Tab;
    renderAll();
    return;
  }
  const id = Number(target.dataset.id);
  switch (target.dataset.act) {
    case 'hide': void call('overlay:toggle'); break;
    case 'refresh': void refresh(true); break;
    case 'call': void startCall(id); break;
    case 'invite': openInviteSheet(id); break;
    case 'close-sheet': closeSheet(); break;
    case 'answer': void acceptCall(); break;
    case 'hangup': void endCall(true); break;
    case 'mute':
      callState.muted = !callState.muted;
      localStream?.getAudioTracks().forEach((t) => { t.enabled = !callState.muted; });
      renderCall();
      break;
    case 'accept':
      void call('friends:inviteAccept', { inviteId: id }).then(() => toast('Инвайт принят')).catch((e) => toast(errMsg(e), true)).finally(() => void refresh());
      break;
    case 'decline':
      void call('friends:inviteDecline', { inviteId: id }).catch((e) => toast(errMsg(e), true)).finally(() => void refresh());
      break;
    case 'copy':
      void navigator.clipboard.writeText(target.dataset.text ?? '').then(() => toast('Адрес скопирован')).catch(() => toast('Не удалось скопировать', true));
      break;
  }
});

document.addEventListener('keydown', (ev) => {
  if (ev.key !== 'Escape') return;
  if (!$('sheet').hidden) closeSheet();
  else void call('overlay:toggle');
});

// A head that fails to load (offline, blocked host) becomes a tile with the nickname's first letter, not a broken-image icon.
document.addEventListener('error', (ev) => {
  const img = ev.target;
  if (img instanceof HTMLImageElement) img.closest('.ov-ava')?.classList.add('is-fb');
}, true);

if (/Mac|iPhone|iPad/.test(navigator.platform)) $('k1').textContent = '⌘';

renderAll();
renderCall();
void refresh();
let refreshTick = 0;
// the friend list is kept fresh while the overlay is open; closed, a slower pace is enough (names for incoming calls)
setInterval(() => { refreshTick++; if (mode === 'open' || refreshTick % 4 === 0) void refresh(); }, 8000);
setInterval(() => void pollSignals(), 1500);


/* ---------- window mode from the main process (closed / hud / open) ---------- */
try {
  const bridge = (window as unknown as { chald?: { on: (c: string, cb: (p: unknown) => void) => () => void } }).chald;
  if (bridge) bridge.on('overlay:mode', (m) => setMode(m === 'open' || m === 'hud' ? m : 'closed'));
  else setMode('open'); // opened in a plain browser (preview)
} catch { /* the mode stays closed */ }

/* ---------- start call from main launcher window ---------- */
try {
  const chald = (window as unknown as { chald?: { on: (c: string, cb: (p: unknown) => void) => () => void } }).chald;
  chald?.on('overlay:startCall', (payload) => {
    const p = payload as {
      userId?: number;
      name?: string;
      mcName?: string;
      groupId?: number | null;
      memberIds?: number[];
    };
    const isGroup = !!(p?.groupId && (p.memberIds?.length ?? 0) > 0);
    if (!p?.userId && !isGroup) return;
    // Ensure friend is in list for name resolution
    if (p.userId && (p.name || p.mcName)) {
      const existing = friends.find((f) => f.id === p.userId);
      if (!existing) {
        friends = [{
          id: p.userId,
          chaldId: '',
          mcUuid: '',
          mcName: p.mcName || p.name || 'Friend',
          displayName: p.name || p.mcName || 'Friend',
          bio: '',
          online: true,
          presence: 'launcher',
          activity: '',
          lastSeen: Date.now() / 1000,
          createdAt: 0,
        }, ...friends];
      }
    }
    void startCall(p.userId || 0, {
      groupId: p.groupId,
      memberIds: p.memberIds,
      name: p.name,
    });
  });
} catch { /* preload may not expose on for overlay yet */ }

