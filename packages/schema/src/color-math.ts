/** Colour arithmetic for themes: contrast (TH-02, WCAG), mixing and the palette of a picture. Hex colours only. */

export type Rgb = [number, number, number];

export function hexToRgb(hex: string): Rgb {
  const h = hex.replace('#', '').slice(0, 6);
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}

export function rgbToHex([r, g, b]: Rgb): string {
  const part = (n: number) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, '0');
  return `#${part(r)}${part(g)}${part(b)}`.toUpperCase();
}

/** Relative luminance of WCAG 2.x, 0…1. */
export function luminance(hex: string): number {
  const [r, g, b] = hexToRgb(hex).map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  }) as Rgb;
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** Contrast ratio of two colours, 1…21; text needs 4.5 (AA), large text 3. */
export function contrastRatio(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

/** `t` of the way from `a` to `b`. */
export function mixHex(a: string, b: string, t: number): string {
  const x = hexToRgb(a);
  const y = hexToRgb(b);
  return rgbToHex([x[0] + (y[0] - x[0]) * t, x[1] + (y[1] - x[1]) * t, x[2] + (y[2] - x[2]) * t]);
}

/** Hue 0…360, saturation and lightness 0…1. */
export function toHsl(hex: string): { h: number; s: number; l: number } {
  const [r, g, b] = hexToRgb(hex).map((v) => v / 255) as Rgb;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return { h: 0, s: 0, l };
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  const h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return { h: h * 60, s, l };
}

export function fromHsl(h: number, s: number, l: number): string {
  const hue = ((h % 360) + 360) % 360;
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((hue / 60) % 2) - 1));
  const m = l - c / 2;
  const [r, g, b] = hue < 60 ? [c, x, 0] : hue < 120 ? [x, c, 0] : hue < 180 ? [0, c, x] : hue < 240 ? [0, x, c] : hue < 300 ? [x, 0, c] : [c, 0, x];
  return rgbToHex([(r + m) * 255, (g + m) * 255, (b + m) * 255]);
}

/** The colour moved towards black or white until it reaches the contrast against `against` (or gets as far as it can). */
export function withContrast(color: string, against: string, min: number): string {
  if (contrastRatio(color, against) >= min) return color;
  const target = luminance(against) > 0.5 ? '#000000' : '#FFFFFF';
  for (let t = 0.05; t <= 1.0001; t += 0.05) {
    const next = mixHex(color, target, t);
    if (contrastRatio(next, against) >= min) return next;
  }
  return target;
}

/**
 * The main colours of a picture (median cut) from its pixels as R, G, B triples: at most `count`, the most common first.
 * Fewer distinct colours give fewer results.
 */
export function dominantColors(pixels: ArrayLike<number>, count: number): string[] {
  type Box = { px: Rgb[] };
  const all: Rgb[] = [];
  for (let i = 0; i + 2 < pixels.length; i += 3) all.push([pixels[i]!, pixels[i + 1]!, pixels[i + 2]!]);
  if (all.length === 0) return [];
  const boxes: Box[] = [{ px: all }];
  const range = (b: Box, ch: number) => {
    let lo = 255;
    let hi = 0;
    for (const p of b.px) {
      lo = Math.min(lo, p[ch]!);
      hi = Math.max(hi, p[ch]!);
    }
    return hi - lo;
  };
  while (boxes.length < count) {
    // The most populated box that still has colours to tell apart is cut at the median of its widest channel.
    const candidates = boxes.filter((b) => b.px.length > 1 && Math.max(range(b, 0), range(b, 1), range(b, 2)) > 8).sort((a, b) => b.px.length - a.px.length);
    const box = candidates[0];
    if (!box) break;
    const ch = [0, 1, 2].sort((a, b) => range(box, b) - range(box, a))[0]!;
    box.px.sort((a, b) => a[ch]! - b[ch]!);
    const mid = box.px.length >> 1;
    boxes.splice(boxes.indexOf(box), 1, { px: box.px.slice(0, mid) }, { px: box.px.slice(mid) });
  }
  return boxes
    .sort((a, b) => b.px.length - a.px.length)
    .map((b) => {
      const sum = b.px.reduce<Rgb>((acc, p) => [acc[0] + p[0], acc[1] + p[1], acc[2] + p[2]], [0, 0, 0]);
      return rgbToHex([sum[0] / b.px.length, sum[1] / b.px.length, sum[2] / b.px.length]);
    });
}
