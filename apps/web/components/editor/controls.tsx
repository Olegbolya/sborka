'use client';
import { cssColor } from '@blokum/renderer';
import { type Color, type ThemeTokens } from '@blokum/schema';
import { type ReactNode, useEffect, useRef, useState } from 'react';
import { useEnv } from './context';

/** Names of the colour roles every theme has (TH-01), for the list of theme colours. */
export const ROLE_TITLES: Record<string, string> = {
  background: 'Фон',
  surface: 'Поверхность',
  primary: 'Основной',
  accent: 'Акцент',
  text: 'Текст',
  muted: 'Приглушённый',
  success: 'Успех',
  error: 'Ошибка',
};

/** A collapsible group of properties with the mark «своё» and «Сбросить к теме» (TH-06). */
export function Section({ id, title, own, onReset, resetLabel = 'Сбросить к теме', children, open = false }: { id: string; title: string; own?: boolean; onReset?: () => void; resetLabel?: string; children: ReactNode; open?: boolean }) {
  // The group stays as the person left it (open or closed) whatever happens to the values inside.
  const [isOpen, setIsOpen] = useState(open);
  return (
    <details className="ed-sec" data-section={id} open={isOpen} onToggle={(e) => setIsOpen(e.currentTarget.open)}>
      <summary>
        <span>{title}</span>
        {own && (
          <span className="ed-own" data-testid={`own-${id}`}>
            своё
          </span>
        )}
      </summary>
      <div className="ed-sec-body">
        {own && onReset && (
          <button type="button" className="ed-btn small" aria-label={`${resetLabel}: ${title}`} onClick={onReset}>
            {resetLabel}
          </button>
        )}
        {children}
      </div>
    </details>
  );
}

const clamp = (n: number, min?: number, max?: number): number => Math.min(max ?? Number.POSITIVE_INFINITY, Math.max(min ?? Number.NEGATIVE_INFINITY, n));
const precision = (step: number): number => (String(step).split('.')[1]?.length ?? 0) + 1;
const roundTo = (n: number, step: number): number => Number(n.toFixed(precision(step)));

/**
 * A number: typed, or dragged by its label («протягивание», Shift — ×10, Alt — ×0.1). The whole dragging is one step of the
 * history. `value` is null when the selected blocks differ («смешанно»).
 */
export function NumberInput({ control, label, value, onChange, min, max, step = 1, suffix, scale = 1 }: { control: string; label: string; value: number | null; onChange: (n: number) => void; min?: number; max?: number; step?: number; suffix?: string; scale?: number }) {
  const { store } = useEnv();
  const shown = value === null ? '' : String(roundTo(value * scale, step));
  // What is typed is shown while it still means the stored number («5.», «05», a lone «-»); otherwise the stored value
  // (after undo, after another block is picked): there is no frame in which the field shows an old number.
  const [draft, setDraft] = useState<string | null>(null);
  const text = draft !== null && (Number.isNaN(Number(draft)) || shown === '' || Number(draft) === Number(shown)) ? draft : shown;
  const commit = (n: number) => onChange(clamp(roundTo(n / scale, step / scale), min, max));

  const scrub = (e: React.PointerEvent<HTMLSpanElement>) => {
    if (e.button !== 0) return;
    e.preventDefault();
    const target = e.currentTarget;
    target.setPointerCapture(e.pointerId);
    const from = { x: e.clientX, v: (value ?? 0) * scale };
    let began = false;
    const move = (ev: PointerEvent) => {
      const dx = ev.clientX - from.x;
      if (!began && Math.abs(dx) < 3) return;
      if (!began) {
        began = true;
        store.getState().beginGesture(`Изменить: ${label}`);
      }
      const speed = ev.shiftKey ? 10 : ev.altKey ? 0.1 : 1;
      const n = clamp(from.v + dx * step * speed, min === undefined ? undefined : min * scale, max === undefined ? undefined : max * scale);
      commit(roundTo(n, step));
    };
    const up = () => {
      target.removeEventListener('pointermove', move);
      target.removeEventListener('pointerup', up);
      target.removeEventListener('pointercancel', up);
      if (began) store.getState().endGesture();
    };
    target.addEventListener('pointermove', move);
    target.addEventListener('pointerup', up);
    target.addEventListener('pointercancel', up);
  };

  return (
    <div className="ed-num" data-control={control}>
      <span className="ed-scrub" onPointerDown={scrub} title="Потяните, чтобы изменить">
        {label}
      </span>
      <div className="ed-numrow">
        <input
          type="number"
          aria-label={label}
          value={text}
          placeholder={value === null ? 'смешанно' : undefined}
          step={step}
          {...(min !== undefined ? { min: min * scale } : {})}
          {...(max !== undefined ? { max: max * scale } : {})}
          onBlur={() => setDraft(null)}
          onChange={(e) => {
            setDraft(e.target.value);
            const n = e.target.valueAsNumber;
            if (Number.isFinite(n)) commit(n);
          }}
        />
        {suffix && <span className="ed-suffix">{suffix}</span>}
      </div>
    </div>
  );
}

