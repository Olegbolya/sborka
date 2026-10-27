'use client';

import { type AnswerValue } from '@blokum/engine';
import { type Block } from '@blokum/schema';
import { type CSSProperties, type ReactNode, useEffect, useRef, useState } from 'react';
import { useRenderContext } from '../context.js';
import { type BlockCss } from '../style/style-to-css.js';
import { u } from '../units.js';

type Of<T extends Block['type']> = Extract<Block, { type: T }>;
const fill: CSSProperties = { position: 'absolute', inset: 0 };
/** Accessible name of a question: its label for screen readers, otherwise its name (PL-21). */
export const questionLabel = (block: Block): string => block.a11y.label ?? block.name;

/** Current answer of a question and a way to send a new one to the runtime (the player stores it later, P5). */
function useAnswer(questionId: string): [AnswerValue | undefined, (answer: AnswerValue | null) => void, boolean] {
  const ctx = useRenderContext();
  const live = ctx.mode === 'player' && ctx.dispatch !== undefined;
  return [ctx.answers?.[questionId], (answer) => ctx.dispatch?.({ type: 'answer', questionBlockId: questionId, answer }), live];
}

/**
 * Typing is kept locally and sent after a pause or when the field loses focus — not on every key, so rules
 * on «ответ изменён» (TR-12) do not fire for each letter.
 */
function useDebouncedSend<T>(send: (value: T) => void, delayMs = 400): { push: (value: T) => void; flush: () => void } {
  const pending = useRef<{ value: T } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const sendRef = useRef(send);
  sendRef.current = send;
  const flush = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    if (pending.current) sendRef.current(pending.current.value);
    pending.current = null;
  };
  useEffect(() => () => flush(), []);
  return {
    push: (value) => {
      pending.current = { value };
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(flush, delayMs);
    },
    flush,
  };
}

const fieldStyle = (css: BlockCss): CSSProperties => ({
  ...css.text,
  width: '100%',
  height: '100%',
  boxSizing: 'border-box',
  border: 'none',
  outline: 'none',
  background: 'transparent',
  resize: 'none',
  padding: 0,
  margin: 0,
});

const AUTOCOMPLETE = { none: 'off', name: 'name', phone: 'tel', email: 'email', city: 'address-level2' } as const;
const INPUT_TYPE = { none: 'text', name: 'text', phone: 'tel', email: 'email', city: 'text' } as const;

/** B-13 Текстовый ответ: a real input with a label, hint, length limits and a numeric keyboard for numbers. */
export function TextInputContent({ block, css }: { block: Of<'textInput'>; css: BlockCss }): ReactNode {
  const ctx = useRenderContext();
  const [answer, send, live] = useAnswer(block.id);
  const remote = answer?.kind === 'text' ? answer.value : '';
  const [value, setValue] = useState(remote);
  const typing = useRef(false);
  useEffect(() => {
    if (!typing.current) setValue(remote);
  }, [remote]);
  const { push, flush } = useDebouncedSend<string>((v) => send(v === '' ? null : { kind: 'text', value: v }));
  const p = block.props;
  const common = {
    className: 'bk-field',
    'aria-label': questionLabel(block),
    placeholder: p.placeholder,
    maxLength: p.maxLength,
    minLength: p.minLength > 0 ? p.minLength : undefined,
    required: p.required,
    'aria-required': p.required,
    readOnly: !live,
    tabIndex: live ? 0 : -1,
    value,
    autoComplete: AUTOCOMPLETE[p.semantic],
    onChange: (e: { target: { value: string } }) => {
      typing.current = true;
      setValue(e.target.value);
      push(e.target.value);
    },
    onBlur: () => {
      typing.current = false;
      flush();
    },
    onClick: (e: { stopPropagation: () => void }) => e.stopPropagation(),
    style: ctx.mode === 'player' ? { ...fieldStyle(css), height: 'auto', flex: 1, minHeight: 0 } : fieldStyle(css),
  };
  return (
    <div className="bk-question" style={{ ...fill, ...css.content, display: 'flex', flexDirection: ctx.mode === 'player' ? 'column' : 'row' }}>
      {p.multiline ? (
        <textarea {...common} />
      ) : (
        <input {...common} type={p.mask === 'number' ? 'text' : INPUT_TYPE[p.semantic]} inputMode={p.mask === 'number' ? 'decimal' : p.semantic === 'phone' ? 'tel' : undefined} />
      )}
      {/* PL-17: the participant is told under every field what must not be typed in. */}
      {ctx.mode === 'player' && (
        <small className="bk-field-warning" data-testid="field-warning" style={{ flex: 'none', marginTop: u(2), fontSize: u(11), lineHeight: 1.25, opacity: 0.7 }}>
          Не вводите пароли, коды из СМС и данные банковских карт
        </small>
      )}
    </div>
  );
}

