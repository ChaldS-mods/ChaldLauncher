import type { InstanceSettings } from '../../shared/types';
import { instanceSettingsSchema } from '../../shared/schemas';
import { numOrNull } from '../util';
import { Field } from './ui';

export interface SettingsDraft { javaPath: string; min: string; max: string; jvmArgs: string; width: string; height: string; fullscreen: 'default' | 'yes' | 'no' }

export function draftFrom(s: InstanceSettings): SettingsDraft {
  return {
    javaPath: s.javaPath, min: s.memoryMinMb?.toString() ?? '', max: s.memoryMaxMb?.toString() ?? '', jvmArgs: s.jvmArgs,
    width: s.width?.toString() ?? '', height: s.height?.toString() ?? '',
    fullscreen: s.fullscreen === null ? 'default' : s.fullscreen ? 'yes' : 'no',
  };
}

export const EMPTY_DRAFT: SettingsDraft = draftFrom({ javaPath: '', memoryMinMb: null, memoryMaxMb: null, jvmArgs: '', width: null, height: null, fullscreen: null });

export function parseDraft(d: SettingsDraft): { ok: true; value: InstanceSettings } | { ok: false; error: string } {
  const value = {
    javaPath: d.javaPath.trim(),
    memoryMinMb: numOrNull(d.min), memoryMaxMb: numOrNull(d.max), jvmArgs: d.jvmArgs,
    width: numOrNull(d.width), height: numOrNull(d.height),
    fullscreen: d.fullscreen === 'default' ? null : d.fullscreen === 'yes',
  };
  for (const [k, v] of Object.entries(value)) if (typeof v === 'number' && Number.isNaN(v)) return { ok: false, error: `Поле «${k}»: нужно число` };
  const p = instanceSettingsSchema.safeParse(value);
  return p.success ? { ok: true, value: p.data } : { ok: false, error: p.error.issues[0]?.message ?? 'Некорректные настройки' };
}

/** Empty field = use the global value from Settings. */
export function SettingsFields({ draft, onChange }: { draft: SettingsDraft; onChange: (d: SettingsDraft) => void }) {
  const set = <K extends keyof SettingsDraft>(k: K, v: SettingsDraft[K]) => onChange({ ...draft, [k]: v });
  return (
    <div className="form-grid">
      <Field label="Память, минимум (МБ)" hint="Пусто — как в настройках">
        <input className="input" inputMode="numeric" value={draft.min} onChange={(e) => set('min', e.target.value)} placeholder="1024" />
      </Field>
      <Field label="Память, максимум (МБ)" hint="Пусто — как в настройках">
        <input className="input" inputMode="numeric" value={draft.max} onChange={(e) => set('max', e.target.value)} placeholder="4096" />
      </Field>
      <Field label="Ширина окна" hint="Пусто — как в настройках">
        <input className="input" inputMode="numeric" value={draft.width} onChange={(e) => set('width', e.target.value)} placeholder="1280" />
      </Field>
      <Field label="Высота окна" hint="Пусто — как в настройках">
        <input className="input" inputMode="numeric" value={draft.height} onChange={(e) => set('height', e.target.value)} placeholder="720" />
      </Field>
      <Field label="Полный экран">
        <select className="input" value={draft.fullscreen} onChange={(e) => set('fullscreen', e.target.value as SettingsDraft['fullscreen'])}>
          <option value="default">Как в настройках</option>
          <option value="yes">Включён</option>
          <option value="no">Выключен</option>
        </select>
      </Field>
      <Field label="Путь к Java" hint="Пусто — подобрать автоматически">
        <input className="input" value={draft.javaPath} onChange={(e) => set('javaPath', e.target.value)} placeholder="Автоматически" />
      </Field>
      <div className="form-grid__wide">
        <Field label="Доп. аргументы JVM" hint="Добавляются к общим аргументам из настроек">
          <input className="input" value={draft.jvmArgs} onChange={(e) => set('jvmArgs', e.target.value)} placeholder="-XX:+UseG1GC" />
        </Field>
      </div>
    </div>
  );
}
