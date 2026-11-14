import { useCallback, useEffect, useRef, useState } from 'react';
import type { CurseForgeClass, CurseForgeHit, CurseForgeSort } from '../../shared/types';
import { call, errMsg } from '../api';
import { Empty, Skeleton } from '../components/ui';
import { useStore } from '../store';

const TYPES: { id: CurseForgeClass; label: string }[] = [
  { id: 'mod', label: 'Моды' },
  { id: 'resourcepack', label: 'Ресурспаки' },
  { id: 'modpack', label: 'Сборки' },
];

const SORTS: { id: CurseForgeSort; label: string }[] = [
  { id: 'popularity', label: 'Популярность' },
  { id: 'totalDownloads', label: 'Скачивания' },
  { id: 'lastUpdated', label: 'Обновления' },
  { id: 'name', label: 'Имя' },
  { id: 'featured', label: 'Избранное' },
];

function count(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)} M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(n >= 10_000 ? 0 : 1)} K`;
  return String(n);
}

export function CurseForgePage() {
  const instances = useStore((s) => s.instances);
  const selectedId = useStore((s) => s.selectedId);
  const select = useStore((s) => s.select);
  const toast = useStore((s) => s.toast);
  const refreshInstances = useStore((s) => s.refreshInstances);
  const inst = instances.find((i) => i.id === selectedId) ?? null;

  const [classType, setClassType] = useState<CurseForgeClass>('mod');
  const [text, setText] = useState('');
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<CurseForgeSort>('popularity');
  const [onlyCompat, setOnlyCompat] = useState(true);
  const [hits, setHits] = useState<CurseForgeHit[] | null>(null);
  const [total, setTotal] = useState(0);
  const [more, setMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<Set<number>>(new Set());
  const [installed, setInstalled] = useState<Set<number>>(new Set());
  const seq = useRef(0);

  const instKind = classType === 'mod' || classType === 'resourcepack' ? classType : null;

  useEffect(() => {
    const t = setTimeout(() => setQuery(text.trim()), 350);
    return () => clearTimeout(t);
  }, [text]);

  const filterMc = classType !== 'modpack' && onlyCompat && inst ? inst.mcVersion : null;
  const filterLoader =
    classType === 'mod' && onlyCompat && inst && inst.loader.type !== 'vanilla' ? inst.loader.type : null;
  const instId = inst?.id;

  const search = useCallback(
    async (offset: number) => {
      const my = ++seq.current;
      try {
        const r = await call('curseforge:search', {
          query,
          classType,
          mcVersion: filterMc,
          loader: filterLoader,
          sort,
          offset,
        });
        if (my !== seq.current) return;
        setHits((prev) =>
          offset === 0 ? r.hits : [...(prev ?? []), ...r.hits.filter((h) => !(prev ?? []).some((p) => p.id === h.id))],
        );
        setTotal(r.total);
        setError(null);
      } catch (e) {
        if (my !== seq.current) return;
        setError(errMsg(e));
        if (offset === 0) setHits([]);
      } finally {
        if (my === seq.current) setMore(false);
      }
    },
    [query, classType, filterMc, filterLoader, sort],
  );

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    setHits(null);
    void search(0);
  }, [search, instId]);

  const loadInstalled = useCallback(async () => {
    if (!instId || !instKind) {
      setInstalled(new Set());
      return;
    }
    try {
      setInstalled(new Set(await call('curseforge:installed', { id: instId, kind: instKind })));
    } catch {
      setInstalled(new Set());
    }
  }, [instId, instKind]);
  useEffect(() => {
    void loadInstalled();
  }, [loadInstalled]);

  const install = async (h: CurseForgeHit) => {
    if (h.type === 'modpack') {
      setBusy((b) => new Set(b).add(h.id));
      try {
        await call('curseforge:installPack', { modId: h.id });
        toast('ok', `Сборка «${h.title}» ставится…`);
        void refreshInstances();
      } catch (e) {
        toast('error', errMsg(e));
      } finally {
        setBusy((b) => {
          const n = new Set(b);
          n.delete(h.id);
          return n;
        });
      }
      return;
    }
    if (!inst) {
      toast('error', 'Выбери инстанс');
      return;
    }
    setBusy((b) => new Set(b).add(h.id));
    try {
      await call('curseforge:install', { id: inst.id, modId: h.id, kind: h.type });
      toast('ok', h.title);
      void refreshInstances();
      void loadInstalled();
    } catch (e) {
      toast('error', errMsg(e));
    } finally {
      setBusy((b) => {
        const n = new Set(b);
        n.delete(h.id);
        return n;
      });
    }
  };

  const locked = !!inst && (inst.running || inst.state === 'installing');
  const vanillaMods = classType === 'mod' && inst?.loader.type === 'vanilla';

  return (
    <div className="page page--modrinth">
      <div className="page-head">
        <h1>CurseForge</h1>
        <p className="muted">Поиск и установка модов с CurseForge (публичный API-ключ)</p>
      </div>

      <div className="modrinth-bar">
        <div className="tabs">
          {TYPES.map((t) => (
            <button key={t.id} type="button" className={`tab ${classType === t.id ? 'tab--on' : ''}`} onClick={() => setClassType(t.id)}>
              {t.label}
            </button>
          ))}
        </div>
        <input
          className="input"
          placeholder="Поиск…"
          value={text}
          onChange={(e) => setText(e.target.value)}
        />
        <select className="input" value={sort} onChange={(e) => setSort(e.target.value as CurseForgeSort)}>
          {SORTS.map((s) => (
            <option key={s.id} value={s.id}>
              {s.label}
            </option>
          ))}
        </select>
        <label className="check">
          <input type="checkbox" checked={onlyCompat} onChange={(e) => setOnlyCompat(e.target.checked)} />
          Совместимые с инстансом
        </label>
      </div>

      {!inst && classType !== 'modpack' && (
        <p className="muted">Выбери инстанс слева, чтобы ставить моды / ресурспаки.</p>
      )}
      {vanillaMods && <p className="muted">В Vanilla-инстанс моды не ставятся — смени загрузчик.</p>}

      {error && <p className="error">{error}</p>}

      {hits === null && <Skeleton rows={6} />}
      {hits && hits.length === 0 && !error && <Empty title="Ничего не найдено" />}

      {hits && hits.length > 0 && (
        <div className="modrinth-list">
          {hits.map((h) => {
            const isInstalled = installed.has(h.id);
            const isBusy = busy.has(h.id);
            return (
              <div key={h.id} className="modrinth-card">
                {h.iconDataUrl ? (
                  <img className="modrinth-card__icon" src={h.iconDataUrl} alt="" />
                ) : (
                  <div className="modrinth-card__icon modrinth-card__icon--empty" />
                )}
                <div className="modrinth-card__body">
                  <div className="modrinth-card__title">{h.title}</div>
                  <div className="modrinth-card__meta">
                    {h.author && <span>{h.author}</span>}
                    <span>{count(h.downloads)} ↓</span>
                  </div>
                  <div className="modrinth-card__desc muted">{h.description}</div>
                </div>
                <div className="modrinth-card__actions">
                  <button
                    type="button"
                    className="btn btn--sm"
                    disabled={isBusy || (h.type !== 'modpack' && (locked || !inst || vanillaMods))}
                    onClick={() => void install(h)}
                  >
                    {isBusy ? '…' : isInstalled ? 'Переустановить' : h.type === 'modpack' ? 'Установить' : 'Установить'}
                  </button>
                  <button type="button" className="btn btn--sm btn--ghost" onClick={() => void call('curseforge:openPage', { slug: h.slug })}>
                    CF
                  </button>
                </div>
              </div>
            );
          })}
        </div>
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
          {more ? 'Загрузка…' : `Ещё (${hits.length} / ${total})`}
        </button>
      )}

      {instances.length > 0 && (
        <div className="modrinth-inst">
          <span className="muted">Инстанс:</span>
          <select
            className="input"
            value={selectedId ?? ''}
            onChange={(e) => select(e.target.value || null)}
          >
            <option value="">—</option>
            {instances.map((i) => (
              <option key={i.id} value={i.id}>
                {i.name} ({i.mcVersion} / {i.loader.type})
              </option>
            ))}
          </select>
        </div>
      )}
    </div>
  );
}
