import { useState } from 'react';
import type { InstanceKind, InstanceView } from '../../shared/types';
import { updateInstanceSchema } from '../../shared/schemas';
import { call, errMsg } from '../api';
import { useStore } from '../store';
import { COVER_COLORS, KIND_LABEL } from '../util';
import { Cover, Field, Modal } from './ui';
import { SettingsFields, draftFrom, parseDraft } from './SettingsFields';

export function CoverColors({ value, onChange }: { value: number; onChange: (n: number) => void }) {
  return (
    <div className="swatches" role="radiogroup" aria-label="Цвет обложки">
      {COVER_COLORS.map(([a, b], i) => (
        <button key={i} type="button" role="radio" aria-checked={value === i} aria-label={`Цвет ${i + 1}`} className={`swatch${value === i ? ' is-on' : ''}`} style={{ background: `linear-gradient(135deg, ${a}, ${b})` }} onClick={() => onChange(i)} />
      ))}
    </div>
  );
}

export function EditInstance({ inst, onClose }: { inst: InstanceView; onClose: () => void }) {
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
      if (updated) { await useStore.getState().refreshInstances(); useStore.getState().toast('ok', 'Обложка обновлена'); }
    } catch (e) { setError(errMsg(e)); }
  };

  const save = async () => {
    const s = parseDraft(draft);
    if (!s.ok) return setError(s.error);
    const patch = updateInstanceSchema.safeParse({ name, description, kind, coverColor, settings: s.value });
    if (!patch.success) return setError(patch.error.issues[0]?.message ?? 'Проверь поля');
    setBusy(true);
    setError(null);
    try {
      await call('instances:update', { id: inst.id, patch: patch.data });
      await useStore.getState().refreshInstances();
      useStore.getState().toast('ok', 'Изменения сохранены');
      onClose();
    } catch (e) { setError(errMsg(e)); setBusy(false); }
  };

  // The cover shown here follows the stored instance (image) or the chosen colour.
  const fresh = useStore((s) => s.instances.find((i) => i.id === inst.id)) ?? inst;
  return (
    <Modal
      title="Изменить инстанс"
      wide
      onClose={onClose}
      footer={<><button className="btn" onClick={onClose}>Отмена</button><button className="btn btn--primary" disabled={busy} onClick={() => void save()}>Сохранить</button></>}
    >
      <div className="stack">
        <div className="row">
          <Cover inst={{ coverDataUrl: fresh.coverDataUrl, coverColor }} className="cover--edit" />
          <div className="stack grow">
            <CoverColors value={coverColor} onChange={setCoverColor} />
            <div className="row">
              <button className="btn btn--sm" onClick={() => void pickCover()}>Выбрать картинку…</button>
              <span className="faint">PNG, JPG или WebP. Цвет используется, пока картинки нет.</span>
            </div>
          </div>
        </div>
        <div className="form-grid">
          <Field label="Название"><input className="input" maxLength={48} value={name} onChange={(e) => setName(e.target.value)} /></Field>
          <Field label="Тип">
            <select className="input" value={kind} onChange={(e) => setKind(e.target.value as InstanceKind)}>
              {(Object.keys(KIND_LABEL) as InstanceKind[]).map((k) => <option key={k} value={k}>{KIND_LABEL[k]}</option>)}
            </select>
          </Field>
          <div className="form-grid__wide"><Field label="Описание"><input className="input" maxLength={120} value={description} onChange={(e) => setDescription(e.target.value)} /></Field></div>
        </div>
        <h3 className="section-title">Настройки запуска</h3>
        <SettingsFields draft={draft} onChange={setDraft} />
        {error && <p className="form-error" role="alert">{error}</p>}
      </div>
    </Modal>
  );
}
