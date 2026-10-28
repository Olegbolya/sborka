import { type SETTABLE_PROPERTIES } from './scenario.js';

export type ParsedValue = { ok: true; value: unknown } | { ok: false };

const FRAME_NUMBERS = new Set<string>(['frame.x', 'frame.y', 'frame.w', 'frame.h', 'frame.rotation']);

/**
 * AC-02 · value of a frame property (position, size, turn, flip): a plain check that needs no schema parser, so the player
 * can run it. Returns `null` for any other property — those are checked by `parseSettableValue`.
 */
export function parseFrameValue(property: (typeof SETTABLE_PROPERTIES)[number], value: unknown): ParsedValue | null {
  if (FRAME_NUMBERS.has(property)) {
    if (typeof value !== 'number' || !Number.isFinite(value)) return { ok: false };
    if ((property === 'frame.w' || property === 'frame.h') && value < 0) return { ok: false };
    return { ok: true, value };
  }
  if (property === 'frame.flipX' || property === 'frame.flipY') return typeof value === 'boolean' ? { ok: true, value } : { ok: false };
  return null;
}
