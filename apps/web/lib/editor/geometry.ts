import { type Block } from '@blokum/schema';

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Point {
  x: number;
  y: number;
}

export type Handle = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw';
export const HANDLES: readonly Handle[] = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];

/** Limits of a frame (S-01). */
export const MIN_SIZE = 1;
export const MAX_SIZE = 3000;

const rad = (deg: number): number => (deg * Math.PI) / 180;
const round1 = (n: number): number => Math.round(n * 10) / 10;

export const center = (r: Rect): Point => ({ x: r.x + r.w / 2, y: r.y + r.h / 2 });

/** Smallest rectangle around the frame as it is drawn (a turned block takes more room). */
export function boundsOf(frame: Rect & { rotation?: number }): Rect {
  const a = rad(frame.rotation ?? 0);
  if (a === 0) return { x: frame.x, y: frame.y, w: frame.w, h: frame.h };
  const cos = Math.abs(Math.cos(a));
  const sin = Math.abs(Math.sin(a));
  const w = frame.w * cos + frame.h * sin;
  const h = frame.w * sin + frame.h * cos;
  const c = center(frame);
  return { x: c.x - w / 2, y: c.y - h / 2, w, h };
}

export function unionOf(rects: readonly Rect[]): Rect | null {
  if (rects.length === 0) return null;
  const x1 = Math.min(...rects.map((r) => r.x));
  const y1 = Math.min(...rects.map((r) => r.y));
  const x2 = Math.max(...rects.map((r) => r.x + r.w));
  const y2 = Math.max(...rects.map((r) => r.y + r.h));
  return { x: x1, y: y1, w: x2 - x1, h: y2 - y1 };
}

export const intersects = (a: Rect, b: Rect): boolean => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

export const rectFromPoints = (a: Point, b: Point): Rect => ({ x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w: Math.abs(a.x - b.x), h: Math.abs(a.y - b.y) });

/** Which edges a handle moves: -1 left/top, +1 right/bottom, 0 none. */
export function handleAxes(h: Handle): { sx: -1 | 0 | 1; sy: -1 | 0 | 1 } {
  return { sx: h.includes('e') ? 1 : h.includes('w') ? -1 : 0, sy: h.includes('s') ? 1 : h.includes('n') ? -1 : 0 };
}

const clampSize = (n: number): number => Math.min(MAX_SIZE, Math.max(MIN_SIZE, n));

export interface ResizeOptions {
  /** Shift: keep the proportions. */
  keepAspect?: boolean;
  /** Alt: grow from the centre. */
  fromCenter?: boolean;
}

/**
 * E-05 · new frame of a block when a handle is dragged by `delta` (in the units of the block's parent). The block may be
 * turned: the movement is read along its own axes, and the opposite corner (or the centre with Alt) stays where it was.
 */
export function resizeFrame<F extends Rect & { rotation?: number }>(frame: F, handle: Handle, delta: Point, options: ResizeOptions = {}): F {
  const { sx, sy } = handleAxes(handle);
  const theta = rad(frame.rotation ?? 0);
  const u = { x: Math.cos(theta), y: Math.sin(theta) };
  const v = { x: -Math.sin(theta), y: Math.cos(theta) };
  const local = { x: delta.x * u.x + delta.y * u.y, y: delta.x * v.x + delta.y * v.y };
  const k = options.fromCenter ? 2 : 1;
  let w = clampSize(frame.w + sx * local.x * k);
  let h = clampSize(frame.h + sy * local.y * k);
  if (options.keepAspect) {
    const ratio = frame.w / frame.h;
    if (sx !== 0 && sy !== 0) {
      // A corner: the dimension that grew more decides.
      if (w / frame.w >= h / frame.h) h = clampSize(w / ratio);
      else w = clampSize(h * ratio);
    } else if (sx !== 0) {
      h = clampSize(w / ratio);
    } else {
      w = clampSize(h * ratio);
    }
  }
  const c = center(frame);
  let next: Point;
  if (options.fromCenter) {
    next = c;
  } else {
    // The anchor is the part of the block that does not move, in the block's own axes (from its centre).
    const ax = -sx * (frame.w / 2);
    const ay = -sy * (frame.h / 2);
    const anchor = { x: c.x + u.x * ax + v.x * ay, y: c.y + u.y * ax + v.y * ay };
    const nax = -sx * (w / 2);
    const nay = -sy * (h / 2);
    next = { x: anchor.x - (u.x * nax + v.x * nay), y: anchor.y - (u.y * nax + v.y * nay) };
  }
  return { ...frame, x: round1(next.x - w / 2), y: round1(next.y - h / 2), w: round1(w), h: round1(h) };
}

/** Moves every frame of a group of blocks when the box around them is resized (E-05, several blocks selected). */
export function scaleFrames<F extends Rect>(frames: readonly F[], from: Rect, to: Rect): F[] {
  const fx = from.w === 0 ? 1 : to.w / from.w;
  const fy = from.h === 0 ? 1 : to.h / from.h;
  return frames.map((f) => ({
    ...f,
    x: round1(to.x + (f.x - from.x) * fx),
    y: round1(to.y + (f.y - from.y) * fy),
    w: round1(clampSize(f.w * fx)),
    h: round1(clampSize(f.h * fy)),
  }));
}

/** The box after a handle of the selection box is dragged; the opposite side (or centre with Alt) stays. */
export function resizeBox(box: Rect, handle: Handle, delta: Point, options: ResizeOptions = {}): Rect {
  const r = resizeFrame({ ...box, rotation: 0 }, handle, delta, options);
  return { x: r.x, y: r.y, w: r.w, h: r.h };
}

/** E-05 · angle of a block turned by the pointer around its centre; Shift snaps to 15° steps. */
export function rotationFromPointer(centerPoint: Point, startAngle: number, startPointer: Point, pointer: Point, shift: boolean): number {
  const a0 = Math.atan2(startPointer.y - centerPoint.y, startPointer.x - centerPoint.x);
  const a1 = Math.atan2(pointer.y - centerPoint.y, pointer.x - centerPoint.x);
  let deg = startAngle + ((a1 - a0) * 180) / Math.PI;
  if (shift) deg = Math.round(deg / 15) * 15;
  deg = ((((deg + 180) % 360) + 360) % 360) - 180;
  return round1(deg);
}

/** Frame of a block on the artboard, with the place of the containers around it added. */
export function absoluteFrames(blocks: readonly Block[], origin: Point = { x: 0, y: 0 }, into: Map<string, Rect & { rotation: number }> = new Map()): Map<string, Rect & { rotation: number }> {
  for (const b of blocks) {
    const x = origin.x + b.frame.x;
    const y = origin.y + b.frame.y;
    into.set(b.id, { x, y, w: b.frame.w, h: b.frame.h, rotation: b.frame.rotation });
    absoluteFrames(b.children, { x, y }, into);
  }
  return into;
}
