/** Whitelist sanitiser for the user's own HTML block: no scripts, no handlers, no remote loads except https links/images. */
const TAGS = new Set(['div', 'span', 'p', 'a', 'b', 'i', 'u', 's', 'strong', 'em', 'small', 'br', 'hr', 'h1', 'h2', 'h3', 'h4', 'ul', 'ol', 'li', 'img', 'table', 'thead', 'tbody', 'tr', 'td', 'th', 'pre', 'code', 'blockquote', 'section', 'header', 'footer', 'center', 'font']);
const ATTRS = new Set(['class', 'style', 'href', 'src', 'alt', 'title', 'width', 'height', 'colspan', 'rowspan', 'align']);

const safeUrl = (v: string, kind: 'href' | 'src'): boolean => {
  const u = v.trim().toLowerCase();
  if (kind === 'href') return u.startsWith('https://');
  return u.startsWith('https://') || u.startsWith('data:image/');
};
const safeStyle = (v: string): boolean => !/url\s*\(|@import|expression|javascript:|behavior|-moz-binding/i.test(v);

export function sanitizeHtml(html: string): string {
  if (!html.trim()) return '';
  const doc = new DOMParser().parseFromString(`<body>${html}</body>`, 'text/html');
  const walk = (node: Element) => {
    for (const el of Array.from(node.children)) {
      if (!TAGS.has(el.tagName.toLowerCase())) { el.remove(); continue; }
      for (const a of Array.from(el.attributes)) {
        const n = a.name.toLowerCase();
        const ok = ATTRS.has(n) && !(n === 'style' && !safeStyle(a.value)) && !((n === 'href' || n === 'src') && !safeUrl(a.value, n));
        if (!ok) el.removeAttribute(a.name);
      }
      if (el.tagName === 'A') { el.setAttribute('target', '_blank'); el.setAttribute('rel', 'noopener noreferrer'); }
      walk(el);
    }
  };
  walk(doc.body);
  return doc.body.innerHTML;
}
