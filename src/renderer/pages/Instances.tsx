import { useMemo, useState } from 'react';
import type { InstanceKind } from '../../shared/types';
import { ImportPackButton } from '../components/ChaldPackDialogs';
import { Icon } from '../components/Icon';
import { InstanceCard } from '../components/InstanceCard';
import { InstanceDialogs, type InstanceDialog } from '../components/InstanceMenu';
import { InstancePanel } from '../components/InstancePanel';
import { Empty, Skeleton } from '../components/ui';
import { useI18n } from '../i18n';
import { useStore } from '../store';

type Tab = 'all' | InstanceKind;

export function InstancesPage() {
  const instances = useStore((s) => s.instances);
  const loaded = useStore((s) => s.instancesLoaded);
  const selectedId = useStore((s) => s.selectedId);
  const select = useStore((s) => s.select);
  const openWizard = useStore((s) => s.openWizard);
  const { t } = useI18n();
  const [query, setQuery] = useState('');
  const [tab, setTab] = useState<Tab>('all');
  const [dialog, setDialog] = useState<InstanceDialog>(null);

  const tabs: { id: Tab; label: string }[] = [
    { id: 'all', label: t('home.allInstances') },
    { id: 'official', label: t('kind.official') },
    { id: 'modded', label: t('kind.modded') },
    { id: 'custom', label: t('kind.custom') },
  ];

  const counts = useMemo(() => {
    const c: Record<Tab, number> = { all: instances.length, official: 0, modded: 0, custom: 0 };
    for (const i of instances) c[i.kind] += 1;
    return c;
  }, [instances]);
  const q = query.trim().toLowerCase();
  const list = instances.filter(
    (i) => (tab === 'all' || i.kind === tab) && (!q || `${i.name} ${i.description} ${i.mcVersion}`.toLowerCase().includes(q)),
  );
  const selected = instances.find((i) => i.id === selectedId) ?? null;

  return (
    <div className="split">
      <section className="split__main">
        <header className="page-head">
          <div className="page-head__title">
            <Icon name="cube" size={40} />
            <div>
              <h1>{t('instances.title')}</h1>
              <p>{t('nav.instances')}</p>
            </div>
          </div>
          <div className="search grow">
            <Icon name="search" size={18} />
            <input
              className="input"
              type="search"
              placeholder={t('instances.search')}
              aria-label={t('instances.search')}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>
          <ImportPackButton />
          <button className="btn btn--outline" onClick={() => openWizard()}>
            <Icon name="plus" size={18} /> {t('instances.create')}
          </button>
        </header>

        <div className="tabs" role="tablist">
          {tabs.map((tb) => (
            <button
              key={tb.id}
              role="tab"
              aria-selected={tab === tb.id}
              className={`tab${tab === tb.id ? ' is-on' : ''}`}
              onClick={() => setTab(tb.id)}
            >
              {tb.label} ({counts[tb.id]})
            </button>
          ))}
        </div>

        {!loaded ? (
          <Skeleton rows={4} />
        ) : instances.length === 0 ? (
          <Empty
            icon="cube"
            title={t('home.noInstances')}
            text={t('home.noInstancesHint')}
            action={
              <button className="btn btn--primary" onClick={() => openWizard()}>
                <Icon name="plus" size={18} /> {t('instances.create')}
              </button>
            }
          />
        ) : list.length === 0 ? (
          <Empty
            icon="search"
            title={t('modrinth.none')}
            text={q ? query : t('instances.emptyHint')}
            action={q ? <button className="btn" onClick={() => setQuery('')}>{t('action.clear')}</button> : undefined}
          />
        ) : (
          <div className="icards">
            {list.map((i) => (
              <InstanceCard key={i.id} inst={i} selected={i.id === selectedId} onSelect={() => select(i.id)} openDialog={setDialog} />
            ))}
          </div>
        )}
      </section>

      {selected ? (
        <InstancePanel inst={selected} openDialog={setDialog} />
      ) : loaded && instances.length > 0 ? (
        <aside className="panel panel--empty">
          <Empty icon="cube" title={t('instances.select')} text={t('instances.notSelected')} />
        </aside>
      ) : null}

      <InstanceDialogs dialog={dialog} close={() => setDialog(null)} />
    </div>
  );
}
