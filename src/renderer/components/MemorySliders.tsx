import type { CSSProperties } from 'react';
import { MEM_SLIDER_MIN, MEM_STEP, memorySliderMax, memoryWarning, type MemoryAdvice } from '../../shared/memory';
import { useI18n } from '../i18n';
import { memoryText } from '../util';
import { Icon } from './Icon';

export interface SysMemory {
  totalMb: number;
  freeMb: number;
}

function Range({
  label,
  value,
  min,
  max,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  onChange: (v: number) => void;
}) {
  const pct = max > min ? Math.round(((value - min) / (max - min)) * 100) : 0;
  return (
    <div className="mem__row">
      <span className="mem__label">{label}</span>
      <input
        type="range"
        className="range"
        min={min}
        max={max}
        step={MEM_STEP}
        value={value}
        style={{ '--p': `${Math.min(100, Math.max(0, pct))}%` } as CSSProperties}
        aria-label={label}
        aria-valuetext={memoryText(value)}
        onChange={(e) => onChange(Number(e.target.value))}
      />
      <output className="mem__value">{memoryText(value)}</output>
    </div>
  );
}

/** Two linked sliders: the minimum heap (-Xms) can never be above the maximum (-Xmx). */
export function MemorySliders({
  minMb,
  maxMb,
  onChange,
  sys,
  advice,
}: {
  minMb: number;
  maxMb: number;
  onChange: (minMb: number, maxMb: number) => void;
  sys: SysMemory | null;
  advice?: MemoryAdvice | null;
}) {
  const { t } = useI18n();
  const top = Math.max(memorySliderMax(sys?.totalMb ?? null), maxMb, minMb);
  const warn = memoryWarning(maxMb, sys?.totalMb ?? null);
  return (
    <div className="mem">
      <Range
        label={t('settings.memoryMax')}
        value={maxMb}
        min={MEM_SLIDER_MIN}
        max={top}
        onChange={(v) => onChange(Math.min(minMb, v), v)}
      />
      <Range
        label={t('settings.memoryMin')}
        value={minMb}
        min={MEM_SLIDER_MIN}
        max={top}
        onChange={(v) => onChange(v, Math.max(maxMb, v))}
      />
      <div className="row row--between row--wrap">
        <span className="faint">
          {sys
            ? `${memoryText(sys.totalMb)} / ${memoryText(sys.freeMb)}`
            : '—'}
        </span>
        {advice && (
          <button type="button" className="btn btn--sm" onClick={() => onChange(advice.minMb, advice.maxMb)}>
            <Icon name="refresh" size={16} /> {t('settings.memoryAuto')}: {memoryText(advice.minMb)} – {memoryText(advice.maxMb)}
          </button>
        )}
      </div>
      {warn === 'exceeds-ram' && (
        <p className="inline-warn" role="note">
          <Icon name="alert" size={16} /> {t('memory.overRam')}
        </p>
      )}
      {warn === 'tight' && (
        <p className="inline-warn" role="note">
          <Icon name="alert" size={16} /> {t('memory.lowSystem')}
        </p>
      )}
    </div>
  );
}
