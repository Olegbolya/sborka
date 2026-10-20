import { describe, expect, it } from 'vitest';
import { Block, BlockStyle, ProjectDocument, Variable, z } from '../src/index.js';

const messages = (schema: z.ZodType, value: unknown): string[] => schema.safeParse(value).error?.issues.map((i) => i.message) ?? [];
const LATIN = /[A-Za-z]/;

describe('N-05: ошибки проверки данных — по-русски и без английских слов', () => {
  it.each([
    ['список длиннее лимита', BlockStyle, { fills: Array.from({ length: 5 }, () => ({ kind: 'none' })) }, 'Слишком много элементов: не больше 4'],
    ['число больше лимита', BlockStyle, { effects: { opacity: 2 } }, 'Число должно быть не больше 1'],
    ['число меньше лимита', BlockStyle, { padding: { t: -1 } }, 'Число должно быть не меньше 0'],
    ['значение не из списка', BlockStyle, { text: { align: 'middle' } }, 'Недопустимое значение'],
    ['не тот тип', BlockStyle, { autoHeight: 'да' }, 'Неверный тип значения: нужно «да или нет»'],
    ['лишнее поле', BlockStyle, { glitter: true }, 'Лишнее поле в данных'],
    ['пустой обязательный текст', Variable, { id: 'peremennaya', name: '', type: 'text', initial: '' }, 'Заполните поле'],
    ['длинный текст', Variable, { id: 'peremennaya', name: 'я'.repeat(41), type: 'text', initial: '' }, 'Слишком длинный текст: не больше 40 символов'],
    ['21 символ', Variable, { id: 'peremennaya', name: 'а', type: 'text', initial: 'я'.repeat(1001) }, 'Слишком длинный текст: не больше 1000 символов'],
    ['не заполнено', Block, { id: 'blok000001', type: 'text', name: 'Т' }, 'Поле не заполнено'],
  ] as const)('N-05: %s', (_name, schema, value, expected) => {
    const m = messages(schema as z.ZodType, value);
    expect(m).toContain(expected);
    for (const text of m) expect(text).not.toMatch(LATIN);
  });

  it('N-05: на целом документе с ошибками нет ни одной латинской буквы', () => {
    const m = messages(ProjectDocument, { schemaVersion: 1, screens: [{ id: 'ab', name: '', blocks: [{ type: 'нет' }], height: 10 }], settings: { feedbackMode: 'later' }, extra: 1 });
    expect(m.length).toBeGreaterThan(3);
    for (const text of m) expect(text).not.toMatch(LATIN);
  });

  it('N-05: кратность и короткие списки', () => {
    expect(messages(z.number().multipleOf(5), 7)).toEqual(['Число должно быть кратно 5']);
    expect(messages(z.array(z.number()).min(2), [1])).toEqual(['Нужно не меньше 2 элементов']);
    expect(messages(z.array(z.number()).min(1), [])).toEqual(['Нужно не меньше 1 элемента']);
    expect(messages(z.string().min(5), 'аб')).toEqual(['Слишком короткий текст: не меньше 5 символов']);
    expect(messages(z.number().lt(3), 3)).toEqual(['Число должно быть меньше 3']);
    expect(messages(z.number().gt(3), 3)).toEqual(['Число должно быть больше 3']);
    expect(messages(z.email(), 'нет')).toEqual(['Неверный адрес почты']);
    expect(messages(z.string().regex(/^\d+$/), 'а')).toEqual(['Неверный формат']);
    expect(messages(z.union([z.number(), z.boolean()]), 'а')).toEqual(['Неверные данные']);
    expect(messages(z.record(z.enum(['а']), z.number()), { б: 1 })).toEqual(['Поле не заполнено', 'Лишнее поле в данных']);
    expect(messages(z.record(z.string().regex(/^\d+$/), z.number()), { б: 1 })).toEqual(['Неверное значение в списке']);
    expect(messages(z.date().max(new Date(0)), new Date(1))).toEqual(['Дата слишком поздняя']);
    expect(messages(z.date().min(new Date(10)), new Date(1))).toEqual(['Дата слишком ранняя']);
    expect(messages(z.array(z.number()).max(21), Array.from({ length: 22 }, () => 1))).toEqual(['Слишком много элементов: не больше 21']);
  });
});
