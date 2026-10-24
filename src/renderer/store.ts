import { create } from 'zustand';
import type {
  AppInfo, AppSettings, AuthState, DeviceCodeInfo, InstanceView, ModrinthType, OpProgress, UpdateInfo,
} from '../shared/types';
import { ApiError, call, errMsg, on } from './api';

export type Page = 'home' | 'instances' | 'versions' | 'mods' | 'resourcepacks' | 'wardrobe' | 'modrinth' | 'console' | 'settings';
export interface Toast { id: number; kind: 'ok' | 'error' | 'info'; text: string }

interface State {
  ready: boolean;
  info: AppInfo | null;
  settings: AppSettings | null;
  instances: InstanceView[];
  instancesLoaded: boolean;
  selectedId: string | null;
  page: Page;
  consoleTab: 'game' | 'network';
  modrinthType: ModrinthType;
  ops: Record<string, OpProgress>;
  logs: Record<string, string[]>;
  auth: AuthState | null;
  deviceCode: DeviceCodeInfo | null;
  update: UpdateInfo | null;
  sysMemory: { totalMb: number; freeMb: number } | null;
  toasts: Toast[];
  wizard: { open: boolean; mcVersion: string | null };

  init(): Promise<void>;
  go(page: Page, opts?: { consoleTab?: 'game' | 'network'; modrinthType?: ModrinthType }): void;
  refreshInstances(): Promise<void>;
  select(id: string | null): void;
  saveSettings(patch: Partial<AppSettings>): Promise<AppSettings>;
  toast(kind: Toast['kind'], text: string): void;
  dismissToast(id: number): void;
  openWizard(mcVersion?: string): void;
  closeWizard(): void;
  play(id: string): Promise<void>;
  stop(id: string): Promise<void>;
  install(id: string): Promise<void>;
  cancelInstall(id: string): Promise<void>;
  login(method?: 'browser' | 'code'): Promise<void>;
  loginWait: 'browser' | null;
  setOffline(name: string): Promise<void>;
  setAccountMode(mode: AppSettings['accountMode']): Promise<void>;
  checkUpdate(): Promise<void>;
  downloadUpdate(): Promise<void>;
  installUpdate(): Promise<void>;
  refreshMemory(): Promise<void>;
  selected(): InstanceView | null;
}

let toastId = 0;
let initialized = false;

