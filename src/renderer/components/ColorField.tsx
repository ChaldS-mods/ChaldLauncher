import { useEffect, useState } from 'react';
import { HEX_RE } from '../../shared/theme';

/** Native color picker plus a hex field; the hex field only commits a complete #rrggbb value. */
export function ColorField({ label, hint, value, onChange }: { label: string; hint?: string; value: string; onChange: (hex: string) => void }) {
  const [text, setText] = useState(value);
  useEffect(() => setText(value), [value]);
  const bad = text !== value && !HEX_RE.test(text);
  return (
    <div className="colorfield">
      <input type="color" className="colorfield__pick" value={HEX_RE.test(value) ? value : '#000000'} onChange={(e) => onChange(e.target.value.toLowerCase())} aria-label={label} />
      <div className="colorfield__text">
        <span>{label}</span>
        {hint && <span className="faint">{hint}</span>}
      </div>
      <input
        className={`input colorfield__hex${bad ? ' is-bad' : ''}`}
        value={text}
        spellCheck={false}
        maxLength={7}
        aria-label={`${label}: код цвета`}
        aria-invalid={bad}
        onChange={(e) => {
          const v = e.target.value.trim();
          setText(v);
          if (HEX_RE.test(v)) onChange(v.toLowerCase());
        }}
        onBlur={() => setText(value)}
      />
    </div>
  );
}
