import { describe, expect, it } from 'vitest';
import { PALETTE_MAX, PALETTE_MIN, THEME_COLOR_ROLES, ThemeTokens, contrastRatio, dominantColors, themeColorsFromPalette } from '../src/index.js';

const px = (...colors: Array<[number, number, number, number]>) => colors.flatMap(([r, g, b, n]) => Array.from({ length: n }, () => [r, g, b]).flat());

/** The pairs the editor of themes checks (TH-02): text 4.5, signs 3. */
const readable = (c: Record<string, string>) => {
  const pairs: Array<[string, string, number]> = [['text', 'background', 4.5], ['text', 'surface', 4.5], ['muted', 'background', 4.5], ['muted', 'surface', 4.5], ['primary', 'background', 3], ['accent', 'background', 3], ['success', 'background', 3], ['error', 'background', 3]];
  return pairs.filter(([f, b, need]) => contrastRatio(c[f]!, c[b]!) < need).map(([f, b]) => `${f} на ${b}`);
};

describe('TH-02 · палитра из картинки', () => {
  it('TH-02 · основные цвета: по числу заказанных, самые частые первыми', () => {
    const cols = dominantColors(px([250, 245, 235, 500], [200, 40, 30, 200], [30, 90, 160, 150], [20, 20, 20, 100], [240, 200, 40, 50]), 8);
    expect(cols.length).toBeGreaterThanOrEqual(PALETTE_MIN);
    expect(cols.length).toBeLessThanOrEqual(PALETTE_MAX);
    expect(cols[0]).toBe('#FAF5EB');
  });

  it('TH-02 · цвета темы из светлой картинки: все роли есть, текст читается (AA), тема светлая', () => {
    const colors = themeColorsFromPalette(dominantColors(px([250, 245, 235, 500], [200, 40, 30, 200], [30, 90, 160, 150], [20, 20, 20, 100], [240, 200, 40, 50]), 8));
    for (const r of THEME_COLOR_ROLES) expect(colors[r]).toMatch(/^#[0-9A-F]{6}$/);
    expect(contrastRatio(colors.text!, colors.background!)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(colors.muted!, colors.background!)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(colors.primary!, colors.background!)).toBeGreaterThanOrEqual(3);
    expect(colors.primary).not.toBe(colors.accent);
    expect(Object.keys(colors).filter((k) => k.startsWith('foto_')).length).toBeGreaterThanOrEqual(PALETTE_MIN);
    expect(ThemeTokens.safeParse({ colors }).success).toBe(true);
    expect(readable(colors)).toEqual([]);
  });

  it('TH-02 · тёмная картинка даёт тёмную тему со светлым текстом', () => {
    const colors = themeColorsFromPalette(dominantColors(px([12, 14, 30, 600], [60, 40, 120, 200], [230, 90, 60, 80], [40, 160, 190, 60]), 8));
    expect(colors.background!.toLowerCase() < '#404040').toBe(true);
    expect(contrastRatio(colors.text!, colors.background!)).toBeGreaterThanOrEqual(4.5);
    expect(readable(colors)).toEqual([]);
  });

  it('TH-02 · одноцветная картинка всё равно даёт 5–8 цветов и допустимую тему', () => {
    const cols = themeColorsFromPalette(dominantColors(px([120, 120, 120, 1000]), 8));
    const own = Object.keys(cols).filter((k) => k.startsWith('foto_'));
    expect(own.length).toBeGreaterThanOrEqual(PALETTE_MIN);
    expect(ThemeTokens.safeParse({ colors: cols }).success).toBe(true);
    expect(contrastRatio(cols.text!, cols.background!)).toBeGreaterThanOrEqual(4.5);
    expect(readable(cols)).toEqual([]);
  });
});
