import { useState } from 'react';
import type { InstanceKind, InstanceView } from '../../shared/types';
import { updateInstanceSchema } from '../../shared/schemas';
import { call, errMsg } from '../api';
import { useI18n } from '../i18n';
import { useStore } from '../store';
import { COVER_COLORS, kindLabel } from '../util';
import { Cover, Field, Modal } from './ui';
import { SettingsFields, draftFrom, parseDraft } from './SettingsFields';

export function CoverColors({ value, onChange }: { value: number; onChange: (n: number) => void }) {
  const { t } = useI18n();
  return (
    <div className="swatches" role="radiogroup" aria-label={t('instances.color')}>
      {COVER_COLORS.map(([a, b], i) => (
        <button
          key={i}
          type="button"
          role="radio"
          aria-checked={value === i}
          aria-label={`${t('instances.color')} ${i + 1}`}
          className={`swatch${value === i ? ' is-on' : ''}`}
          style={{ background: `linear-gradient(135deg, ${a}, ${b})` }}
          onClick={() => onChange(i)}
        />
      ))}
    </div>
  );
}

export function EditInstance({ inst, onClose }: { inst: InstanceView; onClose: () => void }) {
  const { t } = useI18n();
  const [name, setName] = useState(inst.name);
  const [description, setDescription] = useState(inst.description);
  const [kind, setKind] = useState<InstanceKind>(inst.kind);
  const [coverColor, setCoverColor] = useState(inst.coverColor);
  const [draft, setDraft] = useState(draftFrom(inst.settings));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const pickCover = async () => {
    try {
      const updated = await call('instances:setCover', { id: inst.id });
      if (updated) {
        await useStore.getState().refreshInstances();
        useStore.getState().toast('ok', t('instances.coverUpdated'));
      }
    } catch (e) {
      setError(errMsg(e));
    }
  };

  const save = async () => {
    const s = parseDraft(draft);
    if (!s.ok) return setError(s.error);
    const patch = updateInstanceSchema.safeParse({ name, description, kind, coverColor, settings: s.value });
    if (!patch.success) return setError(patch.error.issues[0]?.message ?? t('common.checkFields'));
    setBusy(true);
    setError(null);
    try {
      await call('instances:update', { id: inst.id, patch: patch.data });
      await useStore.getState().refreshInstances();
      useStore.getState().toast('ok', t('common.saved'));
      onClose();
    } catch (e) {
      setError(errMsg(e));
      setBusy(false);
    }
  };

  const fresh = useStore((s) => s.instances.find((i) => i.id === inst.id)) ?? inst;
  const kinds: InstanceKind[] = ['official', 'modded', 'custom'];
  return (
    <Modal
      title={t('instances.edit')}
      wide
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>{t('action.cancel')}</button>
          <button className="btn btn--primary" disabled={busy} onClick={() => void save()}>{t('action.save')}</button>
        </>
      }
    >
      <div className="stack">
        <div className="row">
          <Cover inst={{ coverDataUrl: fresh.coverDataUrl, coverColor }} className="cover--edit" />
          <div className="stack grow">
            <CoverColors value={coverColor} onChange={setCoverColor} />
            <div className="row">
              <button className="btn btn--sm" onClick={() => void pickCover()}>{t('instances.pickCover')}</button>
              <span className="faint">PNG, JPG, WebP</span>
            </div>
          </div>
        </div>
        <div className="form-grid">
          <Field label={t('instances.name')}>
            <input className="input" maxLength={48} value={name} onChange={(e) => setName(e.target.value)} />
          </Field>
          <Field label={t('wizard.type')}>
            <select className="input" value={kind} onChange={(e) => setKind(e.target.value as InstanceKind)}>
              {kinds.map((k) => (
                <option key={k} value={k}>{kindLabel(k, t)}</option>
              ))}
            </select>
          </Field>
          <div className="form-grid__wide">
            <Field label={t('instances.description')}>
              <input className="input" maxLength={120} value={description} onChange={(e) => setDescription(e.target.value)} />
            </Field>
          </div>
        </div>
        <h3 className="section-title">{t('instances.launchSettings')}</h3>
        <SettingsFields draft={draft} onChange={setDraft} memory={{ modCount: inst.modCount, loader: inst.loader.type }} />
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
      </div>
    </Modal>
  );
}
