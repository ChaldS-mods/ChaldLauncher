import { useCallback, useEffect, useState } from 'react';
import type { ContentEntry } from '../../shared/types';
import { call, errMsg } from '../api';
import { Icon } from '../components/Icon';
import { ConfirmModal, Empty, Skeleton, Switch } from '../components/ui';
import { useI18n } from '../i18n';
import { useStore } from '../store';
import { formatSize } from '../util';

export function ContentPage({ kind }: { kind: 'mods' | 'resourcepacks' }) {
  const { t } = useI18n();
  const isMods = kind === 'mods';
  const title = isMods ? t('mods.title') : t('packs.title');
  const icon = isMods ? 'puzzle' : 'image';
  const none = isMods ? t('mods.empty') : t('packs.empty');
  const addLabel = isMods ? t('mods.add') : t('action.create');

  const instances = useStore((s) => s.instances);
  const selectedId = useStore((s) => s.selectedId);
  const select = useStore((s) => s.select);
  const toast = useStore((s) => s.toast);
  const refreshInstances = useStore((s) => s.refreshInstances);
  const inst = instances.find((i) => i.id === selectedId) ?? null;
  const [items, setItems] = useState<ContentEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<ContentEntry | null>(null);
  const [busy, setBusy] = useState(false);
  const locked = !!inst && (inst.running || inst.state === 'installing');
  const id = inst?.id ?? null;

  const load = useCallback(async () => {
    if (!id) {
      setItems([]);
      return;
    }
    try {
      setItems(await call('content:list', { id, kind }));
      setError(null);
    } catch (e) {
      setError(errMsg(e));
      setItems([]);
    }
  }, [id, kind]);
  useEffect(() => {
    setItems(null);
    void load();
  }, [load]);

  const run = async (fn: () => Promise<unknown>, ok?: string) => {
    setBusy(true);
    try {
      await fn();
      if (ok) toast('ok', ok);
      await load();
      void refreshInstances();
    } catch (e) {
      toast('error', errMsg(e));
    } finally {
      setBusy(false);
    }
  };

  if (!inst) {
    return (
      <div className="page">
        <Empty
          icon={icon}
          title={t('instances.notSelected')}
          text={t('content.selectFirst')}
          action={
            <button className="btn" onClick={() => useStore.getState().go('instances')}>
              {t('home.goInstances')}
            </button>
          }
        />
      </div>
    );
  }
  const modsUnsupported = isMods && inst.loader.type === 'vanilla';

  return (
    <div className="page">
      <header className="page-head">
        <div className="page-head__title">
          <Icon name={icon} size={40} />
          <div>
            <h1>{title}</h1>
            <p>{inst.name}</p>
          </div>
        </div>
        <select className="input input--auto" aria-label={t('instances.title')} value={inst.id} onChange={(e) => select(e.target.value)}>
          {instances.map((i) => (
            <option key={i.id} value={i.id}>
              {i.name}
            </option>
          ))}
        </select>
        <button
          className="btn"
          onClick={() => useStore.getState().go('modrinth', { modrinthType: isMods ? 'mod' : 'resourcepack' })}
        >
          <Icon name="download" size={18} /> Modrinth
        </button>
        <button
          className="btn btn--primary"
          disabled={busy || locked}
          onClick={() =>
            void run(async () => {
              const n = await call('content:import', { id: inst.id, kind });
              if (n > 0) toast('ok', String(n));
            })
          }
        >
          <Icon name="plus" size={18} /> {addLabel}
        </button>
      </header>

      {locked && (
        <p className="notice">
          <Icon name="alert" size={16} /> {inst.running ? t('status.running') : t('state.installing')}
        </p>
      )}
      {modsUnsupported && (
        <p className="notice">
          <Icon name="alert" size={16} /> Vanilla
        </p>
      )}
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}

      {items === null ? (
        <Skeleton rows={4} />
      ) : items.length === 0 ? (
        <Empty icon={icon} title={none} text={t('instances.noModsHint')} />
      ) : (
        <ul className="clist">
          <li className="clist__count muted">
            {items.length} • {items.filter((x) => x.enabled).length}
          </li>
          {items.map((it) => (
            <li key={it.file} className={`crow${it.enabled ? '' : ' is-off'}`}>
              {it.iconDataUrl ? (
                <img className="crow__icon" src={it.iconDataUrl} alt="" />
              ) : (
                <span className="crow__icon crow__icon--ph">
                  <Icon name={icon} size={22} />
                </span>
              )}
              <div className="grow">
                <strong>{it.name}</strong>
                <p className="muted">{[it.version, formatSize(it.size), it.isDir ? 'dir' : null].filter(Boolean).join(' • ')}</p>
                {it.warning && (
                  <p className="crow__warn">
                    <Icon name="alert" size={14} /> {it.warning}
                  </p>
                )}
              </div>
              <Switch
                checked={it.enabled}
                disabled={busy || locked}
                label={it.name}
                onChange={(v) =>
                  void run(async () => {
                    await call('content:toggle', { id: inst.id, kind, file: it.file, enabled: v });
                  })
                }
              />
              <button
                className="icon-btn"
                disabled={busy || locked}
                aria-label={t('action.delete')}
                onClick={() => setConfirm(it)}
              >
                <Icon name="trash" />
              </button>
            </li>
          ))}
        </ul>
      )}

      {confirm && (
        <ConfirmModal
          title={t('action.delete')}
          confirmLabel={t('action.delete')}
          danger
          busy={busy}
          onConfirm={() =>
            void run(async () => {
              await call('content:remove', { id: inst.id, kind, file: confirm.file });
              setConfirm(null);
            })
          }
          onClose={() => setConfirm(null)}
        >
          <p>
            <strong>{confirm.name}</strong>
          </p>
        </ConfirmModal>
      )}
    </div>
  );
}
