import { type ReactNode } from 'react';
import './legal.css';

/**
 * Тексты документов из `legal/*.md` в виде страницы: заголовки, абзацы, списки, таблицы, цитаты, **жирный**, `код` и ссылки
 * на страницы сайта (`/legal/…`, `/tariffs`). Разбор собственный и без HTML-вставок: в документах только эта часть разметки,
 * а всё остальное выводится как обычный текст. Первый заголовок `# …` пропускается — у страницы свой.
 */
export type LegalBlock =
  | { kind: 'h'; level: 2 | 3; text: string }
  | { kind: 'p'; text: string }
  | { kind: 'quote'; text: string }
  | { kind: 'ul' | 'ol'; items: string[] }
  | { kind: 'table'; head: string[]; rows: string[][] };

const cells = (line: string): string[] => line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim());

export function parseLegal(md: string): LegalBlock[] {
  const lines = md.replace(/\r\n?/g, '\n').split('\n');
  const out: LegalBlock[] = [];
  let skippedTitle = false;
  let i = 0;
  while (i < lines.length) {
    const line = lines[i]!;
    const trimmed = line.trim();
    if (!trimmed) {
      i += 1;
      continue;
    }
    const h = /^(#{1,3})\s+(.*)$/.exec(trimmed);
    if (h) {
      if (h[1] === '#' && !skippedTitle) skippedTitle = true;
      else out.push({ kind: 'h', level: h[1]!.length >= 3 ? 3 : 2, text: h[2]! });
      i += 1;
      continue;
    }
    if (trimmed.startsWith('|')) {
      const rows: string[][] = [];
      while (i < lines.length && lines[i]!.trim().startsWith('|')) {
        const row = cells(lines[i]!);
        if (!row.every((c) => /^:?-{3,}:?$/.test(c))) rows.push(row);
        i += 1;
      }
      out.push({ kind: 'table', head: rows[0] ?? [], rows: rows.slice(1) });
      continue;
    }
    if (trimmed.startsWith('>')) {
      const parts: string[] = [];
      while (i < lines.length && lines[i]!.trim().startsWith('>')) {
        parts.push(lines[i]!.trim().replace(/^>\s?/, ''));
        i += 1;
      }
      out.push({ kind: 'quote', text: parts.join(' ') });
      continue;
    }
    const bullet = /^[-*]\s+/;
    const numbered = /^\d+[.)]\s+/;
    if (bullet.test(trimmed) || numbered.test(trimmed)) {
      const kind = bullet.test(trimmed) ? 'ul' : 'ol';
      const re = kind === 'ul' ? bullet : numbered;
      const items: string[] = [];
      while (i < lines.length) {
        const t = lines[i]!.trim();
        if (re.test(t)) items.push(t.replace(re, ''));
        else if (t && /^\s{2,}/.test(lines[i]!) && items.length > 0) items[items.length - 1] += ` ${t.replace(/^[-*]\s+/, '— ')}`;
        else break;
        i += 1;
      }
      out.push({ kind, items });
      continue;
    }
    const para: string[] = [];
    while (i < lines.length) {
      const t = lines[i]!.trim();
      if (!t || /^(#{1,3}\s|\||>|[-*]\s|\d+[.)]\s)/.test(t)) break;
      para.push(t);
      i += 1;
    }
    out.push({ kind: 'p', text: para.join(' ') });
  }
  return out;
}

/** `**жирный**`, `` `код` `` и пути сайта (`/legal/terms`) — ссылками; остальное — текст. */
export function inline(text: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  const re = /\*\*([^*]+)\*\*|`([^`]+)`|(?<![\w/.])(\/(?:legal|tariffs|cabinet|account)(?:\/[a-z0-9-]+)*)/g;
  let last = 0;
  let k = 0;
  for (const m of text.matchAll(re)) {
    if (m.index > last) nodes.push(text.slice(last, m.index));
    if (m[1] !== undefined) nodes.push(<strong key={k++}>{inline(m[1])}</strong>);
    else if (m[2] !== undefined) nodes.push(<code key={k++}>{m[2]}</code>);
    else nodes.push(<a key={k++} href={m[3]}>{m[3]}</a>);
    last = m.index + m[0].length;
  }
  if (last < text.length) nodes.push(text.slice(last));
  return nodes;
}

export function LegalMarkdown({ source }: { source: string }) {
  return (
    <div className="legal-doc" data-testid="legal-doc">
      {parseLegal(source).map((b, i) => {
        switch (b.kind) {
          case 'h':
            return b.level === 2 ? <h2 key={i}>{inline(b.text)}</h2> : <h3 key={i}>{inline(b.text)}</h3>;
          case 'p':
            return <p key={i}>{inline(b.text)}</p>;
          case 'quote':
            return <blockquote key={i}>{inline(b.text)}</blockquote>;
          case 'ul':
            return (
              <ul key={i}>
                {b.items.map((it, j) => (
                  <li key={j}>{inline(it)}</li>
                ))}
              </ul>
            );
          case 'ol':
            return (
              <ol key={i}>
                {b.items.map((it, j) => (
                  <li key={j}>{inline(it)}</li>
                ))}
              </ol>
            );
          case 'table':
            return (
              <div key={i} className="legal-table">
                <table>
                  <thead>
                    <tr>
                      {b.head.map((c, j) => (
                        <th key={j}>{inline(c)}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {b.rows.map((r, j) => (
                      <tr key={j}>
                        {r.map((c, n) => (
                          <td key={n}>{inline(c)}</td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            );
        }
      })}
    </div>
  );
}
