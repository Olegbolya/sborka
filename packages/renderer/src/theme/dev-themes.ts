import { ThemeTokens } from '@blokum/schema';

/**
 * Two service themes for development and tests (P1.4) — not system themes for users (TH-05 is filled by
 * the owner through the admin panel). Only system fonts, no assets.
 */
export const DEV_THEMES = {
  light: /*#__PURE__*/ ThemeTokens.parse({
    colors: { background: '#F6F4EF', surface: '#FFFFFF', primary: '#D9480F', accent: '#1971C2', text: '#1D1B18', muted: '#6B665D', success: '#2F9E44', error: '#C92A2A' },
    fonts: { heading: { kind: 'system', name: 'rounded' }, body: { kind: 'system', name: 'sans' } },
    blockDefaults: {
      button: {
        radius: { unit: 'u', tl: 16, tr: 16, br: 16, bl: 16 },
        fills: [{ kind: 'solid', color: { token: 'primary', alpha: 1 } }],
        text: { font: { kind: 'theme', role: 'heading' }, size: 18, weight: 700, align: 'center', verticalAlign: 'middle', paint: { kind: 'solid', color: { hex: '#FFFFFF' } } },
        shadows: [{ x: 0, y: 6, blur: 16, spread: 0, color: { token: 'primary', alpha: 0.35 } }],
      },
      text: { text: { font: { kind: 'theme', role: 'body' }, size: 18 } },
    },
  }),
  dark: /*#__PURE__*/ ThemeTokens.parse({
    colors: { background: '#15171C', surface: '#22262E', primary: '#FF8A3D', accent: '#5CC8FF', text: '#F1F3F5', muted: '#A4ABB6', success: '#51CF66', error: '#FF6B6B' },
    fonts: { heading: { kind: 'system', name: 'rounded' }, body: { kind: 'system', name: 'sans' } },
    blockDefaults: {
      button: {
        radius: { unit: 'u', tl: 28, tr: 28, br: 28, bl: 28 },
        fills: [{ kind: 'linear', angle: 135, stops: [{ offset: 0, color: { token: 'primary', alpha: 1 } }, { offset: 1, color: { token: 'accent', alpha: 1 } }] }],
        text: { font: { kind: 'theme', role: 'heading' }, size: 18, weight: 700, align: 'center', verticalAlign: 'middle', paint: { kind: 'solid', color: { hex: '#15171C' } } },
        glow: { color: { token: 'primary', alpha: 0.5 }, size: 18 },
      },
    },
  }),
} as const;
