import { describe, expect, it } from 'vitest';
import { createRng, hashSeed } from '../src/index.js';

describe('детерминированная случайность', () => {
  it('одинаковый seed даёт одинаковую последовательность', () => {
    const a = createRng(42);
    const b = createRng(42);
    for (let i = 0; i < 100; i++) expect(a.next()).toBe(b.next());
  });

  it('разные seed дают разные последовательности', () => {
    const a = Array.from({ length: 10 }, createRng(1).next);
    const b = Array.from({ length: 10 }, createRng(2).next);
    expect(a).not.toEqual(b);
  });

  it('next() в диапазоне [0, 1) и примерно равномерен', () => {
    const rng = createRng(7);
    const buckets = new Array<number>(10).fill(0);
    for (let i = 0; i < 20000; i++) {
      const v = rng.next();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
      buckets[Math.floor(v * 10)]! += 1;
    }
    for (const n of buckets) expect(Math.abs(n - 2000)).toBeLessThan(250);
  });

  it('int() включает обе границы и не выходит за них', () => {
    const rng = createRng(3);
    const seen = new Set<number>();
    for (let i = 0; i < 2000; i++) {
      const v = rng.int(-2, 2);
      expect(v).toBeGreaterThanOrEqual(-2);
      expect(v).toBeLessThanOrEqual(2);
      seen.add(v);
    }
    expect([...seen].sort()).toEqual([-1, -2, 0, 1, 2].sort());
  });

  it('int() отклоняет неверный диапазон', () => {
    const rng = createRng(1);
    expect(() => rng.int(5, 1)).toThrow(RangeError);
    expect(() => rng.int(0.5, 2)).toThrow(RangeError);
  });

  it('pick() выбирает элемент и падает на пустом списке', () => {
    const rng = createRng(9);
    expect(['а', 'б', 'в']).toContain(rng.pick(['а', 'б', 'в']));
    expect(() => rng.pick([])).toThrow(RangeError);
  });

  it('shuffle() сохраняет состав, не меняет исходный массив и детерминирован', () => {
    const items = Array.from({ length: 20 }, (_, i) => i);
    const s1 = createRng(11).shuffle(items);
    const s2 = createRng(11).shuffle(items);
    expect(s1).toEqual(s2);
    expect([...s1].sort((x, y) => x - y)).toEqual(items);
    expect(s1).not.toEqual(items);
    expect(items[0]).toBe(0);
  });

  it('hashSeed() стабилен и различает строки', () => {
    expect(hashSeed('сессия-1')).toBe(hashSeed('сессия-1'));
    expect(hashSeed('сессия-1')).not.toBe(hashSeed('сессия-2'));
    expect(hashSeed('')).toBe(0x811c9dc5);
    expect(Number.isInteger(hashSeed('abc'))).toBe(true);
  });
});