/** Icons of a scale: stars, hearts, emoji, the creator's pictures or plain numbers (B-14). */
function scaleIcon(variant: Of<'scale'>['props']['variant'], index: number, on: boolean): string {
  if (variant === 'stars') return on ? '★' : '☆';
  if (variant === 'hearts') return on ? '♥' : '♡';
  if (variant === 'emoji') return ['😞', '🙁', '😐', '🙂', '😄', '😍'][Math.min(5, index)] ?? '🙂';
  return '';
}

/** B-14 Шкала / рейтинг: a group of radio buttons (or a slider) with the values min…max. */
export function ScaleContent({ block, css }: { block: Of<'scale'>; css: BlockCss }): ReactNode {
  const ctx = useRenderContext();
  const [answer, send, live] = useAnswer(block.id);
  const p = block.props;
  const current = answer?.kind === 'number' ? answer.value : null;
  const label = questionLabel(block);
  if (p.variant === 'slider') {
    return (
      <div className="bk-question" style={{ ...fill, ...css.content, display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: u(4) }}>
        <input
          type="range"
          className="bk-field"
          aria-label={label}
          min={p.min}
          max={p.max}
          step={p.step}
          value={current ?? p.min}
          aria-valuetext={current === null ? 'нет ответа' : String(current)}
          disabled={!live}
          onChange={(e) => send({ kind: 'number', value: Number(e.target.value) })}
          onClick={(e) => e.stopPropagation()}
          style={{ width: '100%', accentColor: ctx.tokens.colors.primary }}
        />
        {(p.labels.min || p.labels.max) && (
          <div aria-hidden style={{ display: 'flex', justifyContent: 'space-between', fontSize: u(12) }}>
            <span>{p.labels.min}</span>
            <span>{p.labels.max}</span>
          </div>
        )}
      </div>
    );
  }
  const count = Math.floor((p.max - p.min) / p.step + 1e-9) + 1;
  const values = Array.from({ length: Math.min(count, 101) }, (_, i) => Math.round((p.min + i * p.step) * 1000) / 1000);
  const picked = (v: number) => current !== null && (p.variant === 'numbers' || p.variant === 'emoji' ? v === current : v <= current);
  return (
    <div className="bk-question" role="radiogroup" aria-label={label} aria-required={p.required} style={{ ...fill, ...css.content, display: 'flex', flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: u(2) }}>
      {values.map((v, i) => {
        const icon = p.variant === 'images' ? p.icons[Math.min(i, p.icons.length - 1)] : undefined;
        const src = icon ? ctx.media(icon) : null;
        return (
          <button
            key={v}
            type="button"
            role="radio"
            aria-checked={current === v}
            aria-label={`${v} из ${p.max}`}
            disabled={!live}
            tabIndex={live && (current === v || (current === null && i === 0)) ? 0 : -1}
            onClick={(e) => {
              e.stopPropagation();
              send({ kind: 'number', value: v });
            }}
            onKeyDown={(e) => {
              const step = e.key === 'ArrowRight' || e.key === 'ArrowUp' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowDown' ? -1 : 0;
              if (!step) return;
              e.preventDefault();
              const next = values[Math.max(0, Math.min(values.length - 1, i + step))]!;
              send({ kind: 'number', value: next });
              ((e.currentTarget.parentElement?.children[values.indexOf(next)] as HTMLElement | undefined) ?? e.currentTarget).focus();
            }}
            className="bk-scale-item"
            data-picked={picked(v) ? '' : undefined}
            style={{
              flex: '1 1 0',
              minWidth: 0,
              height: '100%',
              border: 'none',
              padding: 0,
              background: 'transparent',
              cursor: live ? 'pointer' : 'default',
              color: picked(v) ? ctx.tokens.colors.primary : 'inherit',
              opacity: p.variant === 'emoji' && current !== null && !picked(v) ? 0.45 : 1,
              fontSize: p.variant === 'numbers' ? u(16) : u(26),
              fontWeight: p.variant === 'numbers' && picked(v) ? 800 : 400,
              lineHeight: 1,
            }}
          >
            {src ? <img src={src.url} alt="" style={{ width: '80%', height: '80%', objectFit: 'contain', opacity: picked(v) ? 1 : 0.4 }} /> : p.variant === 'numbers' ? v : <span aria-hidden>{scaleIcon(p.variant, i, picked(v))}</span>}
          </button>
        );
      })}
    </div>
  );
}

