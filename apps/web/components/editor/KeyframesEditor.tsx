'use client';
import { type Block, type Color, type ThemeTokens } from '@blokum/schema';
import { type ANIM_VARS, customKeyframes, loopPlan, runPlan } from '@blokum/renderer';
import { useState } from 'react';
import { ColorInput, NumberInput } from './controls';

type Keyframe = NonNullable<NonNullable<NonNullable<Block['animation']>['enter']>['keyframes']>[number];
/** S-12…S-14 · editor of own animation by keyframes: time of a frame, values of properties, fill colour; «Проиграть» runs it on the canvas. */
export type Frames = Keyframe[];
export type Slot = 'enter' | 'loop' | 'press';

/** Properties the person can change in a frame (width and height are not animated by the canvas layer). */
export const FRAME_PROPS: Array<{ key: keyof typeof ANIM_VARS; label: string; min: number; max: number; step: number; neutral: number; suffix?: string }> = [
  { key: 'x', label: 'Сдвиг по горизонтали', min: -1000, max: 1000, step: 1, neutral: 0 },
  { key: 'y', label: 'Сдвиг по вертикали', min: -1000, max: 1000, step: 1, neutral: 0 },
  { key: 'rotation', label: 'Поворот, °', min: -3600, max: 3600, step: 1, neutral: 0 },
  { key: 'scale', label: 'Масштаб', min: 0, max: 20, step: 0.05, neutral: 1 },
  { key: 'opacity', label: 'Прозрачность (1 — непрозрачно)', min: 0, max: 1, step: 0.05, neutral: 1 },
  { key: 'blur', label: 'Размытие', min: 0, max: 200, step: 1, neutral: 0 },
  { key: 'backdropBlur', label: 'Размытие фона под блоком', min: 0, max: 200, step: 1, neutral: 0 },
  { key: 'rotateX', label: 'Наклон вперёд, °', min: -360, max: 360, step: 1, neutral: 0 },
  { key: 'rotateY', label: 'Наклон вбок, °', min: -360, max: 360, step: 1, neutral: 0 },
  { key: 'brightness', label: 'Яркость', min: 0, max: 5, step: 0.05, neutral: 1 },
  { key: 'contrast', label: 'Контрастность', min: 0, max: 5, step: 0.05, neutral: 1 },
  { key: 'saturate', label: 'Насыщенность', min: 0, max: 5, step: 0.05, neutral: 1 },
  { key: 'grayscale', label: 'Чёрно-белое (0…1)', min: 0, max: 1, step: 0.05, neutral: 0 },
  { key: 'hueRotate', label: 'Сдвиг оттенка, °', min: -360, max: 360, step: 1, neutral: 0 },
];

/** What a block gets when «своя анимация» is chosen: a smooth appearance by size and opacity, which the person then edits. */
export const DEFAULT_FRAMES: Frames = [
  { at: 0, props: { opacity: 0, scale: 0.8 } },
  { at: 1, props: { opacity: 1, scale: 1 } },
];

const MAX_FRAMES = 20;
const byTime = (a: Keyframe, b: Keyframe): number => a.at - b.at;

/** Plays the frames on the block of the canvas once and returns it to rest. */
export function playFrames(blockId: string, frames: Frames, durationMs: number, tokens: Pick<ThemeTokens, 'colors'>): boolean {
  const layer = document.querySelector<HTMLElement>(`[data-block-id="${CSS.escape(blockId)}"] .bk-anim`);
  if (!layer) return false;
  const plan = customKeyframes(frames, tokens);
  const controls = runPlan(layer, { ...plan, duration: durationMs / 1000, delay: 0, ease: (t) => t });
  void controls.finished.then(() => {
    controls.cancel();
    for (const name of Object.keys(plan.keyframes)) layer.style.removeProperty(name);
  });
  return true;
}

