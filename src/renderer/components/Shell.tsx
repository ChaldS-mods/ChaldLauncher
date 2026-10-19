import { call } from '../api';
import { activeOp, useStore, type Page } from '../store';
import { STATE_TEXT } from '../util';
import { Icon } from './Icon';
import { LogoMark } from './Logo';
import { ProgressBar } from './ui';

export function TitleBar() {
  const auth = useStore((s) => s.auth);
  const go = useStore((s) => s.go);
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
        <button className="profile" onClick={() => go('settings')} title={auth?.mode === 'offline' ? 'Офлайн-аккаунт: настройки аккаунта' : 'Аккаунт Microsoft: настройки аккаунта'}>
          <span className="profile__avatar"><Icon name="user" size={18} /></span>
          <span className="profile__name">{auth?.loggedIn ? auth.name : auth?.mode === 'offline' ? 'Укажи ник' : 'Войти'}</span>
          {auth?.mode === 'offline' && <span className="badge badge--warn">Офлайн</span>}
          <Icon name="down" size={14} />
        </button>
        <button className="icon-btn" onClick={() => go('settings')} aria-label="Настройки"><Icon name="gear" /></button>
        <span className="titlebar__sep" />
        <button className="icon-btn win-btn" onClick={() => win('minimize')} aria-label="Свернуть"><Icon name="min" /></button>
        <button className="icon-btn win-btn" onClick={() => win('maximize')} aria-label="Развернуть"><Icon name="max" size={15} /></button>
        <button className="icon-btn win-btn win-btn--close" onClick={() => win('close')} aria-label="Закрыть"><Icon name="x" /></button>
      </div>
    </header>
  );
}

const NAV: { page: Page; label: string; icon: string }[] = [
  { page: 'home', label: 'Главная', icon: 'home' },
  { page: 'instances', label: 'Инстансы', icon: 'cube' },
  { page: 'versions', label: 'Версии', icon: 'layers' },
  { page: 'mods', label: 'Моды', icon: 'puzzle' },
  { page: 'resourcepacks', label: 'Ресурспаки', icon: 'image' },
  { page: 'modrinth', label: 'Modrinth', icon: 'download' },
  { page: 'console', label: 'Консоль', icon: 'terminal' },
  { page: 'settings', label: 'Настройки', icon: 'gear' },
];

export function Sidebar() {
  const page = useStore((s) => s.page);
  const go = useStore((s) => s.go);
  const info = useStore((s) => s.info);
  const update = useStore((s) => s.update);
  const checkUpdate = useStore((s) => s.checkUpdate);
  return (
    <aside className="sidebar">
      <nav>
        {NAV.map((n) => (
          <button key={n.page} className={`nav${page === n.page ? ' is-active' : ''}`} onClick={() => go(n.page)}>
            <Icon name={n.icon} size={20} /> {n.label}
          </button>
        ))}
      </nav>
      <div className="sidebar__bottom">
        <button className="update" onClick={() => void checkUpdate()}>
          <Icon name="refresh" size={20} />
          <span>
            <strong>ChaldLauncher v{info?.version ?? '…'}</strong>
            <small>
              {!update ? 'Проверить обновления' : !update.configured ? 'Источник обновлений не задан' : update.hasUpdate ? `Доступна v${update.latest}` : 'Установлена последняя версия'}
            </small>
          </span>
        </button>
        <div className="studio"><strong>Chald Studio</strong><small>Создаём лучше</small></div>
      </div>
    </aside>
  );
}

export function StatusBar() {
  const sel = useStore((s) => s.selected());
  const ops = useStore((s) => s.ops);
  const go = useStore((s) => s.go);
  const op = activeOp(ops);
  const failed = Object.values(ops).find((o) => o.status === 'error');
  return (
    <footer className="statusbar">
      <button className="statusbar__ver" onClick={() => go('instances')}>
        <span className="statusbar__chip"><Icon name="cube" size={16} /></span>
        {sel ? `Minecraft ${sel.mcVersion}` : 'Инстанс не выбран'} <Icon name="down" size={14} />
      </button>
      <span className="statusbar__state">
        {!sel ? 'Создай инстанс, чтобы играть' : sel.running ? 'Игра запущена' : STATE_TEXT[sel.state]}
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
      <button className="statusbar__net" onClick={() => go('console', { consoleTab: 'network' })} title="Открыть журнал сетевых запросов">
        <Icon name="shield" size={16} /> Только официальные серверы
      </button>
    </footer>
  );
}

export function Toasts() {
  const toasts = useStore((s) => s.toasts);
  const dismiss = useStore((s) => s.dismissToast);
  return (
    <div className="toasts" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} className={`toast toast--${t.kind}`} onClick={() => dismiss(t.id)}>
          <Icon name={t.kind === 'ok' ? 'check' : t.kind === 'error' ? 'alert' : 'globe'} size={18} />
          <span>{t.text}</span>
        </div>
      ))}
    </div>
  );
}
