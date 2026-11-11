'use client';
import { type Block } from '@blokum/schema';
import { type KeyboardEvent, type PointerEvent, useRef, useState, useSyncExternalStore } from 'react';
import { mediaUrl } from '../../lib/editor/media';
import { useControlEnv } from './context';

export interface Crop {
  x: number;
  y: number;
  w: number;
  h: number;
}
export interface Focal {
  x: number;
  y: number;
}

/** Sides of the frame the person can pull; «move» drags the whole frame. */
type Grip = 'move' | 'n' | 's' | 'e' | 'w' | 'nw' | 'ne' | 'sw' | 'se';
const GRIPS: Grip[] = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];
const GRIP_TITLE: Record<Grip, string> = {
  move: 'Рамка кадра',
  n: 'Верхняя сторона кадра',
  s: 'Нижняя сторона кадра',
  e: 'Правая сторона кадра',
  w: 'Левая сторона кадра',
  nw: 'Левый верхний угол кадра',
  ne: 'Правый верхний угол кадра',
  sw: 'Левый нижний угол кадра',
  se: 'Правый нижний угол кадра',
};
const MIN_SIDE = 0.05;
export const FULL: Crop = { x: 0, y: 0, w: 1, h: 1 };

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));
const round = (v: number): number => Math.round(v * 1000) / 1000;

/** The frame after pulling a grip by (dx, dy) — fractions of the whole file; it never leaves the file and never gets thinner than MIN_SIDE. */
export function pull(from: Crop, grip: Grip, dx: number, dy: number): Crop {
  if (grip === 'move') return { ...from, x: round(clamp(from.x + dx, 0, 1 - from.w)), y: round(clamp(from.y + dy, 0, 1 - from.h)) };
  let { x, y, w, h } = from;
  if (grip.includes('w')) {
    const nx = clamp(x + dx, 0, x + w - MIN_SIDE);
    w += x - nx;
    x = nx;
  }
  if (grip.includes('e')) w = clamp(w + dx, MIN_SIDE, 1 - x);
  if (grip.includes('n')) {
    const ny = clamp(y + dy, 0, y + h - MIN_SIDE);
    h += y - ny;
    y = ny;
  }
  if (grip.includes('s')) h = clamp(h + dy, MIN_SIDE, 1 - y);
  return { x: round(x), y: round(y), w: round(w), h: round(h) };
}

/** Arrow keys move the grip by 1 % (with Shift — by 10 %), so the frame can be set without a pointer. */
const KEY_STEP: Record<string, [number, number]> = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };

/**
 * S-11 · visual framing: the file itself with the frame to crop and the focus point to drag. The numbers of the group
 * «Медиа» stay below and show the same values; both write to the same fields.
 */
