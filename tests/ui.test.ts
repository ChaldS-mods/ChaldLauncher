import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { MemorySliders } from '../src/renderer/components/MemorySliders';
import { SkinPreview } from '../src/renderer/components/SkinPreview';
import { WardrobePage } from '../src/renderer/pages/Wardrobe';
import { recommendMemory } from '../src/shared/memory';
import { useStore } from '../src/renderer/store';

const noop = () => undefined;

/** zustand renders the *initial* state on the server, so the test patches that object in place. */
function withAuth(auth: NonNullable<ReturnType<typeof useStore.getState>['auth']>): () => void {
  const initial = useStore.getInitialState() as { auth: unknown };
  const before = initial.auth;
  initial.auth = auth;
  return () => { initial.auth = before; };
}

describe('MemorySliders (server render)', () => {
  const sys = { totalMb: 16384, freeMb: 9000 };
  it('shows both sliders, the computer RAM and the automatic pick', () => {
    const advice = recommendMemory({ totalMb: sys.totalMb, modCount: 60, loader: 'fabric' });
    const html = renderToString(createElement(MemorySliders, { minMb: 1024, maxMb: 4096, onChange: noop, sys, advice }));
    expect(html).toContain('Максимум (Xmx)');
    expect(html).toContain('Минимум (Xms)');
    expect(html).toContain('max="16384"');
    expect(html).toContain('ОЗУ компьютера: 16');
    expect(html).toContain('Подобрать автоматически');
    expect(html).not.toContain('inline-warn');
  });
  it('warns when the heap does not fit into the RAM', () => {
    const html = renderToString(createElement(MemorySliders, { minMb: 1024, maxMb: 12288, onChange: noop, sys: { totalMb: 8192, freeMb: 3000 } }));
    expect(html).toContain('больше, чем ОЗУ');
  });
  it('still renders when the RAM size is unknown', () => {
    const html = renderToString(createElement(MemorySliders, { minMb: 1024, maxMb: 4096, onChange: noop, sys: null }));
    expect(html).toContain('не определён');
  });
});

describe('Wardrobe (server render)', () => {
  it('renders a canvas of the right size for the doll', () => {
    const html = renderToString(createElement(SkinPreview, { dataUrl: 'data:image/png;base64,AAAA', variant: 'slim', scale: 10, label: 'x' }));
    expect(html).toContain('width="160"');
    expect(html).toContain('height="320"');
  });
  it('page renders for an offline account with a warning and without the account section', () => {
    const restore = withAuth({ mode: 'offline', loggedIn: true, name: 'Steve', uuid: 'u', configured: true, encryptionAvailable: true });
    const html = renderToString(createElement(WardrobePage));
    restore();
    expect(html).toContain('Гардероб');
    expect(html).toContain('Офлайн-режим');
    expect(html).not.toContain('Сейчас на аккаунте');
    expect(html).not.toContain('Сохранить текущий скин');
  });
  it('page renders for a Microsoft account with the account controls', () => {
    const restore = withAuth({ mode: 'microsoft', loggedIn: true, name: 'Alex', uuid: 'u', configured: true, encryptionAvailable: true });
    const html = renderToString(createElement(WardrobePage));
    restore();
    expect(html).toContain('Сохранить текущий скин');
    expect(html).toContain('Сейчас на аккаунте');
    expect(html).toMatch(/Сейчас на аккаунте <!-- -->Alex/);
    expect(html).not.toContain('Офлайн-режим');
  });
});
