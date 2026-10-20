import { describe, expect, it } from 'vitest';
import { BlockStyle, ThemeTokens, createBlock, ownStyleGroups, resetToTheme, resolveBlockStyle } from '../src/index.js';

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
