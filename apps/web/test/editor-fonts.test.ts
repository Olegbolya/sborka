import { describe, expect, it } from 'vitest';
import { faceCss } from '../lib/editor/fonts';

describe('TH-04 · @font-face шрифтов редактора', () => {
  it('TH-04: каждое начертание — своё правило; «700i» — вес 700 курсивом; имя семейства то же, что рисует холст', () => {
    const css = faceCss({
      id: 'abc123456',
      family: 'Тест',
      hasCyrillic: true,
      source: 'mine',
      faces: [
        { style: '400', url: '/api/v1/media/m1/file' },
        { style: '700i', url: '/api/v1/media/m2/file' },
      ],
    });
    const rules = css.split('\n');
    expect(rules).toHaveLength(2);
    expect(rules[0]).toContain('font-family: "bk-font-abc123456"');
    expect(rules[0]).toContain('font-weight: 400; font-style: normal');
    expect(rules[1]).toContain('font-weight: 700; font-style: italic');
    expect(rules[1]).toContain('url("/api/v1/media/m2/file") format("woff2")');
  });
});
