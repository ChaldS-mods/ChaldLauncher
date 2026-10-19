import { useCallback, useEffect, useRef, useState } from 'react';
import type { NetEntry } from '../../shared/types';
import { call, errMsg } from '../api';
import { Icon } from '../components/Icon';
import { Empty } from '../components/ui';
import { useStore } from '../store';

function GameLogs() {
  const instances = useStore((s) => s.instances);
  const selectedId = useStore((s) => s.selectedId);
  const select = useStore((s) => s.select);
  const live = useStore((s) => s.logs);
  const [initial, setInitial] = useState<Record<string, string[]>>({});
  const box = useRef<HTMLDivElement>(null);
  const [stick, setStick] = useState(true);
  const id = selectedId && instances.some((i) => i.id === selectedId) ? selectedId : null;

  // lines produced before this page was opened come from the main process buffer
  useEffect(() => {
    if (!id || initial[id]) return;
    void call('game:logs', { id }).then((l) => setInitial((p) => ({ ...p, [id]: l }))).catch(() => setInitial((p) => ({ ...p, [id]: [] })));
  }, [id, initial]);

  const liveLines = id ? live[id] ?? [] : [];
  const bufferLines = id ? initial[id] ?? [] : [];
  const lines = liveLines.length >= bufferLines.length ? liveLines : bufferLines;
  useEffect(() => { if (stick && box.current) box.current.scrollTop = box.current.scrollHeight; }, [lines.length, stick]);

  if (!instances.length) return <Empty icon="terminal" title="Нет инстансов" text="Логи игры появятся после первого запуска." />;
  return (
    <div className="stack">
      <div className="row">
        <select className="input input--auto" aria-label="Инстанс" value={id ?? ''} onChange={(e) => select(e.target.value)}>
          {instances.map((i) => <option key={i.id} value={i.id}>{i.name}{i.running ? ' (запущен)' : ''}</option>)}
        </select>
        <label className="row"><input type="checkbox" checked={stick} onChange={(e) => setStick(e.target.checked)} /> Следовать за выводом</label>
        <span className="muted">{lines.length} строк</span>
      </div>
      {lines.length === 0
        ? <Empty icon="terminal" title="Лог пуст" text="Вывод игры появится здесь после запуска инстанса. Токены в журнале скрыты." />
        : <div className="log" ref={box} role="log" tabIndex={0} aria-label="Лог игры">{lines.map((l, i) => <div key={i} className={/ERROR|Exception|FATAL/.test(l) ? 'log__err' : /WARN/.test(l) ? 'log__warn' : ''}>{l}</div>)}</div>}
    </div>
  );
}

function NetworkLog() {
  const [entries, setEntries] = useState<NetEntry[]>([]);
  const [hosts, setHosts] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async () => {
    try { setEntries(await call('net:log')); setError(null); } catch (e) { setError(errMsg(e)); }
  }, []);
  useEffect(() => {
    void load();
    void call('net:allowedHosts').then(setHosts).catch(() => undefined);
    const t = setInterval(() => void load(), 3000);
    return () => clearInterval(t);
  }, [load]);

  return (
    <div className="stack">
      <div className="row row--between">
        <p className="muted">Лаунчер обращается только к хостам из списка ниже. Каждый запрос записывается сюда.</p>
        <div className="row">
          <button className="btn btn--sm" onClick={() => void load()}><Icon name="refresh" size={14} /> Обновить</button>
          <button className="btn btn--sm" onClick={() => void call('net:clear').then(load)} disabled={!entries.length}>Очистить</button>
        </div>
      </div>
      {error && <p className="form-error" role="alert">{error}</p>}
      {entries.length === 0 ? <Empty icon="shield" title="Запросов пока не было" text="Они появятся при загрузке версий, установке инстанса или входе в аккаунт." /> : (
        <div className="table-wrap">
          <table className="table">
            <thead><tr><th>Время</th><th>Метод</th><th>Хост и путь</th><th>Назначение</th><th>Статус</th></tr></thead>
            <tbody>
              {[...entries].reverse().map((e) => (
                <tr key={e.id} className={e.error || (e.status && e.status >= 400) ? 'is-bad' : ''}>
                  <td className="mono">{new Date(e.time).toLocaleTimeString('ru-RU')}</td>
                  <td>{e.method}</td>
                  <td className="mono" title={`${e.host}${e.path}`}>{e.host}<span className="faint">{e.path.length > 48 ? `${e.path.slice(0, 48)}…` : e.path}</span></td>
                  <td>{e.purpose}</td>
                  <td>{e.error ? e.error : e.status ?? '…'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <section className="pcard">
        <h3><Icon name="shield" size={16} /> Разрешённые хосты</h3>
        <ul className="hosts">{hosts.map((h) => <li key={h} className="mono">{h}</li>)}</ul>
      </section>
    </div>
  );
}

export function ConsolePage() {
  const tab = useStore((s) => s.consoleTab);
  const go = useStore((s) => s.go);
  return (
    <div className="page">
      <header className="page-head"><div className="page-head__title"><Icon name="terminal" size={40} /><div><h1>Консоль</h1><p>Логи игры и сетевые запросы лаунчера</p></div></div></header>
      <div className="tabs" role="tablist">
        <button role="tab" aria-selected={tab === 'game'} className={`tab${tab === 'game' ? ' is-on' : ''}`} onClick={() => go('console', { consoleTab: 'game' })}>Логи игры</button>
        <button role="tab" aria-selected={tab === 'network'} className={`tab${tab === 'network' ? ' is-on' : ''}`} onClick={() => go('console', { consoleTab: 'network' })}>Сетевые запросы</button>
      </div>
      {tab === 'game' ? <GameLogs /> : <NetworkLog />}
    </div>
  );
}
