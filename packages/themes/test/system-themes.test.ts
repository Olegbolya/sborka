import { describe, expect, it } from 'vitest';
import { ThemeTokens, THEME_COLOR_ROLES } from '@blokum/schema';
import { SYSTEM_THEMES, SYSTEM_THEME_NAMES } from '../src/index.js';

/**
 * TH-05 · the starter system themes must exist, be parseable by `ThemeTokens` and cover the three
 * baseline presets (New Year, light neutral, dark neutral). They are shipped as data (ADR-012) and
 * must not depend on any external asset — otherwise `check-licenses` would need a manifest for
 * each file (docs/05-LEGAL.md §2.10).
 */
describe('TH-05 стартовые системные темы', () => {
  it('TH-05 · набор содержит минимум три темы с нужными именами', () => {
    expect(SYSTEM_THEMES.length).toBeGreaterThanOrEqual(3);
    expect(SYSTEM_THEME_NAMES).toEqual(expect.arrayContaining(['Новогодний уют', 'Светлая нейтральная', 'Тёмная нейтральная']));
  });

  it('TH-05 · у всех тем уникальные стабильные id (нужно для идемпотентного посева)', () => {
    const ids = SYSTEM_THEMES.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(id).toMatch(/^[a-z0-9_-]+$/);
  });

  it.each(SYSTEM_THEMES)('TH-05 · «$name» проходит ThemeTokens.parse', (theme) => {
    expect(() => ThemeTokens.parse(theme.tokens)).not.toThrow();
  });

  it('TH-05 · каждая тема задаёт все обязательные роли палитры', () => {
    for (const theme of SYSTEM_THEMES) {
      for (const role of THEME_COLOR_ROLES) {
        expect(theme.tokens.colors).toHaveProperty(role);
        expect(theme.tokens.colors[role]).toMatch(/^#[0-9A-Fa-f]{6}([0-9A-Fa-f]{2})?$/);
      }
    }
  });

  it('TH-05 · палитры трёх базовых тем отличаются (не копия одна другой)', () => {
    const signatures = SYSTEM_THEMES.map((t) =>
      THEME_COLOR_ROLES.map((r) => t.tokens.colors[r]?.toUpperCase()).join('|'),
    );
    expect(new Set(signatures).size).toBe(signatures.length);
  });

  it('TH-05 · «Светлая нейтральная» светлая, «Тёмная нейтральная» тёмная (на фоне)', () => {
    const light = SYSTEM_THEMES.find((t) => t.name === 'Светлая нейтральная')!;
    const dark = SYSTEM_THEMES.find((t) => t.name === 'Тёмная нейтральная')!;
    const brightness = (hex: string): number => {
      const n = Number.parseInt(hex.slice(1, 7), 16);
      return ((n >> 16) & 0xff) + ((n >> 8) & 0xff) + (n & 0xff);
    };
    expect(brightness(light.tokens.colors.background!)).toBeGreaterThan(600); // ≈ > 200 per channel
    expect(brightness(dark.tokens.colors.background!)).toBeLessThan(300); // ≈ < 100 per channel
  });

  it('TH-05 · ни одна тема не ссылается на внешние ассеты (media/library)', () => {
    for (const theme of SYSTEM_THEMES) {
      // decor is MediaRef[] — must be empty, otherwise we would need a LICENSES.json record.
      expect(theme.tokens.decor).toEqual([]);
      // sounds are optional MediaRef — must be absent.
      expect(Object.keys(theme.tokens.sounds)).toEqual([]);
      // Background fills may be solid/gradient but not media (would require a MediaRef).
      for (const fill of theme.tokens.background) expect(fill.kind).not.toBe('media');
      // Particles — a preset is fine, custom images would need licensed files.
      if (theme.tokens.particles) {
        expect(theme.tokens.particles.preset).not.toBe('custom');
        expect(theme.tokens.particles.images).toEqual([]);
      }
    }
  });

  it('TH-05 · шрифты — только системные семейства (встроены в ОС, OFL)', () => {
    for (const theme of SYSTEM_THEMES) {
      for (const role of ['heading', 'body', 'accent'] as const) {
        const font = theme.tokens.fonts[role];
        if (!font) continue;
        expect(font.kind).toBe('system');
      }
    }
  });

  it('TH-05 · системные экраны «закрыто/пароль/18+» заполнены по-русски', () => {
    for (const theme of SYSTEM_THEMES) {
      for (const screen of ['closed', 'password', 'age18'] as const) {
        const s = theme.tokens.systemScreens[screen];
        expect(s.title).toBeTruthy();
        expect(s.text).toBeTruthy();
        // Latin characters would mean untranslated placeholders (CLAUDE.md: UI на русском).
        expect(s.title!).toMatch(/[А-Яа-я]/);
        expect(s.text!).toMatch(/[А-Яа-я]/);
      }
    }
  });
});
