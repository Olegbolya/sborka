import { type BlockStyle } from './style.js';

const freeze = <T>(value: T): T => {
  if (value !== null && typeof value === 'object') for (const inner of Object.values(value)) freeze(inner);
  return Object.freeze(value);
};

/**
 * What `BlockStyle.parse({})` gives: the style of a block that sets nothing. It is written out as a finished value
 * (a test checks it equals the parse) so `resolveBlockStyle`, which the player calls for every block, does not need
 * the schema parser — and the player does not carry it (P5.7, PL-19, ADR-048). The groups are shared and frozen.
 */
export const BLOCK_STYLE_DEFAULTS: Readonly<BlockStyle> = freeze({
  autoHeight: false,
  lockAspect: false,
  shape: { kind: 'rect' },
  radius: { unit: 'u', tl: 0, tr: 0, br: 0, bl: 0 },
  fills: [],
  stroke: { width: 0, style: 'solid', paint: { kind: 'solid', color: { token: 'text', alpha: 1 } }, align: 'inside' },
  shadows: [],
  effects: { opacity: 1, blur: 0, backdropBlur: 0, blendMode: 'normal' },
  filters: { brightness: 1, contrast: 1, saturate: 1, grayscale: 0, sepia: 0, hueRotate: 0, invert: 0 },
  padding: { t: 0, r: 0, b: 0, l: 0 },
  text: {
    font: { kind: 'theme', role: 'body' },
    size: 18,
    weight: 400,
    italic: false,
    lineHeight: 1.3,
    letterSpacing: 0,
    align: 'left',
    verticalAlign: 'top',
    transform: 'none',
    paint: { kind: 'solid', color: { token: 'text', alpha: 1 } },
    path: { kind: 'none', curvature: 0.5 },
  },
  media: { fit: 'cover', focal: { x: 0.5, y: 0.5 }, autoplay: true, muted: true, loop: true, controls: false, speed: 1 },
  transform3d: { rotateX: 0, rotateY: 0, perspective: 1000, origin: { x: 0.5, y: 0.5 }, tiltFollow: false, tiltStrength: 10 },
  mask: { clipToShape: true },
  layout: { mode: 'free', gap: 8, align: 'start', justify: 'start', wrap: false, columns: 2, scroll: false },
});
