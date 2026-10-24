import { useCallback, useEffect, useState } from 'react';
import type { SkinSide, SkinVariant } from '../../shared/skin';
import type { AccountSkin, SkinEntry } from '../../shared/types';
import { call, errMsg } from '../api';
import { Icon } from '../components/Icon';
import { SkinPreview } from '../components/SkinPreview';
import { SkinViewer3D } from '../components/SkinViewer3D';
import { ConfirmModal, Empty, Field, Skeleton } from '../components/ui';
import { useStore } from '../store';

const VARIANT_LABEL: Record<SkinVariant, string> = { classic: 'Классическая (Steve)', slim: 'Тонкая (Alex)' };
const VARIANT_SHORT: Record<SkinVariant, string> = { classic: 'Steve', slim: 'Alex' };

function problemsText(problems: string[]): string {
  return problems.length > 2 ? `${problems.slice(0, 2).join('; ')} (и ещё ${problems.length - 2})` : problems.join('; ');
}

export function WardrobePage() {
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
      toast('ok', r.added.length === 1 ? `Скин «${r.added[0]!.name}» добавлен` : `Добавлено скинов: ${r.added.length}`);
    }
    if (r.problems.length) toast('error', problemsText(r.problems));
  });

  const saveCurrent = () => run('save', async () => {
    const r = await call('wardrobe:saveCurrent', { name: `Скин ${auth?.name ?? 'аккаунта'}`.slice(0, 32) });
    if (r.added.length) {
      setSkins((list) => [...r.added, ...(list ?? [])]);
      setSelectedId(r.added[0]!.id);
      toast('ok', 'Текущий скин аккаунта сохранён в гардероб');
    } else if (r.problems.length) toast('info', problemsText(r.problems));
  });

  const apply = () => selected && run('apply', async () => {
    const worn = await call('wardrobe:apply', { id: selected.id });
    setCurrent(worn);
    toast('ok', `Скин «${selected.name}» надет. В игре он появится после перезахода в мир или на сервер; на серверах обновление может занять несколько минут.`);
  });

  const reset = () => run('reset', async () => {
    setConfirmReset(false);
    await call('wardrobe:reset');
    toast('ok', 'Скин сброшен на стандартный');
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
        <div className="page-head__title"><Icon name="shirt" size={40} /><div><h1>Гардероб</h1><p>Скины Minecraft: храни, примеряй и меняй одним нажатием</p></div></div>
        <div className="row row--wrap" style={{ marginLeft: 'auto' }}>
          {online && <button className="btn" disabled={busy !== null} onClick={() => void saveCurrent()} title="Скачать скин, который сейчас на аккаунте, и добавить в гардероб"><Icon name="download" size={16} /> Сохранить текущий скин</button>}
          <button className="btn btn--primary" disabled={busy !== null} onClick={() => void addSkins()}><Icon name="plus" size={16} /> Добавить скин</button>
        </div>
      </header>

      {!online && (
        <div className="notice" role="note">
          <Icon name="alert" size={18} />
          <span className="grow">
            {auth?.mode === 'offline'
              ? 'Офлайн-режим: скин на аккаунте не меняется, гардероб можно собирать заранее.'
              : 'Войди через Microsoft, чтобы надевать скины на аккаунт. Пока можно собирать гардероб.'}
          </span>
          <button className="btn btn--sm" onClick={() => go('settings')}>Аккаунт</button>
        </div>
      )}

      <div className="split">
        <div className="split__main">
          {skins === null ? <Skeleton rows={4} /> : skins.length === 0 ? (
            <Empty icon="shirt" title="В гардеробе пока пусто" text="Добавь PNG-файл скина 64×64 (или 64×32). Скачать готовые скины можно, например, на namemc.com или minecraftskins.com." action={<button className="btn btn--primary" onClick={() => void addSkins()}><Icon name="plus" size={16} /> Добавить скин</button>} />
          ) : (
            <ul className="skins" aria-label="Скины в гардеробе">
              {skins.map((s) => (
                <li key={s.id}>
                  <button className={`skin${s.id === selectedId ? ' is-selected' : ''}`} onClick={() => setSelectedId(s.id)} aria-pressed={s.id === selectedId}>
                    <SkinPreview dataUrl={s.dataUrl} variant={s.variant} scale={5} label={`Скин «${s.name}»`} />
                    <span className="skin__name">{s.name}</span>
                    <span className="skin__meta">
                      <span className="badge badge--plain">{VARIANT_SHORT[s.variant]}</span>
                      {worn(s) && <span className="badge badge--ok">Надет</span>}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <aside className="panel" aria-label="Выбранный скин">
          {selected ? (
            <>
              <div className={`stage${view === '3d' ? ' stage--3d' : ''}`}>
                {view === '3d'
                  ? <SkinViewer3D dataUrl={selected.dataUrl} variant={selected.variant} walk={walk} label={`Предпросмотр: ${selected.name}`} />
                  : <SkinPreview dataUrl={selected.dataUrl} variant={selected.variant} side={view} scale={10} label={`Предпросмотр: ${selected.name}`} />}
              </div>
              <div className="segmented" role="radiogroup" aria-label="Вид" style={{ alignSelf: 'center' }}>
                {(['3d', 'front', 'back'] as const).map((v) => (
                  <button key={v} type="button" role="radio" aria-checked={view === v} className={view === v ? 'is-on' : ''} onClick={() => setView(v)}>{v === '3d' ? '3D' : v === 'front' ? 'Спереди' : 'Сзади'}</button>
                ))}
              </div>
              {view === '3d' && (
                <div className="row row--between">
                  <span className="muted">Тяни — повернуть</span>
                  <label className="row"><input type="checkbox" checked={walk} onChange={(e) => setWalk(e.target.checked)} /> Ходьба</label>
                </div>
              )}
              <Field label="Название">
                <input className="input" value={nameDraft} maxLength={32} onChange={(e) => setNameDraft(e.target.value)} onBlur={() => void rename()} onKeyDown={(e) => e.key === 'Enter' && (e.currentTarget.blur())} />
              </Field>
              <Field label="Модель рук" hint="Если у скина тонкие руки (3 пикселя), выбери «Тонкая». Лаунчер определяет это сам, но можно поправить.">
                <select className="input" value={selected.variant} onChange={(e) => void setVariant(e.target.value as SkinVariant)}>
                  {(Object.keys(VARIANT_LABEL) as SkinVariant[]).map((v) => <option key={v} value={v}>{VARIANT_LABEL[v]}</option>)}
                </select>
              </Field>
              <button className="btn btn--primary btn--block" disabled={!online || busy !== null} onClick={() => void apply()} title={online ? undefined : 'Нужен вход через Microsoft'}>
                <Icon name="shirt" size={16} /> {busy === 'apply' ? 'Надеваю…' : 'Надеть на аккаунт'}
              </button>
              <button className="btn btn--danger btn--block" disabled={busy !== null} onClick={() => setConfirmDelete(true)}><Icon name="trash" size={16} /> Удалить из гардероба</button>
            </>
          ) : (
            <Empty icon="shirt" title="Скин не выбран" text="Выбери скин слева, чтобы посмотреть его и надеть." />
          )}

          {online && (
            <section className="pcard">
              <h3><Icon name="user" size={16} /> Сейчас на аккаунте {auth?.name}</h3>
              {current ? (
                <div className="row">
                  <SkinPreview dataUrl={current.dataUrl} variant={current.variant} scale={3} label="Скин аккаунта сейчас" />
                  <span className="muted">Модель: {VARIANT_SHORT[current.variant]}</span>
                </div>
              ) : currentError ? (
                <p className="form-error" role="alert"><Icon name="alert" size={16} /> {currentError}</p>
              ) : current === null ? (
                <p className="muted">Своего скина нет: игра показывает стандартный.</p>
              ) : <p className="muted">Загружаю…</p>}
              <div className="row row--wrap">
                <button className="btn btn--sm" disabled={busy !== null} onClick={() => void loadCurrent()}><Icon name="refresh" size={16} /> Обновить</button>
                <button className="btn btn--sm" disabled={busy !== null} onClick={() => setConfirmReset(true)}>Сбросить на стандартный</button>
              </div>
            </section>
          )}
        </aside>
      </div>

      {confirmDelete && selected && (
        <ConfirmModal title="Удалить скин?" confirmLabel="Удалить" danger busy={busy !== null} onConfirm={() => void remove()} onClose={() => setConfirmDelete(false)}>
          <p>Скин «{selected.name}» будет удалён из гардероба. Скин на аккаунте Minecraft не изменится.</p>
        </ConfirmModal>
      )}
      {confirmReset && (
        <ConfirmModal title="Сбросить скин?" confirmLabel="Сбросить" busy={busy !== null} onConfirm={() => void reset()} onClose={() => setConfirmReset(false)}>
          <p>На аккаунте Microsoft снова будет стандартный скин (Steve или Alex, как выбрал Mojang). Скины в гардеробе останутся.</p>
        </ConfirmModal>
      )}
    </div>
  );
}
