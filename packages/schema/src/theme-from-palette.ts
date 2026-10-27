import { contrastRatio, fromHsl, luminance, mixHex, toHsl, withContrast } from './color-math.js';
import { DEFAULT_COLORS } from './theme.js';

/** How many colours of a picture go into a theme (TH-02: 5–8). */
export const PALETTE_MIN = 5;
export const PALETTE_MAX = 8;

/** Colours made up from the ones there are, when a picture has fewer than `PALETTE_MIN` distinct ones. */
function pad(colors: string[]): string[] {
  const out = [...colors];
  const seed = out.length > 0 ? out : [DEFAULT_COLORS.primary];
  let i = 0;
  while (out.length < PALETTE_MIN) {
    const base = toHsl(seed[i % seed.length]!);
    const step = Math.floor(i / seed.length) + 1;
    out.push(fromHsl(base.h + 30 * step, base.s, Math.min(0.9, Math.max(0.1, base.l + (step % 2 ? 0.18 : -0.18)))));
    i++;
  }
  return out;
}

/**
 * TH-02 · the colours of a theme from the main colours of a picture. The roles are given by brightness and contrast:
 * a dark picture makes a dark theme; the text is the colour that reads best on the background; «основной» is the most vivid
 * colour, «акцент» the most vivid of another hue. Every colour of the picture stays as an own colour «foto_N».
 */
export function themeColorsFromPalette(extracted: string[]): Record<string, string> {
  const palette = pad([...new Set(extracted.map((c) => c.toUpperCase()))]).slice(0, PALETTE_MAX);
  const lum = palette.map(luminance);
  const dark = lum.reduce((a, b) => a + b, 0) / lum.length < 0.3;

  const byLum = [...palette].sort((a, b) => luminance(a) - luminance(b));
  const pickedBg = dark ? byLum[0]! : byLum[byLum.length - 1]!;
  // A background that is a vivid colour makes a loud theme: calm it towards grey, keeping its tint.
  const hsl = toHsl(pickedBg);
  const background = hsl.s > 0.35 ? fromHsl(hsl.h, 0.25, dark ? Math.min(hsl.l, 0.14) : Math.max(hsl.l, 0.94)) : pickedBg;
  const surface = dark ? mixHex(background, '#FFFFFF', 0.08) : mixHex(background, '#FFFFFF', 0.65);

  const others = palette.filter((c) => c !== pickedBg);
  const bestText = [...others].sort((a, b) => contrastRatio(b, background) - contrastRatio(a, background))[0];
  const fallbackText = dark ? '#F5F3EE' : '#1D1B18';
  const text = bestText && contrastRatio(bestText, background) >= 7 ? bestText : withContrast(bestText ?? fallbackText, background, 7);

  const vivid = (c: string) => toHsl(c).s * (1 - Math.abs(toHsl(c).l - 0.5));
  const ranked = [...others].sort((a, b) => vivid(b) - vivid(a));
  const primary = withContrast(ranked[0] ?? DEFAULT_COLORS.primary, background, 3);
  const hueGap = (c: string) => {
    const d = Math.abs(toHsl(c).h - toHsl(primary).h);
    return Math.min(d, 360 - d);
  };
  const accentSource = ranked.find((c) => c !== ranked[0] && hueGap(c) >= 30) ?? fromHsl(toHsl(primary).h + 150, 0.6, 0.45);
  const accent = withContrast(accentSource, background, 3);
  const muted = withContrast(mixHex(text, background, 0.45), background, 4.5);

  const colors: Record<string, string> = {
    background,
    surface,
    primary,
    accent,
    text,
    muted,
    success: withContrast(DEFAULT_COLORS.success, background, 3),
    error: withContrast(DEFAULT_COLORS.error, background, 3),
  };
  palette.forEach((c, i) => (colors[`foto_${i + 1}`] = c));
  return colors;
}
