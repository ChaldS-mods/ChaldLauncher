import { useEffect, useState } from 'react';
import type { CurseForgeFileInfo, CurseForgeHit, CurseForgeProjectInfo, InstanceView } from '../../shared/types';
import { call, errMsg } from '../api';
import { useI18n, localeTag } from '../i18n';
import { useStore } from '../store';
import { Icon } from './Icon';
import { Skeleton } from './ui';
import { WorldPickerModal } from './WorldPickerModal';

const TYPE_LABEL = { release: 'Release', beta: 'Beta', alpha: 'Alpha' } as const;

function count(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)} M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(n >= 10_000 ? 0 : 1)} K`;
  return String(n);
}
function size(n: number): string {
  if (n >= 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(n / 1024))} KB`;
}
function shortList(list: string[], max = 4): string {
  return list.length > max ? `${list.slice(0, max).join(', ')} +${list.length - max}` : list.join(', ');
}

/** Sanitize CF HTML: drop scripts/events and media (same idea as Modrinth Markdown — no raw images). */
function safeHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?>[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?>[\s\S]*?<\/style>/gi, '')
    .replace(/<iframe[\s\S]*?>[\s\S]*?<\/iframe>/gi, '')
    .replace(/<object[\s\S]*?>[\s\S]*?<\/object>/gi, '')
    .replace(/<embed[\s\S]*?>/gi, '')
    .replace(/<video[\s\S]*?>[\s\S]*?<\/video>/gi, '')
    .replace(/<img\b[^>]*>/gi, '')
    .replace(/\son\w+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '')
    .replace(/javascript:/gi, '')
    .replace(/<\/?html[^>]*>/gi, '')
    .replace(/<\/?body[^>]*>/gi, '');
}

interface Props {
  hit: CurseForgeHit;
  inst: InstanceView | null;
  locked: boolean;
  vanillaMods: boolean;
  filterMc: string | null;
  filterLoader: 'fabric' | 'quilt' | 'forge' | 'neoforge' | null;
  installed: boolean;
  onChanged: () => void;
  onBack: () => void;
}

