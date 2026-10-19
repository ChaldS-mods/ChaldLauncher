import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { InstanceView } from '../../shared/types';
import { COVER_COLORS } from '../util';
import { Icon } from './Icon';

export function Modal({ title, onClose, children, footer, wide }: { title: string; onClose: () => void; children: ReactNode; footer?: ReactNode; wide?: boolean }) {
  useEffect(() => {
    const h = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [onClose]);
  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`modal${wide ? ' modal--wide' : ''}`} role="dialog" aria-modal="true" aria-label={title}>
        <header className="modal__head">
          <h2>{title}</h2>
          <button className="icon-btn" onClick={onClose} aria-label="Закрыть"><Icon name="x" /></button>
        </header>
        <div className="modal__body">{children}</div>
        {footer && <footer className="modal__foot">{footer}</footer>}
      </div>
    </div>
  );
}

export function ConfirmModal(p: { title: string; children: ReactNode; confirmLabel: string; danger?: boolean; busy?: boolean; onConfirm: () => void; onClose: () => void }) {
  return (
    <Modal
      title={p.title}
      onClose={p.onClose}
      footer={
        <>
          <button className="btn" onClick={p.onClose}>Отмена</button>
          <button className={`btn ${p.danger ? 'btn--danger' : 'btn--primary'}`} onClick={p.onConfirm} disabled={p.busy}>{p.confirmLabel}</button>
        </>
      }
    >
      {p.children}
    </Modal>
  );
}

export interface MenuItem { label: string; icon: string; onClick: () => void; danger?: boolean; disabled?: boolean }

export function Menu({ items }: { items: MenuItem[] }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const h = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && setOpen(false);
    window.addEventListener('mousedown', h);
    return () => window.removeEventListener('mousedown', h);
  }, [open]);
  return (
    <div className="menu" ref={ref}>
      <button className="icon-btn" aria-label="Действия" onClick={(e) => { e.stopPropagation(); setOpen((o) => !o); }}><Icon name="dots" /></button>
      {open && (
        <ul className="menu__list" role="menu">
          {items.map((it) => (
            <li key={it.label}>
              <button role="menuitem" className={it.danger ? 'is-danger' : ''} disabled={it.disabled} onClick={(e) => { e.stopPropagation(); setOpen(false); it.onClick(); }}>
                <Icon name={it.icon} size={16} /> {it.label}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function Cover({ inst, className = '' }: { inst: Pick<InstanceView, 'coverDataUrl' | 'coverColor'>; className?: string }) {
  if (inst.coverDataUrl) return <div className={`cover ${className}`}><img src={inst.coverDataUrl} alt="" /></div>;
  const [a, b] = COVER_COLORS[inst.coverColor % COVER_COLORS.length]!;
  return (
    <div className={`cover cover--gen ${className}`} style={{ background: `linear-gradient(135deg, ${a}, ${b})` }}>
      <svg viewBox="0 0 48 48" fill="none" stroke="rgba(255,255,255,.55)" strokeWidth="1.6" strokeLinejoin="round" aria-hidden="true">
        <path d="M24 6l15 8.5v17L24 40 9 31.5v-17L24 6zM24 23l15-8.5M24 23L9 14.5M24 23v17" />
      </svg>
    </div>
  );
}

export function ProgressBar({ fraction }: { fraction: number | null }) {
  return (
    <div className={`progress${fraction === null ? ' progress--indeterminate' : ''}`} role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={fraction === null ? undefined : Math.round(fraction * 100)}>
      <div className="progress__bar" style={fraction === null ? undefined : { width: `${Math.round(fraction * 100)}%` }} />
    </div>
  );
}

export function Field({ label, hint, error, children }: { label: string; hint?: string; error?: string | null; children: ReactNode }) {
  return (
    <label className="field">
      <span className="field__label">{label}</span>
      {children}
      {error ? <span className="field__error">{error}</span> : hint ? <span className="field__hint">{hint}</span> : null}
    </label>
  );
}

export function Switch({ checked, onChange, label, disabled }: { checked: boolean; onChange: (v: boolean) => void; label: string; disabled?: boolean }) {
  return (
    <button type="button" role="switch" aria-checked={checked} aria-label={label} disabled={disabled} className={`switch${checked ? ' is-on' : ''}`} onClick={() => onChange(!checked)}>
      <span />
    </button>
  );
}

export function Empty({ icon, title, text, action }: { icon: string; title: string; text?: string; action?: ReactNode }) {
  return (
    <div className="empty">
      <div className="empty__icon"><Icon name={icon} size={34} /></div>
      <h3>{title}</h3>
      {text && <p>{text}</p>}
      {action}
    </div>
  );
}

export function Skeleton({ rows = 3 }: { rows?: number }) {
  return <div className="skeletons">{Array.from({ length: rows }, (_, i) => <div key={i} className="skeleton" />)}</div>;
}
