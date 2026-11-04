import { useCallback, useEffect, useRef, useState } from 'react';
import type { ModrinthHit, ModrinthSort, ModrinthType } from '../../shared/types';
import { call, errMsg } from '../api';
import { Icon } from '../components/Icon';
import { ModrinthProject } from '../components/ModrinthProject';
import { Empty, Skeleton } from '../components/ui';
import { useI18n } from '../i18n';
import { useStore } from '../store';

const TYPES: { id: ModrinthType; labelKey: string; icon: string }[] = [
  { id: 'mod', labelKey: 'modrinth.mods', icon: 'puzzle' },
  { id: 'modpack', labelKey: 'modrinth.modpacks', icon: 'layers' },
  { id: 'resourcepack', labelKey: 'modrinth.resourcepacks', icon: 'image' },
];
const SORTS: { id: ModrinthSort; label: string }[] = [
  { id: 'relevance', label: 'Relevance' },
  { id: 'downloads', label: 'Downloads' },
  { id: 'follows', label: 'Follows' },
  { id: 'updated', label: 'Updated' },
  { id: 'newest', label: 'Newest' },
];

function count(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)} M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(n >= 10_000 ? 0 : 1)} K`;
  return String(n);
}

export function ModrinthPage() {
  const { t } = useI18n();
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
        toast('info', h.title);
      } else if (inst) {
        const files = await call('modrinth:install', { id: inst.id, projectId: h.id, kind: h.type });
        toast('ok', h.title);
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
  const tab = TYPES.find((x) => x.id === type)!;

  if (open) {
    return <ModrinthProject hit={open} inst={inst} locked={locked} vanillaMods={vanillaMods} filterMc={isPack ? null : (inst?.mcVersion ?? null)} filterLoader={type === 'mod' && inst && inst.loader.type !== 'vanilla' ? inst.loader.type : null} installed={installed.has(open.id)} onChanged={() => void loadInstalled()} onBack={() => setOpen(null)} />;
  }

  return (
    <div className="page">
      <header className="page-head">
        <div className="page-head__title"><Icon name="download" size={40} /><div><h1>Modrinth</h1><p>Modrinth</p></div></div>
        <div className="tabs" role="tablist">
          {TYPES.map((x) => (
            <button key={x.id} role="tab" aria-selected={type === x.id} className={`tab${type === x.id ? ' is-on' : ''}`} onClick={() => setType(x.id)}>{t(x.labelKey)}</button>
          ))}
        </div>
      </header>

      <div className="mr-bar">
        <div className="search grow">
          <Icon name="search" size={18} />
          <input className="input" placeholder={t('modrinth.search')} value={text} onChange={(e) => setText(e.target.value)} aria-label={t('modrinth.search')} />
        </div>
        <select className="input input--auto" value={sort} onChange={(e) => setSort(e.target.value as ModrinthSort)} aria-label={t('modrinth.sort')}>
          {SORTS.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
        </select>
        {!isPack && (
          <select className="input input--auto" aria-label={t('instances.title')} value={inst?.id ?? ''} onChange={(e) => select(e.target.value)} disabled={instances.length === 0}>
            {instances.length === 0 && <option value="">{t('instances.empty')}</option>}
            {instances.map((i) => <option key={i.id} value={i.id}>{i.name} · {i.mcVersion}</option>)}
          </select>
        )}
      </div>

      {!isPack && inst && (
        <label className="mr-check">
          <input type="checkbox" checked={onlyCompat} onChange={(e) => setOnlyCompat(e.target.checked)} />
          {inst.name} · Minecraft {inst.mcVersion}{filterLoader ? `, ${filterLoader}` : ''}
        </label>
      )}
      {!isPack && !inst && <p className="notice"><Icon name="alert" size={16} /> {t('content.selectFirst')}</p>}
      {vanillaMods && <p className="notice"><Icon name="alert" size={16} /> Vanilla</p>}
      {!isPack && locked && <p className="notice"><Icon name="alert" size={16} /> {inst?.running ? t('status.running') : t('state.installing')}</p>}
      {isPack && <p className="muted">{t('modrinth.packHint')}</p>}
      {error && <p className="form-error" role="alert">{error}</p>}

      {hits === null ? <Skeleton rows={5} />
        : hits.length === 0 ? <Empty icon={tab.icon} title={t('modrinth.none')} text={t('modrinth.noneHint')} />
        : (
          <ul className="clist">
            <li className="clist__count muted">{count(total)}</li>
            {hits.map((h) => {
              const packOp = ops[`modpack:${h.id}`];
              const packRunning = packOp?.status === 'running';
              const working = busy.has(h.id) || packRunning;
              const isInstalled = h.type !== 'modpack' && installed.has(h.id);
              const disabled = working || isInstalled || (h.type !== 'modpack' && (!inst || locked || vanillaMods));
              return (
                <li key={h.id} className="crow mr-row">
                  {h.iconDataUrl ? <img className="crow__icon" src={h.iconDataUrl} alt="" /> : <span className="crow__icon crow__icon--ph"><Icon name={tab.icon} size={22} /></span>}
                  <div className="grow">
                    <button className="mr-title" onClick={() => setOpen(h)}>{h.title}</button> <span className="muted">by {h.author}</span>
                    <p className="muted mr-desc">{h.description}</p>
                    <div className="mr-meta">
                      <span title="downloads"><Icon name="download" size={13} /> {count(h.downloads)}</span>
                      {h.categories.slice(0, 3).map((c) => <span key={c} className="badge badge--plain">{c}</span>)}
                    </div>
                    {packRunning && <p className="muted mr-op">{packOp.label}</p>}
                  </div>
                  {packRunning && <button className="btn btn--sm" onClick={() => cancelPack(h.id)}>{t('action.cancel')}</button>}
                  <button className="btn" onClick={() => setOpen(h)}>{t('modrinth.details')}</button>
                  <button className={`btn${isInstalled ? ' btn--done' : ' btn--primary'}`} disabled={disabled} onClick={() => void install(h)}>
                    {working ? t('state.installing') : isInstalled ? t('modrinth.installed') : t('modrinth.install')}
                  </button>
                </li>
              );
            })}
            {hits.length < total && (
              <li><button className="btn" disabled={more} onClick={() => { setMore(true); void search(hits.length); }}>{more ? t('common.loading') : t('action.next')}</button></li>
            )}
          </ul>
        )}
    </div>
  );
}
