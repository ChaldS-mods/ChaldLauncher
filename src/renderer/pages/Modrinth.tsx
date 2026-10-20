import { useCallback, useEffect, useRef, useState } from 'react';
import type { ModrinthHit, ModrinthSort, ModrinthType } from '../../shared/types';
import { call, errMsg } from '../api';
import { Icon } from '../components/Icon';
import { ModrinthProject } from '../components/ModrinthProject';
import { Empty, Skeleton } from '../components/ui';
import { useStore } from '../store';

const TYPES: { id: ModrinthType; label: string; icon: string }[] = [
  { id: 'mod', label: 'Моды', icon: 'puzzle' },
  { id: 'modpack', label: 'Сборки', icon: 'layers' },
  { id: 'resourcepack', label: 'Ресурспаки', icon: 'image' },
];
const SORTS: { id: ModrinthSort; label: string }[] = [
  { id: 'relevance', label: 'По релевантности' },
  { id: 'downloads', label: 'По скачиваниям' },
  { id: 'follows', label: 'По подпискам' },
  { id: 'updated', label: 'Недавно обновлённые' },
  { id: 'newest', label: 'Новые' },
];

function count(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)} млн`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(n >= 10_000 ? 0 : 1)} тыс.`;
  return String(n);
}

export function ModrinthPage() {
  const type = useStore((s) => s.modrinthType);
  const instances = useStore((s) => s.instances);
  const selectedId = useStore((s) => s.selectedId);
  const select = useStore((s) => s.select);
  const ops = useStore((s) => s.ops);
  const toast = useStore((s) => s.toast);
  const refreshInstances = useStore((s) => s.refreshInstances);
  const inst = instances.find((i) => i.id === selectedId) ?? null;

  const [text, setText] = useState('');
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<ModrinthSort>('downloads');
  const [onlyCompat, setOnlyCompat] = useState(true);
  const [hits, setHits] = useState<ModrinthHit[] | null>(null);
  const [total, setTotal] = useState(0);
  const [more, setMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<Set<string>>(new Set());
  const [open, setOpen] = useState<ModrinthHit | null>(null);
  const [installed, setInstalled] = useState<Set<string>>(new Set());
  const seq = useRef(0);
  const instKind = type === 'mod' || type === 'resourcepack' ? type : null;

  useEffect(() => {
    const t = setTimeout(() => setQuery(text.trim()), 350);
    return () => clearTimeout(t);
  }, [text]);

  const isPack = type === 'modpack';
  const filterMc = !isPack && onlyCompat && inst ? inst.mcVersion : null;
  const filterLoader = type === 'mod' && onlyCompat && inst && inst.loader.type !== 'vanilla' ? inst.loader.type : null;
  const instId = inst?.id;

  const search = useCallback(async (offset: number) => {
    const my = ++seq.current;
    try {
      const r = await call('modrinth:search', { query, type, mcVersion: filterMc, loader: filterLoader, sort, offset });
      if (my !== seq.current) return;
      setHits((prev) => (offset === 0 ? r.hits : [...(prev ?? []), ...r.hits.filter((h) => !(prev ?? []).some((p) => p.id === h.id))]));
      setTotal(r.total);
      setError(null);
    } catch (e) {
      if (my !== seq.current) return;
      setError(errMsg(e));
      if (offset === 0) setHits([]);
    } finally {
      if (my === seq.current) setMore(false);
    }
  }, [query, type, filterMc, filterLoader, sort]);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { setHits(null); void search(0); }, [search, instId]);

  const loadInstalled = useCallback(async () => {
    if (!instId || !instKind) { setInstalled(new Set()); return; }
    try { setInstalled(new Set(await call('modrinth:installed', { id: instId, kind: instKind }))); } catch { setInstalled(new Set()); }
  }, [instId, instKind]);
  useEffect(() => { void loadInstalled(); }, [loadInstalled]);

  const setType = (t: ModrinthType) => useStore.setState({ modrinthType: t });

  const install = async (h: ModrinthHit) => {
    setBusy((b) => new Set(b).add(h.id));
    try {
      if (h.type === 'modpack') {
        await call('modrinth:installPack', { projectId: h.id });
        toast('info', `Скачиваю сборку «${h.title}»…`);
      } else if (inst) {
        const files = await call('modrinth:install', { id: inst.id, projectId: h.id, kind: h.type });
        toast('ok', files.length > 1 ? `Установлено: ${h.title} и зависимости (${files.length} файла)` : `Установлено: ${h.title}`);
        void refreshInstances();
        void loadInstalled();
      }
    } catch (e) {
      toast('error', errMsg(e));
    } finally {
      setBusy((b) => { const n = new Set(b); n.delete(h.id); return n; });
    }
  };

  const cancelPack = (id: string) => void call('modrinth:cancelPack', { projectId: id }).catch((e) => toast('error', errMsg(e)));

  const locked = !!inst && (inst.running || inst.state === 'installing');
  const vanillaMods = type === 'mod' && inst?.loader.type === 'vanilla';
  const t = TYPES.find((x) => x.id === type)!;

  if (open) {
    return <ModrinthProject hit={open} inst={inst} locked={locked} vanillaMods={vanillaMods} filterMc={isPack ? null : (inst?.mcVersion ?? null)} filterLoader={type === 'mod' && inst && inst.loader.type !== 'vanilla' ? inst.loader.type : null} installed={installed.has(open.id)} onChanged={() => void loadInstalled()} onBack={() => setOpen(null)} />;
  }

  return (
    <div className="page">
      <header className="page-head">
        <div className="page-head__title"><Icon name="download" size={40} /><div><h1>Modrinth</h1><p>Моды, сборки и ресурспаки одним щелчком</p></div></div>
        <div className="tabs" role="tablist">
          {TYPES.map((x) => (
            <button key={x.id} role="tab" aria-selected={type === x.id} className={`tab${type === x.id ? ' is-on' : ''}`} onClick={() => setType(x.id)}>{x.label}</button>
          ))}
        </div>
      </header>

      <div className="mr-bar">
        <div className="search grow">
          <Icon name="search" size={18} />
          <input className="input" placeholder={`Искать: ${t.label.toLowerCase()}`} value={text} onChange={(e) => setText(e.target.value)} aria-label="Поиск" />
        </div>
        <select className="input input--auto" value={sort} onChange={(e) => setSort(e.target.value as ModrinthSort)} aria-label="Сортировка">
          {SORTS.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
        </select>
        {!isPack && (
          <select className="input input--auto" aria-label="Инстанс" value={inst?.id ?? ''} onChange={(e) => select(e.target.value)} disabled={instances.length === 0}>
            {instances.length === 0 && <option value="">Нет инстансов</option>}
            {instances.map((i) => <option key={i.id} value={i.id}>{i.name} · {i.mcVersion}</option>)}
          </select>
        )}
      </div>

      {!isPack && inst && (
        <label className="mr-check">
          <input type="checkbox" checked={onlyCompat} onChange={(e) => setOnlyCompat(e.target.checked)} />
          Только подходящие для «{inst.name}» (Minecraft {inst.mcVersion}{filterLoader ? `, ${filterLoader}` : ''})
        </label>
      )}
      {!isPack && !inst && <p className="notice"><Icon name="alert" size={16} /> Сначала создай или выбери инстанс: файлы скачиваются в него.</p>}
      {vanillaMods && <p className="notice"><Icon name="alert" size={16} /> Это инстанс Vanilla: моды в нём не загружаются. Выбери инстанс с Fabric, Quilt, Forge или NeoForge.</p>}
      {!isPack && locked && <p className="notice"><Icon name="alert" size={16} /> {inst?.running ? 'Игра запущена: останови её, чтобы ставить файлы.' : 'Идёт установка инстанса: подожди её окончания.'}</p>}
      {isPack && <p className="muted">Сборка скачивается в новый инстанс: лаунчер сам поставит нужную версию Minecraft и загрузчик.</p>}
      {error && <p className="form-error" role="alert">{error}</p>}

      {hits === null ? <Skeleton rows={5} />
        : hits.length === 0 ? <Empty icon={t.icon} title="Ничего не найдено" text={onlyCompat && !isPack && inst ? 'Попробуй другой запрос или сними фильтр совместимости.' : 'Попробуй другой запрос.'} />
        : (
          <ul className="clist">
            <li className="clist__count muted">Найдено: {count(total)}</li>
            {hits.map((h) => {
              const packOp = ops[`modpack:${h.id}`];
              const packRunning = packOp?.status === 'running';
              const working = busy.has(h.id) || packRunning;
              const isInstalled = h.type !== 'modpack' && installed.has(h.id);
              const disabled = working || isInstalled || (h.type !== 'modpack' && (!inst || locked || vanillaMods));
              return (
                <li key={h.id} className="crow mr-row">
                  {h.iconDataUrl ? <img className="crow__icon" src={h.iconDataUrl} alt="" /> : <span className="crow__icon crow__icon--ph"><Icon name={t.icon} size={22} /></span>}
                  <div className="grow">
                    <button className="mr-title" onClick={() => setOpen(h)}>{h.title}</button> <span className="muted">от {h.author}</span>
                    <p className="muted mr-desc">{h.description}</p>
                    <div className="mr-meta">
                      <span title="Скачиваний"><Icon name="download" size={13} /> {count(h.downloads)}</span>
                      {h.categories.slice(0, 3).map((c) => <span key={c} className="badge badge--plain">{c}</span>)}
                    </div>
                    {packRunning && <p className="muted mr-op">{packOp.label}</p>}
                  </div>
                  {packRunning && <button className="btn btn--sm" onClick={() => cancelPack(h.id)}>Отмена</button>}
                  <button className="btn" onClick={() => setOpen(h)}>Подробнее</button>
                  <button className={`btn${isInstalled ? ' btn--done' : ' btn--primary'}`} disabled={disabled} onClick={() => void install(h)}>
                    {working ? 'Установка…' : isInstalled ? 'Установлено' : h.type === 'modpack' ? 'Установить сборку' : 'Установить'}
                  </button>
                </li>
              );
            })}
            {hits.length < total && (
              <li><button className="btn" disabled={more} onClick={() => { setMore(true); void search(hits.length); }}>{more ? 'Загрузка…' : 'Показать ещё'}</button></li>
            )}
          </ul>
        )}
    </div>
  );
}
