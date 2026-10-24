import { describe, expect, it } from 'vitest';
import { pickSound, SOUND_NOTES, type PressTarget } from '../src/renderer/sound';

const t = (o: Partial<PressTarget>): PressTarget => ({ tag: 'BUTTON', role: null, className: 'btn', ariaChecked: null, disabled: false, silent: false, ...o });

describe('pickSound', () => {
  it('plain button, primary button, danger button', () => {
    expect(pickSound(t({}))).toBe('click');
    expect(pickSound(t({ className: 'btn btn--primary btn--lg' }))).toBe('primary');
    expect(pickSound(t({ className: 'btn btn--danger' }))).toBe('danger');
  });
  it('disabled and silenced elements are silent', () => {
    expect(pickSound(t({ disabled: true }))).toBeNull();
    expect(pickSound(t({ silent: true }))).toBeNull();
  });
  it('switches sound by the state they are turning into', () => {
    expect(pickSound(t({ role: 'switch', ariaChecked: 'false' }))).toBe('on');
    expect(pickSound(t({ role: 'switch', ariaChecked: 'true' }))).toBe('off');
  });
  it('text, divs and selects are silent; checkboxes, links and menu items are not', () => {
    expect(pickSound(t({ tag: 'DIV' }))).toBeNull();
    expect(pickSound(t({ tag: 'SELECT' }))).toBeNull();
    expect(pickSound(t({ tag: 'INPUT', type: 'text' }))).toBeNull();
    expect(pickSound(t({ tag: 'INPUT', type: 'checkbox' }))).toBe('click');
    expect(pickSound(t({ tag: 'A' }))).toBe('click');
    expect(pickSound(t({ tag: 'DIV', role: 'menuitem' }))).toBe('click');
  });
  it('every sound has notes that are short', () => {
    for (const notes of Object.values(SOUND_NOTES)) {
      expect(notes.length).toBeGreaterThan(0);
      for (const n of notes) expect(n.at + n.len).toBeLessThan(0.25);
    }
  });
});
