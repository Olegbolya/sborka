import { type PointerEvent as ReactPointerEvent, type SyntheticEvent } from 'react';
import { ARTBOARD_WIDTH } from '../units.js';

/** Pixels in one artboard unit where the element is drawn (the artboard is 390 units wide). */
export function pxPerUnit(el: Element): number {
  const board = el.closest('.bk-artboard') ?? el;
  const width = board.getBoundingClientRect().width;
  return width > 0 ? width / ARTBOARD_WIDTH : 1;
}

type Handler<E> = ((e: E) => void) | undefined;
export type PointerHandlers = Partial<{
  onPointerDown: (e: ReactPointerEvent<HTMLDivElement>) => void;
  onPointerMove: (e: ReactPointerEvent<HTMLDivElement>) => void;
  onPointerUp: (e: ReactPointerEvent<HTMLDivElement>) => void;
  onPointerCancel: (e: ReactPointerEvent<HTMLDivElement>) => void;
  onClickCapture: (e: SyntheticEvent) => void;
  /** The browser's own drag of a picture or selected text would cancel the pointer mid-gesture. */
  onDragStart: (e: SyntheticEvent) => void;
}>;

/** Joins handler sets: for the same event every handler runs, in order. */
export function mergeHandlers<T extends Record<string, unknown>>(...sets: Array<Partial<T>>): Partial<T> {
  const out: Record<string, unknown> = {};
  for (const set of sets) {
    for (const [key, fn] of Object.entries(set)) {
      if (typeof fn !== 'function') continue;
      const prev = out[key] as Handler<unknown>;
      out[key] = prev ? (e: unknown) => (prev(e), (fn as (e: unknown) => void)(e)) : fn;
    }
  }
  return out as Partial<T>;
}
