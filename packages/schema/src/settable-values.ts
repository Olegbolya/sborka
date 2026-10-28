import { BlockStyle } from './style.js';
import { MediaRef } from './primitives.js';
import { RichText } from './text.js';
import { type SETTABLE_PROPERTIES } from './scenario.js';
import { type ParsedValue, parseFrameValue } from './frame-values.js';

/**
 * AC-02 · checks the value a «change property» action gives to a property, with the same schemas the document is made of.
 * It runs at publishing (`validateDocument`) and in the editor's preview; the player takes a published document as checked
 * and does not carry the schema parser (P5.7, PL-19, ADR-048).
 */
export function parseSettableValue(property: (typeof SETTABLE_PROPERTIES)[number], value: unknown): ParsedValue {
  const frame = parseFrameValue(property, value);
  if (frame) return frame;
  if (property === 'textLayer') {
    const r = RichText.safeParse(value);
    return r.success ? { ok: true, value: r.data } : { ok: false };
  }
  if (property === 'props.media') {
    if (value === null) return { ok: true, value: null };
    const r = MediaRef.safeParse(value);
    return r.success ? { ok: true, value: r.data } : { ok: false };
  }
  const key = property.slice('style.'.length) as keyof typeof BlockStyle.shape;
  const r = BlockStyle.shape[key].safeParse(value);
  return r.success ? { ok: true, value: r.data } : { ok: false };
}
