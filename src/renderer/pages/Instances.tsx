import { useMemo, useState } from 'react';
import type { InstanceKind } from '../../shared/types';
import { ImportPackButton } from '../components/ChaldPackDialogs';
import { Icon } from '../components/Icon';
import { InstanceCard } from '../components/InstanceCard';
import { InstanceDialogs, type InstanceDialog } from '../components/InstanceMenu';
import { InstancePanel } from '../components/InstancePanel';
import { Empty, Skeleton } from '../components/ui';
import { useStore } from '../store';

type Tab = 'all' | InstanceKind;
const TABS: { id: Tab; label: string }[] = [
  { id: 'all', label: 'Все' },
  { id: 'official', label: 'Официальные' },
  { id: 'modded', label: 'Модифицированные' },
  { id: 'custom', label: 'Сборки' },
];

export function InstancesPage() {
  const instances = useStore((s) => s.instances);
  const loaded = useStore((s) => s.instancesLoaded);
  const selectedId = useStore((s) => s.selectedId);
  const select = useStore((s) => s.select);
  const openWizard = useStore((s) => s.openWizard);
  const [query, setQuery] = useState('');
  const [tab, setTab] = useState<Tab>('all');
  const [dialog, setDialog] = useState<InstanceDialog>(null);

  const counts = useMemo(() => {
    const c: Record<Tab, number> = { all: instances.length, official: 0, modded: 0, custom: 0 };
    for (const i of instances) c[i.kind] += 1;
    return c;
  }, [instances]);
  const q = query.trim().toLowerCase();
  const list = instances.filter((i) => (tab === 'all' || i.kind === tab) && (!q || `${i.name} ${i.description} ${i.mcVersion}`.toLowerCase().includes(q)));
  const selected = instances.find((i) => i.id === selectedId) ?? null;

  return (
    <div className="split">
      <section className="split__main">
        <header className="page-head">
          <div className="page-head__title">
            <Icon name="cube" size={40} />
            <div><h1>Инстансы</h1><p>Ваши игровые профили и сборки</p></div>
          </div>
          <div className="search grow">
            <Icon name="search" size={18} />
            <input className="input" type="search" placeholder="Поиск по инстансам…" aria-label="Поиск по инстансам" value={query} onChange={(e) => setQuery(e.target.value)} />
          </div>
          <ImportPackButton />
          <button className="btn btn--outline" onClick={() => openWizard()}><Icon name="plus" size={18} /> Создать инстанс</button>
        </header>

        <div className="tabs" role="tablist">
          {TABS.map((t) => (
            <button key={t.id} role="tab" aria-selected={tab === t.id} className={`tab${tab === t.id ? ' is-on' : ''}`} onClick={() => setTab(t.id)}>
              {t.label} ({counts[t.id]})
            </button>
          ))}
        </div>

        {!loaded ? (
          <Skeleton rows={4} />
        ) : instances.length === 0 ? (
          <Empty icon="cube" title="Пока нет ни одного инстанса" text="Инстанс — это отдельная копия игры со своей версией, модами и настройками. Создай первый, и лаунчер скачает всё нужное с серверов Mojang." action={<button className="btn btn--primary" onClick={() => openWizard()}><Icon name="plus" size={18} /> Создать инстанс</button>} />
        ) : list.length === 0 ? (
          <Empty icon="search" title="Ничего не найдено" text={q ? `Нет инстансов по запросу «${query}» в этой вкладке.` : 'В этой вкладке пока пусто.'} action={q ? <button className="btn" onClick={() => setQuery('')}>Сбросить поиск</button> : undefined} />
        ) : (
          <div className="icards">
            {list.map((i) => <InstanceCard key={i.id} inst={i} selected={i.id === selectedId} onSelect={() => select(i.id)} openDialog={setDialog} />)}
          </div>
        )}
      </section>

      {selected ? (
        <InstancePanel inst={selected} openDialog={setDialog} />
      ) : loaded && instances.length > 0 ? (
        <aside className="panel panel--empty"><Empty icon="cube" title="Выбери инстанс" text="Слева выбери инстанс, чтобы увидеть детали и запустить игру." /></aside>
      ) : null}

      <InstanceDialogs dialog={dialog} close={() => setDialog(null)} />
    </div>
  );
}