/** A number with a slider next to it (opacity, filters…). */
export function SliderInput(props: { control: string; label: string; value: number | null; onChange: (n: number) => void; min: number; max: number; step: number; scale?: number; suffix?: string }) {
  const scale = props.scale ?? 1;
  return (
    <div className="ed-slider" data-control={`${props.control}`}>
      <NumberInput {...props} control={`${props.control}#number`} />
      <input
        type="range"
        aria-label={`${props.label}: ползунок`}
        min={props.min * scale}
        max={props.max * scale}
        step={props.step}
        value={(props.value ?? props.min) * scale}
        onChange={(e) => props.onChange(clamp(roundTo(Number(e.target.value) / scale, props.step / scale), props.min, props.max))}
      />
    </div>
  );
}

export function SelectInput<T extends string>({ control, label, value, options, onChange }: { control: string; label: string; value: T | null; options: ReadonlyArray<readonly [T, string]>; onChange: (v: T) => void }) {
  return (
    <label className="ed-field" data-control={control}>
      <span>{label}</span>
      <select aria-label={label} value={value ?? ''} onChange={(e) => onChange(e.target.value as T)}>
        {value === null && (
          <option value="" disabled>
            смешанно
          </option>
        )}
        {options.map(([v, t]) => (
          <option key={v} value={v}>
            {t}
          </option>
        ))}
      </select>
    </label>
  );
}

export function Toggle({ control, label, value, onChange }: { control: string; label: string; value: boolean | null; onChange: (v: boolean) => void }) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (ref.current) ref.current.indeterminate = value === null;
  }, [value]);
  return (
    <label className="ed-check" data-control={control}>
      <input ref={ref} type="checkbox" checked={value === true} onChange={(e) => onChange(e.target.checked)} />
      <span>{label}</span>
    </label>
  );
}

export function TextInput({ control, label, value, onChange, max, placeholder }: { control: string; label: string; value: string | null; onChange: (v: string) => void; max?: number; placeholder?: string }) {
  return (
    <label className="ed-field" data-control={control}>
      <span>{label}</span>
      <input type="text" aria-label={label} value={value ?? ''} placeholder={value === null ? 'смешанно' : placeholder} {...(max ? { maxLength: max } : {})} onChange={(e) => onChange(e.target.value)} />
    </label>
  );
}

interface EyeDropperApi {
  open: () => Promise<{ sRGBHex: string }>;
}

const hexOf = (c: Color): string => ('hex' in c ? c.hex : '#000000');
const alphaOf = (c: Color): number => {
  if ('token' in c) return c.alpha;
  return c.hex.length === 9 ? Math.round((parseInt(c.hex.slice(7, 9), 16) / 255) * 100) / 100 : 1;
};
const withAlpha = (rgb: string, alpha: number): Color => ({ hex: alpha >= 1 ? rgb.slice(0, 7) : `${rgb.slice(0, 7)}${Math.round(alpha * 255).toString(16).padStart(2, '0')}` });

