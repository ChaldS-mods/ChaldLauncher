import { useCallback, useEffect, useState } from 'react';
import { offlineNameSchema } from '../../shared/schemas';
import { call, errMsg } from '../api';
import { useI18n } from '../i18n';
import { useStore } from '../store';
import { Field } from './ui';

type Tab = 'register' | 'login';
/** null: no Chald session, object: signed in (chaldId unknown when the server is unreachable) */
type Session = { chaldId?: string } | null;

/**
 * Chald account for the offline mode: register or sign in with a login + password.
 * With no nickname yet, the login becomes the nickname (3–16 chars); an existing nickname is never changed,
 * because the offline UUID (worlds, skin) is derived from it.
 */
export function ChaldAccountForm() {
  const { t } = useI18n();
  const settings = useStore((s) => s.settings);
  const [tab, setTab] = useState<Tab>('register');
  const [session, setSession] = useState<Session | undefined>(undefined);
  const [login, setLogin] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    try {
      if (!(await call('friends:hasSession'))) return setSession(null);
      try {
        const me = await call('friends:me');
        setSession({ chaldId: me.chaldId });
      } catch {
        setSession({});
      }
    } catch {
      setSession(null);
    }
  }, []);
  useEffect(() => { void refresh(); }, [refresh]);

  const nickOk = offlineNameSchema.safeParse(settings?.offlineName ?? '').success;
  useEffect(() => {
    if (nickOk && settings?.offlineName) setLogin((v) => v || settings.offlineName);
  }, [nickOk, settings?.offlineName]);

  const submit = async () => {
    const { setOffline, saveSettings, toast } = useStore.getState();
    // with a nickname set, the login IS the nickname; without one, the typed login becomes the nickname
    const l = tab === 'register' && nickOk ? (settings?.offlineName ?? '') : login.trim().replace(/^@/, '');
    setError(null);
    if (!/^[A-Za-z0-9_]{3,20}$/.test(l)) return setError(t('chald.loginHint'));
    if (password.length < 6) return setError(t('chald.passHint'));

    setBusy(true);
    let nickChanged = false;
    try {
      if (tab === 'register') {
        if (!nickOk) {
          const p = offlineNameSchema.safeParse(l);
          if (!p.success) throw new Error(t('chald.loginAsNick'));
          await setOffline(p.data);
          nickChanged = true;
        }
        const r = await call('friends:register', { password });
        toast('ok', r.created ? t('chald.created', { id: r.user.chaldId }) : t('chald.linked', { id: r.user.chaldId }));
      } else {
        const r = await call('friends:login', { login: l, password });
        if (!nickOk && offlineNameSchema.safeParse(r.user.mcName).success) await setOffline(r.user.mcName);
        toast('ok', t('chald.signedIn', { id: r.user.chaldId }));
      }
      setPassword('');
      await refresh();
    } catch (e) {
      if (nickChanged) await saveSettings({ offlineName: '' }).catch(() => undefined); // do not keep a nickname from a failed registration
      setError(errMsg(e));
    } finally {
      setBusy(false);
    }
  };

  const logout = async () => {
    try {
      await call('friends:logout');
      setSession(null);
    } catch (e) {
      useStore.getState().toast('error', errMsg(e));
    }
  };

  if (session === undefined) return null;

  if (session) {
    return (
      <div className="row row--between row--wrap">
        <div>
          <strong>{t('chald.title')}</strong>
          <p className="muted">{session.chaldId ? t('chald.connectedAs', { id: session.chaldId }) : t('chald.connected')}</p>
        </div>
        <button type="button" className="btn" onClick={() => void logout()}>{t('chald.logout')}</button>
      </div>
    );
  }

  return (
    <div className="stack">
      <div>
        <strong>{t('chald.title')}</strong>
        <p className="muted">{t('chald.desc')}</p>
      </div>
      <div className="segmented" role="tablist" aria-label={t('chald.title')}>
        {(['register', 'login'] as const).map((k) => (
          <button key={k} type="button" role="tab" aria-selected={tab === k} className={tab === k ? 'is-on' : ''} onClick={() => { setTab(k); setError(null); }}>
            {k === 'register' ? t('chald.register') : t('chald.login')}
          </button>
        ))}
      </div>
      {tab === 'register' && nickOk ? (
        <Field label={t('chald.nickIsId')} hint={t('chald.loginIsId')}>
          <input className="input mono" value={settings?.offlineName ?? ''} readOnly aria-readonly="true" />
        </Field>
      ) : (
        <Field label={t('chald.loginLabel')} hint={tab === 'register' ? `${t('chald.loginIsId')} ${t('chald.loginAsNick')}` : t('chald.loginIsId')}>
          <input className="input mono" value={login} maxLength={20} autoComplete="username" spellCheck={false} placeholder="my_login" onChange={(e) => setLogin(e.target.value)} />
        </Field>
      )}
      <Field label={t('chald.password')} hint={t('chald.passHint')}>
        <input
          className="input"
          type="password"
          value={password}
          maxLength={72}
          autoComplete={tab === 'login' ? 'current-password' : 'new-password'}
          onChange={(e) => setPassword(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && void submit()}
        />
      </Field>
      {error && <p className="form-error" role="alert">{error}</p>}
      <div>
        <button type="button" className="btn btn--primary" disabled={busy || (!(tab === 'register' && nickOk) && !login.trim()) || password.length < 6} onClick={() => void submit()}>
          {busy ? '…' : tab === 'register' ? t('chald.submitRegister') : t('chald.submitLogin')}
        </button>
      </div>
    </div>
  );
}
