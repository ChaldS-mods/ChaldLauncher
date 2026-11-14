/**
 * Short interface sounds, synthesised with Web Audio (no audio files, nothing to download).
 * One listener on the document plays a sound for any enabled button-like element that is pressed.
 */
export type SoundKind = 'click' | 'primary' | 'danger' | 'on' | 'off';

export interface PressTarget {
  tag: string;
  role: string | null;
  className: string;
  ariaChecked: string | null;
  disabled: boolean;
  silent: boolean;
  type?: string | null;
}

/** Which sound a pressed element makes (null: none). Pure, so it can be tested without a DOM. */
export function pickSound(t: PressTarget): SoundKind | null {
  if (t.disabled || t.silent) return null;
  const tag = t.tag.toLowerCase();
  const pressable = tag === 'button' || tag === 'a' || (tag === 'input' && (t.type === 'checkbox' || t.type === 'radio' || t.type === 'button' || t.type === 'submit'))
    || ['button', 'radio', 'switch', 'menuitem', 'tab', 'checkbox'].includes(t.role ?? '');
  if (!pressable) return null;
  // the state is read before the click handler flips it
  if (t.role === 'switch' || t.role === 'checkbox') return t.ariaChecked === 'true' ? 'off' : 'on';
  if (/\bbtn--danger\b|\bis-danger\b/.test(t.className)) return 'danger';
  if (/\bbtn--primary\b|\bplay\b/.test(t.className)) return 'primary';
  return 'click';
}

interface Note { f0: number; f1?: number; at: number; len: number; wave: OscillatorType; gain: number }

export const SOUND_NOTES: Record<SoundKind, Note[]> = {
  click: [{ f0: 760, f1: 520, at: 0, len: 0.05, wave: 'triangle', gain: 0.9 }],
  primary: [{ f0: 520, at: 0, len: 0.06, wave: 'square', gain: 0.45 }, { f0: 780, at: 0.055, len: 0.09, wave: 'square', gain: 0.45 }],
  danger: [{ f0: 240, f1: 150, at: 0, len: 0.1, wave: 'square', gain: 0.5 }],
  on: [{ f0: 600, f1: 900, at: 0, len: 0.07, wave: 'triangle', gain: 0.9 }],
  off: [{ f0: 900, f1: 560, at: 0, len: 0.07, wave: 'triangle', gain: 0.9 }],
};

let enabled = true;
let volume = 0.5;
let ctx: AudioContext | null = null;
let lastAt = 0;

export function configureSound(o: { enabled: boolean; volume: number }): void {
  enabled = o.enabled;
  volume = Math.max(0, Math.min(100, o.volume)) / 100;
}

export function playSound(kind: SoundKind): void {
  if (!enabled || volume === 0) return;
  const now = performance.now();
  if (now - lastAt < 35) return; // a double event must not stack into a louder click
  lastAt = now;
  try {
    ctx ??= new AudioContext();
    if (ctx.state === 'suspended') void ctx.resume();
    const t0 = ctx.currentTime;
    for (const n of SOUND_NOTES[kind]) {
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      osc.type = n.wave;
      const s = t0 + n.at;
      osc.frequency.setValueAtTime(n.f0, s);
      if (n.f1) osc.frequency.exponentialRampToValueAtTime(n.f1, s + n.len);
      const peak = 0.22 * volume * n.gain; // calm: it plays on every press
      g.gain.setValueAtTime(0.0001, s);
      g.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), s + 0.004);
      g.gain.exponentialRampToValueAtTime(0.0001, s + n.len);
      osc.connect(g).connect(ctx.destination);
      osc.start(s);
      osc.stop(s + n.len + 0.02);
    }
  } catch {
    /* no audio device: the interface works without sound */
  }
}

/** Plays a sound for every press on a button-like element. Returns a function that removes the listener. */
export function installClickSounds(doc: Document = document): () => void {
  const handler = (e: Event) => {
    const start = e.target instanceof Element ? e.target : null;
    const el = start?.closest('button, a, input, [role="button"], [role="radio"], [role="switch"], [role="menuitem"], [role="tab"], [role="checkbox"]');
    if (!el) return;
    const kind = pickSound({
      tag: el.tagName,
      role: el.getAttribute('role'),
      className: el.getAttribute('class') ?? '',
      ariaChecked: el.getAttribute('aria-checked'),
      disabled: (el as HTMLButtonElement).disabled === true || el.getAttribute('aria-disabled') === 'true',
      silent: el.closest('[data-silent]') !== null,
      type: el.getAttribute('type'),
    });
    if (kind) playSound(kind);
  };
  doc.addEventListener('click', handler, true);
  return () => doc.removeEventListener('click', handler, true);
}