/**
 * A colour (S-04…): from the theme (a role or an own colour of the theme) or its own HEX, with transparency; the eyedropper
 * where the browser has one.
 */
export function ColorInput({ control, label, value, onChange, tokens }: { control: string; label: string; value: Color | null; onChange: (c: Color) => void; tokens: ThemeTokens }) {
  const mode = value && 'token' in value ? 'token' : 'hex';
  const names = Object.keys(tokens.colors);
  const current: Color = value ?? { hex: '#000000' };
  const eyedropper = typeof window !== 'undefined' && 'EyeDropper' in window;
  const currentHex = hexOf(current);
  const [hexText, setHexText] = useState(currentHex);
  useEffect(() => setHexText(currentHex), [currentHex]);
  const alpha = Math.round(alphaOf(current) * 100);
  return (
    <div className="ed-color" data-control={control} role="group" aria-label={label}>
      <span className="ed-colorlabel">{label}</span>
      <div className="ed-colorrow">
        <span className="ed-swatch" aria-hidden style={{ background: value ? cssColor(value, tokens) : 'repeating-conic-gradient(#ccc 0 25%, #fff 0 50%) 0 0 / 8px 8px' }} />
        <select
          aria-label={`${label}: источник`}
          value={value === null ? '' : mode}
          onChange={(e) => {
            if (e.target.value === 'token') onChange({ token: names.includes('primary') ? 'primary' : names[0]!, alpha: alphaOf(current) });
            else onChange(withAlpha(mode === 'hex' ? hexOf(current) : '#000000', alphaOf(current)));
          }}
        >
          {value === null && (
            <option value="" disabled>
              смешанно
            </option>
          )}
          <option value="token">Из темы</option>
          <option value="hex">Свой цвет</option>
        </select>
      </div>
      <div className="ed-colorrow">
        {mode === 'token' ? (
          <select aria-label={`${label}: цвет темы`} value={'token' in current ? current.token : ''} onChange={(e) => onChange({ token: e.target.value, alpha: alphaOf(current) })}>
            {names.map((n) => (
              <option key={n} value={n}>
                {ROLE_TITLES[n] ?? n}
              </option>
            ))}
          </select>
        ) : (
          <>
            <input type="color" aria-label={`${label}: выбор цвета`} value={hexOf(current).slice(0, 7)} onChange={(e) => onChange(withAlpha(e.target.value, alphaOf(current)))} />
            <input
              type="text"
              aria-label={`${label}: HEX`}
              value={hexText}
              maxLength={9}
              spellCheck={false}
              onChange={(e) => {
                setHexText(e.target.value);
                if (/^#[0-9a-fA-F]{6}([0-9a-fA-F]{2})?$/.test(e.target.value)) onChange({ hex: e.target.value });
              }}
            />
            {eyedropper && (
              <button
                type="button"
                className="ed-btn small"
                aria-label={`${label}: пипетка`}
                onClick={() => {
                  const Dropper = (window as unknown as { EyeDropper: new () => EyeDropperApi }).EyeDropper;
                  new Dropper()
                    .open()
                    .then((r) => onChange(withAlpha(r.sRGBHex, alphaOf(current))))
                    .catch(() => undefined);
                }}
              >
                Пипетка
              </button>
            )}
          </>
        )}
        <label className="ed-alpha">
          <input
            type="number"
            aria-label={`${label}: прозрачность, %`}
            min={0}
            max={100}
            value={alpha}
            onChange={(e) => {
              const a = clamp(e.target.valueAsNumber / 100, 0, 1);
              if (!Number.isFinite(a)) return;
              onChange('token' in current ? { token: current.token, alpha: a } : withAlpha(hexOf(current), a));
            }}
          />
          <span className="ed-suffix">%</span>
        </label>
      </div>
    </div>
  );
}
