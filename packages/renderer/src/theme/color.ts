import { type Color, DEFAULT_COLORS, type ThemeTokens } from '@blokum/schema';

/** #RGB… → [r, g, b, a] with a in 0…1. */
function parseHex(hex: string): [number, number, number, number] {
  const h = hex.slice(1);
  const n = (i: number) => Number.parseInt(h.slice(i, i + 2), 16);
  return [n(0), n(2), n(4), h.length === 8 ? n(6) / 255 : 1];
}

const round = (v: number) => Math.round(v * 1000) / 1000;

/**
 * CSS colour of a style colour (S-04, TH-01): a fixed HEX stays as is; a theme token follows the theme,
 * so changing the theme recolours everything that uses tokens (TH-06). An unknown token falls back to
 * the neutral palette, then to the text colour.
 */
export function cssColor(color: Color, tokens: Pick<ThemeTokens, 'colors'>): string {
  if ('hex' in color) return color.hex;
  const hex = tokens.colors[color.token] ?? DEFAULT_COLORS[color.token as keyof typeof DEFAULT_COLORS] ?? tokens.colors.text ?? DEFAULT_COLORS.text;
  const [r, g, b, a] = parseHex(hex);
  const alpha = round(a * color.alpha);
  return alpha === 1 ? hex.slice(0, 7) : `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

/** Relative luminance (WCAG 2.1) of a #RRGGBB colour — for contrast checks of themes (TH-02). */
export function luminance(hex: string): number {
  const [r, g, b] = parseHex(hex).map((v, i) => (i < 3 ? v / 255 : v)) as [number, number, number, number];
  const lin = (c: number) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

/** WCAG contrast ratio of two colours, 1…21. */
export function contrastRatio(a: string, b: string): number {
  const [l1, l2] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (l1 + 0.05) / (l2 + 0.05);
}
