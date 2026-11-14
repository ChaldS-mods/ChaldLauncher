import { useState } from 'react';
import type { ArchiveAnalysis, ArchiveApplyResult } from '../../shared/archive';
import { call, errMsg } from '../api';
import { useI18n } from '../i18n';
import { formatSize } from '../util';
import { Icon } from './Icon';
import { Modal } from './ui';

const KNOWN = new Set(['resourcepacks', 'shaderpacks', 'config', 'saves']);

/** «There is more than mods in this archive: put everything into its own folders?» */
export function ArchiveDialog({
  analysis, instanceId, onClose,
}: { analysis: ArchiveAnalysis; instanceId: string; onClose: (result: ArchiveApplyResult | null) => void }) {
  const { t } = useI18n();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const apply = async (mode: 'mods' | 'all') => {
    setBusy(true);
    setError(null);
    try {
      onClose(await call('content:applyArchive', { id: instanceId, token: analysis.token, mode }));
    } catch (e) {
      setError(errMsg(e));
      setBusy(false);
    }
  };

  const label = (dir: string) => (dir === '' ? t('archive.root') : KNOWN.has(dir) ? t(`archive.g.${dir}`) : dir);

  return (
    <Modal
      title={t('archive.title')}
      onClose={busy ? () => undefined : () => onClose(null)}
      footer={
        <>
          <button className="btn" disabled={busy} onClick={() => onClose(null)}>
            {t('action.cancel')}
          </button>
          <button className="btn" disabled={busy || analysis.mods === 0} onClick={() => void apply('mods')}>
            {t('archive.onlyMods')}
          </button>
          <button className="btn btn--primary" disabled={busy} onClick={() => void apply('all')}>
            {t('archive.all')}
          </button>
        </>
      }
    >
      <div className="stack">
        <p>{t('archive.text', { name: analysis.name })}</p>
        <ul className="clist">
          {analysis.mods > 0 && (
            <li className="crow">
              <span className="grow">
                <strong>{t('archive.mods')}</strong> <span className="muted mono">mods/</span>
              </span>
              <span className="muted">
                {t('archive.files', { n: analysis.mods })} · {formatSize(analysis.modBytes)}
              </span>
            </li>
          )}
          {analysis.groups.map((g) => (
            <li key={g.dir} className="crow">
              <span className="grow">
                <strong>{label(g.dir)}</strong> <span className="muted mono">{g.dir === '' ? './' : `${g.dir}/`}</span>
              </span>
              <span className="muted">
                {t('archive.files', { n: g.files })} · {formatSize(g.bytes)}
              </span>
            </li>
          ))}
        </ul>
        <p className="muted">
          {t('archive.noOverwrite')}
          {analysis.ignored > 0 ? ` ${t('archive.ignored', { n: analysis.ignored })}` : ''}
        </p>
        {error && (
          <p className="form-error" role="alert">
            <Icon name="alert" size={16} /> {error}
          </p>
        )}
      </div>
    </Modal>
  );
}
