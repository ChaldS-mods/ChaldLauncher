import { useMemo, useState } from 'react';
import type { McVersionEntry } from '../../shared/types';
import { Icon } from '../components/Icon';
import { Empty, Skeleton } from '../components/ui';
import { useMcVersions } from '../hooks';
import { useI18n, localeTag } from '../i18n';
import { useStore } from '../store';

type Filter = 'release' | 'snapshot' | 'old' | 'all';
const PAGE = 60;

export function VersionsPage() {
  const { versions, loading, error, reload } = useMcVersions();
  const openWizard = useStore((s) => s.openWizard);
  const { t, language } = useI18n();
  const [filter, setFilter] = useState<Filter>('release');
  const [query, setQuery] = useState('');
  const [limit, setLimit] = useState(PAGE);

  const filters: { id: Filter; label: string }[] = [
    { id: 'release', label: t('versions.release') },
    { id: 'snapshot', label: t('versions.snapshot') },
    { id: 'old', label: 'Old' },
    { id: 'all', label: t('home.allInstances') },
  ];
  const typeLabel: Record<McVersionEntry['type'], string> = {
    release: t('versions.release'),
    snapshot: t('versions.snapshot'),
    old_beta: 'Beta',
    old_alpha: 'Alpha',
  };

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
        <div className="page-head__title">
          <Icon name="layers" size={40} />
          <div>
            <h1>{t('versions.title')}</h1>
            <p>Minecraft</p>
          </div>
        </div>
        <div className="search grow">
          <Icon name="search" size={18} />
          <input
            className="input"
            type="search"
            placeholder={t('wizard.versionSearch')}
            aria-label={t('versions.search')}
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setLimit(PAGE);
            }}
          />
        </div>
        <button className="btn" onClick={reload} disabled={loading}>
          <Icon name="refresh" size={16} /> {t('action.refresh')}
        </button>
      </header>
      <div className="tabs" role="tablist">
        {filters.map((f) => (
          <button
            key={f.id}
            role="tab"
            aria-selected={filter === f.id}
            className={`tab${filter === f.id ? ' is-on' : ''}`}
            onClick={() => {
              setFilter(f.id);
              setLimit(PAGE);
            }}
          >
            {f.label}
          </button>
        ))}
      </div>

      {loading && !versions.length ? (
        <Skeleton rows={6} />
      ) : error && !versions.length ? (
        <Empty icon="alert" title={t('versions.failed')} text={error} action={<button className="btn" onClick={reload}>{t('action.retry')}</button>} />
      ) : list.length === 0 ? (
        <Empty icon="search" title={t('versions.none')} text={t('modrinth.noneHint')} />
      ) : (
        <>
          <ul className="vlist">
            {list.slice(0, limit).map((v) => (
              <li key={v.id} className="vrow">
                <strong className="vrow__id">{v.id}</strong>
                <span className={`badge${v.type === 'release' ? '' : ' badge--plain'}`}>{typeLabel[v.type]}</span>
                <span className="muted grow">{new Date(v.releaseTime).toLocaleDateString(localeTag(language))}</span>
                <button className="btn btn--sm" onClick={() => openWizard(v.id)}>
                  <Icon name="plus" size={14} /> {t('versions.createWith')}
                </button>
              </li>
            ))}
          </ul>
          {list.length > limit && (
            <button className="btn" onClick={() => setLimit(limit + PAGE)}>
              {t('action.next')} ({list.length - limit})
            </button>
          )}
        </>
      )}
    </div>
  );
}
