import { z } from './locale.js';
import { MAX_PATH_LENGTH, isValidPath } from './path.js';
import { Color, Easing, MediaRef, UnitPoint, int, num } from './primitives.js';

// ── S-04 Fill ─────────────────────────────────────────────────────────────────
export const GradientStop = z.strictObject({ offset: num(0, 1), color: Color });
const stops = z.array(GradientStop).min(2).max(10);

const FillNone = z.strictObject({ kind: z.literal('none') });
const FillSolid = z.strictObject({ kind: z.literal('solid'), color: Color });
const FillLinear = z.strictObject({ kind: z.literal('linear'), angle: num(0, 360).default(180), stops });
const FillRadial = z.strictObject({ kind: z.literal('radial'), cx: num(0, 1).default(0.5), cy: num(0, 1).default(0.5), stops });
const FillConic = z.strictObject({
  kind: z.literal('conic'),
  angle: num(0, 360).default(0),
  cx: num(0, 1).default(0.5),
  cy: num(0, 1).default(0.5),
  stops,
});
const FillMedia = z.strictObject({
  kind: z.literal('media'),
  media: MediaRef,
  fit: z.enum(['cover', 'contain', 'fill', 'tile']).default('cover'),
  focal: UnitPoint.default({ x: 0.5, y: 0.5 }),
  scale: num(0.1, 10).default(1),
});

export const Fill = z.discriminatedUnion('kind', [FillNone, FillSolid, FillLinear, FillRadial, FillConic, FillMedia]);
export type Fill = z.infer<typeof Fill>;

/** Paint without media — for strokes (S-05). */
export const Paint = z.discriminatedUnion('kind', [FillSolid, FillLinear, FillRadial, FillConic]);

/** Text may be painted with colour, gradient or media (S-10). */
export const TextPaint = z.discriminatedUnion('kind', [FillSolid, FillLinear, FillRadial, FillConic, FillMedia]);

// ── S-02 Shape ────────────────────────────────────────────────────────────────
/** Allowed characters of a normalised SVG path: commands M L H V C S Q T A Z and numbers. P1.6 normalises further. */
export const PATH_DATA = /^[MmLlHhVvCcSsQqTtAaZz0-9eE.,\s+-]*$/;

export const Shape = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('rect') }),
  z.strictObject({ kind: z.literal('pill') }),
  z.strictObject({ kind: z.literal('ellipse') }),
  z.strictObject({ kind: z.literal('polygon'), sides: int(3, 24).default(6), cornerRadius: num(0, 0.5).default(0) }),
  z.strictObject({
    kind: z.literal('star'),
    points: int(3, 48).default(5),
    depth: num(0.05, 0.95).default(0.5),
    cornerRadius: num(0, 0.5).default(0),
  }),
  z.strictObject({ kind: z.literal('heart') }),
  z.strictObject({ kind: z.literal('blob'), seed: int(0, 2 ** 31 - 1).default(1), complexity: int(3, 16).default(6) }),
  z.strictObject({ kind: z.literal('bubble'), tail: UnitPoint.default({ x: 0.2, y: 1 }), tailWidth: num(0.05, 0.5).default(0.15) }),
  z.strictObject({
    kind: z.literal('arrow'),
    thickness: num(0.1, 0.9).default(0.4),
    head: z.enum(['triangle', 'round', 'chevron']).default('triangle'),
  }),
  z.strictObject({
    kind: z.literal('wave'),
    amplitude: num(0, 0.5).default(0.1),
    frequency: int(1, 40).default(6),
    zigzag: z.boolean().default(false),
    edges: z.array(z.enum(['top', 'right', 'bottom', 'left'])).min(1).max(4).default(['bottom']),
  }),
  z.strictObject({
    kind: z.literal('path'),
    /** Normalised contour (0…100, see `normalizePath`); any valid contour is accepted and parsed. */
    d: z
      .string()
      .min(1)
      .max(MAX_PATH_LENGTH)
      .regex(PATH_DATA, 'Контур фигуры содержит недопустимые символы')
      .refine(isValidPath, 'Контур фигуры не разбирается: проверьте команды и числа'),
    closed: z.boolean().default(true),
  }),
]);
export type Shape = z.infer<typeof Shape>;

