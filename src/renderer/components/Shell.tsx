import type { UpdateInfo } from '../../shared/types';
import { call } from '../api';
import { useI18n } from '../i18n';
import { activeOp, useStore, type Page } from '../store';
import { stateText } from '../util';
import { DiscordButton } from './Discord';
import { Icon } from './Icon';
import { LogoMark } from './Logo';
import { ProgressBar } from './ui';

export function TitleBar() {
  const auth = useStore((s) => s.auth);
  const go = useStore((s) => s.go);
  const { t } = useI18n();
  const win = (a: 'minimize' | 'maximize' | 'close') => void call('window:control', a);
  return (
    <header className="titlebar">
      <div className="titlebar__brand">
        <LogoMark />
        <div>
          <div className="wordmark">Chald<span>Launcher</span></div>
          <div className="tagline">Minecraft Launcher by Chald Studio</div>
        </div>
      </div>
      <div className="titlebar__right">
        <button
          className="profile"
          onClick={() => go('settings')}
          title={auth?.mode === 'offline' ? t('auth.offlineHint') : t('auth.msHint')}
        >
          <span className="profile__avatar"><Icon name="user" size={18} /></span>
          <span className="profile__name">
            {auth?.loggedIn ? auth.name : auth?.mode === 'offline' ? t('auth.enterName') : t('auth.signIn')}
          </span>
          {auth?.mode === 'offline' && <span className="badge badge--warn">{t('auth.offline')}</span>}
          <Icon name="down" size={14} />
        </button>
        <button className="icon-btn" onClick={() => go('settings')} aria-label={t('nav.settings')}>
          <Icon name="gear" />
        </button>
        <span className="titlebar__sep" />
        <button className="icon-btn win-btn" onClick={() => win('minimize')} aria-label={t('win.minimize')}>
          <Icon name="min" />
        </button>
        <button className="icon-btn win-btn" onClick={() => win('maximize')} aria-label={t('win.maximize')}>
          <Icon name="max" size={15} />
        </button>
        <button className="icon-btn win-btn win-btn--close" onClick={() => win('close')} aria-label={t('win.close')}>
          <Icon name="x" />
        </button>
      </div>
    </header>
  );
}

export const NAV_PAGES: { page: Page; labelKey: string; icon: string }[] = [
  { page: 'home', labelKey: 'nav.home', icon: 'home' },
  { page: 'instances', labelKey: 'nav.instances', icon: 'cube' },
  { page: 'versions', labelKey: 'nav.versions', icon: 'layers' },
  { page: 'mods', labelKey: 'nav.mods', icon: 'puzzle' },
  { page: 'resourcepacks', labelKey: 'nav.resourcepacks', icon: 'image' },
  { page: 'wardrobe', labelKey: 'nav.wardrobe', icon: 'shirt' },
  { page: 'modrinth', labelKey: 'nav.modrinth', icon: 'download' },
  { page: 'console', labelKey: 'nav.console', icon: 'terminal' },
  { page: 'mojang', labelKey: 'nav.mojang', icon: 'play' },
  { page: 'settings', labelKey: 'nav.settings', icon: 'gear' },
];

/** What the update button says and does, depending on how far the update has come. */
export function updateButton(
  u: UpdateInfo | null,
  t: (key: string, vars?: Record<string, string | number>) => string,
): { text: string; icon: string; action: 'check' | 'download' | 'install' | 'none' } {
  if (!u) return { text: t('update.check'), icon: 'refresh', action: 'check' };
  if (!u.configured) return { text: t('update.check'), icon: 'refresh', action: 'check' };
  if (!u.hasUpdate) return { text: t('update.upToDate'), icon: 'refresh', action: 'check' };
  if (u.downloaded) return { text: `${t('update.install')} v${u.latest}`, icon: 'download', action: 'install' };
  if (u.downloading) return { text: `${t('update.downloading')} v${u.latest}`, icon: 'download', action: 'none' };
  if (u.assetName) return { text: `${t('update.download')} v${u.latest}`, icon: 'download', action: 'download' };
  return { text: `${t('update.available')} v${u.latest}`, icon: 'download', action: 'check' };
}

