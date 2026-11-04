import { useCallback, useEffect, useState } from 'react';
import type { SkinSide, SkinVariant } from '../../shared/skin';
import type { AccountSkin, SkinEntry } from '../../shared/types';
import { call, errMsg } from '../api';
import { Icon } from '../components/Icon';
import { SkinPreview } from '../components/SkinPreview';
import { SkinViewer3D } from '../components/SkinViewer3D';
import { ConfirmModal, Empty, Field, Skeleton } from '../components/ui';
import { useI18n } from '../i18n';
import { useStore } from '../store';


const VARIANT_SHORT: Record<SkinVariant, string> = { classic: 'Steve', slim: 'Alex' };

function problemsText(problems: string[]): string {
  return problems.length > 2 ? `${problems.slice(0, 2).join('; ')} (${problems.length - 2})` : problems.join('; ');
}

export function WardrobePage() {
  const { t } = useI18n();
  const VARIANT_LABEL: Record<SkinVariant, string> = { classic: t('wardrobe.wide'), slim: t('wardrobe.slim') };
  const auth = useStore((s) => s.auth);
  const go = useStore((s) => s.go);
  const toast = useStore((s) => s.toast);
  const online = auth?.mode === 'microsoft' && auth.loggedIn;

  const [skins, setSkins] = useState<SkinEntry[] | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [current, setCurrent] = useState<AccountSkin | null | undefined>(undefined); // undefined = not loaded
  const [currentError, setCurrentError] = useState<string | null>(null);
  const [view, setView] = useState<'3d' | SkinSide>('3d');
  const [walk, setWalk] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [nameDraft, setNameDraft] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);

  const selected = skins?.find((s) => s.id === selectedId) ?? null;

  const loadSkins = useCallback(async () => {
    try {
      const list = await call('wardrobe:list');
      setSkins(list);
      setSelectedId((id) => (id && list.some((s) => s.id === id) ? id : list[0]?.id ?? null));
    } catch (e) { toast('error', errMsg(e)); setSkins([]); }
  }, [toast]);

  const loadCurrent = useCallback(async () => {
    setCurrentError(null);
    try { setCurrent(await call('wardrobe:current')); } catch (e) { setCurrent(undefined); setCurrentError(errMsg(e)); }
  }, []);

  useEffect(() => { void loadSkins(); }, [loadSkins]);
  useEffect(() => {
    if (online) void loadCurrent(); else { setCurrent(undefined); setCurrentError(null); }
  }, [online, auth?.uuid, loadCurrent]);
  useEffect(() => { setNameDraft(selected?.name ?? ''); }, [selected?.id, selected?.name]);

  const run = async (key: string, fn: () => Promise<void>) => {
    setBusy(key);
    try { await fn(); } catch (e) { toast('error', errMsg(e)); } finally { setBusy(null); }
  };

  const addSkins = () => run('import', async () => {
    const r = await call('wardrobe:import');
    if (r.added.length) {
      setSkins((list) => [...r.added, ...(list ?? [])]);
      setSelectedId(r.added[0]!.id);
      toast('ok', r.added.length === 1 ? t('wardrobe.added') : t('wardrobe.addedN', { n: r.added.length }));
    }
    if (r.problems.length) toast('error', problemsText(r.problems));
  });

  const saveCurrent = () => run('save', async () => {
    const r = await call('wardrobe:saveCurrent', { name: (auth?.name ?? 'skin').slice(0, 32) });
    if (r.added.length) {
      setSkins((list) => [...r.added, ...(list ?? [])]);
      setSelectedId(r.added[0]!.id);
      toast('ok', t('wardrobe.savedCurrent'));
    } else if (r.problems.length) toast('info', problemsText(r.problems));
  });

  const apply = () => selected && run('apply', async () => {
    const worn = await call('wardrobe:apply', { id: selected.id });
    setCurrent(worn);
    toast('ok', t('wardrobe.equippedToast'));
  });

  const reset = () => run('reset', async () => {
    setConfirmReset(false);
    await call('wardrobe:reset');
    toast('ok', t('wardrobe.resetToast'));
    await loadCurrent();
  });

  const rename = () => selected && nameDraft.trim() && nameDraft.trim() !== selected.name && run('rename', async () => {
    const u = await call('wardrobe:update', { id: selected.id, patch: { name: nameDraft.trim() } });
    setSkins((list) => list?.map((s) => (s.id === u.id ? u : s)) ?? null);
  });

  const setVariant = (variant: SkinVariant) => selected && variant !== selected.variant && run('variant', async () => {
    const u = await call('wardrobe:update', { id: selected.id, patch: { variant } });
    setSkins((list) => list?.map((s) => (s.id === u.id ? u : s)) ?? null);
  });

  const remove = () => selected && run('remove', async () => {
    setConfirmDelete(false);
    await call('wardrobe:remove', { id: selected.id, confirm: true });
    setSkins((list) => list?.filter((s) => s.id !== selected.id) ?? null);
    setSelectedId(null);
    await loadSkins();
  });

  const worn = (s: SkinEntry) => !!current && current.dataUrl === s.dataUrl;

  return (
    <div className="page">
      <header className="page-head">
        <div className="page-head__title"><Icon name="shirt" size={40} /><div><h1>{t('wardrobe.title')}</h1><p>{t('wardrobe.subtitle')}</p></div></div>
        <div className="row row--wrap" style={{ marginLeft: 'auto' }}>
          {online && <button className="btn" disabled={busy !== null} onClick={() => void saveCurrent()} title={t('wardrobe.saveCurrentHint')}><Icon name="download" size={16} /> {t('wardrobe.saveCurrent')}</button>}
          <button className="btn btn--primary" disabled={busy !== null} onClick={() => void addSkins()}><Icon name="plus" size={16} /> {t('wardrobe.add')}</button>
        </div>
      </header>

      {!online && (
        <div className="notice" role="note">
          <Icon name="alert" size={18} />
          <span className="grow">
            {auth?.mode === 'offline'
              ? t('wardrobe.offlineHint')
              : t('wardrobe.loginHint')}
          </span>
          <button className="btn btn--sm" onClick={() => go('settings')}>{t('auth.account')}</button>
        </div>
      )}

      <div className="split">
        <div className="split__main">
          {skins === null ? <Skeleton rows={4} /> : skins.length === 0 ? (
            <Empty icon="shirt" title={t('wardrobe.empty')} text={t('wardrobe.emptyHint')} action={<button className="btn btn--primary" onClick={() => void addSkins()}><Icon name="plus" size={16} /> {t('wardrobe.add')}</button>} />
          ) : (
            <ul className="skins" aria-label={t('wardrobe.title')}>
              {skins.map((s) => (
                <li key={s.id}>
                  <button className={`skin${s.id === selectedId ? ' is-selected' : ''}`} onClick={() => setSelectedId(s.id)} aria-pressed={s.id === selectedId}>
                    <SkinPreview dataUrl={s.dataUrl} variant={s.variant} scale={5} label={s.name} />
                    <span className="skin__name">{s.name}</span>
                    <span className="skin__meta">
                      <span className="badge badge--plain">{VARIANT_SHORT[s.variant]}</span>
                      {worn(s) && <span className="badge badge--ok">{t('wardrobe.equipped')}</span>}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <aside className="panel" aria-label={t('wardrobe.selected')}>
          {selected ? (
            <>
              <div className={`stage${view === '3d' ? ' stage--3d' : ''}`}>
                {view === '3d'
                  ? <SkinViewer3D dataUrl={selected.dataUrl} variant={selected.variant} walk={walk} label={selected.name} />
                  : <SkinPreview dataUrl={selected.dataUrl} variant={selected.variant} side={view} scale={10} label={selected.name} />}
              </div>
              <div className="segmented" role="radiogroup" aria-label={t('wardrobe.view')} style={{ alignSelf: 'center' }}>
                {(['3d', 'front', 'back'] as const).map((v) => (
                  <button key={v} type="button" role="radio" aria-checked={view === v} className={view === v ? 'is-on' : ''} onClick={() => setView(v)}>{v === '3d' ? '3D' : v === 'front' ? t('wardrobe.front') : t('wardrobe.back')}</button>
                ))}
              </div>
              {view === '3d' && (
                <div className="row row--between">
                  <span className="muted">{t('wardrobe.rotate')}</span>
                  <label className="row"><input type="checkbox" checked={walk} onChange={(e) => setWalk(e.target.checked)} /> {t('wardrobe.walk')}</label>
                </div>
              )}
              <Field label={t('instances.name')}>
                <input className="input" value={nameDraft} maxLength={32} onChange={(e) => setNameDraft(e.target.value)} onBlur={() => void rename()} onKeyDown={(e) => e.key === 'Enter' && (e.currentTarget.blur())} />
              </Field>
              <Field label={t('wardrobe.model')} hint={t('wardrobe.slimHint')}>
                <select className="input" value={selected.variant} onChange={(e) => void setVariant(e.target.value as SkinVariant)}>
                  {(Object.keys(VARIANT_LABEL) as SkinVariant[]).map((v) => <option key={v} value={v}>{VARIANT_LABEL[v]}</option>)}
                </select>
              </Field>
              <button className="btn btn--primary btn--block" disabled={!online || busy !== null} onClick={() => void apply()} title={online ? undefined : t('auth.loginMs')}>
                <Icon name="shirt" size={16} /> {busy === 'apply' ? '…' : t('wardrobe.equip')}
              </button>
              <button className="btn btn--danger btn--block" disabled={busy !== null} onClick={() => setConfirmDelete(true)}><Icon name="trash" size={16} /> {t('wardrobe.delete')}</button>
            </>
          ) : (
            <Empty icon="shirt" title={t('wardrobe.selected')} text={t('wardrobe.selectHint')} />
          )}

          {online && (
            <section className="pcard">
              <h3><Icon name="user" size={16} /> {auth?.name}</h3>
              {current ? (
                <div className="row">
                  <SkinPreview dataUrl={current.dataUrl} variant={current.variant} scale={3} label={t('wardrobe.selected')} />
                  <span className="muted">{VARIANT_SHORT[current.variant]}</span>
                </div>
              ) : currentError ? (
                <p className="form-error" role="alert"><Icon name="alert" size={16} /> {currentError}</p>
              ) : current === null ? (
                <p className="muted">{t('wardrobe.noSkin')}</p>
              ) : <p className="muted">{t('common.loading')}</p>}
              <div className="row row--wrap">
                <button className="btn btn--sm" disabled={busy !== null} onClick={() => void loadCurrent()}><Icon name="refresh" size={16} /> {t('action.refresh')}</button>
                <button className="btn btn--sm" disabled={busy !== null} onClick={() => setConfirmReset(true)}>{t('wardrobe.reset')}</button>
              </div>
            </section>
          )}
        </aside>
      </div>

      {confirmDelete && selected && (
        <ConfirmModal title={t('action.delete')} confirmLabel={t('action.delete')} danger busy={busy !== null} onConfirm={() => void remove()} onClose={() => setConfirmDelete(false)}>
          <p>{selected.name}</p>
        </ConfirmModal>
      )}
      {confirmReset && (
        <ConfirmModal title={t('wardrobe.reset')} confirmLabel={t('action.reset')} busy={busy !== null} onConfirm={() => void reset()} onClose={() => setConfirmReset(false)}>
          <p>{t('wardrobe.resetConfirm')}</p>
        </ConfirmModal>
      )}
    </div>
  );
}
