import { z } from './locale.js';
import { ColorKey, HexColor, MediaRef, THEME_COLOR_ROLES } from './primitives.js';
import { BLOCK_PROPS, type BlockType } from './blocks.js';
import { FontRef, Fill, StyleOverride } from './style.js';
import { ParticlesConfig, TransitionPreset } from './transitions.js';

/** Default palette for new themes: neutral light. Every role exists in every theme. */
export const DEFAULT_COLORS: Record<(typeof THEME_COLOR_ROLES)[number], string> = {
  background: '#FBFAF7',
  surface: '#FFFFFF',
  primary: '#E4572E',
  accent: '#2E86AB',
  text: '#1D1B18',
  muted: '#6B665D',
  success: '#2F9E44',
  error: '#D6336C',
};

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
