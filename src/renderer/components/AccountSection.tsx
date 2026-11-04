import { useEffect, useState } from 'react';
import { offlineNameSchema } from '../../shared/schemas';
import type { AccountMode } from '../../shared/types';
import { call, errMsg } from '../api';
import { useI18n } from '../i18n';
import { useStore } from '../store';
import { Icon } from './Icon';
import { Field, Modal } from './ui';

function NotConfiguredModal({ onClose, onOffline }: { onClose: () => void; onOffline: () => void }) {
  const { t } = useI18n();
  return (
    <Modal
      title={t('auth.msNotConfigured')}
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>{t('action.close')}</button>
          <button className="btn btn--primary" onClick={onOffline}>{t('auth.useOffline')}</button>
        </>
      }
    >
      <div className="stack">
        <p>{t('auth.msNotConfigured')}</p>
        <p>{t('auth.offlineDesc')}</p>
      </div>
    </Modal>
  );
}

export function AccountSection() {
  const auth = useStore((s) => s.auth);
  const settings = useStore((s) => s.settings);
  const { setAccountMode, setOffline, login, toast } = useStore.getState();
  const { t } = useI18n();
  const [nick, setNick] = useState(settings?.offlineName ?? '');
  const [nickErr, setNickErr] = useState<string | null>(null);
  const [explain, setExplain] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (settings) setNick(settings.offlineName);
  }, [settings?.offlineName]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!auth || !settings) return null;
  const mode = auth.mode;

  const switchMode = (m: AccountMode) => {
    if (m !== mode) void setAccountMode(m).catch((e) => toast('error', errMsg(e)));
  };
  const applyNick = async () => {
    const p = offlineNameSchema.safeParse(nick);
    if (!p.success) return setNickErr(p.error.issues[0]?.message ?? t('auth.nickHint'));
    setNickErr(null);
    try {
      await setOffline(p.data);
      toast('ok', p.data);
    } catch (e) {
      setNickErr(errMsg(e));
    }
  };
  const msLogin = async (method: 'browser' | 'code') => {
    if (!auth.configured) return setExplain(true);
    setBusy(true);
    try {
      await login(method);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="stack">
      <div className="row row--wrap">
        <div className="segmented" role="radiogroup" aria-label={t('auth.account')}>
          {(['microsoft', 'offline'] as const).map((m) => (
            <button
              key={m}
              type="button"
              role="radio"
              aria-checked={mode === m}
              className={mode === m ? 'is-on' : ''}
              onClick={() => switchMode(m)}
            >
              {m === 'microsoft' ? 'Microsoft' : t('auth.offline')}
            </button>
          ))}
        </div>
        {mode === 'offline' && (
          <p className="inline-warn" role="note">
            <Icon name="alert" size={16} /> {t('auth.offlineDesc')}
          </p>
        )}
      </div>

      {mode === 'microsoft' ? (
        <>
          <div className="row row--between row--wrap">
            <div>
              <strong>{auth.loggedIn ? auth.name : t('auth.signIn')}</strong>
              <p className="muted">{auth.loggedIn ? 'Microsoft' : 'Minecraft Java Edition'}</p>
            </div>
            {auth.loggedIn ? (
              <button className="btn" onClick={() => void call('auth:logout').catch((e) => toast('error', errMsg(e)))}>
                {t('action.logout')}
              </button>
            ) : (
              <div className="row row--wrap">
                <button className="btn btn--primary" disabled={busy} onClick={() => void msLogin('browser')}>
                  {t('auth.loginMs')}
                </button>
                <button className="btn" disabled={busy} onClick={() => void msLogin('code')} title={t('auth.loginCodeHint')}>
                  {t('auth.loginCode')}
                </button>
              </div>
            )}
          </div>
        </>
      ) : (
        <>
          <Field label={t('auth.nick')} error={nickErr} hint={t('auth.nickHint')}>
            <div className="row">
              <input
                className="input"
                value={nick}
                maxLength={16}
                onChange={(e) => setNick(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && void applyNick()}
                placeholder="Steve"
                spellCheck={false}
                aria-invalid={!!nickErr}
              />
              <button
                type="button"
                className="btn btn--primary"
                onClick={() => void applyNick()}
                disabled={nick === settings.offlineName && auth.loggedIn}
              >
                {t('action.apply')}
              </button>
            </div>
          </Field>
          {auth.loggedIn && auth.uuid && (
            <p className="muted">
              UUID: <span className="mono">{auth.uuid}</span>{' '}
              <span className="badge badge--warn">{t('auth.offline')}</span>
            </p>
          )}
        </>
      )}

      {explain && (
        <NotConfiguredModal
          onClose={() => setExplain(false)}
          onOffline={() => {
            setExplain(false);
            switchMode('offline');
          }}
        />
      )}
    </div>
  );
}