// ── S-03 Radius ───────────────────────────────────────────────────────────────
export const Radius = z
  .strictObject({
    unit: z.enum(['u', '%']).default('u'),
    tl: num(0, 1500).default(0),
    tr: num(0, 1500).default(0),
    br: num(0, 1500).default(0),
    bl: num(0, 1500).default(0),
  })
  .refine((r) => r.unit === 'u' || [r.tl, r.tr, r.br, r.bl].every((v) => v <= 50), {
    message: 'Скругление в процентах — не больше 50 %',
  });

// ── S-05 Stroke, S-06 Shadows ────────────────────────────────────────────────
export const Stroke = z.strictObject({
  width: num(0, 60).default(0),
  style: z.enum(['solid', 'dashed', 'dotted']).default('solid'),
  dash: z.array(num(0, 200)).max(8).optional(),
  paint: Paint.default({ kind: 'solid', color: { token: 'text', alpha: 1 } }),
  align: z.enum(['inside', 'center', 'outside']).default('inside'),
});

export const Shadow = z.strictObject({
  x: num(-500, 500).default(0),
  y: num(-500, 500).default(4),
  blur: num(0, 500).default(12),
  spread: num(-200, 200).default(0),
  color: Color.default({ hex: '#00000033' }),
  inset: z.boolean().default(false),
});

export const Glow = z.strictObject({ color: Color, size: num(0, 200).default(16) });

// ── S-07 Effects, S-08 Filters, S-09 Padding ─────────────────────────────────
export const BLEND_MODES = ['normal', 'multiply', 'screen', 'overlay', 'darken', 'lighten', 'color-dodge', 'difference'] as const;

export const Effects = z.strictObject({
  opacity: num(0, 1).default(1),
  blur: num(0, 60).default(0),
  backdropBlur: num(0, 60).default(0),
  blendMode: z.enum(BLEND_MODES).default('normal'),
});

export const Filters = z.strictObject({
  brightness: num(0, 3).default(1),
  contrast: num(0, 3).default(1),
  saturate: num(0, 3).default(1),
  grayscale: num(0, 1).default(0),
  sepia: num(0, 1).default(0),
  hueRotate: num(-180, 180).default(0),
  invert: num(0, 1).default(0),
});

export const Padding = z.strictObject({
  t: num(0, 500).default(0),
  r: num(0, 500).default(0),
  b: num(0, 500).default(0),
  l: num(0, 500).default(0),
});

// ── S-10 Text style ───────────────────────────────────────────────────────────
export const FontRef = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('theme'), role: z.enum(['heading', 'body', 'accent']) }),
  z.strictObject({ kind: z.literal('font'), id: z.string().min(6).max(64) }),
  z.strictObject({ kind: z.literal('system'), name: z.enum(['sans', 'serif', 'mono', 'rounded']) }),
]);
export type FontRef = z.infer<typeof FontRef>;

export const TextStyle = z.strictObject({
  font: FontRef.default({ kind: 'theme', role: 'body' }),
  size: num(6, 400).default(18),
  weight: int(100, 900)
    .refine((w) => w % 100 === 0, 'Начертание — кратно 100')
    .default(400),
  italic: z.boolean().default(false),
  lineHeight: num(0.5, 4).default(1.3),
  letterSpacing: num(-0.5, 2).default(0),
  align: z.enum(['left', 'center', 'right', 'justify']).default('left'),
  verticalAlign: z.enum(['top', 'middle', 'bottom']).default('top'),
  transform: z.enum(['none', 'uppercase', 'lowercase', 'capitalize']).default('none'),
  paint: TextPaint.default({ kind: 'solid', color: { token: 'text', alpha: 1 } }),
  shadow: Shadow.optional(),
  outline: z.strictObject({ width: num(0, 20), color: Color }).optional(),
  path: z
    .strictObject({ kind: z.enum(['none', 'circle', 'arc']).default('none'), curvature: num(-1, 1).default(0.5) })
    .prefault({}),
});

