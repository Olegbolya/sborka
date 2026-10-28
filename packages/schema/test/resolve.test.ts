import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { BLOCK_STYLE_DEFAULTS, BlockStyle, ThemeTokens, createBlock, ownStyleGroups, resetToTheme, resolveBlockStyle } from '../src/index.js';

const theme = (radius: number, color: string) =>
  ThemeTokens.parse({ blockDefaults: { button: { radius: { tl: radius, tr: radius, br: radius, bl: radius }, fills: [{ kind: 'solid', color: { hex: color } }] } } });

describe('TH-06: тема и собственные правки блока', () => {
  it('TH-01: новый блок получает стиль по умолчанию своего типа из темы', () => {
    const s = resolveBlockStyle(createBlock('button'), theme(28, '#E4572E'));
    expect(s.radius).toMatchObject({ tl: 28, br: 28 });
    expect(s.fills).toEqual([{ kind: 'solid', color: { hex: '#E4572E' } }]);
  });

  it('TH-01: у других типов стиль темы для кнопок не применяется; без темы — базовые значения', () => {
    expect(resolveBlockStyle(createBlock('text'), theme(28, '#E4572E'))).toEqual(BlockStyle.parse({}));
    expect(resolveBlockStyle(createBlock('button'), undefined)).toEqual(BlockStyle.parse({}));
  });

  it('TH-06: ручное свойство сохраняется при смене темы, остальное берётся из новой темы', () => {
    const b = createBlock('button', { style: { radius: { unit: 'u', tl: 4, tr: 4, br: 4, bl: 4 } } });
    expect(ownStyleGroups(b)).toEqual(['radius']);
    const before = resolveBlockStyle(b, theme(28, '#E4572E'));
    const after = resolveBlockStyle(b, theme(10, '#2E86AB'));
    expect([before.radius.tl, after.radius.tl]).toEqual([4, 4]);
    expect(after.fills).toEqual([{ kind: 'solid', color: { hex: '#2E86AB' } }]);
  });

  it('TH-06: «Сбросить к теме» — для одной группы и для всех', () => {
    const b = createBlock('button', { style: { radius: { tl: 4 }, fills: [{ kind: 'solid', color: { hex: '#000000' } }] } });
    const one = resetToTheme(b, ['radius']);
    expect(ownStyleGroups(one)).toEqual(['fills']);
    expect(resolveBlockStyle(one, theme(28, '#E4572E')).radius.tl).toBe(28);
    expect(ownStyleGroups(resetToTheme(b))).toEqual([]);
    expect(b.style.radius).toBeDefined();
  });

  it('S-15: состояние блока переопределяет и тему, и свои правки', () => {
    const b = createBlock('button', { style: { effects: { opacity: 0.9 } }, states: { pressed: { effects: { opacity: 0.5 } } } });
    expect(resolveBlockStyle(b, theme(28, '#E4572E'), 'pressed').effects.opacity).toBe(0.5);
    expect(resolveBlockStyle(b, theme(28, '#E4572E'), 'hover').effects.opacity).toBe(0.9);
  });
});

describe('PL-19: стиль блока собирается без разбора схемой', () => {
  it('BLOCK_STYLE_DEFAULTS равен разбору пустого стиля', () => {
    expect(BLOCK_STYLE_DEFAULTS).toEqual(BlockStyle.parse({}));
  });

  it('результат равен разбору слияния: любые наборы групп из темы, блока и состояния (1000 случаев)', () => {
    const rich = BlockStyle.parse({
      shape: { kind: 'rect' },
      radius: { tl: 12, tr: 12, br: 12, bl: 12 },
      fills: [{ kind: 'solid', color: { hex: '#112233' } }],
      stroke: { width: 3 },
      shadows: [{ x: 1, y: 2, blur: 3, color: { hex: '#000000' } }],
      effects: { opacity: 0.4 },
      filters: { grayscale: 0.5 },
      padding: { t: 4 },
      text: { size: 30, weight: 700 },
      media: { fit: 'contain' },
      transform3d: { rotateX: 20 },
      mask: { clipToShape: false },
      layout: { mode: 'row', gap: 20 },
      glow: { color: { hex: '#FFFFFF' }, size: 9 },
    });
    const groups = Object.keys(rich) as Array<keyof typeof rich>;
    const subset = fc.subarray(groups).map((keys) => Object.fromEntries(keys.map((k) => [k, rich[k]])));
    fc.assert(
      fc.property(subset, subset, subset, (fromTheme, own, state) => {
        const b = createBlock('button', { style: own, states: { pressed: state } });
        const tokens = { blockDefaults: { button: fromTheme } } as never;
        const expected = BlockStyle.parse({ ...fromTheme, ...own, ...state });
        expect(resolveBlockStyle(b, tokens, 'pressed')).toEqual(expected);
      }),
      { numRuns: 1000 },
    );
  });
});
