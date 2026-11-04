import { useEffect, useMemo, useState } from 'react';
import type { InstanceKind, LoaderType, LoaderVersionEntry } from '../../shared/types';
import { LOADERS } from '../../shared/types';
import { createInstanceSchema } from '../../shared/schemas';
import { call, errMsg } from '../api';
import { useMcVersions } from '../hooks';
import { useI18n } from '../i18n';
import { useStore } from '../store';
import { LOADER_LABEL, kindLabel } from '../util';
import { CoverColors } from './EditInstance';
import { Icon } from './Icon';
import { EMPTY_DRAFT, SettingsFields, parseDraft } from './SettingsFields';
import { Field, Modal } from './ui';

export function CreateWizard() {
  const preset = useStore((s) => s.wizard.mcVersion);
  const close = useStore((s) => s.closeWizard);
  const { versions, loading, error: versionsError, reload } = useMcVersions();
  const { t } = useI18n();

  const STEPS = [t('wizard.stepName'), t('wizard.stepVersion'), t('wizard.stepSettings'), t('wizard.stepConfirm')];
  const LOADER_NOTE: Record<LoaderType, string> = {
    vanilla: 'Vanilla',
    fabric: 'Fabric',
    quilt: 'Quilt',
    forge: 'Forge',
    neoforge: 'NeoForge',
  };

  const [step, setStep] = useState(0);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [kind, setKind] = useState<InstanceKind>('official');
  const [kindTouched, setKindTouched] = useState(false);
  const [coverColor, setCoverColor] = useState(0);
  const [mcVersion, setMcVersion] = useState(preset ?? '');
  const [snapshots, setSnapshots] = useState(false);
  const [loader, setLoader] = useState<LoaderType>('vanilla');
  const [loaderVersion, setLoaderVersion] = useState('');
  const [loaders, setLoaders] = useState<{ list: LoaderVersionEntry[]; loading: boolean; error: string | null }>({
    list: [],
    loading: false,
    error: null,
  });
  const [draft, setDraft] = useState(EMPTY_DRAFT);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const shown = useMemo(
    () => versions.filter((v) => v.type === 'release' || snapshots || v.id === mcVersion),
    [versions, snapshots, mcVersion],
  );
  useEffect(() => {
    if (preset && versions.find((v) => v.id === preset && v.type !== 'release')) setSnapshots(true);
  }, [preset, versions]);
  useEffect(() => {
    if (!mcVersion && versions.length) setMcVersion(versions.find((v) => v.type === 'release')?.id ?? versions[0]!.id);
  }, [versions, mcVersion]);

  useEffect(() => {
    if (loader === 'vanilla' || !mcVersion) return;
    let alive = true;
    const title = LOADER_LABEL[loader];
    setLoaders({ list: [], loading: true, error: null });
    setLoaderVersion('');
    call('versions:loaders', { loader, mcVersion })
      .then((list) => {
        if (!alive) return;
        setLoaders({ list, loading: false, error: list.length ? null : `${title} / ${mcVersion}` });
        setLoaderVersion((list.find((l) => l.recommended) ?? list.find((l) => l.stable) ?? list[0])?.version ?? '');
      })
      .catch((e) => alive && setLoaders({ list: [], loading: false, error: errMsg(e) }));
    return () => {
      alive = false;
    };
  }, [loader, mcVersion]);

  const pickLoader = (l: LoaderType) => {
    setLoader(l);
    if (!kindTouched) setKind(l === 'vanilla' ? 'official' : 'modded');
  };

  const stepError = (s: number): string | null => {
    if (s === 0) {
      if (!name.trim()) return t('instances.name');
      if (!mcVersion) return t('instances.mcVersion');
    }
    if (s === 1 && loader !== 'vanilla') {
      if (loaders.loading) return t('common.loading');
      if (loaders.error) return loaders.error;
      if (!loaderVersion) return LOADER_LABEL[loader];
    }
    if (s === 2) {
      const p = parseDraft(draft);
      if (!p.ok) return p.error;
    }
    return null;
  };

  const next = () => {
    const e = stepError(step);
    setError(e);
    if (!e) setStep(step + 1);
  };

  const submit = async () => {
    const s = parseDraft(draft);
    if (!s.ok) return setError(s.error);
    const parsed = createInstanceSchema.safeParse({
      name,
      description,
      mcVersion,
      kind,
      coverColor,
      settings: s.value,
      loader: { type: loader, version: loader === 'vanilla' ? null : loaderVersion },
    });
    if (!parsed.success) return setError(parsed.error.issues[0]?.message ?? t('common.checkFields'));
    setBusy(true);
    setError(null);
    try {
      const inst = await call('instances:create', parsed.data);
      await useStore.getState().refreshInstances();
      useStore.getState().select(inst.id);
      useStore.getState().closeWizard();
      await useStore.getState().install(inst.id);
    } catch (e) {
      setError(errMsg(e));
      setBusy(false);
    }
  };

  const last = step === STEPS.length - 1;
  const kinds: InstanceKind[] = ['official', 'modded', 'custom'];
  return (
    <Modal
      title={t('wizard.title')}
      wide
      onClose={busy ? () => undefined : close}
      footer={
        <>
          {step > 0 && (
            <button
              className="btn"
              disabled={busy}
              onClick={() => {
                setError(null);
                setStep(step - 1);
              }}
            >
              {t('action.back')}
            </button>
          )}
          <button className="btn" disabled={busy} onClick={close}>
            {t('action.cancel')}
          </button>
          {last ? (
            <button className="btn btn--primary" disabled={busy} onClick={() => void submit()}>
              {busy ? t('common.loading') : t('action.create')}
            </button>
          ) : (
            <button className="btn btn--primary" onClick={next}>
              {t('action.next')}
            </button>
          )}
        </>
      }
    >
      <ol className="steps" aria-label={t('wizard.title')}>
        {STEPS.map((label, i) => (
          <li key={label} className={i === step ? 'is-on' : i < step ? 'is-done' : ''} aria-current={i === step ? 'step' : undefined}>
            <span>{i < step ? <Icon name="check" size={14} /> : i + 1}</span>
            {label}
          </li>
        ))}
      </ol>

      {step === 0 && (
        <div className="stack">
          <div className="form-grid">
            <Field label={t('instances.name')}>
              <input className="input" autoFocus maxLength={48} value={name} onChange={(e) => setName(e.target.value)} placeholder={t('wizard.namePlaceholder')} />
            </Field>
            <Field label={t('wizard.type')}>
              <select
                className="input"
                value={kind}
                onChange={(e) => {
                  setKind(e.target.value as InstanceKind);
                  setKindTouched(true);
                }}
              >
                {kinds.map((k) => (
                  <option key={k} value={k}>
                    {kindLabel(k, t)}
                  </option>
                ))}
              </select>
            </Field>
            <div className="form-grid__wide">
              <Field label={t('instances.description')} hint={t('instances.optional')}>
                <input className="input" maxLength={120} value={description} onChange={(e) => setDescription(e.target.value)} />
              </Field>
            </div>
            <Field label={t('instances.mcVersion')} error={versionsError} hint={loading ? t('common.loading') : undefined}>
              <select className="input" value={mcVersion} onChange={(e) => setMcVersion(e.target.value)} disabled={loading && !versions.length}>
                {shown.map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.id}
                    {v.type !== 'release' ? ` (${v.type === 'snapshot' ? t('versions.snapshot') : 'old'})` : ''}
                  </option>
                ))}
              </select>
            </Field>
            <div className="field">
              <span className="field__label">{t('versions.snapshots')}</span>
              <label className="row">
                <input type="checkbox" checked={snapshots} onChange={(e) => setSnapshots(e.target.checked)} /> {t('wizard.showSnapshots')}
              </label>
              {versionsError && (
                <button className="btn btn--sm" onClick={reload}>
                  {t('versions.retry')}
                </button>
              )}
            </div>
          </div>
          <Field label={t('instances.cover')}>
            <CoverColors value={coverColor} onChange={setCoverColor} />
          </Field>
        </div>
      )}

      {step === 1 && (
        <div className="stack">
          <div className="loader-grid" role="radiogroup" aria-label={t('instances.loader')}>
            {LOADERS.map((l) => (
              <button
                key={l.id}
                type="button"
                role="radio"
                aria-checked={loader === l.id}
                disabled={!l.implemented}
                className={`loader-card${loader === l.id ? ' is-on' : ''}`}
                onClick={() => pickLoader(l.id)}
              >
                <strong>{l.label}</strong>
                <small>{LOADER_NOTE[l.id]}</small>
                {!l.implemented && <span className="badge badge--warn">…</span>}
              </button>
            ))}
          </div>
          {loader !== 'vanilla' && (
            <Field label={LOADER_LABEL[loader]} error={loaders.error} hint={loaders.loading ? t('common.loading') : undefined}>
              <select
                className="input"
                value={loaderVersion}
                onChange={(e) => setLoaderVersion(e.target.value)}
                disabled={loaders.loading || !loaders.list.length}
              >
                {loaders.list.map((l) => (
                  <option key={l.version} value={l.version}>
                    {l.version}
                    {l.recommended ? ' ★' : ''}
                    {l.stable ? '' : ' β'}
                  </option>
                ))}
              </select>
            </Field>
          )}
        </div>
      )}

      {step === 2 && (
        <div className="stack">
          <p className="muted">{t('wizard.emptyHint')}</p>
          <SettingsFields draft={draft} onChange={setDraft} memory={{ modCount: 0, loader }} />
        </div>
      )}

      {step === 3 && (
        <div className="stack">
          <dl className="summary">
            <dt>{t('instances.name')}</dt>
            <dd>{name.trim()}</dd>
            <dt>{t('wizard.type')}</dt>
            <dd>{kindLabel(kind, t)}</dd>
            <dt>Minecraft</dt>
            <dd>{mcVersion}</dd>
            <dt>{t('instances.loader')}</dt>
            <dd>
              {LOADER_LABEL[loader]}
              {loader !== 'vanilla' && loaderVersion ? ` ${loaderVersion}` : ''}
            </dd>
          </dl>
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
