import { describe, expect, it } from 'vitest';
import { ProjectDocument, ThemeTokens, contrastRatio, validateDocument, walkBlocks } from '@blokum/schema';
import { STARTER_TEMPLATES, STARTER_THEMES } from '../src/index.js';

describe('TH-05 · стартовые системные темы', () => {
  it('TH-05 · три темы: «Новогодний уют», «Светлая нейтральная», «Тёмная нейтральная»', () => {
    expect(STARTER_THEMES.map((t) => t.name)).toEqual(['Новогодний уют', 'Светлая нейтральная', 'Тёмная нейтральная']);
  });

  it.each(STARTER_THEMES.map((t) => [t.name, t] as const))('TH-05 · «%s» проходит схему темы, читается (контраст не ниже 4.5) и не тянет внешних файлов', (_name, theme) => {
    const tokens = ThemeTokens.parse(theme.tokens);
    const c = tokens.colors;
    expect(contrastRatio(c.text!, c.background!)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(c.text!, c.surface!)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(c.muted!, c.background!)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(c.surface!, c.primary!)).toBeGreaterThanOrEqual(4.5);
    // Только встроенное: ни шрифтов-файлов, ни картинок, ни звуков, ни своих частиц.
    const text = JSON.stringify(tokens);
    expect(text).not.toMatch(/"source":"media"|"kind":"font"|"kind":"media"/);
    expect(tokens.decor).toEqual([]);
    expect(tokens.sounds).toEqual({});
  });

  it('TH-05 · у «Новогоднего уюта» идёт снег, у нейтральных частиц нет; ключи и названия не повторяются', () => {
    expect(ThemeTokens.parse(STARTER_THEMES[0]!.tokens).particles?.preset).toBe('snow');
    expect(ThemeTokens.parse(STARTER_THEMES[1]!.tokens).particles).toBeUndefined();
    expect(new Set(STARTER_THEMES.map((t) => t.key)).size).toBe(3);
  });
});

describe('TPL-03 · стартовые системные шаблоны', () => {
  const names = STARTER_TEMPLATES.map((t) => t.name);

  it('TPL-03 · четыре шаблона и десять игр RG-01…RG-10', () => {
    expect(names).toEqual(expect.arrayContaining(['Письмо Деду Морозу', 'Викторина с баллами', 'Анонимный опрос', 'Приглашение с ответом']));
    expect(STARTER_TEMPLATES.filter((t) => t.category === 'Игры')).toHaveLength(10);
    expect(new Set(STARTER_TEMPLATES.map((t) => t.key)).size).toBe(STARTER_TEMPLATES.length);
    expect(new Set(names).size).toBe(names.length);
  });

  it.each(STARTER_TEMPLATES.map((t) => [t.name, t] as const))('TPL-03 · «%s»: документ проходит схему и проверку перед публикацией без ошибок, без «рыбы» и файлов', (_name, tpl) => {
    const doc = ProjectDocument.parse(tpl.document);
    expect(validateDocument(doc).filter((i) => i.severity === 'error')).toEqual([]);
    const text = JSON.stringify(doc);
    expect(text).not.toMatch(/lorem|ipsum|заглушк|текст текст|заголовок заголовок|рыба/i);
    // Ни одной ссылки на чужой файл: единственное допустимое — пустое место «Картинка не выбрана» (`media_unset`), как в самом редакторе.
    expect([...text.matchAll(/"source":"media","id":"([^"]+)"/g)].map((m) => m[1]).filter((id) => id !== 'media_unset')).toEqual([]);
    const words = [...walkBlocks(doc.screens.flatMap((s) => s.blocks))].flatMap((b) => (b.textLayer?.paragraphs ?? []).flatMap((p) => p.runs.map((r) => ('t' in r ? r.t : ''))));
    expect(words.join(' ')).toMatch(/[А-Яа-яЁё]{3}/);
    expect(tpl.category.length).toBeGreaterThan(2);
  });

  it('TPL-03 · викторина: результаты покрывают весь диапазон баллов 0–30 без дыр', () => {
    const doc = ProjectDocument.parse(STARTER_TEMPLATES.find((t) => t.name === 'Викторина с баллами')!.document);
    const ranges = doc.results.flatMap((r) => (r.kind === 'scoreRange' ? [[r.min, r.max] as const] : [])).sort((a, b) => a[0] - b[0]);
    expect(ranges[0]![0]).toBe(0);
    expect(ranges.at(-1)![1]).toBe(30);
    ranges.slice(1).forEach(([min], i) => expect(min).toBe(ranges[i]![1] + 1));
  });
});
