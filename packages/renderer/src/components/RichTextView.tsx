'use client';

import { type BlockStyle, type RichText, plainText } from '@blokum/schema';
import { type CSSProperties, type ReactNode, useId } from 'react';
import { useRenderContext } from '../context.js';

function Runs({ runs }: { runs: RichText['paragraphs'][number]['runs'] }): ReactNode {
  const ctx = useRenderContext();
  return runs.map((run, i) => {
    if (!('t' in run)) {
      const value = ctx.runText(run);
      return (
        <span key={i} data-placeholder={value === null || ctx.mode === 'editor' ? '' : undefined}>
          {value ?? ''}
        </span>
      );
    }
    let node: ReactNode = run.t;
    if (run.b) node = <strong>{node}</strong>;
    if (run.i) node = <em>{node}</em>;
    if (run.u) node = <u>{node}</u>;
    if (run.s) node = <s>{node}</s>;
    if (run.href && ctx.mode === 'player') {
      node = (
        <a href={ctx.linkHref(run.href)} target="_blank" rel="noopener noreferrer nofollow">
          {node}
        </a>
      );
    }
    return <span key={i}>{node}</span>;
  });
}

const resetList: CSSProperties = { margin: 0, paddingLeft: '1.2em' };
const resetP: CSSProperties = { margin: 0 };

/** Text layer of any block (B-01, S-10): paragraphs, lists, marks, links and placeholders. */
export function RichTextView({ text, style }: { text: RichText; style: CSSProperties }): ReactNode {
  const groups: Array<{ kind: 'p' | 'bullet' | 'ordered'; items: RichText['paragraphs'] }> = [];
  for (const p of text.paragraphs) {
    const last = groups[groups.length - 1];
    if (last && last.kind === p.kind && p.kind !== 'p') last.items.push(p);
    else groups.push({ kind: p.kind, items: [p] });
  }
  return (
    <div className="bk-text" style={style}>
      {groups.map((g, gi) => {
        if (g.kind === 'p')
          return (
            <p key={gi} style={resetP}>
              <Runs runs={g.items[0]!.runs} />
            </p>
          );
        const items = g.items.map((p, i) => (
          <li key={i}>
            <Runs runs={p.runs} />
          </li>
        ));
        return g.kind === 'bullet' ? (
          <ul key={gi} style={resetList}>
            {items}
          </ul>
        ) : (
          <ol key={gi} style={resetList}>
            {items}
          </ol>
        );
      })}
    </div>
  );
}

/** Text along an arc or a circle (S-10 «текст по контуру»): one line, drawn with SVG. */
export function PathTextView({ text, typography, style, w, h }: { text: RichText; typography: BlockStyle['text']; style: CSSProperties; w: number; h: number }): ReactNode {
  const path = typography.path;
  const id = useId().replace(/:/g, '');
  const line = plainText(text).replace(/\n/g, ' ');
  const d =
    path.kind === 'circle'
      ? `M ${w / 2} ${h / 2} m ${-Math.min(w, h) / 2.4} 0 a ${Math.min(w, h) / 2.4} ${Math.min(w, h) / 2.4} 0 1 1 ${(2 * Math.min(w, h)) / 2.4} 0 a ${Math.min(w, h) / 2.4} ${Math.min(w, h) / 2.4} 0 1 1 ${(-2 * Math.min(w, h)) / 2.4} 0`
      : `M 0 ${h / 2 + (path.curvature * h) / 2} Q ${w / 2} ${h / 2 - (path.curvature * h) / 2} ${w} ${h / 2 + (path.curvature * h) / 2}`;
  // Inside the SVG one user unit is one artboard unit, so the font size is given in units, not in CSS px.
  const { color, fontSize: _fontSize, ...rest } = style;
  return (
    <svg className="bk-text" viewBox={`0 0 ${w} ${h}`} width="100%" height="100%" style={{ overflow: 'visible', ...rest }} aria-label={line} role="img">
      <path id={`bk-path-${id}`} d={d} fill="none" />
      <text fill={typeof color === 'string' ? color : 'currentColor'} fontSize={typography.size}>
        <textPath href={`#bk-path-${id}`} startOffset="50%" textAnchor="middle">
          {line}
        </textPath>
      </text>
    </svg>
  );
}
