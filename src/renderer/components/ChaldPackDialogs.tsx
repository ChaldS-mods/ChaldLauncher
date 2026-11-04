import { useState } from 'react';
import type { ChaldPackExportResult, ChaldPackSummary, InstanceView } from '../../shared/types';
import { call, errMsg } from '../api';
import { useI18n } from '../i18n';
import { useStore } from '../store';
import { formatSize } from '../util';
import { Icon } from './Icon';
import { Modal, ProgressBar, Switch } from './ui';

export function ExportDialog({ inst, onClose }: { inst: InstanceView; onClose: () => void }) {
  const toast = useStore((s) => s.toast);
  const { t } = useI18n();
  const [worlds, setWorlds] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<(ChaldPackExportResult & { file: string }) | null>(null);
  const op = useStore((s) => s.ops[`export:${inst.id}`]);

  const run = async () => {
    setBusy(true);
    setError(null);
    try {
      const r = await call('chaldpack:export', { id: inst.id, includeWorlds: worlds });
      if (!r) {
        setBusy(false);
        return;
      }
      setDone(r);
      toast('ok', inst.name);
    } catch (e) {
      setError(errMsg(e));
    }
    setBusy(false);
  };

  return (
    <Modal
      title={t('pack.exportTitle')}
      onClose={busy ? () => undefined : onClose}
      footer={
        done ? (
          <button className="btn btn--primary" onClick={onClose}>{t('action.done')}</button>
        ) : (
          <>
            <button className="btn" onClick={onClose} disabled={busy}>{t('action.cancel')}</button>
            <button className="btn btn--primary" disabled={busy || (inst.running && worlds)} onClick={() => void run()}>
              {busy ? '…' : t('action.export')}
            </button>
          </>
        )
      }
    >
      {done ? (
        <>
          <p>
            {t('pack.fileSaved')}
            <strong>{done.file}</strong>
          </p>
          <p className="muted">Modrinth: {done.downloads}</p>
          {done.identified > 0 && <p className="muted">{t('pack.identified', { n: done.identified })}</p>}
          <p className="muted">
            {done.bundledFiles} ({formatSize(done.bundledBytes)})
          </p>
          {done.notices.length > 0 && (
            <details className="mr-log">
              <summary>{done.notices.length}</summary>
              <ul>
                {done.notices.slice(0, 50).map((n) => (
                  <li key={n} className="muted">
                    {n}
                  </li>
                ))}
              </ul>
            </details>
          )}
        </>
      ) : (
        <>
          <p>
            <strong>«{inst.name}»</strong> → <code>.chaldlauncher</code>
          </p>
          <p className="muted">{t('pack.notIncluded')}</p>
          {busy && (
            <div style={{ marginTop: 16 }} aria-live="polite">
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, marginBottom: 6 }}>
                <span
                  title={op?.label}
                  style={{ minWidth: 0, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: 'var(--cyan)' }}
                >
                  {op?.label ?? '…'}
                </span>
                {op?.fraction != null && <span className="muted">{Math.round(op.fraction * 100)}%</span>}
              </div>
              <ProgressBar fraction={op?.fraction ?? null} />
            </div>
          )}
          <div className="row" style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 12 }}>
            <Switch checked={worlds} onChange={setWorlds} label={t('pack.includeWorlds')} disabled={busy} />
            <span>{t('pack.includeWorlds')}</span>
          </div>
          {inst.running && worlds && <p className="form-error">{t('pack.stopToExportWorlds')}</p>}
          {error && (
            <p className="form-error" role="alert">
              {error}
            </p>
          )}
        </>
      )}
    </Modal>
  );
}

export function ImportPackButton() {
  const toast = useStore((s) => s.toast);
  const { t } = useI18n();
  const [picked, setPicked] = useState<{ token: string; summary: ChaldPackSummary } | null>(null);
  const [busy, setBusy] = useState(false);

  const pick = async () => {
    setBusy(true);
    try {
      const r = await call('chaldpack:inspect');
      if (r) setPicked(r);
    } catch (e) {
      toast('error', errMsg(e));
    }
    setBusy(false);
  };
  const confirm = async () => {
    if (!picked) return;
    setBusy(true);
    try {
      await call('chaldpack:import', { token: picked.token });
      toast('info', picked.summary.name);
      setPicked(null);
    } catch (e) {
      toast('error', errMsg(e));
    }
    setBusy(false);
  };

  const s = picked?.summary;
  return (
    <>
      <button className="btn btn--outline" disabled={busy} onClick={() => void pick()}>
        <Icon name="download" size={18} /> {t('action.import')}
      </button>
      {picked && s && (
        <Modal
          title={t('pack.importTitle')}
          onClose={() => setPicked(null)}
          footer={
            <>
              <button className="btn" onClick={() => setPicked(null)}>{t('action.cancel')}</button>
              <button className="btn btn--primary" disabled={busy} onClick={() => void confirm()}>
                {t('pack.import')}
              </button>
            </>
          }
        >
          <p>
            <strong>«{s.name}»</strong>
            {s.description ? <span className="muted"> · {s.description}</span> : null}
          </p>
          <p className="muted">
            Minecraft {s.mcVersion} ·{' '}
            {s.loader.type === 'vanilla' ? 'Vanilla' : `${s.loader.type} ${s.loader.version}`}
          </p>
          <p className="muted">{t('pack.downloads', { n: s.downloads })}</p>
          <p className="muted">{t('pack.overrides', { n: s.overrideFiles, size: formatSize(s.overrideBytes) })}</p>
          <p className="notice">
            <Icon name="alert" size={16} /> {t('pack.importWarn')}
          </p>
        </Modal>
      )}
    </>
  );
}
