import { useEffect, useState } from 'react';
import type { InstanceView, ModrinthHit, ModrinthProjectInfo, ModrinthVersionInfo } from '../../shared/types';
import { call, errMsg } from '../api';
import { useStore } from '../store';
import { Icon } from './Icon';
import { Markdown } from './Markdown';
import { Skeleton } from './ui';

const TYPE_LABEL = { release: 'Релиз', beta: 'Бета', alpha: 'Альфа' } as const;

function count(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)} млн`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(n >= 10_000 ? 0 : 1)} тыс.`;
  return String(n);
}
function size(n: number): string {
  if (n >= 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} МБ`;
  return `${Math.max(1, Math.round(n / 1024))} КБ`;
}
function date(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString('ru-RU');
}
function shortList(list: string[], max = 4): string {
  return list.length > max ? `${list.slice(0, max).join(', ')} +${list.length - max}` : list.join(', ');
}

interface Props {
  hit: ModrinthHit;
  inst: InstanceView | null;
  locked: boolean;
  vanillaMods: boolean;
  filterMc: string | null;
  filterLoader: 'fabric' | 'quilt' | 'forge' | 'neoforge' | null;
  installed: boolean;
  onChanged: () => void;
  onBack: () => void;
}

export function ModrinthProject({ hit, inst, locked, vanillaMods, filterMc, filterLoader, installed, onChanged, onBack }: Props) {
  const toast = useStore((s) => s.toast);
  const ops = useStore((s) => s.ops);
  const refreshInstances = useStore((s) => s.refreshInstances);

  const [info, setInfo] = useState<ModrinthProjectInfo | null>(null);
  const [versions, setVersions] = useState<ModrinthVersionInfo[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<'about' | 'versions'>('about');
  const [onlyCompat, setOnlyCompat] = useState(true);
  const [chosen, setChosen] = useState<string>(''); // '' = newest compatible
  const [busy, setBusy] = useState(false);

  const isPack = hit.type === 'modpack';
  const mc = !isPack && onlyCompat ? filterMc : null;
  const loader = !isPack && onlyCompat ? filterLoader : null;

  useEffect(() => {
    let alive = true;
    setInfo(null);
    call('modrinth:project', { projectId: hit.id })
      .then((p) => { if (alive) setInfo(p); })
      .catch((e) => { if (alive) setError(errMsg(e)); });
    return () => { alive = false; };
  }, [hit.id]);

  useEffect(() => {
    let alive = true;
    setVersions(null);
    setChosen('');
    call('modrinth:versions', { projectId: hit.id, mcVersion: mc, loader })
      .then((v) => { if (alive) setVersions(v); })
      .catch((e) => { if (alive) { setError(errMsg(e)); setVersions([]); } });
    return () => { alive = false; };
  }, [hit.id, mc, loader]);

  const packOp = ops[`modpack:${hit.id}`];
  const packRunning = packOp?.status === 'running';
  const working = busy || packRunning;
  const disabled = working || (!isPack && installed) || (!isPack && (!inst || locked || vanillaMods));

  const install = async (versionId: string | null) => {
    setBusy(true);
    try {
      if (isPack) {
        await call('modrinth:installPack', { projectId: hit.id, versionId });
        toast('info', `Скачиваю сборку «${hit.title}»…`);
      } else if (inst) {
        const files = await call('modrinth:install', { id: inst.id, projectId: hit.id, kind: hit.type as 'mod' | 'resourcepack', versionId });
        toast('ok', files.length > 1 ? `Установлено: ${hit.title} и зависимости (${files.length} файла)` : `Установлено: ${hit.title}`);
        void refreshInstances();
        onChanged();
      }
    } catch (e) {
      toast('error', errMsg(e));
    } finally {
      setBusy(false);
    }
  };

  const chosenVersion = versions?.find((v) => v.id === chosen) ?? null;
  const isDone = !isPack && installed;
  const label = working ? 'Установка…' : isDone ? 'Установлено' : isPack ? 'Установить сборку' : 'Установить';

  return (
    <div className="page">
      <button className="btn btn--sm mr-back" onClick={onBack}><span className="mr-back__arrow"><Icon name="chevron" size={14} /></span> К списку</button>

      <header className="mr-hero">
        {(info?.iconDataUrl ?? hit.iconDataUrl) ? <img className="mr-hero__icon" src={(info?.iconDataUrl ?? hit.iconDataUrl)!} alt="" /> : <span className="mr-hero__icon crow__icon--ph"><Icon name="puzzle" size={32} /></span>}
        <div className="grow">
          <h1>{hit.title}</h1>
          <p className="muted">{info?.description || hit.description}</p>
          <div className="mr-meta">
            <span>от {hit.author}</span>
            <span title="Скачиваний"><Icon name="download" size={13} /> {count(info?.downloads ?? hit.downloads)}</span>
            {info?.license && <span>Лицензия: {info.license}</span>}
            {info?.updated && <span>Обновлён: {date(info.updated)}</span>}
          </div>
          <div className="mr-meta">
            {(info?.categories ?? hit.categories).slice(0, 6).map((c) => <span key={c} className="badge badge--plain">{c}</span>)}
          </div>
        </div>
      </header>

      <section className="mr-install">
        <div className="grow">
          <label className="mr-install__label" htmlFor="mr-version">Версия для установки</label>
          <select id="mr-version" className="input" value={chosen} onChange={(e) => setChosen(e.target.value)} disabled={versions === null}>
            <option value="">Последняя подходящая (авто)</option>
            {(versions ?? []).map((v) => (
              <option key={v.id} value={v.id}>{v.versionNumber || v.name} · {TYPE_LABEL[v.type]} · {shortList(v.gameVersions, 2)}</option>
            ))}
          </select>
          {chosenVersion && <p className="muted mr-install__hint">{chosenVersion.fileName} · {size(chosenVersion.size)}{chosenVersion.requiredDeps > 0 ? ` · обязательных зависимостей: ${chosenVersion.requiredDeps} (поставятся сами)` : ''}</p>}
        </div>
        <button className={`btn ${isDone ? 'btn--done' : 'btn--primary'} btn--lg-static`} disabled={disabled} onClick={() => void install(chosen || null)}>{label}</button>
        <button className="btn" onClick={() => void call('modrinth:openPage', { type: hit.type, slug: hit.slug }).catch((e) => toast('error', errMsg(e)))}>Открыть на сайте</button>
      </section>

      {packRunning && <p className="muted mr-op">{packOp.label}</p>}
      {isDone && <p className="muted mr-install__hint">Уже стоит в «{inst?.name}». Чтобы поставить другую версию, сначала удали файл на вкладке «Моды» или «Ресурспаки».</p>}
      {!isPack && !inst && <p className="notice"><Icon name="alert" size={16} /> Сначала создай или выбери инстанс: файлы скачиваются в него.</p>}
      {vanillaMods && <p className="notice"><Icon name="alert" size={16} /> Это инстанс Vanilla: моды в нём не загружаются. Выбери инстанс с Fabric, Quilt, Forge или NeoForge.</p>}
      {!isPack && locked && <p className="notice"><Icon name="alert" size={16} /> {inst?.running ? 'Игра запущена: останови её, чтобы ставить файлы.' : 'Идёт установка инстанса: подожди её окончания.'}</p>}
      {error && <p className="form-error" role="alert">{error}</p>}

      <div className="tabs" role="tablist">
        <button role="tab" aria-selected={tab === 'about'} className={`tab${tab === 'about' ? ' is-on' : ''}`} onClick={() => setTab('about')}>Описание</button>
        <button role="tab" aria-selected={tab === 'versions'} className={`tab${tab === 'versions' ? ' is-on' : ''}`} onClick={() => setTab('versions')}>Версии{versions ? ` (${versions.length})` : ''}</button>
      </div>

      {tab === 'about' && (
        info === null ? <Skeleton rows={4} /> : (
          <div className="mr-about">
            {info.body.trim() ? <Markdown text={info.body} /> : <p className="muted">У проекта нет подробного описания.</p>}
            <aside className="mr-facts">
              <h3>Поддержка</h3>
              <p className="muted">Minecraft: {info.gameVersions.length ? shortList([...info.gameVersions].reverse(), 6) : '—'}</p>
              <p className="muted">Загрузчики: {info.loaders.length ? info.loaders.join(', ') : '—'}</p>
            </aside>
          </div>
        )
      )}

      {tab === 'versions' && (
        <>
          {!isPack && inst && (
            <label className="mr-check">
              <input type="checkbox" checked={onlyCompat} onChange={(e) => setOnlyCompat(e.target.checked)} />
              Только подходящие для «{inst.name}» (Minecraft {inst.mcVersion}{filterLoader ? `, ${filterLoader}` : ''})
            </label>
          )}
          {versions === null ? <Skeleton rows={4} /> : versions.length === 0 ? (
            <p className="muted">{onlyCompat && !isPack && inst ? 'Нет версий под этот инстанс. Сними фильтр, чтобы увидеть все.' : 'Версий нет.'}</p>
          ) : (
            <ul className="clist">
              {versions.map((v) => (
                <li key={v.id} className="crow mr-ver">
                  <div className="grow">
                    <strong>{v.name || v.versionNumber}</strong> <span className={`badge badge--plain mr-type mr-type--${v.type}`}>{TYPE_LABEL[v.type]}</span>
                    <div className="mr-meta">
                      <span>{v.versionNumber}</span>
                      <span>Minecraft {shortList(v.gameVersions)}</span>
                      <span>{shortList(v.loaders)}</span>
                      <span>{date(v.published)}</span>
                      <span title="Скачиваний"><Icon name="download" size={13} /> {count(v.downloads)}</span>
                      {v.size > 0 && <span>{size(v.size)}</span>}
                    </div>
                    {v.changelog.trim() && (
                      <details className="mr-log">
                        <summary>Что нового</summary>
                        <Markdown text={v.changelog} />
                      </details>
                    )}
                  </div>
                  <button className={`btn ${isDone ? 'btn--done' : 'btn--primary'}`} disabled={disabled} onClick={() => void install(v.id)}>{working ? 'Установка…' : isDone ? 'Установлено' : 'Установить'}</button>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  );
}
