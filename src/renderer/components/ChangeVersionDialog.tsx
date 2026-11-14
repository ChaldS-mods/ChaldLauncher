import { useEffect, useMemo, useState } from 'react';
import type { InstanceView, LoaderType, LoaderVersionEntry } from '../../shared/types';
import { LOADERS } from '../../shared/types';
import { changeVersionSchema } from '../../shared/schemas';
import { call, errMsg } from '../api';
import { useMcVersions } from '../hooks';
import { useI18n } from '../i18n';
import { useStore } from '../store';
import { LOADER_LABEL, loaderText } from '../util';
import { Field, Modal } from './ui';

/**
 * Moves an existing instance to another Minecraft version and/or another loader. Worlds, settings, resource packs
 * and mods stay in the instance; the new version is installed first, so a failed switch changes nothing.
 */
export function ChangeVersionDialog({ inst, onClose }: { inst: InstanceView; onClose: () => void }) {
  const { t } = useI18n();
  const { versions, loading, error: versionsError, reload } = useMcVersions();
  const [mcVersion, setMcVersion] = useState(inst.mcVersion);
  const [snapshots, setSnapshots] = useState(false);
  const [loader, setLoader] = useState<LoaderType>(inst.loader.type);
  const [loaderVersion, setLoaderVersion] = useState(inst.loader.version ?? '');
  const [loaders, setLoaders] = useState<{ list: LoaderVersionEntry[]; loading: boolean; error: string | null }>({ list: [], loading: false, error: null });
  const [backupSaves, setBackupSaves] = useState(true);
  const [disableMods, setDisableMods] = useState(false);
  const [disableTouched, setDisableTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const shown = useMemo(
    () => versions.filter((v) => v.type === 'release' || snapshots || v.id === mcVersion || v.id === inst.mcVersion),
    [versions, snapshots, mcVersion, inst.mcVersion],
  );
  const latest = useMemo(() => versions.find((v) => v.type === 'release') ?? null, [versions]);
  const timeOf = (id: string) => versions.find((v) => v.id === id)?.releaseTime ?? null;

  const mcChanged = mcVersion !== inst.mcVersion;
  const loaderChanged = loader !== inst.loader.type;
  const loaderVersionChanged = loader !== 'vanilla' && !loaderChanged && loaderVersion !== (inst.loader.version ?? '');
  const changed = mcChanged || loaderChanged || loaderVersionChanged;
  const [curTime, newTime] = [timeOf(inst.mcVersion), timeOf(mcVersion)];
  const downgrade = mcChanged && curTime !== null && newTime !== null && newTime < curTime;
  const latestIsNewer = !!latest && latest.id !== inst.mcVersion && (timeOf(inst.mcVersion) === null || latest.releaseTime > (timeOf(inst.mcVersion) ?? ''));

  // loader builds that exist for the chosen Minecraft version; the current build stays selected when it is still valid
  useEffect(() => {
    if (loader === 'vanilla' || !mcVersion) return;
    let alive = true;
    setLoaders({ list: [], loading: true, error: null });
    call('versions:loaders', { loader, mcVersion })
      .then((list) => {
        if (!alive) return;
        setLoaders({ list, loading: false, error: list.length ? null : `${LOADER_LABEL[loader]} / ${mcVersion}` });
        const keep = loader === inst.loader.type && mcVersion === inst.mcVersion ? list.find((l) => l.version === inst.loader.version) : undefined;
        setLoaderVersion((keep ?? list.find((l) => l.recommended) ?? list.find((l) => l.stable) ?? list[0])?.version ?? '');
      })
      .catch((e) => alive && setLoaders({ list: [], loading: false, error: errMsg(e) }));
    return () => {
      alive = false;
    };
  }, [loader, mcVersion, inst.loader.type, inst.loader.version, inst.mcVersion]);

  // mods built for the old version / loader will most likely not load: offer to switch them off (until the user decides)
  useEffect(() => {
    if (!disableTouched) setDisableMods(inst.modCount > 0 && (mcChanged || loaderChanged));
  }, [mcChanged, loaderChanged, inst.modCount, disableTouched]);

  const blocked = ((): string | null => {
    if (!changed) return t('changeVersion.noChange');
    if (loader !== 'vanilla') {
      if (loaders.loading) return t('common.loading');
      if (loaders.error) return loaders.error;
      if (!loaderVersion) return LOADER_LABEL[loader];
    }
    return null;
  })();

  const submit = async () => {
    const parsed = changeVersionSchema.safeParse({
      id: inst.id, mcVersion, backupSaves, disableMods,
      loader: { type: loader, version: loader === 'vanilla' ? null : loaderVersion },
    });
    if (!parsed.success) return setError(parsed.error.issues[0]?.message ?? t('common.checkFields'));
    setBusy(true);
    setError(null);
    try {
      await call('instances:changeVersion', parsed.data);
      await useStore.getState().refreshInstances();
      useStore.getState().toast('info', t('changeVersion.started', { version: mcVersion }));
      onClose();
    } catch (e) {
      setError(errMsg(e));
      setBusy(false);
    }
  };

  return (
    <Modal
      title={t('changeVersion.title')}
      wide
      onClose={busy ? () => undefined : onClose}
      footer={
        <>
          <button className="btn" disabled={busy} onClick={onClose}>{t('action.cancel')}</button>
          <button className="btn btn--primary" disabled={busy || blocked !== null} title={blocked ?? undefined} onClick={() => void submit()}>
            {t('changeVersion.apply')}
          </button>
        </>
      }
    >
      <div className="stack">
        <p className="muted">{t('changeVersion.current', { value: `Minecraft ${inst.mcVersion} · ${loaderText(inst)}` })}</p>

        <div className="form-grid">
          <Field label={t('instances.mcVersion')} error={versionsError} hint={loading ? t('common.loading') : undefined}>
            <select className="input" value={mcVersion} onChange={(e) => setMcVersion(e.target.value)} disabled={loading && !versions.length}>
              {shown.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.id}{v.id === inst.mcVersion ? ` (${t('changeVersion.currentTag')})` : ''}{v.type !== 'release' ? ` (${v.type === 'snapshot' ? t('versions.snapshot') : 'old'})` : ''}
                </option>
              ))}
            </select>
          </Field>
          <div className="field">
            <span className="field__label">{t('versions.snapshots')}</span>
            <label className="row">
              <input type="checkbox" checked={snapshots} onChange={(e) => setSnapshots(e.target.checked)} /> {t('wizard.showSnapshots')}
            </label>
            {versionsError && <button className="btn btn--sm" onClick={reload}>{t('versions.retry')}</button>}
          </div>
        </div>
        {latest && latestIsNewer && mcVersion !== latest.id && (
          <div className="row">
            <button type="button" className="btn btn--sm" onClick={() => setMcVersion(latest.id)}>
              {t('changeVersion.useLatest', { version: latest.id })}
            </button>
          </div>
        )}

        <div className="loader-grid" role="radiogroup" aria-label={t('instances.loader')}>
          {LOADERS.map((l) => (
            <button
              key={l.id}
              type="button"
              role="radio"
              aria-checked={loader === l.id}
              disabled={!l.implemented}
              className={`loader-card${loader === l.id ? ' is-on' : ''}`}
              onClick={() => setLoader(l.id)}
            >
              <strong>{l.label}</strong>
              {l.id === inst.loader.type && <small>{t('changeVersion.currentTag')}</small>}
            </button>
          ))}
        </div>
        {loader !== 'vanilla' && (
          <Field label={LOADER_LABEL[loader]} error={loaders.error} hint={loaders.loading ? t('common.loading') : undefined}>
            <select className="input" value={loaderVersion} onChange={(e) => setLoaderVersion(e.target.value)} disabled={loaders.loading || !loaders.list.length}>
              {loaders.list.map((l) => (
                <option key={l.version} value={l.version}>
                  {l.version}{l.recommended ? ' ★' : ''}{l.stable ? '' : ' β'}
                </option>
              ))}
            </select>
          </Field>
        )}

        {changed && (
          <div className="stack">
            <label className="row">
              <input type="checkbox" checked={backupSaves} onChange={(e) => setBackupSaves(e.target.checked)} /> {t('changeVersion.backupSaves')}
            </label>
            {inst.modCount > 0 && (mcChanged || loaderChanged) && (
              <label className="row">
                <input type="checkbox" checked={disableMods} onChange={(e) => { setDisableMods(e.target.checked); setDisableTouched(true); }} />
                {t('changeVersion.disableMods', { count: inst.modCount })}
              </label>
            )}
            {downgrade && <p className="notice" role="alert">{t('changeVersion.warnDowngrade')}</p>}
            {loaderChanged && inst.modCount > 0 && <p className="notice" role="alert">{t('changeVersion.warnLoader')}</p>}
            {!loaderChanged && mcChanged && inst.modCount > 0 && <p className="muted">{t('changeVersion.warnMods')}</p>}
          </div>
        )}

        {error && <p className="form-error" role="alert">{error}</p>}
      </div>
    </Modal>
  );
}
