import { useEffect, useRef, useState } from 'react';
import { LAUNCHER_IDS, type ImportCandidate, type LauncherSource } from '../../shared/launchers';
import { call, errMsg } from '../api';
import { useI18n } from '../i18n';
import { useStore } from '../store';
import { Icon } from './Icon';
import { LauncherIcon } from './LauncherIcon';
import { Modal, Skeleton } from './ui';

const LOADER_NAMES: Record<string, string> = { vanilla: 'Vanilla', fabric: 'Fabric', quilt: 'Quilt', forge: 'Forge', neoforge: 'NeoForge' };

function loaderText(c: ImportCandidate): string {
  const name = LOADER_NAMES[c.loader.type] ?? c.loader.type;
  return c.loader.type === 'vanilla' ? name : `${name}${c.loader.version ? ` ${c.loader.version}` : ''}`;
}

const canImport = (c: ImportCandidate) => !c.problem;

/** Row of launcher icons (settings page). */
export function LauncherIconStrip() {
  const { t } = useI18n();
  return (
    <div className="limp-strip" aria-label={t('import.title')}>
      {LAUNCHER_IDS.map((id) => (
        <span key={id} className="limp-strip__item" title={id}>
          <LauncherIcon id={id} size={36} />
        </span>
      ))}
    </div>
  );
}

function SourceTiles({ sources, onPick }: { sources: LauncherSource[]; onPick: (s: LauncherSource) => void }) {
  const { t } = useI18n();
  return (
    <div className="limp-grid">
      {sources.map((s) => {
        const usable = s.candidates.length > 0;
        return (
          <button key={s.id} type="button" className={`limp-tile${usable ? ' is-found' : ''}`} disabled={!usable} onClick={() => onPick(s)}>
            <LauncherIcon id={s.id} size={44} />
            <span className="limp-tile__name">{s.name}</span>
            <span className="muted limp-tile__sub">
              {usable ? t('import.count', { n: s.candidates.length }) : s.found ? t('import.empty') : t('import.notFound')}
            </span>
          </button>
        );
      })}
    </div>
  );
}

