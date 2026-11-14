import type { ReactNode } from 'react';

/**
 * Small, safe Markdown renderer for Modrinth descriptions and changelogs.
 * It builds React elements only (no innerHTML), drops raw HTML and images, and allows https links only.
 */

function httpsHref(raw: string): string | null {
  try {
    const u = new URL(raw.trim());
    return u.protocol === 'https:' ? u.toString() : null;
  } catch {
    return null;
  }
}

function cleanLine(text: string): string {
  return text
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '') // images
    .replace(/\[\s*\]\([^)]*\)/g, '') // links left empty after removing the image inside
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/?[a-zA-Z][^>]*>/g, ''); // any other raw HTML
}

const INLINE = /(`[^`\n]+`)|(\*\*[^*\n]+\*\*)|(__[^_\n]+__)|(\[[^\]\n]+\]\([^)\s]+(?:\s+"[^"]*")?\))|(\*[^*\s][^*\n]*\*)/g;

function inline(text: string, key: string): ReactNode[] {
  const out: ReactNode[] = [];
  let last = 0;
  let n = 0;
  for (const m of text.matchAll(INLINE)) {
    const i = m.index ?? 0;
    if (i > last) out.push(text.slice(last, i));
    const tok = m[0];
    const k = `${key}-${n++}`;
    if (m[1]) out.push(<code key={k}>{tok.slice(1, -1)}</code>);
    else if (m[2] || m[3]) out.push(<strong key={k}>{tok.slice(2, -2)}</strong>);
    else if (m[4]) {
      const mm = /^\[([^\]]+)\]\(([^)\s]+)/.exec(tok);
      const href = mm ? httpsHref(mm[2]!) : null;
      out.push(href ? <a key={k} href={href} target="_blank" rel="noreferrer noopener">{mm![1]}</a> : (mm?.[1] ?? tok));
    } else out.push(<em key={k}>{tok.slice(1, -1)}</em>);
    last = i + tok.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

const isTableSep = (l: string | undefined): boolean => !!l && /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/.test(l) && l.includes('-') && (l.includes('|') || /^\s*:?-{3,}/.test(l));
const tableCells = (l: string): string[] => l.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim());

export function Markdown({ text }: { text: string }) {
  // Raw HTML is dropped everywhere except inside fenced code blocks, where it is plain text.
  let fenced = false;
  const lines = String(text ?? '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .flatMap((l) => {
      if (/^\s*```/.test(l)) { fenced = !fenced; return [l]; }
      return fenced ? [l] : cleanLine(l).split('\n');
    });
  const blocks: ReactNode[] = [];
  let i = 0;
  let k = 0;

  while (i < lines.length) {
    const line = lines[i]!;
    const key = `b${k++}`;

    if (/^\s*```/.test(line)) {
      const code: string[] = [];
      i++;
      while (i < lines.length && !/^\s*```/.test(lines[i]!)) code.push(lines[i++]!);
      i++;
      blocks.push(<pre key={key}><code>{code.join('\n')}</code></pre>);
      continue;
    }
    const h = /^(#{1,6})\s+(.*)$/.exec(line);
    if (h) {
      const level = Math.min(h[1]!.length + 1, 6); // page title is h1, so shift down
      const Tag = `h${level}` as 'h2' | 'h3' | 'h4' | 'h5' | 'h6';
      blocks.push(<Tag key={key}>{inline(h[2]!.trim(), key)}</Tag>);
      i++;
      continue;
    }
    if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(line)) { blocks.push(<hr key={key} />); i++; continue; }

    if (line.includes('|') && isTableSep(lines[i + 1]) && lines[i + 1]!.includes('|')) {
      const head = tableCells(line);
      const rows: string[][] = [];
      i += 2;
      while (i < lines.length && lines[i]!.includes('|') && lines[i]!.trim() !== '') rows.push(tableCells(lines[i++]!));
      blocks.push(
        <div key={key} className="md-table">
          <table>
            <thead><tr>{head.map((c, ci) => <th key={ci}>{inline(c, `${key}-h${ci}`)}</th>)}</tr></thead>
            <tbody>{rows.map((r, ri) => <tr key={ri}>{head.map((_, ci) => <td key={ci}>{inline(r[ci] ?? '', `${key}-${ri}-${ci}`)}</td>)}</tr>)}</tbody>
          </table>
        </div>,
      );
      continue;
    }

    const ul = /^\s*[-*+]\s+(.*)$/.exec(line);
    const ol = /^\s*\d+[.)]\s+(.*)$/.exec(line);
    if (ul || ol) {
      const ordered = !!ol;
      const items: ReactNode[] = [];
      while (i < lines.length) {
        const mm = ordered ? /^\s*\d+[.)]\s+(.*)$/.exec(lines[i]!) : /^\s*[-*+]\s+(.*)$/.exec(lines[i]!);
        if (!mm) break;
        items.push(<li key={`${key}-${items.length}`}>{inline(mm[1]!.trim(), `${key}-${items.length}`)}</li>);
        i++;
      }
      blocks.push(ordered ? <ol key={key}>{items}</ol> : <ul key={key}>{items}</ul>);
      continue;
    }
    if (/^\s*>/.test(line)) {
      const q: string[] = [];
      while (i < lines.length && /^\s*>/.test(lines[i]!)) q.push(lines[i++]!.replace(/^\s*>\s?/, ''));
      blocks.push(<blockquote key={key}>{inline(q.join(' '), key)}</blockquote>);
      continue;
    }
    if (line.trim() === '') { i++; continue; }

    const para: string[] = [];
    while (i < lines.length && lines[i]!.trim() !== '' && !/^\s*(```|#{1,6}\s|[-*+]\s|\d+[.)]\s|>)/.test(lines[i]!)) para.push(lines[i++]!.trim());
    if (para.length === 0) { para.push(line.trim()); i++; }
    blocks.push(<p key={key}>{inline(para.join(' '), key)}</p>);
  }
  return <div className="md">{blocks}</div>;
}
