import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ProjectDocument } from '@blokum/schema';
import { LESSONS, completed, currentStep } from '../lib/editor/lessons';

/*
 * P10.5 · уроки в редакторе: шаги проверяются по документу. Эталонные игры — готовый ответ на уроки RG-01/06/07,
 * поэтому все «автоматические» шаги должны на них выполняться, а на пустой сборке — нет.
 */
const EXAMPLES = resolve(__dirname, '../../../packages/themes/examples');
const load = (id: string): ProjectDocument => ProjectDocument.parse(JSON.parse(readFileSync(resolve(EXAMPLES, `${id}.json`), 'utf8')));
const empty = (): ProjectDocument => ProjectDocument.parse({ schemaVersion: 1, meta: { title: 'Пусто' }, screens: [{ id: 'ekran_1', name: 'Экран 1', blocks: [] }] });

describe('P10.5 · уроки', () => {
  it('уроков пять: три игры, «своя тема» и «мем-переход»; у каждого шаги с названием и текстом по-русски', () => {
    expect(LESSONS.map((l) => l.id)).toEqual(['rg-01', 'rg-06', 'rg-07', 'theme', 'meme']);
    for (const l of LESSONS) {
      expect(l.steps.length).toBeGreaterThanOrEqual(3);
      for (const s of [l, ...l.steps]) expect(/[а-яё]/i.test('title' in s ? s.title : '')).toBe(true);
      for (const s of l.steps) expect(s.text).toMatch(/[а-яё]/i);
    }
  });

  it.each(['rg-01', 'rg-06', 'rg-07'])('игра %s: на готовой эталонной сборке выполнены все шаги, которые проверяются по документу', (id) => {
    const lesson = LESSONS.find((l) => l.id === id)!;
    const flags = completed(lesson, load(id), new Set());
    lesson.steps.forEach((s, i) => {
      if (s.done) expect(flags[i], `${lesson.title}: «${s.title}»`).toBe(true);
    });
  });

  it('на пустой сборке не выполнен ни один автоматический шаг, текущий — первый', () => {
    for (const l of LESSONS) {
      const flags = completed(l, empty(), new Set());
      l.steps.forEach((s, i) => {
        if (s.done) expect(flags[i], `${l.title}: «${s.title}»`).toBe(false);
      });
      expect(currentStep(flags)).toBe(0);
    }
  });

  it('шаги без проверки подтверждает автор кнопкой «Готово»; урок пройден, когда выполнены все шаги', () => {
    const lesson = LESSONS.find((l) => l.id === 'rg-07')!;
    const manual = new Set(lesson.steps.flatMap((s, i) => (s.done ? [] : [i])));
    const flags = completed(lesson, load('rg-07'), manual);
    expect(flags.every(Boolean)).toBe(true);
    expect(currentStep(flags)).toBe(lesson.steps.length);
  });

  it('«мем-переход»: шаг про картинку выполнен, только когда в переходе выбран настоящий файл, а не заготовка', () => {
    const lesson = LESSONS.find((l) => l.id === 'meme')!;
    const doc = load('rg-01');
    const withMeme = (id: string): ProjectDocument => {
      const copy = structuredClone(doc);
      copy.screens[0]!.rules = [{ id: 'pr1', when: { kind: 'screen', phase: 'show' }, do: [{ kind: 'goTo', to: 'next', transition: { kind: 'media', overlay: { media: { source: 'media', id } } } }] } as never];
      return copy;
    };
    const step = lesson.steps.findIndex((s) => s.title === 'Своя картинка');
    expect(completed(lesson, withMeme('media_unset'), new Set())[step]).toBe(false);
    expect(completed(lesson, withMeme('media_abc123'), new Set())[step]).toBe(true);
  });

  it('«мем-переход» не требует готовых мемов: шаг про картинку просит загрузить свою', () => {
    const step = LESSONS.find((l) => l.id === 'meme')!.steps.find((s) => s.title === 'Своя картинка')!;
    expect(step.text).toContain('медиатека пуста — загрузите свою');
  });

  it('«своя тема»: шаг «Примените тему» выполнен, когда у сборки есть тема', () => {
    const lesson = LESSONS.find((l) => l.id === 'theme')!;
    const doc = empty();
    const step = lesson.steps.findIndex((s) => s.title === 'Примените тему');
    expect(completed(lesson, doc, new Set())[step]).toBe(false);
    doc.theme.themeId = 'tema_moya';
    expect(completed(lesson, doc, new Set())[step]).toBe(true);
  });
});
