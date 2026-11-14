import { useCallback, useEffect, useRef, useState } from 'react';
import type { CurseForgeHit, CurseForgeSort, ModrinthHit, ModrinthSort, ModrinthType } from '../../shared/types';
import { call, errMsg } from '../api';
import { Icon } from '../components/Icon';
import { ModrinthProject } from '../components/ModrinthProject';
import { CurseForgeProject } from '../components/CurseForgeProject';
import { Empty, Skeleton } from '../components/ui';
import { WorldPickerModal } from '../components/WorldPickerModal';
import { useI18n } from '../i18n';
import { useStore } from '../store';

type Source = 'modrinth' | 'curseforge';

const TYPES: { id: ModrinthType; labelKey: string; icon: string }[] = [
  { id: 'mod', labelKey: 'modrinth.mods', icon: 'puzzle' },
  { id: 'modpack', labelKey: 'modrinth.modpacks', icon: 'layers' },
  { id: 'resourcepack', labelKey: 'modrinth.resourcepacks', icon: 'image' },
  { id: 'shader', labelKey: 'modrinth.shaders', icon: 'image' },
  { id: 'datapack', labelKey: 'modrinth.datapacks', icon: 'layers' },
];

const MR_SORTS: { id: ModrinthSort; labelKey: string }[] = [
  { id: 'relevance', labelKey: 'modrinth.sort.relevance' },
  { id: 'downloads', labelKey: 'modrinth.sort.downloads' },
  { id: 'follows', labelKey: 'modrinth.sort.follows' },
  { id: 'updated', labelKey: 'modrinth.sort.updated' },
  { id: 'newest', labelKey: 'modrinth.sort.newest' },
];

const CF_SORTS: { id: CurseForgeSort; labelKey: string }[] = [
  { id: 'popularity', labelKey: 'modrinth.sort.popularity' },
  { id: 'totalDownloads', labelKey: 'modrinth.sort.totalDownloads' },
  { id: 'lastUpdated', labelKey: 'modrinth.sort.lastUpdated' },
  { id: 'name', labelKey: 'modrinth.sort.name' },
  { id: 'featured', labelKey: 'modrinth.sort.featured' },
];

function tagLabel(tFn: (k: string) => string, c: string): string {
  const key = `tag.${c}`;
  const tr = tFn(key);
  return tr === key ? c : tr;
}

/** Unified list item for both sources */
interface UnifiedHit {
  source: Source;
  /** string id for Modrinth, number as string for CF */
  key: string;
  mrId?: string;
  cfId?: number;
  slug: string;
  title: string;
  description: string;
  author: string;
  downloads: number;
  categories: string[];
  type: ModrinthType;
  iconDataUrl: string | null;
  /** original Modrinth hit when source=modrinth (for detail panel) */
  mr?: ModrinthHit;
}

