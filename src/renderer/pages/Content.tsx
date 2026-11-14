import { useCallback, useEffect, useRef, useState, type DragEvent } from 'react';
import type { ArchiveAnalysis, ContentAddResult } from '../../shared/archive';
import type { ContentEntry } from '../../shared/types';
import { call, errMsg } from '../api';
import { ArchiveDialog } from '../components/ArchiveDialog';
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
  const [pending, setPending] = useState<ArchiveAnalysis[]>([]);
  const [dragging, setDragging] = useState(false);
  const dragDepth = useRef(0);
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

  useEffect(() => setPending([]), [id]);

  const reportAdd = (r: ContentAddResult) => {
    if (r.imported > 0 || r.skipped > 0) {
      toast(r.imported > 0 ? 'ok' : 'info', r.skipped > 0 ? t('archive.addedSkipped', { n: r.imported, s: r.skipped }) : t('archive.added', { n: r.imported }));
    }
    for (const m of r.errors) toast('error', m);
  };

  /** Mods page: .jar files and .zip archives, from the dialog (`paths` = null) or dropped on the page. */
  const addMods = async (paths: string[] | null) => {
    if (!inst) return;
    setBusy(true);
    try {
      const r = await call('content:add', { id: inst.id, paths });
      reportAdd(r);
      if (r.pending.length) setPending((q) => [...q, ...r.pending]);
      await load();
      void refreshInstances();
    } catch (e) {
      toast('error', errMsg(e));
    } finally {
      setBusy(false);
    }
  };

  const hasFiles = (e: DragEvent) => isMods && e.dataTransfer.types.includes('Files');
  const onDragEnter = (e: DragEvent) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    dragDepth.current++;
    setDragging(true);
  };
  const onDragOver = (e: DragEvent) => {
    if (hasFiles(e)) e.preventDefault(); // without this the window would open the dropped file
  };
  const onDragLeave = (e: DragEvent) => {
    if (!hasFiles(e)) return;
    dragDepth.current = Math.max(0, dragDepth.current - 1);
    if (dragDepth.current === 0) setDragging(false);
  };
  const onDrop = (e: DragEvent) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    dragDepth.current = 0;
    setDragging(false);
    if (locked || busy || !inst) return;
    const paths = Array.from(e.dataTransfer.files)
      .map((f) => window.chald.pathForFile?.(f) ?? '')
      .filter(Boolean);
    if (!paths.length) {
      toast('error', t('archive.noPath'));
      return;
    }
    void addMods(paths);
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
    <div className="page" onDragEnter={onDragEnter} onDragOver={onDragOver} onDragLeave={onDragLeave} onDrop={onDrop}>
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
            isMods
              ? void addMods(null)
              : void run(async () => {
                  const n = await call('content:import', { id: inst.id, kind });
                  if (n > 0) toast('ok', String(n));
                })
          }
        >
          <Icon name="plus" size={18} /> {addLabel}
        </button>
      </header>

      {isMods && !locked && <p className="muted">{t('archive.hint')}</p>}
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
                    await call('content:toggle', { id: inst.id, kind, file: it.file });
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
              await call('content:remove', { id: inst.id, kind, file: confirm.file, confirm: true });
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
      {dragging && !locked && (
        <div className="drop-overlay" aria-hidden="true">
          <Icon name="download" size={48} />
          <strong>{t('archive.dropHint')}</strong>
        </div>
      )}
      {pending[0] && inst && (
        <ArchiveDialog
          key={pending[0].token}
          analysis={pending[0]}
          instanceId={inst.id}
          onClose={(r) => {
            setPending((q) => q.slice(1));
            if (r) {
              toast('ok', t('archive.done', { mods: r.mods, other: r.other, skipped: r.skipped }));
              void load();
              void refreshInstances();
            }
          }}
        />
      )}
    </div>
  );
}
