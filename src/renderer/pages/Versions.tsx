import { useMemo, useState } from 'react';
import type { McVersionEntry } from '../../shared/types';
import { Icon } from '../components/Icon';
import { Empty, Skeleton } from '../components/ui';
import { useMcVersions } from '../hooks';
import { useStore } from '../store';

type Filter = 'release' | 'snapshot' | 'old' | 'all';
const FILTERS: { id: Filter; label: string }[] = [
  { id: 'release', label: 'Релизы' }, { id: 'snapshot', label: 'Снапшоты' }, { id: 'old', label: 'Старые' }, { id: 'all', label: 'Все' },
];
const TYPE_LABEL: Record<McVersionEntry['type'], string> = { release: 'Релиз', snapshot: 'Снапшот', old_beta: 'Бета', old_alpha: 'Альфа' };
const PAGE = 60;

export function VersionsPage() {
  const { versions, loading, error, reload } = useMcVersions();
  const openWizard = useStore((s) => s.openWizard);
  const [filter, setFilter] = useState<Filter>('release');
  const [query, setQuery] = useState('');
  const [limit, setLimit] = useState(PAGE);

  const list = useMemo(() => {
    const q = query.trim().toLowerCase();
    return versions.filter((v) => {
      if (filter === 'release' && v.type !== 'release') return false;
      if (filter === 'snapshot' && v.type !== 'snapshot') return false;
      if (filter === 'old' && v.type !== 'old_beta' && v.type !== 'old_alpha') return false;
      return !q || v.id.toLowerCase().includes(q);
    });
  }, [versions, filter, query]);

  return (
    <div className="page">
      <header className="page-head">
        <div className="page-head__title"><Icon name="layers" size={40} /><div><h1>Версии</h1><p>Все версии Minecraft от Mojang</p></div></div>
        <div className="search grow"><Icon name="search" size={18} /><input className="input" type="search" placeholder="Поиск версии, например 1.21" aria-label="Поиск версии" value={query} onChange={(e) => { setQuery(e.target.value); setLimit(PAGE); }} /></div>
        <button className="btn" onClick={reload} disabled={loading}><Icon name="refresh" size={16} /> Обновить список</button>
      </header>
      <div className="tabs" role="tablist">
        {FILTERS.map((f) => <button key={f.id} role="tab" aria-selected={filter === f.id} className={`tab${filter === f.id ? ' is-on' : ''}`} onClick={() => { setFilter(f.id); setLimit(PAGE); }}>{f.label}</button>)}
      </div>

      {loading && !versions.length ? <Skeleton rows={6} />
        : error && !versions.length ? <Empty icon="alert" title="Не удалось загрузить версии" text={error} action={<button className="btn" onClick={reload}>Повторить</button>} />
        : list.length === 0 ? <Empty icon="search" title="Нет подходящих версий" text="Измени фильтр или поисковый запрос." />
        : (
          <>
            <ul className="vlist">
              {list.slice(0, limit).map((v) => (
                <li key={v.id} className="vrow">
                  <strong className="vrow__id">{v.id}</strong>
                  <span className={`badge${v.type === 'release' ? '' : ' badge--plain'}`}>{TYPE_LABEL[v.type]}</span>
                  <span className="muted grow">{new Date(v.releaseTime).toLocaleDateString('ru-RU')}</span>
                  <button className="btn btn--sm" onClick={() => openWizard(v.id)}><Icon name="plus" size={14} /> Создать инстанс с этой версией</button>
                </li>
              ))}
            </ul>
            {list.length > limit && <button className="btn" onClick={() => setLimit(limit + PAGE)}>Показать ещё ({list.length - limit})</button>}
          </>
        )}
    </div>
  );
}