export function KeyframesEditor({
  slot,
  frames,
  durationMs,
  blockId,
  tokens,
  onChange,
}: {
  slot: Slot;
  frames: Frames;
  durationMs: number;
  blockId: string | null;
  tokens: ThemeTokens;
  onChange: (next: Frames) => void;
}) {
  const [open, setOpen] = useState(0);
  const [note, setNote] = useState<string | null>(null);
  const sorted = [...frames].sort(byTime);
  const at = Math.min(open, sorted.length - 1);
  const frame = sorted[at]!;
  const testid = `keyframes-${slot}`;

  const write = (list: Frames, focus?: Keyframe): void => {
    const next = [...list].sort(byTime);
    onChange(next);
    if (focus) setOpen(Math.max(0, next.indexOf(focus)));
  };
  const patch = (change: Partial<Keyframe>): void => {
    const edited = { ...frame, ...change };
    write(sorted.map((f) => (f === frame ? edited : f)), edited);
  };
  const setProp = (key: keyof typeof ANIM_VARS, value: number | null): void => {
    const props = { ...frame.props } as Record<string, number>;
    if (value === null) delete props[key];
    else props[key] = value;
    patch({ props: props });
  };
  const add = (): void => {
    if (sorted.length >= MAX_FRAMES) return;
    const last = sorted[sorted.length - 1]!;
    const prev = sorted.length > 1 ? sorted[sorted.length - 2]!.at : 0;
    const created: Keyframe = { at: Math.round(((prev + last.at) / 2) * 100) / 100, props: { ...frame.props }, ...(frame.fill ? { fill: frame.fill } : {}) };
    write([...sorted, created], created);
  };
  const remove = (): void => {
    if (sorted.length <= 2) return;
    write(sorted.filter((f) => f !== frame));
    setOpen(Math.max(0, at - 1));
  };
  const play = (): void => {
    setNote(null);
    if (!blockId || !playFrames(blockId, sorted, durationMs, tokens)) setNote('Блок не найден на холсте: выберите экран, на котором он лежит.');
  };

  return (
    <div className="ed-keyframes" data-testid={testid} data-control={`${slot}.keyframes`}>
      <div className="ed-kf-head">
        <strong>Кадры своей анимации</strong>
        <button type="button" className="ed-btn" data-testid={`${testid}-play`} onClick={play}>
          Проиграть
        </button>
      </div>
      <div className="ed-kf-strip" role="tablist" aria-label="Кадры">
        {sorted.map((f, i) => (
          <button key={`${f.at}-${i}`} type="button" role="tab" aria-selected={i === at} className={`ed-chip${i === at ? ' is-on' : ''}`} onClick={() => setOpen(i)}>
            {Math.round(f.at * 100)}%
          </button>
        ))}
        <button type="button" className="ed-btn" data-testid={`${testid}-add`} disabled={sorted.length >= MAX_FRAMES} onClick={add} title={sorted.length >= MAX_FRAMES ? `Не больше ${MAX_FRAMES} кадров` : 'Добавить кадр между последними'}>
          + Кадр
        </button>
      </div>
      <NumberInput control={`${slot}.keyframes.at`} label="Момент кадра, % длительности" value={frame.at} scale={100} min={0} max={1} step={1} onChange={(v) => patch({ at: v })} />
      {FRAME_PROPS.map((p) => (
        <NumberInput
          key={p.key}
          control={`${slot}.keyframes.props.${p.key}`}
          label={p.label}
          value={frame.props[p.key] ?? p.neutral}
          min={p.min}
          max={p.max}
          step={p.step}
          onChange={(v) => setProp(p.key, v)}
        />
      ))}
      <ColorInput control={`${slot}.keyframes.fill`} label="Цвет заливки в кадре" value={frame.fill ?? null} tokens={tokens} onChange={(c: Color) => patch({ fill: c })} />
      <div className="ed-kf-actions">
        {frame.fill && (
          <button type="button" className="ed-btn" onClick={() => patch({ fill: undefined })}>
            Убрать цвет
          </button>
        )}
        {Object.keys(frame.props).length > 0 && (
          <button type="button" className="ed-btn" onClick={() => patch({ props: {} })}>
            Очистить свойства кадра
          </button>
        )}
        <button type="button" className="ed-btn" data-testid={`${testid}-remove`} disabled={sorted.length <= 2} onClick={remove} title={sorted.length <= 2 ? 'Нужно минимум два кадра' : 'Удалить выбранный кадр'}>
          Удалить кадр
        </button>
      </div>
      <p className="ed-hint">Свойство, которое в кадре не заполнено, берётся из соседних кадров. Кадров нужно от 2 до {MAX_FRAMES}.</p>
      {note && (
        <p role="alert" className="ed-hint">
          {note}
        </p>
      )}
    </div>
  );
}

/** What «движение по контуру» starts with: a loop to the right and back (units of the canvas, from the first point). */
export const DEFAULT_MOTION_PATH = 'M 0 0 C 0 -40 80 -40 80 0 C 80 40 0 40 0 0';

/** Plays one lap of the motion path on the block of the canvas. */
export function playMotionPath(blockId: string, path: string, tokens: Pick<ThemeTokens, 'colors'>): boolean {
  const layer = document.querySelector<HTMLElement>(`[data-block-id="${CSS.escape(blockId)}"] .bk-anim`);
  if (!layer) return false;
  const plan = loopPlan({ kind: 'followPath', speed: 1, amplitude: 1, pauseMs: 0, path }, tokens, false);
  if (!plan) return false;
  const controls = runPlan(layer, { ...plan, repeat: 0, repeatDelay: 0 });
  void controls.finished.then(() => {
    controls.cancel();
    for (const name of Object.keys(plan.keyframes)) layer.style.removeProperty(name);
  });
  return true;
}