/** Pick a launcher (or a folder), tick the instances, import. Nothing in the other launcher is changed. */
export function LauncherImportDialog({ onClose, initial }: { onClose: () => void; initial?: LauncherSource[] | null }) {
  const { t } = useI18n();
  const toast = useStore((s) => s.toast);
  const [sources, setSources] = useState<LauncherSource[] | null>(initial ?? null);
  const [active, setActive] = useState<LauncherSource | null>(null);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (initial) return;
    let alive = true;
    call('launchers:detect')
      .then((list) => alive && setSources(list))
      .catch((e) => {
        if (!alive) return;
        setSources([]);
        setError(errMsg(e));
      });
    return () => {
      alive = false;
    };
  }, [initial]);

  const open = (s: LauncherSource) => {
    setActive(s);
    setError(null);
    setPicked(new Set(s.candidates.filter((c) => canImport(c) && !c.imported).map((c) => c.token)));
  };

  const pickFolder = async () => {
    setError(null);
    try {
      const s = await call('launchers:pickFolder');
      if (!s) return;
      if (!s.candidates.length) {
        setError(t('import.nothingFound'));
        return;
      }
      open(s);
    } catch (e) {
      setError(errMsg(e));
    }
  };

  const toggle = (token: string) =>
    setPicked((p) => {
      const n = new Set(p);
      if (n.has(token)) n.delete(token);
      else n.add(token);
      return n;
    });

  const run = async () => {
    if (!picked.size) return;
    setBusy(true);
    setError(null);
    try {
      await call('launchers:import', { tokens: [...picked] });
      toast('info', t('import.started'));
      onClose();
    } catch (e) {
      setError(errMsg(e));
      setBusy(false);
    }
  };

  const selectable = active?.candidates.filter(canImport) ?? [];
  const allOn = selectable.length > 0 && selectable.every((c) => picked.has(c.token));

  return (
    <Modal
      wide
      title={active ? active.name : t('import.title')}
      onClose={busy ? () => undefined : onClose}
      footer={
        active ? (
          <>
            <button className="btn" disabled={busy} onClick={() => setActive(null)}>
              {t('action.back')}
            </button>
            <button className="btn btn--primary" disabled={busy || !picked.size} onClick={() => void run()}>
              {t('import.run', { n: picked.size })}
            </button>
          </>
        ) : (
          <button className="btn" onClick={onClose}>
            {t('action.close')}
          </button>
        )
      }
    >
      {!active && (
        <div className="stack">
          <p className="muted">{t('import.hint')}</p>
          {sources === null ? <Skeleton rows={3} /> : <SourceTiles sources={sources} onPick={open} />}
          <div className="row" style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
            <button className="btn btn--outline" onClick={() => void pickFolder()}>
              <Icon name="folder" size={16} /> {t('import.pickFolder')}
            </button>
            <span className="muted">{t('import.pickHint')}</span>
          </div>
        </div>
      )}

      {active && (
        <div className="stack">
          {active.path && <p className="muted mono limp-path" title={active.path}>{active.path}</p>}
          <label className="mr-check">
            <input
              type="checkbox"
              checked={allOn}
              onChange={() => setPicked(allOn ? new Set() : new Set(selectable.map((c) => c.token)))}
            />
            {t('import.selectAll')} · {t('import.selected', { n: picked.size })}
          </label>
          <ul className="clist limp-list">
            {active.candidates.map((c) => (
              <li key={c.token} className={`crow${c.problem ? ' limp-bad' : ''}`}>
                <label className="grow limp-row" style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: c.problem ? 'default' : 'pointer' }}>
                  <input type="checkbox" disabled={!!c.problem} checked={picked.has(c.token)} onChange={() => toggle(c.token)} />
                  <span className="grow" style={{ minWidth: 0 }}>
                    <strong>{c.name}</strong>
                    {c.imported && <span className="badge badge--plain" style={{ marginLeft: 8 }}>{t('import.already')}</span>}
                    <span className="muted" style={{ display: 'block' }}>
                      {c.problem
                        ? c.problem
                        : `Minecraft ${c.mcVersion} · ${loaderText(c)} · ${t('import.mods', { n: c.mods })} · ${t('import.worlds', { n: c.worlds })}`}
                    </span>
                  </span>
                </label>
              </li>
            ))}
          </ul>
          <p className="notice">
            <Icon name="alert" size={16} /> {t('import.copyNote')}
          </p>
        </div>
      )}
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
    </Modal>
  );
}

/** First start: shows the launchers found on this PC and offers the import. Shown once. */
export function LauncherImportOffer() {
  const { t } = useI18n();
  const settings = useStore((s) => s.settings);
  const saveSettings = useStore((s) => s.saveSettings);
  const [sources, setSources] = useState<LauncherSource[] | null>(null);
  const [dialog, setDialog] = useState(false);
  const [offer, setOffer] = useState(false);
  const started = useRef(false);

  const markSeen = () => void saveSettings({ launcherImportSeen: true }).catch(() => undefined);

  useEffect(() => {
    if (!settings || settings.launcherImportSeen || started.current) return;
    started.current = true;
    call('launchers:detect')
      .then((list) => {
        if (list.some((s) => s.candidates.length)) {
          setSources(list);
          setOffer(true);
        } else {
          markSeen(); // nothing to import: do not ask again, the settings page still has the button
        }
      })
      .catch(() => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings]);

  if (dialog) return <LauncherImportDialog initial={sources} onClose={() => setDialog(false)} />;
  if (!offer || !sources) return null;
  const close = () => {
    setOffer(false);
    markSeen();
  };
  return (
    <Modal
      wide
      title={t('import.offerTitle')}
      onClose={close}
      footer={
        <>
          <button className="btn" onClick={close}>
            {t('import.later')}
          </button>
          <button
            className="btn btn--primary"
            onClick={() => {
              setOffer(false);
              setDialog(true);
              markSeen();
            }}
          >
            {t('import.open')}
          </button>
        </>
      }
    >
      <div className="stack">
        <p>{t('import.offerText')}</p>
        <SourceTiles
          sources={sources}
          onPick={() => {
            setOffer(false);
            setDialog(true);
            markSeen();
          }}
        />
        <p className="muted">{t('import.offerHint')}</p>
      </div>
    </Modal>
  );
}
