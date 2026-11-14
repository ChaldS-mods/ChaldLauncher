import { JVM_PRESETS, findJvmPreset, type JvmPresetId } from '../../shared/jvmPresets';
import { useI18n } from '../i18n';

/** Buttons that fill the JVM args field with a known-good preset. */
export function JvmPresets({
  value,
  onChange,
}: {
  value: string;
  onChange: (args: string) => void;
}) {
  const { t } = useI18n();
  const active = findJvmPreset(value);

  return (
    <div className="stack" style={{ gap: 8 }}>
      <div className="segmented" role="group" aria-label={t('settings.jvmPresets')} style={{ flexWrap: 'wrap' }}>
        {JVM_PRESETS.map((p) => (
          <button
            key={p.id}
            type="button"
            className={active === p.id ? 'is-on' : ''}
            aria-pressed={active === p.id}
            title={t(p.hintKey)}
            onClick={() => onChange(p.args)}
          >
            {t(p.labelKey)}
          </button>
        ))}
        {active === 'custom' && (
          <button type="button" className="is-on" aria-pressed disabled title={t('settings.jvmPreset.customHint')}>
            {t('settings.jvmPreset.custom')}
          </button>
        )}
      </div>
      <p className="muted" style={{ fontSize: 12, margin: 0 }}>
        {active === 'custom'
          ? t('settings.jvmPreset.customHint')
          : t(JVM_PRESETS.find((p) => p.id === active)?.hintKey ?? 'settings.jvmPreset.noneHint')}
      </p>
    </div>
  );
}

export type { JvmPresetId };
