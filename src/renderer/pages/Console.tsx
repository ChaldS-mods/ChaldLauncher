import { useCallback, useEffect, useRef, useState } from 'react';
import type { NetEntry } from '../../shared/types';
import { call, errMsg } from '../api';
import { Icon } from '../components/Icon';
import { Empty } from '../components/ui';
import { useI18n, localeTag } from '../i18n';
import { useStore } from '../store';

function GameLogs() {
  const instances = useStore((s) => s.instances);
  const selectedId = useStore((s) => s.selectedId);
  const select = useStore((s) => s.select);
  const live = useStore((s) => s.logs);
  const { t } = useI18n();
  const [initial, setInitial] = useState<Record<string, string[]>>({});
  const box = useRef<HTMLDivElement>(null);
  const [stick, setStick] = useState(true);
  const id = selectedId && instances.some((i) => i.id === selectedId) ? selectedId : null;

  useEffect(() => {
    if (!id || initial[id]) return;
    void call('game:logs', { id })
      .then((l) => setInitial((p) => ({ ...p, [id]: l })))
      .catch(() => setInitial((p) => ({ ...p, [id]: [] })));
  }, [id, initial]);

  const liveLines = id ? live[id] ?? [] : [];
  const bufferLines = id ? initial[id] ?? [] : [];
  const lines = liveLines.length >= bufferLines.length ? liveLines : bufferLines;
  useEffect(() => {
    if (stick && box.current) box.current.scrollTop = box.current.scrollHeight;
  }, [lines.length, stick]);

  if (!instances.length) {
    return <Empty icon="terminal" title={t('instances.empty')} text={t('console.gameHint')} />;
  }
  return (
    <div className="stack">
      <div className="row">
        <select className="input input--auto" aria-label={t('instances.title')} value={id ?? ''} onChange={(e) => select(e.target.value)}>
          {instances.map((i) => (
            <option key={i.id} value={i.id}>
              {i.name}
              {i.running ? ` (${t('status.running')})` : ''}
            </option>
          ))}
        </select>
        <label className="row">
          <input type="checkbox" checked={stick} onChange={(e) => setStick(e.target.checked)} /> {t('console.follow')}
        </label>
        <span className="muted">{lines.length}</span>
      </div>
      {lines.length === 0 ? (
        <Empty icon="terminal" title={t('console.empty')} text={t('console.gameHint')} />
      ) : (
        <div className="log" ref={box} role="log" tabIndex={0} aria-label={t('console.game')}>
          {lines.map((l, i) => (
            <div key={i} className={/ERROR|Exception|FATAL/.test(l) ? 'log__err' : /WARN/.test(l) ? 'log__warn' : ''}>
              {l}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function NetworkLog() {
  const { t, language } = useI18n();
  const [entries, setEntries] = useState<NetEntry[]>([]);
  const [hosts, setHosts] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async () => {
    try {
      setEntries(await call('net:log'));
      setError(null);
    } catch (e) {
      setError(errMsg(e));
    }
  }, []);
  useEffect(() => {
    void load();
    void call('net:allowedHosts').then(setHosts).catch(() => undefined);
    const timer = setInterval(() => void load(), 3000);
    return () => clearInterval(timer);
  }, [load]);

  return (
    <div className="stack">
      <div className="row row--between">
        <p className="muted">{t('console.networkHint')}</p>
        <div className="row">
          <button className="btn btn--sm" onClick={() => void load()}>
            <Icon name="refresh" size={14} /> {t('action.refresh')}
          </button>
          <button className="btn btn--sm" onClick={() => void call('net:clear').then(load)} disabled={!entries.length}>
            {t('action.clear')}
          </button>
        </div>
      </div>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      {entries.length === 0 ? (
        <Empty icon="shield" title={t('console.noRequests')} text={t('console.noRequestsHint')} />
      ) : (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Time</th>
                <th>{t('console.method')}</th>
                <th>{t('console.host')}</th>
                <th>{t('console.status')}</th>
              </tr>
            </thead>
            <tbody>
              {[...entries].reverse().map((e) => (
                <tr key={e.id} className={e.error || (e.status && e.status >= 400) ? 'is-bad' : ''}>
                  <td className="mono">{new Date(e.time).toLocaleTimeString(localeTag(language))}</td>
                  <td>{e.method}</td>
                  <td className="mono" title={`${e.host}${e.path}`}>
                    {e.host}
                    <span className="faint">{e.path.length > 48 ? `${e.path.slice(0, 48)}…` : e.path}</span>
                  </td>
                  <td>{e.error ? e.error : e.status ?? '…'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <section className="pcard">
        <h3>
          <Icon name="shield" size={16} /> {t('console.hosts')}
        </h3>
        <ul className="hosts">
          {hosts.map((h) => (
            <li key={h} className="mono">
              {h}
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

export function ConsolePage() {
  const tab = useStore((s) => s.consoleTab);
  const go = useStore((s) => s.go);
  const { t } = useI18n();
  return (
    <div className="page">
      <header className="page-head">
        <div className="page-head__title">
          <Icon name="terminal" size={40} />
          <div>
            <h1>{t('console.title')}</h1>
            <p>{t('console.game')} / {t('console.network')}</p>
          </div>
        </div>
      </header>
      <div className="tabs" role="tablist">
        <button
          role="tab"
          aria-selected={tab === 'game'}
          className={`tab${tab === 'game' ? ' is-on' : ''}`}
          onClick={() => go('console', { consoleTab: 'game' })}
        >
          {t('console.game')}
        </button>
        <button
          role="tab"
          aria-selected={tab === 'network'}
          className={`tab${tab === 'network' ? ' is-on' : ''}`}
          onClick={() => go('console', { consoleTab: 'network' })}
        >
          {t('console.network')}
        </button>
      </div>
      {tab === 'game' ? <GameLogs /> : <NetworkLog />}
    </div>
  );
}
