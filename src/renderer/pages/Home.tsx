import { Icon } from '../components/Icon';
import { Cover, Empty } from '../components/ui';
import { activeOp, useStore } from '../store';
import { KIND_LABEL, STATE_TEXT, formatDate, loaderText } from '../util';

export function HomePage() {
  const instances = useStore((s) => s.instances);
  const selected = useStore((s) => s.selected());
  const auth = useStore((s) => s.auth);
  const update = useStore((s) => s.update);
  const ops = useStore((s) => s.ops);
  const { openWizard, go, select, play, stop } = useStore.getState();
  const recent = [...instances].filter((i) => i.lastPlayedAt).sort((a, b) => (b.lastPlayedAt ?? '').localeCompare(a.lastPlayedAt ?? '')).slice(0, 4);
  const op = selected ? activeOp(ops, selected.id) : null;

  return (
    <div className="page">
      <header className="page-head">
        <div className="page-head__title"><Icon name="home" size={40} /><div><h1>Главная</h1><p>Больше, чем просто Minecraft</p></div></div>
      </header>

      {instances.length === 0 || !selected ? (
        <Empty icon="cube" title="Добро пожаловать в ChaldLauncher" text="Чтобы начать играть, создай первый инстанс: выбери версию Minecraft и загрузчик, остальное лаунчер скачает сам." action={<button className="btn btn--primary" onClick={() => openWizard()}><Icon name="plus" size={18} /> Создать инстанс</button>} />
      ) : (
        <section className="hero">
          <Cover inst={selected} className="cover--home" />
          <div className="hero__body">
            <span className="badge">{KIND_LABEL[selected.kind]}</span>
            <h2>{selected.name}</h2>
            <p className="muted">Minecraft {selected.mcVersion} • {loaderText(selected)} • {selected.running ? 'Игра запущена' : STATE_TEXT[selected.state]}</p>
            {op && <p className="muted">{op.label}{op.fraction != null ? ` — ${Math.round(op.fraction * 100)}%` : ''}</p>}
            <div className="row">
              {selected.running
                ? <button className="btn btn--danger" onClick={() => void stop(selected.id)}><Icon name="stop" size={16} /> Остановить</button>
                : <button className="btn btn--primary" disabled={selected.state === 'installing'} onClick={() => (selected.state === 'ready' ? void play(selected.id) : go('instances'))}>
                    <Icon name={selected.state === 'ready' ? 'play' : 'cube'} size={16} /> {selected.state === 'ready' ? 'Играть' : 'Открыть инстанс'}
                  </button>}
              <button className="btn" onClick={() => go('instances')}>Все инстансы</button>
            </div>
          </div>
        </section>
      )}

      <div className="cards-3">
        <section className="pcard">
          <h3><Icon name="user" size={16} /> Аккаунт</h3>
          <p>{auth?.loggedIn ? <strong>{auth.name}</strong> : <span className="muted">{auth?.mode === 'offline' ? 'Ник не задан' : 'Вход не выполнен'}</span>} {auth?.mode === 'offline' && <span className="badge badge--warn">Офлайн</span>}</p>
          <button className="btn btn--sm" onClick={() => go('settings')}>Настроить аккаунт</button>
        </section>
        <section className="pcard">
          <h3><Icon name="refresh" size={16} /> Обновления</h3>
          <p className="muted">{!update ? 'Ещё не проверялось' : !update.configured ? 'Источник обновлений не задан в настройках' : update.hasUpdate ? `Доступна версия ${update.latest}` : 'Установлена последняя версия'}</p>
          {update?.hasUpdate && update.url && <p className="faint mono">{update.url}</p>}
        </section>
        <section className="pcard">
          <h3><Icon name="shield" size={16} /> Сеть</h3>
          <p className="muted">Лаунчер обращается только к списку официальных серверов. Каждый запрос виден в журнале.</p>
          <button className="btn btn--sm" onClick={() => go('console', { consoleTab: 'network' })}>Открыть журнал</button>
        </section>
      </div>

      {recent.length > 0 && (
        <section className="stack">
          <h3 className="section-title">Недавно играли</h3>
          <div className="recent">
            {recent.map((i) => (
              <button key={i.id} className="recent__item" onClick={() => { select(i.id); go('instances'); }}>
                <Cover inst={i} className="cover--mini" />
                <span><strong>{i.name}</strong><small>{formatDate(i.lastPlayedAt)}</small></span>
              </button>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
