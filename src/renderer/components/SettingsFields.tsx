import type { InstanceSettings, LoaderType } from '../../shared/types';
import { recommendMemory } from '../../shared/memory';
import { instanceSettingsSchema } from '../../shared/schemas';
import { useI18n } from '../i18n';
import { useStore } from '../store';
import { memoryText, numOrNull } from '../util';
import { MemorySliders } from './MemorySliders';
import { Field } from './ui';

export interface SettingsDraft {
  javaPath: string;
  min: string;
  max: string;
  jvmArgs: string;
  width: string;
  height: string;
  fullscreen: 'default' | 'yes' | 'no';
}

export function draftFrom(s: InstanceSettings): SettingsDraft {
  return {
    javaPath: s.javaPath,
    min: s.memoryMinMb?.toString() ?? '',
    max: s.memoryMaxMb?.toString() ?? '',
    jvmArgs: s.jvmArgs,
    width: s.width?.toString() ?? '',
    height: s.height?.toString() ?? '',
    fullscreen: s.fullscreen === null ? 'default' : s.fullscreen ? 'yes' : 'no',
  };
}

export const EMPTY_DRAFT: SettingsDraft = draftFrom({
  javaPath: '',
  memoryMinMb: null,
  memoryMaxMb: null,
  jvmArgs: '',
  width: null,
  height: null,
  fullscreen: null,
});

export function parseDraft(d: SettingsDraft): { ok: true; value: InstanceSettings } | { ok: false; error: string } {
  const value = {
    javaPath: d.javaPath.trim(),
    memoryMinMb: numOrNull(d.min),
    memoryMaxMb: numOrNull(d.max),
    jvmArgs: d.jvmArgs,
    width: numOrNull(d.width),
    height: numOrNull(d.height),
    fullscreen: d.fullscreen === 'default' ? null : d.fullscreen === 'yes',
  };
  for (const [k, v] of Object.entries(value)) {
    if (typeof v === 'number' && Number.isNaN(v)) return { ok: false, error: k };
  }
  const p = instanceSettingsSchema.safeParse(value);
  return p.success ? { ok: true, value: p.data } : { ok: false, error: p.error.issues[0]?.message ?? 'error' };
}

/** Empty field = use the global value from Settings. */
export function SettingsFields({
  draft,
  onChange,
  memory,
}: {
  draft: SettingsDraft;
  onChange: (d: SettingsDraft) => void;
  memory?: { modCount: number; loader: LoaderType };
}) {
  const { t } = useI18n();
  const set = <K extends keyof SettingsDraft>(k: K, v: SettingsDraft[K]) => onChange({ ...draft, [k]: v });
  const settings = useStore((s) => s.settings);
  const sys = useStore((s) => s.sysMemory);
  const advice = sys
    ? recommendMemory({ totalMb: sys.totalMb, modCount: memory?.modCount ?? 0, loader: memory?.loader ?? 'vanilla' })
    : null;
  const own = draft.min !== '' || draft.max !== '';
  const globalText = !settings
    ? '—'
    : settings.memoryAuto
      ? advice
        ? `${memoryText(advice.minMb)} – ${memoryText(advice.maxMb)}`
        : 'auto'
      : `${memoryText(settings.memoryMinMb)} – ${memoryText(settings.memoryMaxMb)}`;
  const startOwn = () => {
    const from =
      advice && settings?.memoryAuto
        ? advice
        : settings
          ? { minMb: settings.memoryMinMb, maxMb: settings.memoryMaxMb }
          : { minMb: 1024, maxMb: 4096 };
    onChange({ ...draft, min: String(from.minMb), max: String(from.maxMb) });
  };
  return (
    <div className="form-grid">
      <div className="form-grid__wide">
        <Field
          label={t('instSettings.memory')}
          hint={own ? t('instSettings.globalHint') : t('instSettings.asSettings', { value: globalText })}
        >
          <div className="segmented" role="radiogroup" aria-label={t('instSettings.memory')}>
            <button
              type="button"
              role="radio"
              aria-checked={!own}
              className={!own ? 'is-on' : ''}
              onClick={() => onChange({ ...draft, min: '', max: '' })}
            >
              {t('instSettings.asGlobal')}
            </button>
            <button
              type="button"
              role="radio"
              aria-checked={own}
              className={own ? 'is-on' : ''}
              onClick={() => !own && startOwn()}
            >
              {t('instSettings.custom')}
            </button>
          </div>
        </Field>
        {own && (
          <MemorySliders
            minMb={Number(draft.min) || advice?.minMb || 1024}
            maxMb={Number(draft.max) || advice?.maxMb || 4096}
            onChange={(a, b) => onChange({ ...draft, min: String(a), max: String(b) })}
            sys={sys}
            advice={advice}
          />
        )}
      </div>
      <Field label={t('instSettings.width')} hint={t('instSettings.emptyGlobal')}>
        <input className="input" inputMode="numeric" value={draft.width} onChange={(e) => set('width', e.target.value)} placeholder="1280" />
      </Field>
      <Field label={t('instSettings.height')} hint={t('instSettings.emptyGlobal')}>
        <input className="input" inputMode="numeric" value={draft.height} onChange={(e) => set('height', e.target.value)} placeholder="720" />
      </Field>
      <Field label={t('instSettings.fullscreen')}>
        <select
          className="input"
          value={draft.fullscreen}
          onChange={(e) => set('fullscreen', e.target.value as SettingsDraft['fullscreen'])}
        >
          <option value="default">{t('instSettings.fsDefault')}</option>
          <option value="yes">{t('instSettings.fsOn')}</option>
          <option value="no">{t('instSettings.fsOff')}</option>
        </select>
      </Field>
      <Field label={t('instSettings.java')} hint={t('instSettings.javaHint')}>
        <input
          className="input"
          value={draft.javaPath}
          onChange={(e) => set('javaPath', e.target.value)}
          placeholder={t('settings.javaAuto')}
        />
      </Field>
      <div className="form-grid__wide">
        <Field label={t('instSettings.jvm')} hint={t('instSettings.jvmHint')}>
          <input className="input" value={draft.jvmArgs} onChange={(e) => set('jvmArgs', e.target.value)} placeholder="-XX:+UseG1GC" />
        </Field>
      </div>
    </div>
  );
}