export function MediaFramer({ block, crop, focal, onCrop, onFocal }: { block: Block; crop: Crop | null; focal: Focal; onCrop: (next: Crop | undefined) => void; onFocal: (next: Focal) => void }) {
  const { media } = useControlEnv();
  useSyncExternalStore(media.subscribe, media.getSnapshot, media.getSnapshot);
  const ref = (block.props as { media?: { id?: string } | null }).media;
  const item = ref?.id ? media.items().find((m) => m.id === ref.id) : undefined;
  const [natural, setNatural] = useState<{ w: number; h: number } | null>(null);
  const box = useRef<HTMLDivElement | null>(null);
  const drag = useRef<{ grip: Grip | 'focal'; from: Crop; startX: number; startY: number } | null>(null);
  const frame = crop ?? FULL;
  if (!ref?.id || !item) return <p className="ed-hint" data-testid="media-framer-empty">Выберите файл блока, и здесь появится кадр для обрезки.</p>;
  if (item.status === 'REJECTED' || item.status === 'BLOCKED') return <p className="ed-hint" data-testid="media-framer-empty">Этот файл не прошёл проверку, обрезать его нельзя. Выберите другой.</p>;

  const width = item.width ?? natural?.w ?? 4;
  const height = item.height ?? natural?.h ?? 3;
  const src = mediaUrl(item.id);

  const down = (grip: Grip | 'focal') => (e: PointerEvent<HTMLElement>) => {
    e.preventDefault();
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { grip, from: frame, startX: e.clientX, startY: e.clientY };
  };
  const move = (e: PointerEvent<HTMLElement>) => {
    const d = drag.current;
    const rect = box.current?.getBoundingClientRect();
    if (!d || !rect || rect.width === 0 || rect.height === 0) return;
    if (d.grip === 'focal') {
      onFocal({ x: round(clamp((e.clientX - rect.left) / rect.width, 0, 1)), y: round(clamp((e.clientY - rect.top) / rect.height, 0, 1)) });
      return;
    }
    onCrop(pull(d.from, d.grip, (e.clientX - d.startX) / rect.width, (e.clientY - d.startY) / rect.height));
  };
  const up = () => {
    drag.current = null;
  };
  const key = (grip: Grip | 'focal') => (e: KeyboardEvent<HTMLElement>) => {
    const step = KEY_STEP[e.key];
    if (!step) return;
    e.preventDefault();
    e.stopPropagation();
    const k = e.shiftKey ? 0.1 : 0.01;
    if (grip === 'focal') onFocal({ x: round(clamp(focal.x + step[0] * k, 0, 1)), y: round(clamp(focal.y + step[1] * k, 0, 1)) });
    else onCrop(pull(frame, grip, step[0] * k, step[1] * k));
  };

  const isVideo = item.kind === 'VIDEO' || item.kind === 'GIF';
  return (
    <div className="ed-framer" data-testid="media-framer">
      <div ref={box} className="ed-framer-box" style={{ aspectRatio: `${width} / ${height}` }}>
        {isVideo ? (
          <video src={src} muted preload="metadata" playsInline aria-hidden="true" onLoadedMetadata={(e) => setNatural({ w: e.currentTarget.videoWidth, h: e.currentTarget.videoHeight })} />
        ) : (
          <img src={src} alt="" aria-hidden="true" draggable={false} onLoad={(e) => setNatural({ w: e.currentTarget.naturalWidth, h: e.currentTarget.naturalHeight })} />
        )}
        <div
          className="ed-framer-crop"
          data-testid="media-framer-crop"
          role="group"
          aria-label={GRIP_TITLE.move}
          tabIndex={0}
          style={{ left: `${frame.x * 100}%`, top: `${frame.y * 100}%`, width: `${frame.w * 100}%`, height: `${frame.h * 100}%` }}
          onPointerDown={down('move')}
          onPointerMove={move}
          onPointerUp={up}
          onPointerCancel={up}
          onKeyDown={key('move')}
        >
          {GRIPS.map((g) => (
            <span key={g} className={`ed-framer-grip g-${g}`} role="button" tabIndex={0} aria-label={GRIP_TITLE[g]} data-grip={g} onPointerDown={down(g)} onPointerMove={move} onPointerUp={up} onPointerCancel={up} onKeyDown={key(g)} />
          ))}
        </div>
        <span
          className="ed-framer-focal"
          data-testid="media-framer-focal"
          role="button"
          tabIndex={0}
          aria-label="Фокус-точка: что должно остаться в кадре при обрезке"
          style={{ left: `${focal.x * 100}%`, top: `${focal.y * 100}%` }}
          onPointerDown={down('focal')}
          onPointerMove={move}
          onPointerUp={up}
          onPointerCancel={up}
          onKeyDown={key('focal')}
        />
      </div>
      <p className="ed-hint">Потяните за углы и стороны рамки, чтобы обрезать; точку — чтобы выбрать главное место. С клавиатуры: стрелки, с Shift — крупнее.</p>
      <div className="ed-kf-actions">
        <button type="button" className="ed-btn" data-testid="media-framer-reset" disabled={!crop} onClick={() => onCrop(undefined)}>
          Убрать кадрирование
        </button>
        <button type="button" className="ed-btn" disabled={focal.x === 0.5 && focal.y === 0.5} onClick={() => onFocal({ x: 0.5, y: 0.5 })}>
          Фокус в центр
        </button>
      </div>
    </div>
  );
}
