import { describe, expect, it } from 'vitest';
import { cx, formatLimit, pluralRu } from '../src/index.js';

const forms = ['сборка', 'сборки', 'сборок'] as const;

describe('тексты интерфейса', () => {
  it.each([
    [0, 'сборок'],
    [1, 'сборка'],
    [2, 'сборки'],
    [4, 'сборки'],
    [5, 'сборок'],
    [11, 'сборок'],
    [12, 'сборок'],
    [14, 'сборок'],
    [21, 'сборка'],
    [22, 'сборки'],
    [111, 'сборок'],
    [101, 'сборка'],
    [-3, 'сборки'],
    [1.5, 'сборки'],
  ])('%s → %s', (n, expected) => {
    expect(pluralRu(n, forms)).toBe(expected);
  });

  it('cx склеивает только непустые классы', () => {
    expect(cx('a', false, null, undefined, '', 'b')).toBe('a b');
  });

  it('formatLimit показывает «из» и разряды по-русски', () => {
    expect(formatLimit(37, 50)).toBe('37 из 50');
    expect(formatLimit(1500, 10000).replace(/\s/g, ' ')).toBe('1 500 из 10 000');
    expect(formatLimit(3, null)).toBe('3 (без ограничения)');
  });
});