// ── S-11 Media settings ───────────────────────────────────────────────────────
export const MediaSettings = z.strictObject({
  fit: z.enum(['cover', 'contain', 'fill']).default('cover'),
  crop: z.strictObject({ x: num(0, 1), y: num(0, 1), w: num(0.01, 1), h: num(0.01, 1) }).optional(),
  focal: UnitPoint.default({ x: 0.5, y: 0.5 }),
  autoplay: z.boolean().default(true),
  muted: z.boolean().default(true),
  loop: z.boolean().default(true),
  controls: z.boolean().default(false),
  poster: MediaRef.optional(),
  speed: num(0.25, 4).default(1),
});

// ── S-18 3D, S-19 Mask, S-20 Layout ──────────────────────────────────────────
export const Transform3d = z.strictObject({
  rotateX: num(-80, 80).default(0),
  rotateY: num(-80, 80).default(0),
  perspective: num(100, 5000).default(1000),
  origin: UnitPoint.default({ x: 0.5, y: 0.5 }),
  tiltFollow: z.boolean().default(false),
  tiltStrength: num(0, 40).default(10),
});

export const Mask = z.strictObject({
  clipToShape: z.boolean().default(true),
  image: MediaRef.optional(),
  fade: z
    .strictObject({ edges: z.array(z.enum(['top', 'right', 'bottom', 'left'])).min(1).max(4), size: num(0, 0.5) })
    .optional(),
});

export const Layout = z.strictObject({
  mode: z.enum(['free', 'row', 'column', 'grid']).default('free'),
  gap: num(0, 500).default(8),
  align: z.enum(['start', 'center', 'end', 'stretch']).default('start'),
  justify: z.enum(['start', 'center', 'end', 'between', 'around']).default('start'),
  wrap: z.boolean().default(false),
  columns: int(1, 12).default(2),
  scroll: z.boolean().default(false),
});

/**
 * Visual style of a block — ONE type for every block (S-00). Groups map to S-02…S-11, S-18…S-20;
 * position and size (S-01) live in `Block.frame`, animations (S-12…S-14) in `Block.animation`,
 * states (S-15) in `Block.states`, visibility (S-16) and service fields (S-17) on the block itself.
 */
export const BlockStyle = z.strictObject({
  autoHeight: z.boolean().default(false),
  lockAspect: z.boolean().default(false),
  shape: Shape.default({ kind: 'rect' }),
  radius: Radius.prefault({}),
  fills: z.array(Fill).max(4).default([]),
  stroke: Stroke.prefault({}),
  shadows: z.array(Shadow).max(6).default([]),
  glow: Glow.optional(),
  effects: Effects.prefault({}),
  filters: Filters.prefault({}),
  padding: Padding.prefault({}),
  text: TextStyle.prefault({}),
  media: MediaSettings.prefault({}),
  transform3d: Transform3d.prefault({}),
  mask: Mask.prefault({}),
  layout: Layout.prefault({}),
});
export type BlockStyle = z.infer<typeof BlockStyle>;
export type BlockStyleInput = z.input<typeof BlockStyle>;

/** Partial style used by states (S-15) and theme defaults per block type (TH-01). */
/**
 * Part of a style: only the groups that are set (TH-06 own style, theme defaults per block type, states).
 * Unlike `BlockStyle.partial()`, missing groups stay missing — no defaults are filled in — so «своё»
 * can be told apart from «из темы»; a group that is present is parsed with its inner defaults.
 */
export type StyleOverride = Partial<BlockStyle>;
const optionalGroups = Object.fromEntries(
  Object.entries(BlockStyle.shape).map(([key, schema]) => {
    const def = (schema as z.ZodType).def as { type: string; innerType?: z.ZodType };
    const inner = def.type === 'default' || def.type === 'prefault' ? def.innerType! : (schema as z.ZodType);
    return [key, inner.optional()];
  }),
);
export const StyleOverride = z.strictObject(optionalGroups) as unknown as z.ZodType<StyleOverride, Partial<z.input<typeof BlockStyle>>>;

