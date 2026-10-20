import { useEffect, useState } from 'react';
import { offlineNameSchema } from '../../shared/schemas';
import type { AccountMode } from '../../shared/types';
import { call, errMsg } from '../api';
import { useStore } from '../store';
import { Icon } from './Icon';
import { Field, Modal } from './ui';

export const OFFLINE_WARNING = 'Нельзя зайти на серверы с online-mode, нет скина.';

function NotConfiguredModal({ onClose, onOffline }: { onClose: () => void; onOffline: () => void }) {
  return (
    <Modal
      title="Вход через Microsoft не настроен"
      onClose={onClose}
      footer={<><button className="btn" onClick={onClose}>Закрыть</button><button className="btn btn--primary" onClick={onOffline}>Использовать офлайн-режим</button></>}
    >
      <div className="stack">
        <p>Вход через Microsoft в этой сборке ещё не настроен. Это проблема сборки, а не твоего аккаунта.</p>
        <p>Пока вход недоступен, можно играть в офлайн-режиме. {OFFLINE_WARNING}</p>
      </div>
    </Modal>
  );
}

export function AccountSection() {
  const auth = useStore((s) => s.auth);
  const settings = useStore((s) => s.settings);
  const { setAccountMode, setOffline, login, toast } = useStore.getState();
  const [nick, setNick] = useState(settings?.offlineName ?? '');
  const [nickErr, setNickErr] = useState<string | null>(null);
  const [explain, setExplain] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => { if (settings) { setNick(settings.offlineName); } }, [settings?.offlineName]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!auth || !settings) return null;
  const mode = auth.mode;

  const switchMode = (m: AccountMode) => {
    if (m !== mode) void setAccountMode(m).catch((e) => toast('error', errMsg(e)));
  };
  const applyNick = async () => {
    const p = offlineNameSchema.safeParse(nick);
    if (!p.success) return setNickErr(p.error.issues[0]?.message ?? 'Некорректный ник');
    setNickErr(null);
    try { await setOffline(p.data); toast('ok', `Офлайн-профиль: ${p.data}`); } catch (e) { setNickErr(errMsg(e)); }
  };
  const msLogin = async (method: 'browser' | 'code') => {
    if (!auth.configured) return setExplain(true);
    setBusy(true);
    try { await login(method); } finally { setBusy(false); }
  };

  return (
    <div className="stack">
      <div className="row row--wrap">
        <div className="segmented" role="radiogroup" aria-label="Режим аккаунта">
          {(['microsoft', 'offline'] as const).map((m) => (
            <button key={m} type="button" role="radio" aria-checked={mode === m} className={mode === m ? 'is-on' : ''} onClick={() => switchMode(m)}>
              {m === 'microsoft' ? 'Microsoft' : 'Офлайн'}
            </button>
          ))}
        </div>
        {mode === 'offline' && <p className="inline-warn" role="note"><Icon name="alert" size={16} /> {OFFLINE_WARNING}</p>}
      </div>

      {mode === 'microsoft' ? (
        <>
          <div className="row row--between row--wrap">
            <div>
              <strong>{auth.loggedIn ? auth.name : 'Вход не выполнен'}</strong>
              <p className="muted">{auth.loggedIn ? 'Аккаунт Microsoft подключён' : 'Нужен купленный Minecraft Java Edition'}</p>
            </div>
            {auth.loggedIn
              ? <button className="btn" onClick={() => void call('auth:logout').catch((e) => toast('error', errMsg(e)))}>Выйти</button>
              : (
                <div className="row row--wrap">
                  <button className="btn btn--primary" disabled={busy} onClick={() => void msLogin('browser')}>Войти через Microsoft</button>
                  <button className="btn" disabled={busy} onClick={() => void msLogin('code')} title="Если браузерный вход не открывается: код вводится на microsoft.com/link">Войти по коду</button>
                </div>
              )}
          </div>
          {!auth.encryptionAvailable && <p className="form-error" role="note"><Icon name="alert" size={16} /> Шифрование системного хранилища недоступно: сессия не будет сохраняться между запусками.</p>}
        </>
      ) : (
        <>
          <Field label="Ник" error={nickErr} hint="3–16 символов: A-Z, a-z, 0-9 и «_»">
            <div className="row">
              <input className="input" value={nick} maxLength={16} onChange={(e) => setNick(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && void applyNick()} placeholder="Steve" spellCheck={false} aria-invalid={!!nickErr} />
              <button type="button" className="btn btn--primary" onClick={() => void applyNick()} disabled={nick === settings.offlineName && auth.loggedIn}>Применить</button>
            </div>
          </Field>
          {auth.loggedIn && auth.uuid && <p className="muted">UUID офлайн-профиля: <span className="mono">{auth.uuid}</span> <span className="badge badge--warn">Офлайн</span></p>}
          <p className="faint">Офлайн-профиль не связан с Microsoft: токены не используются, UUID вычисляется из ника так же, как на ванильном сервере.</p>
        </>
      )}

      {explain && <NotConfiguredModal onClose={() => setExplain(false)} onOffline={() => { setExplain(false); switchMode('offline'); }} />}
    </div>
  );
}
