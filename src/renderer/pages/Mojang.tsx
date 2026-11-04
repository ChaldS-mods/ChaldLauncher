import { useCallback, useEffect, useState } from 'react';
import { parseBedrockServer, type MojangGameId, type MojangStatus } from '../../shared/mojang';
import { call, errMsg } from '../api';
import { Icon } from '../components/Icon';
import { Empty, Field } from '../components/ui';
import { useI18n } from '../i18n';
import { useStore } from '../store';

const GAMES: { id: MojangGameId; icon: string }[] = [
  { id: 'bedrock', icon: 'cube' },
  { id: 'dungeons', icon: 'layers' },
  { id: 'legends', icon: 'globe' },
];

export function MojangPage() {
  const { t } = useI18n();
  const [status, setStatus] = useState<MojangStatus | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [srv, setSrv] = useState({ name: '', host: '', port: '19132' });
  const [srvError, setSrvError] = useState<string | null>(null);
  const { toast } = useStore.getState();

  const refresh = useCallback(async () => {
    setLoading(true);
    try { setStatus(await call('mojang:status')); } catch (e) { toast('error', errMsg(e)); } finally { setLoading(false); }
  }, [toast]);
  useEffect(() => { void refresh(); }, [refresh]);

  const run = async (key: string, job: () => Promise<unknown>, okText?: string) => {
    setBusy(key);
    try { await job(); if (okText) toast('ok', okText); } catch (e) { toast('error', errMsg(e)); } finally { setBusy(null); }
  };
  const play = (game: MojangGameId) => run(`play:${game}`, () => call('mojang:launch', { game }), t('mojang.starting'));
  const store = (game: MojangGameId) => run(`store:${game}`, () => call('mojang:store', { game }));
  const addServer = () => {
    const server = parseBedrockServer({ name: srv.name, host: srv.host, port: Number(srv.port || '19132') });
    if (!server) return setSrvError(t('mojang.serverInvalid'));
    setSrvError(null);
    void run('server', () => call('mojang:launch', { game: 'bedrock', server }), t('mojang.starting'));
  };

  return (
    <div className="page">
      <header className="page-head">
        <div className="page-head__title"><Icon name="play" size={40} /><div><h1>{t('mojang.title')}</h1><p>{t('mojang.subtitle')}</p></div></div>
        <button type="button" className="btn btn--sm" disabled={loading} onClick={() => void refresh()}><Icon name="refresh" size={14} /> {loading ? t('mojang.checking') : t('mojang.refresh')}</button>
      </header>

      {status && !status.supported && <Empty icon="alert" title={t('mojang.winOnlyTitle')} text={t('mojang.winOnly')} />}

      {(!status || status.supported) && <>
        <p className="muted">{t('mojang.storeNote')}</p>
        <div className="mojang-grid">
          {GAMES.map((g) => {
            const st = status?.games.find((x) => x.id === g.id);
            const ready = st?.state === 'ready';
            return (
              <section key={g.id} className="pcard pcard--wide mojang-card">
                <h3><Icon name={g.icon} size={16} /> {t(`mojang.${g.id}`)}
                  {st && <span className={`badge${ready ? '' : ' badge--warn'}`}>{ready ? t('mojang.found') : t('mojang.notFound')}</span>}
                </h3>
                <p className="muted">{t(`mojang.${g.id}Desc`)}</p>
                <div className="row">
                  {ready
                    ? <button type="button" className="btn btn--primary" disabled={busy !== null} onClick={() => void play(g.id)}><Icon name="play" size={14} /> {g.id === 'bedrock' ? t('mojang.play') : t('mojang.openLauncher')}</button>
                    : <button type="button" className="btn" disabled={busy !== null || !st} onClick={() => void store(g.id)}><Icon name="download" size={14} /> {t('mojang.get')}</button>}
                </div>
                {g.id === 'bedrock' && ready && (
                  <div className="stack">
                    <h4>{t('mojang.server')}</h4>
                    <div className="form-grid">
                      <Field label={t('mojang.serverName')}><input className="input" value={srv.name} maxLength={32} onChange={(e) => setSrv({ ...srv, name: e.target.value })} placeholder="My server" /></Field>
                      <Field label={t('mojang.serverHost')}><input className="input mono" value={srv.host} maxLength={253} onChange={(e) => setSrv({ ...srv, host: e.target.value })} placeholder="play.example.com" spellCheck={false} /></Field>
                      <Field label={t('mojang.serverPort')}><input className="input mono" inputMode="numeric" value={srv.port} maxLength={5} onChange={(e) => setSrv({ ...srv, port: e.target.value })} /></Field>
                    </div>
                    {srvError ? <p className="form-error" role="alert">{srvError}</p> : <p className="faint">{t('mojang.serverHint')}</p>}
                    <div className="row"><button type="button" className="btn btn--sm" disabled={busy !== null} onClick={addServer}>{t('mojang.addServer')}</button></div>
                  </div>
                )}
              </section>
            );
          })}
        </div>
      </>}
    </div>
  );
}
