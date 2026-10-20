import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { BlockStyle, MAX_PATH_LENGTH, PathError, isValidPath, normalizePath, parsePath, serializePath } from '../src/index.js';

const reject = (d: string) => {
  try {
    parsePath(d);
  } catch (e) {
    expect(e).toBeInstanceOf(PathError);
    return (e as Error).message;
  }
  return null;
};

describe('S-02: произвольный контур — проверка и нормализация', () => {
  it.each([
    ['url(', 'M0 0 L10 10 url(javascript:alert(1))'],
    ['javascript:', 'javascript:alert(1)'],
    ['сущность', 'M0 0 &#76; 10 10'],
    ['тег', 'M0 0 <script>'],
    ['огромное число', 'M0 0 L1e300 5'],
    ['число за пределом', 'M0 0 L2000000 5'],
    ['без M', 'L10 10'],
    ['пустой', '   '],
    ['лишние числа у Z', 'M0 0 L1 1 Z 5'],
    ['не хватает чисел', 'M0 0 C1 2 3'],
    ['слишком длинный', `M0 0 ${'L1 1 '.repeat(5000)}`],
    ['слишком много отрезков', `M0 0${' L1 1'.repeat(4001)}`],
  ])('S-02: отклоняется — %s', (_name, d) => {
    expect(reject(d)).toMatch(/[а-я]/);
    expect(isValidPath(d)).toBe(false);
  });

  it('S-02: сообщения об ошибках — по-русски', () => {
    expect(reject('M0 0 url(x)')).toBe('Контур содержит недопустимые символы: разрешены только команды M L H V C S Q T A Z и числа');
    expect(reject(`M0 0 ${'L1 1 '.repeat(5000)}`)).toBe(`Контур длиннее ${MAX_PATH_LENGTH} символов`);
    expect(() => normalizePath('M0 0 L10 0')).toThrow('Контур плоский: у него нет ширины или высоты');
  });

  it('S-02: относительные команды, сокращения и неявные L после M', () => {
    expect(serializePath(parsePath('m10 10 20 0 v20 h-20 z'))).toBe('M10 10L30 10L30 30L10 30Z');
    expect(serializePath(parsePath('M0 0 H5 V5 L0 5Z'))).toBe('M0 0L5 0L5 5L0 5Z');
  });

  it('S-02: квадратичные и гладкие кривые переводятся в кубические', () => {
    expect(serializePath(parsePath('M0 0 Q3 3 6 0'))).toBe('M0 0C2 2 4 2 6 0');
    expect(serializePath(parsePath('M0 0 Q3 3 6 0 T12 0'))).toBe('M0 0C2 2 4 2 6 0C8 -2 10 -2 12 0');
    expect(serializePath(parsePath('M0 0 T6 0'))).toBe('M0 0C0 0 2 0 6 0');
    expect(serializePath(parsePath('M0 0 C0 5 5 5 5 0 S10 -5 10 0'))).toBe('M0 0C0 5 5 5 5 0C5 -5 10 -5 10 0');
    expect(serializePath(parsePath('M0 0 S5 5 10 0'))).toBe('M0 0C0 0 5 5 10 0');
    expect(serializePath(parsePath('m0 0 c0 5 5 5 5 0 s5 -5 5 0 q2 2 4 0'))).toBe('M0 0C0 5 5 5 5 0C5 -5 10 -5 10 0C11.33 1.33 12.67 1.33 14 0');
  });

  it('S-02: дуги — в кривые, конечная точка точная; вырожденные дуги — отрезки', () => {
    const circle = parsePath('M0 50 A50 50 0 1 1 100 50 A50 50 0 1 1 0 50Z');
    expect(circle.filter((s) => s.c === 'C').length).toBeGreaterThanOrEqual(4);
    const ends = circle.filter((s) => s.c === 'C').map((s) => (s.c === 'C' ? [Math.round(s.x), Math.round(s.y)] : []));
    expect(ends).toContainEqual([100, 50]);
    expect(ends.at(-1)).toEqual([0, 50]);
    expect(serializePath(parsePath('M0 0 A0 5 0 0 1 10 10'))).toBe('M0 0L10 10');
    expect(serializePath(parsePath('M3 3 a5 5 0 0 0 0 0'))).toBe('M3 3L3 3');
    // Радиусы меньше половины расстояния увеличиваются (как в браузере), поворот эллипса учитывается.
    const small = parsePath('M0 0 A1 1 30 0 0 10 0').at(-1);
    expect(small).toMatchObject({ x: 10, y: 0 });
  });

  it('S-02: нормализация вписывает контур в 0…100', () => {
    expect(normalizePath('M200 100 L400 100 L400 300 Z')).toBe('M0 0L100 0L100 100Z');
    expect(normalizePath('M-5 -5 l10 0 l0 20 z')).toBe('M0 0L100 0L100 100Z');
  });

  it('S-02: нормализованный контур повторно нормализуется в себя и проходит схему', () => {
    fc.assert(
      fc.property(fc.array(fc.tuple(fc.integer({ min: -500, max: 500 }), fc.integer({ min: -500, max: 500 })), { minLength: 3, maxLength: 30 }), (pts) => {
        const d = `M${pts.map(([x, y]) => `${x} ${y}`).join(' L')} Z`;
        let n: string;
        try {
          n = normalizePath(d);
        } catch {
          return;
        }
        expect(normalizePath(n)).toBe(n);
        expect(BlockStyle.safeParse({ shape: { kind: 'path', d: n } }).success).toBe(true);
      }),
      { numRuns: 300 },
    );
  });

  it('S-02: схема фигуры отклоняет неразбираемый контур', () => {
    expect(BlockStyle.safeParse({ shape: { kind: 'path', d: 'M0 0 C1 2' } }).error?.issues[0]?.message).toBe('Контур фигуры не разбирается: проверьте команды и числа');
  });
});