// ── S-01 Frame ────────────────────────────────────────────────────────────────
export const Frame = z.strictObject({
  x: num(-2000, 7000),
  y: num(-2000, 7000),
  w: num(1, 3000),
  h: num(1, 3000),
  rotation: num(-360, 360).default(0),
  flipX: z.boolean().default(false),
  flipY: z.boolean().default(false),
});
export type Frame = z.infer<typeof Frame>;

// ── S-12…S-14 Animation ───────────────────────────────────────────────────────
/** Properties that keyframe animations and «change property smoothly» (AC-02) can interpolate. */
export const ANIMATABLE = [
  'x',
  'y',
  'w',
  'h',
  'rotation',
  'scale',
  'opacity',
  'blur',
  'backdropBlur',
  'rotateX',
  'rotateY',
  'brightness',
  'contrast',
  'saturate',
  'grayscale',
  'hueRotate',
] as const;
export const Keyframe = z.strictObject({
  at: num(0, 1),
  props: z.partialRecord(z.enum(ANIMATABLE), z.number().min(-10000).max(10000)),
  /** S-12: own keyframes may change the fill colour too (it is laid over the block's fills, S-04). */
  fill: Color.optional(),
});
const keyframes = z.array(Keyframe).min(2).max(20);

export const EnterAnimation = z.strictObject({
  kind: z.enum(['fade', 'slide', 'zoom', 'bounce', 'flip', 'rotate', 'typewriter', 'snowflake', 'keyframes']),
  direction: z.enum(['up', 'down', 'left', 'right', 'upLeft', 'upRight', 'downLeft', 'downRight']).default('up'),
  durationMs: int(50, 10000).default(600),
  delayMs: int(0, 30000).default(0),
  easing: Easing.default({ kind: 'preset', name: 'easeOut' }),
  keyframes: keyframes.optional(),
}).refine((a) => a.kind !== 'keyframes' || a.keyframes, { message: 'Для своей анимации нужны ключевые кадры', path: ['keyframes'] });

export const LoopAnimation = z.strictObject({
  kind: z.enum(['pulse', 'sway', 'float', 'spin', 'shake', 'blink', 'heartbeat', 'followPath', 'keyframes']),
  speed: num(0.1, 10).default(1),
  amplitude: num(0, 10).default(1),
  pauseMs: int(0, 30000).default(0),
  path: z.string().min(1).max(MAX_PATH_LENGTH).regex(PATH_DATA, 'Контур движения содержит недопустимые символы').refine(isValidPath, 'Контур движения не разбирается').optional(),
  keyframes: keyframes.optional(),
})
  .refine((a) => a.kind !== 'keyframes' || a.keyframes, { message: 'Для своей анимации нужны ключевые кадры', path: ['keyframes'] })
  .refine((a) => a.kind !== 'followPath' || a.path, { message: 'Для движения по контуру нарисуйте контур', path: ['path'] });

export const PressAnimation = z.strictObject({
  kind: z.enum(['grow', 'shrink', 'glow', 'bounce', 'vibrate', 'keyframes']),
  keyframes: keyframes.optional(),
}).refine((a) => a.kind !== 'keyframes' || a.keyframes, { message: 'Для своей анимации нужны ключевые кадры', path: ['keyframes'] });

export const BlockAnimation = z.strictObject({
  enter: EnterAnimation.optional(),
  loop: LoopAnimation.optional(),
  press: PressAnimation.optional(),
});

// ── S-15 States ───────────────────────────────────────────────────────────────
export const BLOCK_STATES = ['hover', 'pressed', 'selected', 'correct', 'wrong', 'disabled', 'dragging', 'overZone'] as const;
export const BlockStates = z.partialRecord(z.enum(BLOCK_STATES), StyleOverride);
