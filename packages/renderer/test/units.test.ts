import { describe, expect, it } from 'vitest';
import { ARTBOARD_WIDTH, MAX_PLAYER_WIDTH, u, unitScale } from '../src/index.js';

describe('единицы артборда', () => {
  it('артборд 390 единиц, колонка на компьютере до 480 px', () => {
    expect(ARTBOARD_WIDTH).toBe(390);
    expect(MAX_PLAYER_WIDTH).toBe(480);
  });

  it('u() строит CSS через переменную, а не через transform', () => {
    expect(u(10)).toBe('calc(10 * var(--u))');
    expect(u(-2.5)).toBe('calc(-2.5 * var(--u))');
    expect(u(0)).toBe('0px');
    expect(u(10)).not.toContain('scale');
  });

  it('u() отклоняет бесконечность и NaN', () => {
    expect(() => u(Number.NaN)).toThrow(RangeError);
    expect(() => u(Number.POSITIVE_INFINITY)).toThrow(RangeError);
  });

  it('на телефоне 390 px одна единица = 1 px, на 360 px — меньше', () => {
    expect(unitScale(390)).toBe(1);
    expect(unitScale(360)).toBeCloseTo(360 / 390);
  });

  it('на компьютере колонка ограничена 480 px', () => {
    expect(unitScale(1440)).toBeCloseTo(480 / 390);
  });

  it('нулевая ширина — ошибка', () => {
    expect(() => unitScale(0)).toThrow(RangeError);
  });
});
