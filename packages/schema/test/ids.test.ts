import { describe, expect, it } from 'vitest';
import { SAFE_ALPHABET, SCHEMA_VERSION, createId, createSlug, customSlugSchema, idSchema } from '../src/index.js';

describe('идентификаторы', () => {
  it('createId использует только безопасный алфавит и нужную длину', () => {
    for (let i = 0; i < 200; i++) {
      const id = createId();
      expect(id).toHaveLength(16);
      expect([...id].every((c) => SAFE_ALPHABET.includes(c))).toBe(true);
      expect(idSchema.safeParse(id).success).toBe(true);
    }
  });

  it('в алфавите нет похожих символов', () => {
    for (const c of ['0', 'o', '1', 'l', 'i']) expect(SAFE_ALPHABET).not.toContain(c);
  });

  it('распределение символов близко к равномерному', () => {
    const counts = new Map<string, number>();
    const sample = Array.from({ length: 2000 }, () => createId(32)).join('');
    for (const c of sample) counts.set(c, (counts.get(c) ?? 0) + 1);
    const expected = sample.length / SAFE_ALPHABET.length;
    for (const c of SAFE_ALPHABET) expect(Math.abs((counts.get(c) ?? 0) - expected) / expected).toBeLessThan(0.15);
  });

  it('createId отклоняет недопустимую длину', () => {
    expect(() => createId(3)).toThrow(RangeError);
    expect(() => createId(65)).toThrow(RangeError);
    expect(() => createId(7.5)).toThrow(RangeError);
  });

  it('slug по умолчанию — 8 символов, повторы маловероятны', () => {
    const slugs = new Set(Array.from({ length: 5000 }, () => createSlug()));
    expect(slugs.size).toBe(5000);
    for (const s of slugs) expect(s).toHaveLength(8);
  });

  it('версия схемы документа — 1', () => {
    expect(SCHEMA_VERSION).toBe(1);
  });
});

describe('свой адрес сборки', () => {
  it.each(['ded-moroz', 'abc', 'my-test-2026', 'a'.repeat(40)])('принимает «%s»', (s) => {
    expect(customSlugSchema.safeParse(s).success).toBe(true);
  });

  it.each([
    ['ab', 'не короче 3'],
    ['a'.repeat(41), 'не длиннее 40'],
    ['Ded-Moroz', 'строчные'],
    ['дед-мороз', 'строчные'],
    ['-abc', 'дефисом'],
    ['abc-', 'дефисом'],
    ['a--b', 'двух дефисов'],
  ])('отклоняет «%s» с понятной ошибкой', (s, fragment) => {
    const r = customSlugSchema.safeParse(s);
    expect(r.success).toBe(false);
    expect(r.error?.issues.map((i) => i.message).join(' ')).toContain(fragment);
  });
});