export const useStore = create<State>((set, get) => ({
  ready: false,
  info: null,
  settings: null,
  instances: [],
  instancesLoaded: false,
  selectedId: null,
  page: 'instances',
  consoleTab: 'game',
  modrinthType: 'mod',
  ops: {},
  logs: {},
  auth: null,
  deviceCode: null,
  loginWait: null,
  update: null,
  sysMemory: null,
  toasts: [],
  wizard: { open: false, mcVersion: null },

  async init() {
    if (initialized) return;
    initialized = true;
    try {
      const [info, settings, auth] = await Promise.all([call('app:info'), call('settings:get'), call('auth:state')]);
      set({ info, settings, auth, selectedId: settings.lastInstanceId });
      await get().refreshInstances();
      const { instances, selectedId } = get();
      if (!instances.some((i) => i.id === selectedId)) set({ selectedId: instances[0]?.id ?? null });
      void get().refreshMemory();
      set({ ready: true });
    } catch (e) {
      initialized = false; // allow a retry from the boot screen
      throw e;
    }

    on('op:progress', (p) => {
      const first = p.kind === 'launch' && p.status === 'running' && !get().ops[p.opId];
      set((s) => ({ ops: { ...s.ops, [p.opId]: p } }));
      if (first) void get().refreshInstances();
      if (p.status !== 'running') {
        void get().refreshInstances();
        if (p.status === 'done' && p.kind === 'install' && !p.opId.startsWith('modrinth:')) get().toast('ok', 'Установка завершена');
        if (p.kind === 'update' && p.status === 'done') {
          void get().checkUpdate();
          get().toast('ok', `${p.label}. Нажми «Установить» слева внизу, когда будешь готов.`);
        }
        if (p.status === 'done' && p.kind === 'modpack') {
          get().toast('ok', p.label);
          if (p.instanceId) get().select(p.instanceId);
        }
        if (p.status === 'error') get().toast('error', p.message ?? p.label);
        const ttl = p.status === 'error' ? 12000 : 3500;
        setTimeout(() => set((s) => {
          const cur = s.ops[p.opId];
          if (!cur || cur.status === 'running') return s;
          const { [p.opId]: _drop, ...rest } = s.ops;
          return { ops: rest };
        }), ttl);
      }
    });
    on('game:status', (e) => {
      // The process state is the truth: a launch progress entry must never outlive it (no ghost "Остановить" button).
      set((st) => ({
        ops: Object.fromEntries(Object.entries(st.ops).filter(([, o]) => !(o.kind === 'launch' && o.instanceId === e.instanceId))),
      }));
      void get().refreshInstances();
      if (e.status === 'crashed') get().toast('error', `Игра завершилась с ошибкой (код ${e.exitCode ?? '—'}). Смотри «Консоль».`);
    });
    on('game:log', (e) => {
      set((s) => {
        const prev = s.logs[e.instanceId] ?? [];
        const next = prev.length >= 3000 ? [...prev.slice(-2500), e.line] : [...prev, e.line];
        return { logs: { ...s.logs, [e.instanceId]: next } };
      });
    });
    on('auth:changed', (a) => {
      set({ auth: a, deviceCode: null });
      void call('settings:get').then((settings) => set({ settings })).catch(() => undefined);
    });
    on('auth:deviceCode', (c) => set({ deviceCode: c }));

    if (get().settings?.checkUpdates) void get().checkUpdate();
  },

  go(page, opts) {
    void call('presence:page', page).catch(() => undefined);
    set({ page, ...(opts?.consoleTab ? { consoleTab: opts.consoleTab } : {}), ...(opts?.modrinthType ? { modrinthType: opts.modrinthType } : {}) });
  },

  async refreshInstances() {
    try {
      const instances = await call('instances:list');
      set({ instances, instancesLoaded: true });
    } catch (e) {
      get().toast('error', errMsg(e));
      set({ instancesLoaded: true });
    }
  },

  select(id) {
    set({ selectedId: id });
    void call('instances:select', { id }).catch(() => undefined);
  },

  async saveSettings(patch) {
    const next = await call('settings:set', patch);
    set({ settings: next });
    return next;
  },

  toast(kind, text) {
    const id = ++toastId;
    set((s) => ({ toasts: [...s.toasts, { id, kind, text }].slice(-4) }));
    setTimeout(() => get().dismissToast(id), kind === 'error' ? 9000 : 4000);
  },
  dismissToast(id) {
    set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }));
  },

  openWizard(mcVersion) {
    set({ wizard: { open: true, mcVersion: mcVersion ?? null }, page: 'instances' });
  },
  closeWizard() {
    set({ wizard: { open: false, mcVersion: null } });
  },

  async play(id) {
    try {
      await call('game:launch', { id });
    } catch (e) {
      get().toast('error', errMsg(e));
      if (e instanceof ApiError && (e.code === 'AUTH_REQUIRED')) get().go('settings');
    }
  },

  async stop(id) {
    try { await call('game:stop', { id }); } catch (e) { get().toast('error', errMsg(e)); }
  },

  async install(id) {
    try { await call('instances:install', { id }); } catch (e) { get().toast('error', errMsg(e)); }
    void get().refreshInstances();
  },

  async cancelInstall(id) {
    try { await call('instances:cancelInstall', { id }); } catch (e) { get().toast('error', errMsg(e)); }
  },

  async login(method = 'browser') {
    set({ loginWait: method === 'browser' ? 'browser' : null });
    try {
      await call('auth:login', { method });
      get().toast('ok', 'Аккаунт подключён');
    } catch (e) {
      set({ deviceCode: null });
      if (e instanceof ApiError && e.code === 'AUTH_CANCELLED') return;
      get().toast(e instanceof ApiError && e.code === 'AUTH_NOT_CONFIGURED' ? 'info' : 'error', errMsg(e));
    } finally {
      set({ loginWait: null });
    }
  },

  async setOffline(name) {
    const auth = await call('auth:setOffline', { name });
    set({ auth, settings: await call('settings:get') });
  },

  async setAccountMode(mode) {
    await get().saveSettings({ accountMode: mode });
  },

  async checkUpdate() {
    try {
      const info = await call('update:check');
      set({ update: info });
      // a new version: fetch it in the background (installing it always needs a click)
      if (info.hasUpdate && info.assetName && !info.downloaded && !info.downloading && get().settings?.autoDownloadUpdates) void get().downloadUpdate();
    } catch {
      set({ update: null });
    }
  },

  async downloadUpdate() {
    try {
      await call('update:download');
      set((s) => (s.update ? { update: { ...s.update, downloading: true } } : s));
    } catch (e) {
      get().toast('error', errMsg(e));
    }
  },

  async installUpdate() {
    try {
      await call('update:install');
      get().toast('info', 'Запускаю установщик, лаунчер сейчас перезапустится…');
    } catch (e) {
      get().toast('error', errMsg(e));
    }
  },

  async refreshMemory() {
    try { set({ sysMemory: await call('system:memory') }); } catch { /* the sliders work without it */ }
  },

  selected() {
    const { instances, selectedId } = get();
    return instances.find((i) => i.id === selectedId) ?? null;
  },
}));

export function activeOp(ops: Record<string, OpProgress>, instanceId?: string): OpProgress | null {
  const list = Object.values(ops).filter((o) => (instanceId ? o.instanceId === instanceId : true));
  return list.find((o) => o.status === 'running') ?? null;
}
