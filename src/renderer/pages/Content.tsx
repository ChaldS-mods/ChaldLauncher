import { useCallback, useEffect, useState } from 'react';
import type { ContentEntry } from '../../shared/types';
import { call, errMsg } from '../api';
import { Icon } from '../components/Icon';
import { ConfirmModal, Empty, Skeleton, Switch } from '../components/ui';
import { useStore } from '../store';
import { formatSize } from '../util';

const TEXT = {
  mods: { title: 'Моды', sub: 'Моды выбранного инстанса', icon: 'puzzle', add: 'Добавить моды', one: 'мод', none: 'В этом инстансе нет модов', hint: 'Импортируй файлы .jar. Моды работают в инстансах с Fabric, Quilt, Forge или NeoForge — формат мода должен совпадать с загрузчиком.' },
  resourcepacks: { title: 'Ресурспаки', sub: 'Ресурспаки выбранного инстанса', icon: 'image', add: 'Добавить ресурспаки', one: 'ресурспак', none: 'В этом инстансе нет ресурспаков', hint: 'Импортируй архивы .zip или папки с ресурспаками.' },
} as const;

export function ContentPage({ kind }: { kind: 'mods' | 'resourcepacks' }) {
  const t = TEXT[kind];
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
    if (!id) { setItems([]); return; }
    try { setItems(await call('content:list', { id, kind })); setError(null); } catch (e) { setError(errMsg(e)); setItems([]); }
  }, [id, kind]);
  useEffect(() => { setItems(null); void load(); }, [load]);

  const run = async (fn: () => Promise<unknown>, ok?: string) => {
    setBusy(true);
    try { await fn(); if (ok) toast('ok', ok); await load(); void refreshInstances(); } catch (e) { toast('error', errMsg(e)); } finally { setBusy(false); }
  };

  if (!inst) {
    return <div className="page"><Empty icon={t.icon} title={`${t.title}: инстанс не выбран`} text="Сначала создай или выбери инстанс на странице «Инстансы»." action={<button className="btn" onClick={() => useStore.getState().go('instances')}>К инстансам</button>} /></div>;
  }
  const modsUnsupported = kind === 'mods' && inst.loader.type === 'vanilla';

  return (
    <div className="page">
      <header className="page-head">
        <div className="page-head__title"><Icon name={t.icon} size={40} /><div><h1>{t.title}</h1><p>{t.sub}</p></div></div>
        <select className="input input--auto" aria-label="Инстанс" value={inst.id} onChange={(e) => select(e.target.value)}>
          {instances.map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}
        </select>
        <button className="btn" onClick={() => useStore.getState().go('modrinth', { modrinthType: kind === 'mods' ? 'mod' : 'resourcepack' })}>
          <Icon name="download" size={18} /> Скачать с Modrinth
        </button>
        <button className="btn btn--primary" disabled={busy || locked} onClick={() => void run(async () => { const n = await call('content:import', { id: inst.id, kind }); if (n > 0) toast('ok', `Добавлено: ${n}`); })}>
          <Icon name="plus" size={18} /> {t.add}
        </button>
      </header>

      {locked && <p className="notice"><Icon name="alert" size={16} /> {inst.running ? 'Игра запущена: останови её, чтобы менять файлы.' : 'Идёт установка: изменение файлов недоступно.'}</p>}
      {modsUnsupported && <p className="notice"><Icon name="alert" size={16} /> Это инстанс Vanilla: моды в нём не загружаются. Создай инстанс с Fabric, Quilt, Forge или NeoForge.</p>}
      {error && <p className="form-error" role="alert">{error}</p>}

      {items === null ? <Skeleton rows={4} />
        : items.length === 0 ? <Empty icon={t.icon} title={t.none} text={t.hint} />
        : (
          <ul className="clist">
            <li className="clist__count muted">{items.length} {t.one === 'мод' ? 'мод.' : 'шт.'} • включено: {items.filter((x) => x.enabled).length}</li>
            {items.map((it) => (
              <li key={it.file} className={`crow${it.enabled ? '' : ' is-off'}`}>
                {it.iconDataUrl ? <img className="crow__icon" src={it.iconDataUrl} alt="" /> : <span className="crow__icon crow__icon--ph"><Icon name={t.icon} size={22} /></span>}
                <div className="grow">
                  <strong>{it.name}</strong>
                  <p className="muted">{[it.version, formatSize(it.size), it.isDir ? 'папка' : null].filter(Boolean).join(' • ')}</p>
                  {it.warning && <p className="crow__warn"><Icon name="alert" size={14} /> {it.warning}</p>}
                </div>
                <Switch checked={it.enabled} label={`${it.enabled ? 'Выключить' : 'Включить'} ${it.name}`} disabled={busy || locked} onChange={() => void run(() => call('content:toggle', { id: inst.id, kind, file: it.file }))} />
                <button className="icon-btn" aria-label={`Удалить ${it.name}`} disabled={busy || locked} onClick={() => setConfirm(it)}><Icon name="trash" /></button>
              </li>
            ))}
          </ul>
        )}

      {confirm && (
        <ConfirmModal title="Удалить файл?" confirmLabel="Удалить" danger busy={busy} onClose={() => setConfirm(null)} onConfirm={() => { const f = confirm.file; void run(() => call('content:remove', { id: inst.id, kind, file: f, confirm: true }), 'Файл удалён').then(() => setConfirm(null)); }}>
          <p>«{confirm.name}» будет удалён с диска из инстанса «{inst.name}». Это действие нельзя отменить.</p>
        </ConfirmModal>
      )}
    </div>
  );
}
