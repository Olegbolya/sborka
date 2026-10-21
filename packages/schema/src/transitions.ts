import { z } from './locale.js';
import { DEFAULT_EASING, Easing, Id, MediaRef, Rect, int, num } from './primitives.js';
import { Color } from './primitives.js';
import { FontRef } from './style.js';

/** T-01…T-08: built-in transitions between screens. */
export const TRANSITION_KINDS = ['none', 'fade', 'slide', 'zoom', 'flip', 'blinds', 'particles', 'page'] as const;

export const BasicTransition = z.strictObject({
  kind: z.enum(TRANSITION_KINDS),
  direction: z.enum(['up', 'down', 'left', 'right', 'upLeft', 'upRight', 'downLeft', 'downRight']).default('left'),
  durationMs: int(50, 3000).default(400),
  delayMs: int(0, 3000).default(0),
  easing: Easing.default(DEFAULT_EASING),
  /** Extra parameters of own transitions (T-32). */
  blur: num(0, 40).default(0),
  scale: num(0.2, 3).default(1),
});

/** Full-screen media insert with a meme-style caption (T-20, AC-08): the creator's own file. */
export const MediaOverlay = z.strictObject({
  media: MediaRef,
  seconds: num(0.3, 10).default(1.5),
  caption: z
    .strictObject({
      text: z.string().max(200),
      position: z.enum(['top', 'bottom']).default('bottom'),
      font: FontRef.default({ kind: 'system', name: 'sans' }),
      size: num(10, 120).default(36),
      color: Color.default({ hex: '#FFFFFF' }),
      outline: num(0, 12).default(3),
    })
    .optional(),
  sound: MediaRef.optional(),
  skippable: z.boolean().default(true),
});
export type MediaOverlay = z.infer<typeof MediaOverlay>;

export const Transition = z.discriminatedUnion('kind', [
  BasicTransition,
  z.strictObject({ kind: z.literal('media'), overlay: MediaOverlay }),
  z.strictObject({ kind: z.literal('preset'), presetId: Id }),
]);
export type Transition = z.infer<typeof Transition>;

/** T-21: a different media insert depending on the answer to a question. */
export const MediaByAnswer = z.strictObject({
  questionBlockId: Id,
  cases: z
    .array(
      z.strictObject({
        when: z.discriminatedUnion('kind', [
          z.strictObject({ kind: z.literal('correct') }),
          z.strictObject({ kind: z.literal('wrong') }),
          z.strictObject({ kind: z.literal('option'), optionId: Id }),
        ]),
        overlay: MediaOverlay,
      }),
    )
    .min(1)
    .max(30),
});
export type MediaByAnswer = z.infer<typeof MediaByAnswer>;

/** T-32: own transition saved as a preset in a theme or in «Мои элементы». */
export const TransitionPreset = z.strictObject({ id: Id, name: z.string().min(1).max(60), transition: BasicTransition });

/** T-31: what every animation becomes when the participant prefers reduced motion. */
export const REDUCED_MOTION_FALLBACK = { kind: 'fade', durationMs: 200 } as const;

// ── P-01…P-08 Particles ───────────────────────────────────────────────────────
export const PARTICLE_PRESETS = ['snow', 'confetti', 'hearts', 'sparkles', 'bubbles', 'leaves', 'petals', 'custom'] as const;

export const ParticlesConfig = z
  .strictObject({
    preset: z.enum(PARTICLE_PRESETS),
    images: z.array(MediaRef).max(5).default([]),
    density: num(0, 1).default(0.5),
    speed: num(0.1, 5).default(1),
    size: num(0.2, 5).default(1),
    rotation: z.boolean().default(true),
    wind: num(-1, 1).default(0),
    onlyAtStart: z.boolean().default(false),
    area: Rect.optional(),
  })
  .refine((p) => p.preset !== 'custom' || p.images.length > 0, {
    message: 'Для своих частиц загрузите хотя бы одну картинку',
    path: ['images'],
  });
export type ParticlesConfig = z.infer<typeof ParticlesConfig>;