export function Sidebar() {
  const page = useStore((s) => s.page);
  const go = useStore((s) => s.go);
  const info = useStore((s) => s.info);
  const hidden = useStore((s) => s.settings?.hiddenPages) ?? [];
  const update = useStore((s) => s.update);
  const checkUpdate = useStore((s) => s.checkUpdate);
  const downloadUpdate = useStore((s) => s.downloadUpdate);
  const installUpdate = useStore((s) => s.installUpdate);
  const { t } = useI18n();
  const ub = updateButton(update, t);
  const onUpdate = () => {
    if (ub.action === 'install') void installUpdate();
    else if (ub.action === 'download') void downloadUpdate();
    else if (ub.action === 'check') void checkUpdate();
  };
  return (
    <aside className="sidebar">
      <nav>
        {NAV_PAGES.filter((n) => n.page === 'settings' || !hidden.includes(n.page)).map((n) => (
          <button key={n.page} className={`nav${page === n.page ? ' is-active' : ''}`} onClick={() => go(n.page)}>
            <Icon name={n.icon} size={20} /> {t(n.labelKey)}
          </button>
        ))}
      </nav>
      <div className="sidebar__bottom">
        <DiscordButton block />
        <button className={`update${update?.downloaded ? ' update--ready' : ''}`} onClick={onUpdate} disabled={ub.action === 'none'}>
          <Icon name={ub.icon} size={20} />
          <span>
            <strong>ChaldLauncher v{info?.version ?? '…'}</strong>
            <small>{ub.text}</small>
          </span>
        </button>
        <div className="studio">
          <strong>{t('sidebar.studio')}</strong>
          <small>{t('sidebar.tagline')}</small>
        </div>
      </div>
    </aside>
  );
}

export function StatusBar() {
  const sel = useStore((s) => s.selected());
  const ops = useStore((s) => s.ops);
  const go = useStore((s) => s.go);
  const { t } = useI18n();
  const op = activeOp(ops);
  const failed = Object.values(ops).find((o) => o.status === 'error');
  return (
    <footer className="statusbar">
      <button className="statusbar__ver" onClick={() => go('instances')}>
        <span className="statusbar__chip"><Icon name="cube" size={16} /></span>
        {sel ? `Minecraft ${sel.mcVersion}` : t('status.noInstance')} <Icon name="down" size={14} />
      </button>
      <span className="statusbar__state">
        {!sel ? t('status.createToPlay') : sel.running ? t('status.running') : stateText(sel.state, t)}
      </span>
      <div className="statusbar__ops">
        {op ? (
          <>
            <span className="statusbar__op" title={op.label}>{op.label}</span>
            <ProgressBar fraction={op.fraction} />
            {op.fraction !== null && <span className="statusbar__pct">{Math.round(op.fraction * 100)}%</span>}
          </>
        ) : failed ? (
          <span className="statusbar__op is-error" title={failed.message ?? ''}>{failed.label}</span>
        ) : null}
      </div>
      <button className="statusbar__net" onClick={() => go('console', { consoleTab: 'network' })} title={t('console.network')}>
        <Icon name="shield" size={16} /> {t('console.hosts')}
      </button>
    </footer>
  );
}

export function Toasts() {
  const toasts = useStore((s) => s.toasts);
  const dismiss = useStore((s) => s.dismissToast);
  return (
    <div className="toasts" aria-live="polite">
      {toasts.map((toast) => (
        <div key={toast.id} className={`toast toast--${toast.kind}`} onClick={() => dismiss(toast.id)}>
          <Icon name={toast.kind === 'ok' ? 'check' : toast.kind === 'error' ? 'alert' : 'globe'} size={18} />
          <span>{toast.text}</span>
        </div>
      ))}
    </div>
  );
}
