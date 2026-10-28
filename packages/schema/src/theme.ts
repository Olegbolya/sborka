import { z } from './locale.js';
import { DEFAULT_COLORS, THEME_COLOR_ROLES } from './color-roles.js';
import { ColorKey, HexColor, MediaRef } from './primitives.js';
import { BLOCK_PROPS, type BlockType } from './blocks.js';
import { FontRef, Fill, StyleOverride } from './style.js';
import { ParticlesConfig, TransitionPreset } from './transitions.js';

const SystemScreen = z.strictObject({
  background: z.array(Fill).max(4).default([]),
  title: z.string().max(200).optional(),
  text: z.string().max(1000).optional(),
});

/**
 * TH-01: everything a theme defines. Themes are data (ADR-012): system themes, the creator's own
 * themes and the copy inside a document share this shape. Own colours may be added under any name.
 */
export const ThemeTokens = z
  .strictObject({
    colors: z.record(ColorKey, HexColor).default(DEFAULT_COLORS),
    fonts: z
      .strictObject({
        heading: FontRef.default({ kind: 'system', name: 'sans' }),
        body: FontRef.default({ kind: 'system', name: 'sans' }),
        accent: FontRef.optional(),
      })
      .prefault({}),
    background: z.array(Fill).max(4).default([{ kind: 'solid', color: { token: 'background', alpha: 1 } }]),
    particles: ParticlesConfig.optional(),
    blockDefaults: z.partialRecord(z.enum(Object.keys(BLOCK_PROPS) as [BlockType, ...BlockType[]]), StyleOverride).default({}),
    transitions: z.array(TransitionPreset).max(20).default([]),
    decor: z.array(MediaRef).max(100).default([]),
    sounds: z.partialRecord(z.enum(['tap', 'success', 'error', 'transition', 'background']), MediaRef).default({}),
    systemScreens: z
      .strictObject({ closed: SystemScreen.prefault({}), password: SystemScreen.prefault({}), age18: SystemScreen.prefault({}) })
      .prefault({}),
  })
  .refine((t) => THEME_COLOR_ROLES.every((r) => r in t.colors), {
    message: `В теме должны быть цвета: ${THEME_COLOR_ROLES.join(', ')}`,
    path: ['colors'],
  });
export type ThemeTokens = z.infer<typeof ThemeTokens>;
