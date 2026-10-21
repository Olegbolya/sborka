'use client';

import { formatDuration, formatValue } from '@blokum/engine';
import { type Block } from '@blokum/schema';
import { pluralRu } from '@blokum/ui';
import { type CSSProperties, type ReactNode, useEffect, useState } from 'react';
import { useRenderContext } from '../context.js';
import { type BlockCss } from '../style/style-to-css.js';
import { cssColor } from '../theme/color.js';
import { u } from '../units.js';

type Of<T extends Block['type']> = Extract<Block, { type: T }>;
const fill: CSSProperties = { position: 'absolute', inset: 0 };

/** «1 минута 5 секунд» — the «словами» format of a timer. */
export function durationInWords(totalSeconds: number): string {
  const s = Math.max(0, Math.ceil(totalSeconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const parts = [
    h ? `${h} ${pluralRu(h, ['час', 'часа', 'часов'])}` : '',
    m ? `${m} ${pluralRu(m, ['минута', 'минуты', 'минут'])}` : '',
    sec || (!h && !m) ? `${sec} ${pluralRu(sec, ['секунда', 'секунды', 'секунд'])}` : '',
  ];
  return parts.filter(Boolean).join(' ');
}

/** Text of a timer in its format (B-08). */
export function formatTimer(seconds: number, format: Of<'timer'>['props']['format']): string {
  const s = Math.max(0, Math.ceil(seconds));
  if (format === 'seconds') return String(s);
  if (format === 'words') return durationInWords(s);
  const pad = (n: number) => String(n).padStart(2, '0');
  if (format === 'hh:mm:ss') return `${pad(Math.floor(s / 3600))}:${pad(Math.floor((s % 3600) / 60))}:${pad(s % 60)}`;
  return `${pad(Math.floor(s / 60))}:${pad(s % 60)}`;
}

/** Seconds a timer shows before the runtime starts it (editor, thumbnails): its full time. */
function initialSeconds(p: Of<'timer'>['props'], now: number): number {
  if (p.mode === 'until' && p.until) return Math.max(0, (Date.parse(p.until) - now) / 1000);
  return p.seconds;
}

/**
 * B-08 Таймер: the runtime counts (pause, reset, «истёк» TR-10), the block only shows the time left. In the
 * player it refreshes four times a second; screen readers get the time only on request (role="timer").
 */
export function TimerContent({ block, css, instanceId }: { block: Of<'timer'>; css: BlockCss; instanceId: string }): ReactNode {
  const ctx = useRenderContext();
  const [, refresh] = useState(0);
  const live = ctx.mode === 'player' && ctx.timerRemaining !== undefined;
  useEffect(() => {
    if (!live) return;
    const id = setInterval(() => refresh((n) => n + 1), 250);
    return () => clearInterval(id);
  }, [live]);
  const left = ctx.timerRemaining?.(instanceId) ?? initialSeconds(block.props, Date.now());
  return (
    <div className="bk-timer" role="timer" aria-label={block.a11y.label ?? block.name} style={{ ...fill, ...css.content, ...css.text, display: 'flex', alignItems: 'center', justifyContent: css.text.textAlign === 'left' ? 'flex-start' : css.text.textAlign === 'right' ? 'flex-end' : 'center', fontVariantNumeric: 'tabular-nums' }}>
      {formatTimer(left, block.props.format)}
    </div>
  );
}

/** B-09 Прогресс: a bar, dots, «экран N из M» or a variable on a scale. */
export function ProgressContent({ block, css }: { block: Of<'progress'>; css: BlockCss }): ReactNode {
  const ctx = useRenderContext();
  const p = block.props;
  const fromVariable = p.variant === 'variable' && p.variableId;
  const raw = fromVariable ? Number(ctx.variables?.[p.variableId!] ?? 0) : (ctx.progress?.index ?? 0) + 1;
  const max = fromVariable ? (p.max ?? 100) : (ctx.progress?.total ?? 1);
  const value = Math.max(0, Math.min(max, Number.isFinite(raw) ? raw : 0));
  const label = block.a11y.label ?? (fromVariable ? block.name : 'Прогресс прохождения');
  const accent = cssColor({ token: 'primary', alpha: 1 }, ctx.tokens);
  const track = cssColor({ token: 'muted', alpha: 0.3 }, ctx.tokens);
  const aria = { role: 'progressbar', 'aria-label': label, 'aria-valuemin': 0, 'aria-valuemax': max, 'aria-valuenow': value, 'aria-valuetext': `${value} из ${max}` } as const;
  if (p.variant === 'fraction') {
    return (
      <div className="bk-progress" {...aria} style={{ ...fill, ...css.content, ...css.text, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        {`Экран ${value} из ${max}`}
      </div>
    );
  }
  if (p.variant === 'dots') {
    const n = Math.min(max, 30);
    return (
      <div className="bk-progress" {...aria} style={{ ...fill, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: u(6) }}>
        {Array.from({ length: n }, (_, i) => (
          <span key={i} aria-hidden style={{ width: u(8), height: u(8), borderRadius: '50%', background: i < Math.round((value / max) * n) ? accent : track }} />
        ))}
      </div>
    );
  }
  return (
    <div className="bk-progress" {...aria} style={{ ...fill, overflow: 'hidden', borderRadius: 'inherit', background: track }}>
      <div className="bk-progress-bar" style={{ width: `${(value / max) * 100}%`, height: '100%', background: accent, transition: 'width 300ms ease' }} />
    </div>
  );
}

/** B-23 Значение: a variable as a number, text, icons «❤❤❤», time «03:15» or «7 из 10». */
export function formatBlockValue(value: unknown, p: Of<'value'>['props']): string {
  const n = typeof value === 'number' ? value : Number(value);
  switch (p.format) {
    case 'icons': {
      const count = Math.max(0, Math.min(100, Math.floor(Number.isFinite(n) ? n : 0)));
      const icon = p.icon ?? '❤';
      return icon.repeat(count) + (p.max ? '·'.repeat(Math.max(0, Math.min(100, p.max) - count)) : '');
    }
    case 'time':
      return formatDuration((Number.isFinite(n) ? n : 0) * 1000).padStart(5, '0');
    case 'fraction':
      return `${formatValue(Number.isFinite(n) ? n : 0)} из ${formatValue(p.max ?? 0)}`;
    case 'text':
      return typeof value === 'string' ? value : formatValue(value as never);
    case 'number':
      return formatValue(value === undefined ? 0 : (value as never));
  }
}

export function ValueContent({ block, css }: { block: Of<'value'>; css: BlockCss }): ReactNode {
  const ctx = useRenderContext();
  const value = ctx.variables?.[block.props.variableId];
  const text = ctx.variables ? formatBlockValue(value, block.props) : `{{${block.name}}}`;
  return (
    <div className="bk-value" role="status" aria-label={block.a11y.label ?? undefined} style={{ ...fill, ...css.content, ...css.text, display: 'flex', alignItems: 'center', justifyContent: css.text.textAlign === 'left' ? 'flex-start' : css.text.textAlign === 'right' ? 'flex-end' : 'center', fontVariantNumeric: 'tabular-nums' }}>
      {text}
    </div>
  );
}

/**
 * B-22 Зона: an area for «бросили на зону», «коснулся зоны» (TR-06, TR-07). A visible zone shows a dashed
 * outline to the participant; in the editor every zone is outlined so it can be found.
 */
export function ZoneContent({ block }: { block: Of<'zone'> }): ReactNode {
  const ctx = useRenderContext();
  if (ctx.mode === 'player' && !block.props.visible) return null;
  const color = cssColor({ token: 'accent', alpha: ctx.mode === 'player' ? 0.9 : 0.6 }, ctx.tokens);
  return (
    <div className="bk-zone" aria-hidden style={{ ...fill, border: `${u(2)} dashed ${color}`, borderRadius: 'inherit', background: ctx.mode === 'player' ? 'transparent' : `repeating-linear-gradient(45deg, transparent 0 ${u(8)}, ${cssColor({ token: 'accent', alpha: 0.08 }, ctx.tokens)} ${u(8)} ${u(16)})` }}>
      {ctx.mode !== 'player' && <span style={{ position: 'absolute', top: u(4), left: u(6), fontSize: u(11), color }}>Зона</span>}
    </div>
  );
}
