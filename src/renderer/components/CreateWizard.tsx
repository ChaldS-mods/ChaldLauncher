import { useEffect, useMemo, useState } from 'react';
import type { InstanceKind, LoaderType, LoaderVersionEntry } from '../../shared/types';
import { LOADERS } from '../../shared/types';
import { createInstanceSchema } from '../../shared/schemas';
import { call, errMsg } from '../api';
import { useMcVersions } from '../hooks';
import { useStore } from '../store';
import { KIND_LABEL, LOADER_LABEL } from '../util';
import { CoverColors } from './EditInstance';
import { Icon } from './Icon';
import { EMPTY_DRAFT, SettingsFields, parseDraft } from './SettingsFields';
import { Field, Modal } from './ui';

const STEPS = ['Основное', 'Загрузчик', 'Параметры', 'Подтверждение'];
const LOADER_NOTE: Record<LoaderType, string> = {
  vanilla: 'Чистая игра без модов',
  fabric: 'Лёгкий загрузчик модов',
  quilt: 'Форк Fabric, совместим с его модами',
  forge: 'Классический загрузчик (1.13+)',
  neoforge: 'Современный преемник Forge',
};

export function CreateWizard() {
  const preset = useStore((s) => s.wizard.mcVersion);
  const close = useStore((s) => s.closeWizard);
  const { versions, loading, error: versionsError, reload } = useMcVersions();

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
  const [loaders, setLoaders] = useState<{ list: LoaderVersionEntry[]; loading: boolean; error: string | null }>({ list: [], loading: false, error: null });
  const [draft, setDraft] = useState(EMPTY_DRAFT);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const shown = useMemo(() => versions.filter((v) => v.type === 'release' || snapshots || v.id === mcVersion), [versions, snapshots, mcVersion]);
  // a preset can be a snapshot: show snapshots so the choice is visible
  useEffect(() => { if (preset && versions.find((v) => v.id === preset && v.type !== 'release')) setSnapshots(true); }, [preset, versions]);
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
        setLoaders({ list, loading: false, error: list.length ? null : `Для Minecraft ${mcVersion} нет версий ${title}` });
        setLoaderVersion((list.find((l) => l.recommended) ?? list.find((l) => l.stable) ?? list[0])?.version ?? '');
      })
      .catch((e) => alive && setLoaders({ list: [], loading: false, error: errMsg(e) }));
    return () => { alive = false; };
  }, [loader, mcVersion]);

  const pickLoader = (l: LoaderType) => {
    setLoader(l);
    if (!kindTouched) setKind(l === 'vanilla' ? 'official' : 'modded');
  };

  const stepError = (s: number): string | null => {
    if (s === 0) {
      if (!name.trim()) return 'Введи название инстанса';
      if (!mcVersion) return 'Выбери версию Minecraft';
    }
    if (s === 1 && loader !== 'vanilla') {
      if (loaders.loading) return `Подожди, загружается список версий ${LOADER_LABEL[loader]}`;
      if (loaders.error) return loaders.error;
      if (!loaderVersion) return `Выбери версию ${LOADER_LABEL[loader]}`;
    }
    if (s === 2) { const p = parseDraft(draft); if (!p.ok) return p.error; }
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
      name, description, mcVersion, kind, coverColor, settings: s.value,
      loader: { type: loader, version: loader === 'vanilla' ? null : loaderVersion },
    });
    if (!parsed.success) return setError(parsed.error.issues[0]?.message ?? 'Проверь поля');
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
  return (
    <Modal
      title="Создать инстанс"
      wide
      onClose={busy ? () => undefined : close}
      footer={
        <>
          {step > 0 && <button className="btn" disabled={busy} onClick={() => { setError(null); setStep(step - 1); }}>Назад</button>}
          <button className="btn" disabled={busy} onClick={close}>Отмена</button>
          {last
            ? <button className="btn btn--primary" disabled={busy} onClick={() => void submit()}>{busy ? 'Создаём…' : 'Создать и установить'}</button>
            : <button className="btn btn--primary" onClick={next}>Далее</button>}
        </>
      }
    >
      <ol className="steps" aria-label="Шаги">
        {STEPS.map((t, i) => (
          <li key={t} className={i === step ? 'is-on' : i < step ? 'is-done' : ''} aria-current={i === step ? 'step' : undefined}>
            <span>{i < step ? <Icon name="check" size={14} /> : i + 1}</span>{t}
          </li>
        ))}
      </ol>

      {step === 0 && (
        <div className="stack">
          <div className="form-grid">
            <Field label="Название"><input className="input" autoFocus maxLength={48} value={name} onChange={(e) => setName(e.target.value)} placeholder="Мой инстанс" /></Field>
            <Field label="Тип">
              <select className="input" value={kind} onChange={(e) => { setKind(e.target.value as InstanceKind); setKindTouched(true); }}>
                {(Object.keys(KIND_LABEL) as InstanceKind[]).map((k) => <option key={k} value={k}>{KIND_LABEL[k]}</option>)}
              </select>
            </Field>
            <div className="form-grid__wide"><Field label="Описание" hint="Необязательно"><input className="input" maxLength={120} value={description} onChange={(e) => setDescription(e.target.value)} /></Field></div>
            <Field label="Версия Minecraft" error={versionsError} hint={loading ? 'Загружаем список версий…' : undefined}>
              <select className="input" value={mcVersion} onChange={(e) => setMcVersion(e.target.value)} disabled={loading && !versions.length}>
                {shown.map((v) => <option key={v.id} value={v.id}>{v.id}{v.type !== 'release' ? ` (${v.type === 'snapshot' ? 'снапшот' : 'старая'})` : ''}</option>)}
              </select>
            </Field>
            <div className="field">
              <span className="field__label">Снапшоты</span>
              <label className="row"><input type="checkbox" checked={snapshots} onChange={(e) => setSnapshots(e.target.checked)} /> Показывать снапшоты</label>
              {versionsError && <button className="btn btn--sm" onClick={reload}>Повторить загрузку</button>}
            </div>
          </div>
          <Field label="Обложка"><CoverColors value={coverColor} onChange={setCoverColor} /></Field>
        </div>
      )}

      {step === 1 && (
        <div className="stack">
          <div className="loader-grid" role="radiogroup" aria-label="Загрузчик">
            {LOADERS.map((l) => (
              <button key={l.id} type="button" role="radio" aria-checked={loader === l.id} disabled={!l.implemented} className={`loader-card${loader === l.id ? ' is-on' : ''}`} onClick={() => pickLoader(l.id)}>
                <strong>{l.label}</strong>
                <small>{LOADER_NOTE[l.id]}</small>
                {!l.implemented && <span className="badge badge--warn">Скоро</span>}
              </button>
            ))}
          </div>
          {loader !== 'vanilla' && (
            <Field label={`Версия ${LOADER_LABEL[loader]}`} error={loaders.error} hint={loaders.loading ? 'Загружаем…' : undefined}>
              <select className="input" value={loaderVersion} onChange={(e) => setLoaderVersion(e.target.value)} disabled={loaders.loading || !loaders.list.length}>
                {loaders.list.map((l) => <option key={l.version} value={l.version}>{l.version}{l.recommended ? ' (рекомендуется)' : ''}{l.stable ? '' : ' (бета)'}</option>)}
              </select>
            </Field>
          )}
          {(loader === 'forge' || loader === 'neoforge') && (
            <p className="muted">Установка {LOADER_LABEL[loader]} дольше обычной: лаунчер скачивает установщик и обрабатывает файлы игры с помощью Java. Установщик сам обращается к серверам Mojang, эти запросы не видны на вкладке «Сетевые запросы».</p>
          )}
        </div>
      )}

      {step === 2 && (
        <div className="stack">
          <p className="muted">Пустое поле означает «как в общих настройках». Всё можно изменить позже.</p>
          <SettingsFields draft={draft} onChange={setDraft} />
        </div>
      )}

      {step === 3 && (
        <div className="stack">
          <dl className="summary">
            <dt>Название</dt><dd>{name.trim()}</dd>
            <dt>Тип</dt><dd>{KIND_LABEL[kind]}</dd>
            <dt>Minecraft</dt><dd>{mcVersion}</dd>
            <dt>Загрузчик</dt><dd>{LOADER_LABEL[loader]}{loader !== 'vanilla' ? ` ${loaderVersion}` : ''}</dd>
          </dl>
          <p className="muted">После нажатия инстанс будет создан, а игра, библиотеки и ресурсы скачаются с серверов Mojang{loader !== 'vanilla' ? ` и ${LOADER_LABEL[loader]}` : ''}. Прогресс виден в нижней панели; установку можно отменить.</p>
        </div>
      )}
      {error && <p className="form-error" role="alert">{error}</p>}
    </Modal>
  );
}