/** B-15 Свайп-карточка: swipe the block left or right (or press the buttons); the side is the answer. */
export function SwipeContent({ block, css }: { block: Of<'swipe'>; css: BlockCss }): ReactNode {
  const ctx = useRenderContext();
  const [answer, send, live] = useAnswer(block.id);
  const host = useRef<HTMLDivElement>(null);
  const drag = useRef<{ x: number; id: number } | null>(null);
  const p = block.props;
  const chosen = answer?.kind === 'swipe' ? answer.value : null;
  const card = () => host.current?.closest<HTMLElement>('.bk-block') ?? null;
  const move = (dx: number) => {
    const el = card();
    if (!el) return;
    el.style.translate = dx === 0 ? '' : `${dx}px 0`;
    el.style.rotate = dx === 0 ? '' : `${dx / 20}deg`;
  };
  const choose = (side: 'left' | 'right') => send({ kind: 'swipe', value: side });
  return (
    <div
      ref={host}
      className="bk-question bk-swipe"
      role="group"
      aria-label={questionLabel(block)}
      style={{ ...fill, touchAction: live ? 'pan-y' : 'auto' }}
      onPointerDown={(e) => {
        if (!live || (e.target as HTMLElement).closest('button')) return;
        drag.current = { x: e.clientX, id: e.pointerId };
        e.currentTarget.setPointerCapture?.(e.pointerId);
      }}
      onPointerMove={(e) => {
        if (drag.current?.id === e.pointerId) move(e.clientX - drag.current.x);
      }}
      onPointerUp={(e) => {
        const d = drag.current;
        drag.current = null;
        move(0);
        if (!d) return;
        const dx = e.clientX - d.x;
        const width = card()?.getBoundingClientRect().width ?? 300;
        if (Math.abs(dx) > width * 0.3) choose(dx < 0 ? 'left' : 'right');
      }}
      onPointerCancel={() => {
        drag.current = null;
        move(0);
      }}
    >
      {chosen && (
        <div aria-live="polite" style={{ position: 'absolute', top: u(10), [chosen === 'left' ? 'left' : 'right']: u(10), padding: `${u(4)} ${u(10)}`, borderRadius: u(8), border: `${u(2)} solid currentColor`, fontWeight: 800, fontSize: u(16) }}>
          {chosen === 'left' ? p.leftLabel : p.rightLabel}
        </div>
      )}
      {p.buttons && (
        <div style={{ position: 'absolute', left: 0, right: 0, bottom: u(10), display: 'flex', justifyContent: 'space-around' }}>
          {(['left', 'right'] as const).map((side) => (
            <button
              key={side}
              type="button"
              className="bk-swipe-button"
              aria-pressed={chosen === side}
              disabled={!live}
              onClick={(e) => {
                e.stopPropagation();
                choose(side);
              }}
              style={{
                ...css.text,
                minWidth: u(96),
                minHeight: u(44),
                borderRadius: u(22),
                border: `${u(2)} solid ${ctx.tokens.colors.primary}`,
                background: chosen === side ? ctx.tokens.colors.primary : ctx.tokens.colors.surface,
                color: chosen === side ? '#FFFFFF' : ctx.tokens.colors.text,
                cursor: live ? 'pointer' : 'default',
              }}
            >
              {side === 'left' ? `← ${p.leftLabel}` : `${p.rightLabel} →`}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/** B-16 Ранжирование: drag the items into order; «выше / ниже» buttons do the same from the keyboard. */
export function RankingContent({ block, css }: { block: Of<'ranking'>; css: BlockCss }): ReactNode {
  const ctx = useRenderContext();
  const [answer, send, live] = useAnswer(block.id);
  const items = block.props.items;
  const order = answer?.kind === 'ranking' && answer.order.length === items.length ? answer.order : items.map((i) => i.id);
  const list = useRef<HTMLOListElement>(null);
  const drag = useRef<{ id: string; y: number; pointer: number } | null>(null);
  const [dragging, setDragging] = useState<{ id: string; dy: number } | null>(null);
  const moveTo = (id: string, to: number) => {
    const next = order.filter((x) => x !== id);
    next.splice(Math.max(0, Math.min(next.length, to)), 0, id);
    send({ kind: 'ranking', order: next });
  };
  const rowHeight = () => (list.current?.children[0] as HTMLElement | undefined)?.getBoundingClientRect().height ?? 40;
  return (
    <ol ref={list} className="bk-question bk-ranking" aria-label={questionLabel(block)} style={{ ...fill, ...css.content, listStyle: 'none', margin: 0, display: 'flex', flexDirection: 'column', gap: u(6) }}>
      {order.map((id, index) => {
        const item = items.find((i) => i.id === id)!;
        const offset = dragging?.id === id ? dragging.dy : 0;
        return (
          <li
            key={id}
            className="bk-ranking-item"
            data-dragging={dragging?.id === id ? '' : undefined}
            onPointerDown={(e) => {
              if (!live || (e.target as HTMLElement).closest('button')) return;
              drag.current = { id, y: e.clientY, pointer: e.pointerId };
              e.currentTarget.setPointerCapture?.(e.pointerId);
              setDragging({ id, dy: 0 });
            }}
            onPointerMove={(e) => {
              if (drag.current?.pointer === e.pointerId) setDragging({ id, dy: e.clientY - drag.current.y });
            }}
            onPointerUp={(e) => {
              const d = drag.current;
              drag.current = null;
              setDragging(null);
              if (d) {
                const shift = Math.round((e.clientY - d.y) / (rowHeight() + 6));
                if (shift !== 0) moveTo(id, index + shift);
              }
            }}
            onPointerCancel={() => {
              drag.current = null;
              setDragging(null);
            }}
            style={{
              ...css.text,
              display: 'flex',
              alignItems: 'center',
              gap: u(8),
              minHeight: u(44),
              padding: `0 ${u(4)} 0 ${u(10)}`,
              borderRadius: u(10),
              border: `${u(1)} solid currentColor`,
              background: ctx.tokens.colors.surface,
              touchAction: live ? 'none' : 'auto',
              cursor: live ? 'grab' : 'default',
              translate: offset ? `0 ${offset}px` : undefined,
              zIndex: offset ? 1 : undefined,
              position: 'relative',
            }}
          >
            <span aria-hidden style={{ fontWeight: 800, minWidth: u(18) }}>
              {index + 1}
            </span>
            <span style={{ flex: 1 }}>{item.label}</span>
            <button type="button" disabled={!live || index === 0} aria-label={`Выше: ${item.label}`} onClick={(e) => (e.stopPropagation(), moveTo(id, index - 1))} style={arrowButton}>
              ↑
            </button>
            <button type="button" disabled={!live || index === order.length - 1} aria-label={`Ниже: ${item.label}`} onClick={(e) => (e.stopPropagation(), moveTo(id, index + 1))} style={arrowButton}>
              ↓
            </button>
          </li>
        );
      })}
    </ol>
  );
}
const arrowButton: CSSProperties = { width: u(36), height: u(36), border: 'none', borderRadius: u(8), background: 'transparent', color: 'inherit', font: 'inherit', fontSize: u(18), cursor: 'pointer' };

/** Russian masks of B-17: the participant types digits, the dots, colon and space appear by themselves. */
export const DATE_MASKS = { date: 'дд.мм.гггг', time: 'чч:мм', datetime: 'дд.мм.гггг чч:мм' } as const;

/** Digits typed into the mask «дд.мм.гггг чч:мм» → the text shown in the field. */
export function maskDate(raw: string, mode: keyof typeof DATE_MASKS): string {
  const digits = raw.replace(/\D/g, '').slice(0, mode === 'time' ? 4 : mode === 'date' ? 8 : 12);
  const layout = DATE_MASKS[mode];
  let out = '';
  let k = 0;
  for (const ch of layout) {
    if (k >= digits.length) break;
    out += /[дмгч]/.test(ch) ? digits[k++] : ch;
  }
  return out;
}

/** A complete masked text → the answer value (ISO: 2026-12-31, 20:00, 2026-12-31T20:00); null while incomplete. */
export function dateValue(text: string, mode: keyof typeof DATE_MASKS): string | null {
  const m = text.match(/^(?:(\d{2})\.(\d{2})\.(\d{4}))?\s?(?:(\d{2}):(\d{2}))?$/);
  if (!m) return null;
  const [, d, mo, y, h, mi] = m;
  const date = d && mo && y ? `${y}-${mo}-${d}` : null;
  const time = h && mi ? `${h}:${mi}` : null;
  const valid = (!date || (Number(mo) >= 1 && Number(mo) <= 12 && Number(d) >= 1 && Number(d) <= new Date(Number(y), Number(mo), 0).getDate())) && (!time || (Number(h) <= 23 && Number(mi) <= 59));
  if (!valid) return null;
  if (mode === 'date') return date;
  if (mode === 'time') return time;
  return date && time ? `${date}T${time}` : null;
}

/** ISO answer value → the masked text of the field. */
export function dateText(value: string, mode: keyof typeof DATE_MASKS): string {
  const m = value.match(/^(?:(\d{4})-(\d{2})-(\d{2}))?T?(?:(\d{2}):(\d{2}))?$/);
  if (!m) return '';
  const [, y, mo, d, h, mi] = m;
  const date = y ? `${d}.${mo}.${y}` : '';
  const time = h ? `${h}:${mi}` : '';
  return mode === 'date' ? date : mode === 'time' ? time : [date, time].filter(Boolean).join(' ');
}

/**
 * B-17 Дата / время: a Russian field with the mask «дд.мм.гггг» / «чч:мм» — the browser's own field would
 * show its format in the browser's language («mm/dd/yyyy»). «Календарь» opens the system picker.
 */
export function DateContent({ block, css }: { block: Of<'date'>; css: BlockCss }): ReactNode {
  const ctx = useRenderContext();
  const [answer, send, live] = useAnswer(block.id);
  const p = block.props;
  const remote = answer?.kind === 'text' ? dateText(answer.value, p.mode) : '';
  const [text, setText] = useState(remote);
  const native = useRef<HTMLInputElement>(null);
  useEffect(() => setText(remote), [remote]);
  const commit = (next: string) => {
    setText(next);
    const value = dateValue(next, p.mode);
    if (next === '') send(null);
    else if (value) send({ kind: 'text', value });
  };
  const nativeType = p.mode === 'datetime' ? 'datetime-local' : p.mode;
  return (
    <div className="bk-question" style={{ ...fill, ...css.content, display: 'flex', flexDirection: 'row', alignItems: 'center', gap: u(6) }}>
      <input
        className="bk-field"
        type="text"
        inputMode="numeric"
        autoComplete="off"
        aria-label={`${questionLabel(block)}, формат ${DATE_MASKS[p.mode]}`}
        placeholder={DATE_MASKS[p.mode]}
        required={p.required}
        aria-required={p.required}
        aria-invalid={text !== '' && text.length === DATE_MASKS[p.mode].length && dateValue(text, p.mode) === null ? true : undefined}
        readOnly={!live}
        tabIndex={live ? 0 : -1}
        value={text}
        onChange={(e) => commit(maskDate(e.target.value, p.mode))}
        onClick={(e) => e.stopPropagation()}
        style={{ ...fieldStyle(css), flex: 1, minWidth: 0 }}
      />
      <input
        ref={native}
        type={nativeType}
        tabIndex={-1}
        aria-hidden
        {...(p.min ? { min: p.min } : {})}
        {...(p.max ? { max: p.max } : {})}
        value={answer?.kind === 'text' ? answer.value : ''}
        onChange={(e) => commit(dateText(e.target.value, p.mode))}
        style={{ position: 'absolute', width: 1, height: 1, opacity: 0, pointerEvents: 'none', right: 0, bottom: 0 }}
      />
      <button
        type="button"
        className="bk-date-picker"
        aria-label="Календарь"
        disabled={!live}
        onClick={(e) => {
          e.stopPropagation();
          const el = native.current;
          // Old browsers have no picker on request — then the hidden field just gets the focus.
          try {
            el?.showPicker();
          } catch {
            el?.focus();
          }
        }}
        style={{ flex: 'none', width: u(36), height: u(36), border: 'none', borderRadius: u(8), background: 'transparent', color: ctx.tokens.colors.text, font: 'inherit', fontSize: u(18), cursor: live ? 'pointer' : 'default' }}
      >
        <span aria-hidden>{p.mode === 'time' ? '🕑' : '📅'}</span>
      </button>
    </div>
  );
}

const CONTACT_FIELDS = {
  name: { label: 'Имя', type: 'text', autoComplete: 'name' },
  phone: { label: 'Телефон', type: 'tel', autoComplete: 'tel' },
  email: { label: 'Почта', type: 'email', autoComplete: 'email' },
  city: { label: 'Город', type: 'text', autoComplete: 'address-level2' },
} as const;

/** B-19 Контактные данные: labelled fields with the right keyboards and autocomplete (PL-23 is checked at publishing). */
export function ContactsContent({ block, css }: { block: Of<'contacts'>; css: BlockCss }): ReactNode {
  const [answer, send, live] = useAnswer(block.id);
  const remote = answer?.kind === 'contacts' ? answer.values : {};
  const [values, setValues] = useState<Partial<Record<keyof typeof CONTACT_FIELDS, string>>>(remote);
  const { push, flush } = useDebouncedSend<typeof values>((v) => send(Object.values(v).some((x) => x) ? { kind: 'contacts', values: v } : null));
  return (
    <fieldset className="bk-question" style={{ ...fill, ...css.content, border: 'none', margin: 0, display: 'flex', flexDirection: 'column', gap: u(8), minWidth: 0 }}>
      <legend className="bk-sr-only" style={SR_ONLY}>
        {questionLabel(block)}
      </legend>
      {block.props.fields.map((field) => {
        const f = CONTACT_FIELDS[field];
        return (
          <label key={field} style={{ ...css.text, display: 'flex', flexDirection: 'column', gap: u(2), fontSize: u(12) }}>
            <span>{f.label}</span>
            <input
              className="bk-field"
              type={f.type}
              autoComplete={f.autoComplete}
              inputMode={field === 'phone' ? 'tel' : field === 'email' ? 'email' : undefined}
              required={block.props.required}
              aria-required={block.props.required}
              readOnly={!live}
              tabIndex={live ? 0 : -1}
              maxLength={200}
              value={values[field] ?? ''}
              onChange={(e) => {
                const next = { ...values, [field]: e.target.value };
                setValues(next);
                push(next);
              }}
              onBlur={flush}
              onClick={(e) => e.stopPropagation()}
              style={{ ...css.text, height: u(40), padding: `0 ${u(10)}`, borderRadius: u(8), border: `${u(1)} solid currentColor`, background: 'transparent', boxSizing: 'border-box' }}
            />
          </label>
        );
      })}
    </fieldset>
  );
}

export const SR_ONLY: CSSProperties = { position: 'absolute', width: 1, height: 1, padding: 0, margin: -1, overflow: 'hidden', clip: 'rect(0, 0, 0, 0)', whiteSpace: 'nowrap', border: 0 };

/**
 * B-20 Согласие на обработку ПД: an unticked checkbox and a link to the consent text made from the creator's
 * details (PL-23). The text and the logic are fixed; the look follows the block's style.
 */
export function ConsentContent({ block, css }: { block: Of<'consent'>; css: BlockCss }): ReactNode {
  const ctx = useRenderContext();
  const [answer, send, live] = useAnswer(block.id);
  const checked = answer?.kind === 'consent' && answer.value;
  return (
    <label className="bk-question bk-consent" style={{ ...fill, ...css.content, ...css.text, display: 'flex', flexDirection: 'row', alignItems: 'center', gap: u(10), cursor: live ? 'pointer' : 'default' }} onClick={(e) => e.stopPropagation()}>
      <input
        type="checkbox"
        className="bk-field"
        checked={checked}
        disabled={!live}
        onChange={(e) => send(e.target.checked ? { kind: 'consent', value: true } : null)}
        style={{ width: u(22), height: u(22), flex: 'none', margin: 0, accentColor: ctx.tokens.colors.primary }}
      />
      <span>
        {ctx.consentUrl ? (
          <a href={ctx.consentUrl} target="_blank" rel="noopener noreferrer" style={{ color: 'inherit', textDecoration: 'underline' }}>
            {block.props.linkText}
          </a>
        ) : (
          block.props.linkText
        )}
      </span>
    </label>
  );
}
