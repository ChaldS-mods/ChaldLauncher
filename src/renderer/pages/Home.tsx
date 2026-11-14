import { Icon } from '../components/Icon';
import { sanitizeHtml } from '../sanitize';
import { Cover, Empty } from '../components/ui';
import { useI18n } from '../i18n';
import { activeOp, useStore } from '../store';
import { formatDate, kindLabel, loaderText, stateText } from '../util';

export function HomePage() {
  const instances = useStore((s) => s.instances);
  const selected = useStore((s) => s.selected());
  const auth = useStore((s) => s.auth);
  const update = useStore((s) => s.update);
  const ops = useStore((s) => s.ops);
  const { openWizard, go, select, play, stop } = useStore.getState();
  const { t } = useI18n();
  const customHtml = useStore((s) => s.settings?.customHtml) ?? '';
  const recent = [...instances].filter((i) => i.lastPlayedAt).sort((a, b) => (b.lastPlayedAt ?? '').localeCompare(a.lastPlayedAt ?? '')).slice(0, 4);
  const op = selected ? activeOp(ops, selected.id) : null;

  return (
    <div className="page">
      <header className="page-head">
        <div className="page-head__title">
          <Icon name="home" size={40} />
          <div>
            <h1>{t('nav.home')}</h1>
            <p>ChaldLauncher</p>
          </div>
        </div>
      </header>

      {customHtml.trim() && <div className="custom-html" dangerouslySetInnerHTML={{ __html: sanitizeHtml(customHtml) }} />}

      {instances.length === 0 || !selected ? (
        <Empty
          icon="cube"
          title={t('home.welcome')}
          text={t('home.noInstancesHint')}
          action={
            <button className="btn btn--primary" onClick={() => openWizard()}>
              <Icon name="plus" size={18} /> {t('home.create')}
            </button>
          }
        />
      ) : (
        <section className="hero">
          <Cover inst={selected} className="cover--home" />
          <div className="hero__body">
            <span className="badge">{kindLabel(selected.kind, t)}</span>
            <h2>{selected.name}</h2>
            <p className="muted">
              Minecraft {selected.mcVersion} • {loaderText(selected)} •{' '}
              {selected.running ? t('status.running') : stateText(selected.state, t)}
            </p>
            {op && (
              <p className="muted">
                {op.label}
                {op.fraction != null ? ` — ${Math.round(op.fraction * 100)}%` : ''}
              </p>
            )}
            <div className="row">
              {selected.running ? (
                <button className="btn btn--danger" onClick={() => void stop(selected.id)}>
                  <Icon name="stop" size={16} /> {t('action.stop')}
                </button>
              ) : (
                <button
                  className="btn btn--primary"
                  disabled={selected.state === 'installing'}
                  onClick={() => (selected.state === 'ready' ? void play(selected.id) : go('instances'))}
                >
                  <Icon name={selected.state === 'ready' ? 'play' : 'cube'} size={16} />{' '}
                  {selected.state === 'ready' ? t('action.play') : t('instances.select')}
                </button>
              )}
              <button className="btn" onClick={() => go('instances')}>
                {t('home.allInstances')}
              </button>
            </div>
          </div>
        </section>
      )}

      <div className="cards-3">
        <section className="pcard">
          <h3>
            <Icon name="user" size={16} /> {t('auth.account')}
          </h3>
          <p>
            {auth?.loggedIn ? (
              <strong>{auth.name}</strong>
            ) : (
              <span className="muted">{auth?.mode === 'offline' ? t('auth.enterName') : t('auth.signIn')}</span>
            )}{' '}
            {auth?.mode === 'offline' && <span className="badge badge--warn">{t('auth.offline')}</span>}
          </p>
          <button className="btn btn--sm" onClick={() => go('settings')}>
            {t('settings.account')}
          </button>
        </section>
        <section className="pcard">
          <h3>
            <Icon name="refresh" size={16} /> {t('settings.updates')}
          </h3>
          <p className="muted">
            {!update
              ? t('update.check')
              : !update.configured
                ? t('update.check')
                : update.hasUpdate
                  ? `${t('update.available')} ${update.latest}`
                  : t('update.upToDate')}
          </p>
          {update?.hasUpdate && update.url && <p className="faint mono">{update.url}</p>}
        </section>
        <section className="pcard">
          <h3>
            <Icon name="shield" size={16} /> {t('console.network')}
          </h3>
          <p className="muted">{t('console.networkHint')}</p>
          <button className="btn btn--sm" onClick={() => go('console', { consoleTab: 'network' })}>
            {t('console.title')}
          </button>
        </section>
      </div>

      {recent.length > 0 && (
        <section className="stack">
          <h3 className="section-title">{t('home.recent')}</h3>
          <div className="recent">
            {recent.map((i) => (
              <button
                key={i.id}
                className="recent__item"
                onClick={() => {
                  select(i.id);
                  go('instances');
                }}
              >
                <Cover inst={i} className="cover--mini" />
                <span>
                  <strong>{i.name}</strong>
                  <small>{formatDate(i.lastPlayedAt)}</small>
                </span>
              </button>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
