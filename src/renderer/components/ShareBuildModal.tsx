import { useState } from 'react';
import type { InstanceView } from '../../shared/types';
import { call, errMsg } from '../api';
import { useI18n } from '../i18n';
import { useStore } from '../store';
import { loaderText } from '../util';
import { Icon } from './Icon';
import { Cover, Modal } from './ui';

export interface SharedBuild {
  name: string;
  mcVersion: string;
  /** human-readable, for the card */
  loader: string;
  /** machine-readable, so the receiver can create the same instance */
  loaderType: string;
  loaderVersion: string | null;
  modCount: number;
  mods: string[];
}

/** «Какой сборкой поделиться»: список инстансов с выбором и необязательным списком модов. */
export function ShareBuildModal({ peerName, onShare, onClose }: {
  peerName: string;
  onShare: (build: SharedBuild) => Promise<void>;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const instances = useStore((s) => s.instances);
  const selectedId = useStore((s) => s.selectedId);
  const [pick, setPick] = useState<string>(() => (instances.some((i) => i.id === selectedId) ? selectedId! : instances[0]?.id ?? ''));
  const [withMods, setWithMods] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const inst: InstanceView | undefined = instances.find((i) => i.id === pick);

  const send = async () => {
    if (!inst) return;
    setBusy(true);
    setError(null);
    try {
      let mods: string[] = [];
      if (withMods && inst.loader.type !== 'vanilla') {
        const list = await call('content:list', { id: inst.id, kind: 'mods' }).catch(() => []);
        mods = list.filter((m) => m.enabled && !m.isDir).map((m) => (m.name || m.file).slice(0, 48)).slice(0, 60);
      }
      await onShare({
        name: inst.name,
        mcVersion: inst.mcVersion,
        loader: loaderText(inst),
        loaderType: inst.loader.type,
        loaderVersion: inst.loader.version,
        modCount: inst.modCount,
        mods,
      });
      onClose();
    } catch (e) {
      setError(errMsg(e));
      setBusy(false);
    }
  };

  return (
    <Modal
      title={t('share.title')}
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>{t('action.cancel')}</button>
          <button type="button" className="btn btn--primary" disabled={!inst || busy} onClick={() => void send()}>
            <Icon name="send" size={16} /> {busy ? '…' : t('share.send')}
          </button>
        </>
      }
    >
      <p className="muted" style={{ marginBottom: 12 }}>{t('share.hint', { name: peerName })}</p>
      {instances.length === 0 ? (
        <p className="notice"><Icon name="alert" size={16} /> {t('share.empty')}</p>
      ) : (
        <ul className="clist share-list" role="radiogroup" aria-label={t('share.title')}>
          {instances.map((i) => (
            <li key={i.id}>
              <button
                type="button"
                role="radio"
                aria-checked={pick === i.id}
                className={`share-item${pick === i.id ? ' is-picked' : ''}`}
                onClick={() => setPick(i.id)}
                onDoubleClick={() => { setPick(i.id); }}
              >
                <Cover inst={i} className="cover--mini" />
                <span className="share-item__body">
                  <strong>{i.name}</strong>
                  <span className="muted">
                    {i.mcVersion} · {loaderText(i)}{i.loader.type !== 'vanilla' ? ` · ${t('share.mods', { n: i.modCount })}` : ''}
                  </span>
                </span>
                <span className="share-item__check">{pick === i.id && <Icon name="check" size={18} />}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {inst && inst.loader.type !== 'vanilla' && (
        <label className="share-opt">
          <input type="checkbox" checked={withMods} onChange={(e) => setWithMods(e.target.checked)} />
          <span>{t('share.withMods')}</span>
        </label>
      )}
      {error && <p className="form-error" role="alert">{error}</p>}
    </Modal>
  );
}
