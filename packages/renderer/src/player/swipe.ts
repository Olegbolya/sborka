/**
 * TR-08 · a swipe: a quick move of a finger or a mouse in one direction. The classification is pure; the player feeds it
 * where the press began and where it ended.
 */
export type SwipeDirection = 'left' | 'right' | 'up' | 'down';

/** Pixels, milliseconds and the ratio of the main move to the cross one. */
export const SWIPE_MIN_PX = 40;
export const SWIPE_MAX_MS = 700;
export const SWIPE_AXIS_RATIO = 2;

export function classifySwipe(dx: number, dy: number, ms: number): SwipeDirection | null {
  if (ms > SWIPE_MAX_MS) return null;
  const ax = Math.abs(dx);
  const ay = Math.abs(dy);
  if (Math.max(ax, ay) < SWIPE_MIN_PX) return null;
  if (ax >= ay * SWIPE_AXIS_RATIO) return dx < 0 ? 'left' : 'right';
  if (ay >= ax * SWIPE_AXIS_RATIO) return dy < 0 ? 'up' : 'down';
  return null;
}