export function CurseForgeProject({
  hit,
  inst,
  locked,
  vanillaMods,
  filterMc,
  filterLoader,
  installed,
  onChanged,
  onBack,
}: Props) {
  const { t, language } = useI18n();
  const toast = useStore((s) => s.toast);
  const refreshInstances = useStore((s) => s.refreshInstances);

  const [info, setInfo] = useState<CurseForgeProjectInfo | null>(null);
  const [files, setFiles] = useState<CurseForgeFileInfo[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<'about' | 'versions'>('about');
  const [onlyCompat, setOnlyCompat] = useState(true);
  const [chosen, setChosen] = useState<string>('');
  const [busy, setBusy] = useState(false);
  const [worldFor, setWorldFor] = useState<{ fileId: number | null } | null>(null);

  const isPack = hit.type === 'modpack';
  const isDatapack = hit.type === 'datapack';
  const mc = !isPack && onlyCompat ? filterMc : null;
  const loader = hit.type === 'mod' && onlyCompat ? filterLoader : null;

  const date = (iso: string): string => {
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString(localeTag(language));
  };

  useEffect(() => {
    let alive = true;
    setInfo(null);
    call('curseforge:project', { modId: hit.id })
      .then((p) => {
        if (alive) setInfo(p);
      })
      .catch((e) => {
        if (alive) setError(errMsg(e));
      });
    return () => {
      alive = false;
    };
  }, [hit.id]);

  useEffect(() => {
    let alive = true;
    setFiles(null);
    setChosen('');
    call('curseforge:files', { modId: hit.id, mcVersion: mc, loader })
      .then((list) => {
        if (!alive) return;
        setFiles(list);
      })
      .catch((e) => {
        if (alive) setError(errMsg(e));
      });
    return () => {
      alive = false;
    };
  }, [hit.id, mc, loader]);

  const working = busy;
  const disabled = working || (!isPack && installed) || (!isPack && (!inst || locked || (hit.type === 'mod' && vanillaMods)));

  const install = async (fileId: number | null, worldName: string | null = null) => {
    if (isPack) {
      void call('curseforge:openPage', { slug: hit.slug });
      toast('info', 'Сборки CurseForge открываются на сайте');
      return;
    }
    if (!inst) {
      toast('error', t('content.selectFirst'));
      return;
    }
    if (isDatapack && !worldName) {
      setWorldFor({ fileId });
      return;
    }
    setBusy(true);
    try {
      await call('curseforge:install', {
        id: inst.id,
        modId: hit.id,
        kind: hit.type as 'mod' | 'resourcepack' | 'shader' | 'datapack',
        fileId,
        worldName: isDatapack ? worldName : null,
      });
      toast('ok', hit.title);
      void refreshInstances();
      onChanged();
    } catch (e) {
      toast('error', errMsg(e));
    } finally {
      setBusy(false);
    }
  };

  const chosenFile = files?.find((f) => String(f.id) === chosen) ?? null;
  const isDone = !isPack && installed;
  const label = working
    ? t('state.installing')
    : isDone
      ? t('modrinth.installed')
      : t('modrinth.install');

  return (
    <div className="page">
      <button className="btn btn--sm mr-back" onClick={onBack}>
        <span className="mr-back__arrow">
          <Icon name="chevron" size={14} />
        </span>{' '}
        {t('action.back')}
      </button>

      <header className="mr-hero">
        {info?.iconDataUrl ?? hit.iconDataUrl ? (
          <img className="mr-hero__icon" src={(info?.iconDataUrl ?? hit.iconDataUrl)!} alt="" />
        ) : (
          <span className="mr-hero__icon crow__icon--ph">
            <Icon name="puzzle" size={32} />
          </span>
        )}
        <div className="grow">
          <h1>{hit.title}</h1>
          <p className="muted mr-desc--unicode">{info?.description || hit.description}</p>
          <div className="mr-meta">
            <span>by {info?.author || hit.author}</span>
            <span title="downloads">
              <Icon name="download" size={13} /> {count(info?.downloads ?? hit.downloads)}
            </span>
            {info?.updated && <span>{date(info.updated)}</span>}
            <span className="badge badge--plain">CF</span>
          </div>
        </div>
        <button
          className="btn"
          onClick={() => void call('curseforge:openPage', { slug: hit.slug }).catch((e) => toast('error', errMsg(e)))}
        >
          {t('modrinth.openSite')}
        </button>
      </header>

      <section className="mr-install">
        <div className="row row--wrap">
          <label className="mr-install__label" htmlFor="cf-version">
            {t('modrinth.versions')}
          </label>
          <select
            id="cf-version"
            className="input input--auto"
            value={chosen}
            onChange={(e) => setChosen(e.target.value)}
            disabled={!files || files.length === 0}
          >
            <option value="">{files === null ? t('common.loading') : 'Auto'}</option>
            {(files ?? []).map((f) => (
              <option key={f.id} value={String(f.id)}>
                {f.displayName} · {shortList(f.gameVersions, 2)} · {TYPE_LABEL[f.releaseType]}
              </option>
            ))}
          </select>
          <button
            className={`btn ${isDone ? 'btn--done' : 'btn--primary'}`}
            disabled={disabled}
            onClick={() => void install(chosen ? Number(chosen) : null)}
          >
            {label}
          </button>
        </div>
        {chosenFile && (
          <p className="muted mr-install__hint">
            {chosenFile.fileName} · {size(chosenFile.size)}
          </p>
        )}
        {isDone && inst && <p className="muted mr-install__hint">✓ {inst.name}</p>}
        {!isPack && !inst && (
          <p className="notice">
            <Icon name="alert" size={16} /> {t('content.selectFirst')}
          </p>
        )}
        {hit.type === 'mod' && vanillaMods && (
          <p className="notice">
            <Icon name="alert" size={16} /> Vanilla
          </p>
        )}
        {isDatapack && (
          <p className="muted mr-install__hint">Датапак ставится в выбранный мир — при установке спросим, в какой.</p>
        )}
        {!isPack && inst && (
          <label className="mr-check" style={{ marginTop: 8 }}>
            <input type="checkbox" checked={onlyCompat} onChange={(e) => setOnlyCompat(e.target.checked)} />
            {inst.name} · Minecraft {inst.mcVersion}
            {filterLoader ? `, ${filterLoader}` : ''}
          </label>
        )}
      </section>

      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}

      <div className="tabs" role="tablist" style={{ marginTop: 12 }}>
        <button role="tab" aria-selected={tab === 'about'} className={`tab${tab === 'about' ? ' is-on' : ''}`} onClick={() => setTab('about')}>
          {t('modrinth.about') || 'Описание'}
        </button>
        <button role="tab" aria-selected={tab === 'versions'} className={`tab${tab === 'versions' ? ' is-on' : ''}`} onClick={() => setTab('versions')}>
          {t('modrinth.versions')}
        </button>
      </div>

      {tab === 'about' &&
        (info === null ? (
          <Skeleton rows={4} />
        ) : (
          <div className="mr-about">
            {info.bodyHtml.trim() ? (
              <div className="md" dangerouslySetInnerHTML={{ __html: safeHtml(info.bodyHtml) }} />
            ) : (
              <p className="muted">{info.description || hit.description || t('modrinth.noDesc')}</p>
            )}
            <aside className="mr-facts">
              <h3>{t('settings.support') || t('modrinth.support') || 'Поддержка'}</h3>
              <p className="muted">
                Minecraft: {info.gameVersions.length ? shortList([...info.gameVersions].reverse(), 6) : '—'}
              </p>
              <p className="muted">Loaders: {info.loaders.length ? info.loaders.join(', ') : '—'}</p>
            </aside>
          </div>
        ))}

      {tab === 'versions' && (
        <ul className="clist">
          {files === null && <Skeleton rows={5} />}
          {files && files.length === 0 && <p className="muted">{t('modrinth.none')}</p>}
          {(files ?? []).map((f) => (
            <li key={f.id} className="crow">
              <div className="grow">
                <strong>{f.displayName}</strong>
                <p className="muted">
                  {TYPE_LABEL[f.releaseType]} · {shortList(f.gameVersions, 4)} · {date(f.published)} · {size(f.size)}
                </p>
              </div>
              <button
                className="btn btn--primary btn--sm"
                disabled={disabled || isPack}
                onClick={() => void install(f.id)}
              >
                {t('modrinth.install')}
              </button>
            </li>
          ))}
        </ul>
      )}

      {worldFor && inst && (
        <WorldPickerModal
          title={hit.title}
          instanceId={inst.id}
          onClose={() => setWorldFor(null)}
          onConfirm={(world) => {
            const f = worldFor.fileId;
            setWorldFor(null);
            void install(f, world);
          }}
        />
      )}
    </div>
  );
}
