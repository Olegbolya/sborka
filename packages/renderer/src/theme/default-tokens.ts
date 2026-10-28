import { type ThemeTokens } from '@blokum/schema';

/**
 * The theme a block is drawn with when no theme is given (the editor's bare canvas, tests, service galleries).
 * It is the finished result of parsing `DEV_THEMES.light` (a test checks they are equal), written out so the player,
 * which always has its own theme, does not carry the schema parser for it (P5.7, PL-19).
 */
export const DEFAULT_RENDER_TOKENS: ThemeTokens = {
  colors: {
    background: '#F6F4EF',
    surface: '#FFFFFF',
    primary: '#D9480F',
    accent: '#1971C2',
    text: '#1D1B18',
    muted: '#6B665D',
    success: '#2F9E44',
    error: '#C92A2A',
  },
  fonts: {
    heading: {
      kind: 'system',
      name: 'rounded',
    },
    body: {
      kind: 'system',
      name: 'sans',
    },
  },
  background: [
    {
      kind: 'solid',
      color: {
        token: 'background',
        alpha: 1,
      },
    },
  ],
  blockDefaults: {
    button: {
      radius: {
        unit: 'u',
        tl: 16,
        tr: 16,
        br: 16,
        bl: 16,
      },
      fills: [
        {
          kind: 'solid',
          color: {
            token: 'primary',
            alpha: 1,
          },
        },
      ],
      shadows: [
        {
          x: 0,
          y: 6,
          blur: 16,
          spread: 0,
          color: {
            token: 'primary',
            alpha: 0.35,
          },
          inset: false,
        },
      ],
      text: {
        font: {
          kind: 'theme',
          role: 'heading',
        },
        size: 18,
        weight: 700,
        italic: false,
        lineHeight: 1.3,
        letterSpacing: 0,
        align: 'center',
        verticalAlign: 'middle',
        transform: 'none',
        paint: {
          kind: 'solid',
          color: {
            hex: '#FFFFFF',
          },
        },
        path: {
          kind: 'none',
          curvature: 0.5,
        },
      },
    },
    text: {
      text: {
        font: {
          kind: 'theme',
          role: 'body',
        },
        size: 18,
        weight: 400,
        italic: false,
        lineHeight: 1.3,
        letterSpacing: 0,
        align: 'left',
        verticalAlign: 'top',
        transform: 'none',
        paint: {
          kind: 'solid',
          color: {
            token: 'text',
            alpha: 1,
          },
        },
        path: {
          kind: 'none',
          curvature: 0.5,
        },
      },
    },
  },
  transitions: [],
  decor: [],
  sounds: {},
  systemScreens: {
    closed: {
      background: [],
    },
    password: {
      background: [],
    },
    age18: {
      background: [],
    },
  },
};