function count(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)} M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(n >= 10_000 ? 0 : 1)} K`;
  return String(n);
}

function fromMr(h: ModrinthHit): UnifiedHit {
  return {
    source: 'modrinth',
    key: `mr:${h.id}`,
    mrId: h.id,
    slug: h.slug,
    title: h.title,
    description: h.description,
    author: h.author,
    downloads: h.downloads,
    categories: h.categories,
    type: h.type,
    iconDataUrl: h.iconDataUrl,
    mr: h,
  };
}

function fromCf(h: CurseForgeHit): UnifiedHit {
  return {
    source: 'curseforge',
    key: `cf:${h.id}`,
    cfId: h.id,
    slug: h.slug,
    title: h.title,
    description: h.description,
    author: h.author,
    downloads: h.downloads,
    categories: [],
    type: h.type,
    iconDataUrl: h.iconDataUrl,
  };
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

  const [source, setSource] = useState<Source>('modrinth');
  const [text, setText] = useState('');
  const [query, setQuery] = useState('');
  const [mrSort, setMrSort] = useState<ModrinthSort>('downloads');
  const [cfSort, setCfSort] = useState<CurseForgeSort>('popularity');
  const [onlyCompat, setOnlyCompat] = useState(true);
  const [hits, setHits] = useState<UnifiedHit[] | null>(null);
  const [total, setTotal] = useState(0);
  const [more, setMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<Set<string>>(new Set());
  const [open, setOpen] = useState<ModrinthHit | null>(null);
  const [openCf, setOpenCf] = useState<CurseForgeHit | null>(null);
  const [installedMr, setInstalledMr] = useState<Set<string>>(new Set());
  const [installedCf, setInstalledCf] = useState<Set<number>>(new Set());
  const [worldPick, setWorldPick] = useState<UnifiedHit | null>(null);
  const seq = useRef(0);
  const instKind = type === 'modpack' ? null : type;

  useEffect(() => {
    const t = setTimeout(() => setQuery(text.trim()), 350);
    return () => clearTimeout(t);
  }, [text]);

  const isPack = type === 'modpack';
  const filterMc = !isPack && onlyCompat && inst ? inst.mcVersion : null;
  const filterLoader = type === 'mod' && onlyCompat && inst && inst.loader.type !== 'vanilla' ? inst.loader.type : null;
  const instId = inst?.id;

  const search = useCallback(
    async (offset: number) => {
      const my = ++seq.current;
      try {
        if (source === 'modrinth') {
          const r = await call('modrinth:search', {
            query,
            type,
            mcVersion: filterMc,
            loader: filterLoader,
            sort: mrSort,
            offset,
          });
          if (my !== seq.current) return;
          const mapped = r.hits.map(fromMr);
          setHits((prev) =>
            offset === 0 ? mapped : [...(prev ?? []), ...mapped.filter((h) => !(prev ?? []).some((p) => p.key === h.key))],
          );
          setTotal(r.total);
        } else {
          const r = await call('curseforge:search', {
            query,
            classType: type,
            mcVersion: filterMc,
            loader: filterLoader,
            sort: cfSort,
            offset,
          });
          if (my !== seq.current) return;
          const mapped = r.hits.map(fromCf);
          setHits((prev) =>
            offset === 0 ? mapped : [...(prev ?? []), ...mapped.filter((h) => !(prev ?? []).some((p) => p.key === h.key))],
          );
          setTotal(r.total);
        }
        setError(null);
      } catch (e) {
        if (my !== seq.current) return;
        setError(errMsg(e));
        if (offset === 0) setHits([]);
      } finally {
        if (my === seq.current) setMore(false);
      }
    },
    [source, query, type, filterMc, filterLoader, mrSort, cfSort],
  );

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    setHits(null);
    void search(0);
  }, [search, instId]);

  const loadInstalled = useCallback(async () => {
    if (!instId || !instKind) {
      setInstalledMr(new Set());
      setInstalledCf(new Set());
      return;
    }
    try {
      const [mr, cf] = await Promise.all([
        call('modrinth:installed', { id: instId, kind: instKind }).catch(() => [] as string[]),
        call('curseforge:installed', { id: instId, kind: instKind }).catch(() => [] as number[]),
      ]);
      setInstalledMr(new Set(mr));
      setInstalledCf(new Set(cf));
    } catch {
      setInstalledMr(new Set());
      setInstalledCf(new Set());
    }
  }, [instId, instKind]);
  useEffect(() => {
    void loadInstalled();
  }, [loadInstalled]);

  const setType = (t: ModrinthType) => useStore.setState({ modrinthType: t });

  const openWorldPicker = (h: UnifiedHit) => {
    if (!inst) {
      toast('error', t('content.selectFirst'));
      return;
    }
    setWorldPick(h);
  };

  const doInstall = async (h: UnifiedHit, worldName?: string | null) => {
    setBusy((b) => new Set(b).add(h.key));
    try {
      if (h.source === 'modrinth' && h.mrId) {
        if (h.type === 'modpack') {
          await call('modrinth:installPack', { projectId: h.mrId });
          toast('info', h.title);
        } else if (inst) {
          await call('modrinth:install', {
            id: inst.id,
            projectId: h.mrId,
            kind: h.type,
            worldName: h.type === 'datapack' ? worldName ?? null : null,
          });
          toast('ok', h.title);
          void refreshInstances();
          void loadInstalled();
        }
      } else if (h.source === 'curseforge' && h.cfId != null) {
        if (h.type === 'modpack') {
          await call('curseforge:installPack', { modId: h.cfId });
          toast('ok', `Сборка «${h.title}» ставится…`);
          void refreshInstances();
        } else if (inst) {
          await call('curseforge:install', {
            id: inst.id,
            modId: h.cfId,
            kind: h.type,
            worldName: h.type === 'datapack' ? worldName ?? null : null,
          });
          toast('ok', h.title);
          void refreshInstances();
          void loadInstalled();
        }
      }
    } catch (e) {
      toast('error', errMsg(e));
    } finally {
      setBusy((b) => {
        const n = new Set(b);
        n.delete(h.key);
        return n;
      });
    }
  };

  const install = async (h: UnifiedHit) => {
    if (h.type === 'datapack') {
      openWorldPicker(h);
      return;
    }
    await doInstall(h, null);
  };

  const cancelPack = (id: string) => void call('modrinth:cancelPack', { projectId: id }).catch((e) => toast('error', errMsg(e)));

  const locked = !!inst && (inst.running || inst.state === 'installing');
  const vanillaMods = type === 'mod' && inst?.loader.type === 'vanilla';
  const tab = TYPES.find((x) => x.id === type)!;

  if (open && source === 'modrinth') {
    return (
      <ModrinthProject
        hit={open}
        inst={inst}
        locked={locked}
        vanillaMods={vanillaMods}
        filterMc={isPack ? null : (inst?.mcVersion ?? null)}
        filterLoader={type === 'mod' && inst && inst.loader.type !== 'vanilla' ? inst.loader.type : null}
        installed={installedMr.has(open.id)}
        onChanged={() => void loadInstalled()}
        onBack={() => setOpen(null)}
      />
    );
  }

  if (openCf) {
    return (
      <CurseForgeProject
        hit={openCf}
        inst={inst}
        locked={locked}
        vanillaMods={vanillaMods}
        filterMc={isPack ? null : (inst?.mcVersion ?? null)}
        filterLoader={type === 'mod' && inst && inst.loader.type !== 'vanilla' ? inst.loader.type : null}
        installed={installedCf.has(openCf.id)}
        onChanged={() => void loadInstalled()}
        onBack={() => setOpenCf(null)}
      />
    );
  }

  const isInstalled = (h: UnifiedHit) =>
    h.type !== 'modpack' &&
    (h.source === 'modrinth' ? installedMr.has(h.mrId!) : installedCf.has(h.cfId!));

  return (
    <div className="page">
      <header className="page-head">
        <div className="page-head__title">
          <Icon name="download" size={40} />
          <div>
            <h1>{t('modrinth.pageTitle')}</h1>
            <p>{t('modrinth.pageSub')}</p>
          </div>
        </div>
        <div className="tabs" role="tablist">
          {TYPES.map((x) => (
            <button
              key={x.id}
              role="tab"
              aria-selected={type === x.id}
              className={`tab${type === x.id ? ' is-on' : ''}`}
              onClick={() => setType(x.id)}
            >
              {t(x.labelKey)}
            </button>
          ))}
        </div>
      </header>

      <div className="tabs" role="tablist" style={{ marginBottom: 12 }}>
        <button
          role="tab"
          aria-selected={source === 'modrinth'}
          className={`tab${source === 'modrinth' ? ' is-on' : ''}`}
          onClick={() => {
            setSource('modrinth');
            setOpen(null);
            setOpenCf(null);
          }}
        >
          Modrinth
        </button>
        <button
          role="tab"
          aria-selected={source === 'curseforge'}
          className={`tab${source === 'curseforge' ? ' is-on' : ''}`}
          onClick={() => {
            setSource('curseforge');
            setOpen(null);
            setOpenCf(null);
          }}
        >
          CurseForge
        </button>
      </div>

      <div className="mr-bar">
        <div className="search grow">
          <Icon name="search" size={18} />
          <input
            className="input"
            placeholder={t('modrinth.search')}
            value={text}
            onChange={(e) => setText(e.target.value)}
            aria-label={t('modrinth.search')}
          />
        </div>
        {source === 'modrinth' ? (
          <select
            className="input input--auto"
            value={mrSort}
            onChange={(e) => setMrSort(e.target.value as ModrinthSort)}
            aria-label={t('modrinth.sort')}
          >
            {MR_SORTS.map((s) => (
              <option key={s.id} value={s.id}>
                {t(s.labelKey)}
              </option>
            ))}
          </select>
        ) : (
          <select
            className="input input--auto"
            value={cfSort}
            onChange={(e) => setCfSort(e.target.value as CurseForgeSort)}
            aria-label={t('modrinth.sort')}
          >
            {CF_SORTS.map((s) => (
              <option key={s.id} value={s.id}>
                {t(s.labelKey)}
              </option>
            ))}
          </select>
        )}
        {!isPack && (
          <select
            className="input input--auto"
            aria-label={t('instances.title')}
            value={inst?.id ?? ''}
            onChange={(e) => select(e.target.value)}
            disabled={instances.length === 0}
          >
            {instances.length === 0 && <option value="">{t('instances.empty')}</option>}
            {instances.map((i) => (
              <option key={i.id} value={i.id}>
                {i.name} · {i.mcVersion}
              </option>
            ))}
          </select>
        )}
      </div>

      {!isPack && inst && (
        <label className="mr-check">
          <input type="checkbox" checked={onlyCompat} onChange={(e) => setOnlyCompat(e.target.checked)} />
          {inst.name} · Minecraft {inst.mcVersion}
          {filterLoader ? `, ${filterLoader}` : ''}
        </label>
      )}
      {!isPack && !inst && (
        <p className="notice">
          <Icon name="alert" size={16} /> {t('content.selectFirst')}
        </p>
      )}
      {vanillaMods && (
        <p className="notice">
          <Icon name="alert" size={16} /> Vanilla
        </p>
      )}
      {!isPack && locked && (
        <p className="notice">
          <Icon name="alert" size={16} /> {inst?.running ? t('status.running') : t('state.installing')}
        </p>
      )}
      {isPack && source === 'modrinth' && <p className="muted">{t('modrinth.packHint')}</p>}
      {isPack && source === 'curseforge' && <p className="muted">Сборки CurseForge ставятся как новый инстанс (скачивается zip и моды из manifest)</p>}
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}

      {hits === null ? (
        <Skeleton rows={5} />
      ) : hits.length === 0 ? (
        <Empty icon={tab.icon} title={t('modrinth.none')} text={t('modrinth.noneHint')} />
      ) : (
        <ul className="clist">
          <li className="clist__count muted">{count(total)}</li>
          {hits.map((h) => {
            const packOp = h.source === 'modrinth' && h.mrId ? ops[`modpack:${h.mrId}`] : h.source === 'curseforge' && h.cfId != null ? ops[`modpack:cf:${h.cfId}:0`] : undefined;
            const packRunning = packOp?.status === 'running';
            const working = busy.has(h.key) || !!packRunning;
            const installed = isInstalled(h);
            const disabled = working || installed || (h.type !== 'modpack' && (!inst || locked || vanillaMods));
            return (
              <li key={h.key} className="crow mr-row">
                {h.iconDataUrl ? (
                  <img className="crow__icon" src={h.iconDataUrl} alt="" />
                ) : (
                  <span className="crow__icon crow__icon--ph">
                    <Icon name={tab.icon} size={22} />
                  </span>
                )}
                <div className="grow">
                  <button
                    className="mr-title"
                    onClick={() => {
                      if (h.source === 'modrinth' && h.mr) setOpen(h.mr);
                      else if (h.source === 'curseforge' && h.cfId != null) {
                        setOpenCf({
                          id: h.cfId,
                          slug: h.slug,
                          title: h.title,
                          description: h.description,
                          author: h.author,
                          downloads: h.downloads,
                          type: h.type,
                          iconDataUrl: h.iconDataUrl,
                          websiteUrl: null,
                        });
                      }
                    }}
                  >
                    {h.title}
                  </button>{' '}
                  <span className="muted">by {h.author}</span>
                  <span className="badge badge--plain" style={{ marginLeft: 6 }}>
                    {h.source === 'modrinth' ? 'MR' : 'CF'}
                  </span>
                  <p className="muted mr-desc mr-desc--unicode">{h.description}</p>
                  <div className="mr-meta">
                    <span title="downloads">
                      <Icon name="download" size={13} /> {count(h.downloads)}
                    </span>
                    {h.categories.slice(0, 3).map((c) => (
                      <span key={c} className="badge badge--plain">
                        {tagLabel(t, c)}
                      </span>
                    ))}
                  </div>
                  {packRunning && packOp && <p className="muted mr-op">{packOp.label}</p>}
                </div>
                {packRunning && h.mrId && (
                  <button className="btn btn--sm" onClick={() => cancelPack(h.mrId!)}>
                    {t('action.cancel')}
                  </button>
                )}
                {h.source === 'modrinth' && h.mr && (
                  <button className="btn" onClick={() => setOpen(h.mr!)}>
                    {t('modrinth.details')}
                  </button>
                )}
                {h.source === 'curseforge' && h.cfId != null && (
                  <button
                    className="btn"
                    onClick={() =>
                      setOpenCf({
                        id: h.cfId!,
                        slug: h.slug,
                        title: h.title,
                        description: h.description,
                        author: h.author,
                        downloads: h.downloads,
                        type: h.type,
                        iconDataUrl: h.iconDataUrl,
                        websiteUrl: null,
                      })
                    }
                  >
                    {t('modrinth.details')}
                  </button>
                )}
                <button
                  className={`btn${installed ? ' btn--done' : ' btn--primary'}`}
                  disabled={disabled}
                  onClick={() => void install(h)}
                >
                  {working
                    ? '…'
                    : installed
                      ? t('modrinth.installed') || 'Установлен'
                      : h.type === 'modpack'
                        ? t('modrinth.installPack') || 'Установить'
                        : t('modrinth.install') || 'Установить'}
                </button>
              </li>
            );
          })}
        </ul>
      )}

      {hits && hits.length > 0 && hits.length < total && (
        <button
          type="button"
          className="btn"
          disabled={more}
          onClick={() => {
            setMore(true);
            void search(hits.length);
          }}
        >
          {more ? '…' : `${t('modrinth.more') || 'Ещё'} (${hits.length} / ${total})`}
        </button>
      )}

      {worldPick && inst && (
        <WorldPickerModal
          title={worldPick.title}
          instanceId={inst.id}
          onClose={() => setWorldPick(null)}
          onConfirm={(world) => {
            const h = worldPick;
            setWorldPick(null);
            void doInstall(h, world);
          }}
        />
      )}

    </div>
  );
}
