import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { Markdown } from '../src/renderer/components/Markdown';

const html = (text: string) => renderToStaticMarkup(createElement(Markdown, { text }));

describe('Markdown', () => {
  it('renders bold, code, lists and links', () => {
    const out = html('Поставил **Sodium** в `mods`\n\n- один\n- два\n\n[сайт](https://modrinth.com/mod/sodium)');
    expect(out).toContain('<strong>Sodium</strong>');
    expect(out).toContain('<code>mods</code>');
    expect(out).toContain('<ul><li>один</li><li>два</li></ul>');
    expect(out).toContain('href="https://modrinth.com/mod/sodium"');
  });

  it('renders a table', () => {
    const out = html('| Мод | Версия |\n|---|---|\n| Sodium | 0.6 |\n| Lithium | 0.14 |');
    expect(out).toContain('<th>Мод</th>');
    expect(out).toContain('<td>Lithium</td><td>0.14</td>');
  });

  it('keeps a lone pipe sentence a paragraph and never emits raw HTML or non-https links', () => {
    expect(html('a | b')).toContain('<p>a | b</p>');
    const out = html('<script>alert(1)</script> [x](javascript:alert(1)) [y](http://a.b)');
    expect(out).not.toContain('<script');
    expect(out).not.toContain('href=');
  });
});
