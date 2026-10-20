import type { InstanceSettings, LoaderType } from '../../shared/types';
import { recommendMemory } from '../../shared/memory';
import { useStore } from '../store';
import { MemorySliders } from './MemorySliders';
import { memoryText } from '../util';
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
export function SettingsFields({ draft, onChange, memory }: { draft: SettingsDraft; onChange: (d: SettingsDraft) => void; memory?: { modCount: number; loader: LoaderType } }) {
  const set = <K extends keyof SettingsDraft>(k: K, v: SettingsDraft[K]) => onChange({ ...draft, [k]: v });
  const settings = useStore((s) => s.settings);
  const sys = useStore((s) => s.sysMemory);
  const advice = sys ? recommendMemory({ totalMb: sys.totalMb, modCount: memory?.modCount ?? 0, loader: memory?.loader ?? 'vanilla' }) : null;
  const own = draft.min !== '' || draft.max !== '';
  const globalText = !settings ? '—' : settings.memoryAuto ? (advice ? `автоматически: ${memoryText(advice.minMb)} – ${memoryText(advice.maxMb)}` : 'автоматически') : `${memoryText(settings.memoryMinMb)} – ${memoryText(settings.memoryMaxMb)}`;
  const startOwn = () => {
    const from = advice && settings?.memoryAuto ? advice : settings ? { minMb: settings.memoryMinMb, maxMb: settings.memoryMaxMb } : { minMb: 1024, maxMb: 4096 };
    onChange({ ...draft, min: String(from.minMb), max: String(from.maxMb) });
  };
  return (
    <div className="form-grid">
      <div className="form-grid__wide">
        <Field label="Память" hint={own ? 'Значения только для этого инстанса' : `Как в настройках: ${globalText}`}>
          <div className="segmented" role="radiogroup" aria-label="Память инстанса">
            <button type="button" role="radio" aria-checked={!own} className={!own ? 'is-on' : ''} onClick={() => onChange({ ...draft, min: '', max: '' })}>Как в настройках</button>
            <button type="button" role="radio" aria-checked={own} className={own ? 'is-on' : ''} onClick={() => !own && startOwn()}>Свой объём</button>
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
