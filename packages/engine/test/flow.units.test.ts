import { type Block, createBlock, createId } from '@blokum/schema';
import { describe, expect, it } from 'vitest';
import {
  FlowError,
  answerQuestion,
  compare,
  createRng,
  evaluateCondition,
  formatAnswer,
  formatDuration,
  formatValue,
  hasKey,
  isAnswered,
  isCorrect,
  maxQuestionScore,
  navigate,
  nextScreen,
  normalizeAnswer,
  placeholderValue,
  questionScore,
  requiredProblem,
  screenTimer,
  startFlow,
  type AnswerValue,
  type ConditionContext,
  type QuestionBlock,
} from '../src/index.js';
import { byName, choice, doc, env, opt, screen } from './helpers.js';

const q = <T extends QuestionBlock['type']>(type: T, props: Record<string, unknown> = {}) =>
  createBlock(type, { props: { ...(createBlock(type).props as object), ...props } }) as Extract<QuestionBlock, { type: T }>;
const bad = (block: QuestionBlock, answer: AnswerValue) => {
  try {
    normalizeAnswer(block, answer);
  } catch (e) {
    return (e as FlowError).message;
  }
  return null;
};

describe('PL-15: сервер проверяет каждый ответ', () => {
  it('PL-15: ответ другого вида не принимается', () => {
    expect(bad(q('scale'), { kind: 'text', value: '5' })).toBe('Ответ не подходит к вопросу «Шкала»');
  });

  it('PL-15: множественный выбор — повторы убираются, лимит соблюдается', () => {
    const m = choice('М', ['1', '2', '3'], { multi: true, maxSelected: 2 });
    const [a, b, c] = m.props.options.map((o) => o.id);
    expect(normalizeAnswer(m, { kind: 'choice', optionIds: [a!, a!, b!] })).toEqual({ kind: 'choice', optionIds: [a, b] });
    expect(bad(m, { kind: 'choice', optionIds: [a!, b!, c!] })).toBe('Можно выбрать не больше 2');
  });

  it('PL-15: текст — обрезка пробелов, длина, маска числа', () => {
    expect(normalizeAnswer(q('textInput'), { kind: 'text', value: '  ёлка ' })).toEqual({ kind: 'text', value: 'ёлка' });
    expect(bad(q('textInput', { maxLength: 3 }), { kind: 'text', value: 'длинно' })).toBe('Ответ длиннее 3 символов');
    expect(bad(q('textInput', { mask: 'number' }), { kind: 'text', value: '12а' })).toBe('Введите число');
    expect(normalizeAnswer(q('textInput', { mask: 'number' }), { kind: 'text', value: '-12,5' })).toEqual({ kind: 'text', value: '-12,5' });
  });

  it('PL-15: дата — формат и границы', () => {
    const d = q('date', { min: '2026-12-01', max: '2026-12-31' });
    expect(normalizeAnswer(d, { kind: 'text', value: '2026-12-31' })).toEqual({ kind: 'text', value: '2026-12-31' });
    expect(bad(d, { kind: 'text', value: '31.12.2026' })).toBe('Неверный формат даты');
    expect(bad(d, { kind: 'text', value: '2026-11-30' })).toBe('Дата не раньше 2026-12-01');
    expect(bad(d, { kind: 'text', value: '2027-01-01' })).toBe('Дата не позже 2026-12-31');
    expect(normalizeAnswer(q('date', { mode: 'time' }), { kind: 'text', value: '' })).toEqual({ kind: 'text', value: '' });
  });

  it('PL-15: шкала — диапазон и шаг', () => {
    const s = q('scale', { min: 0, max: 1, step: 0.1 });
    expect(normalizeAnswer(s, { kind: 'number', value: 0.3 })).toEqual({ kind: 'number', value: 0.3 });
    expect(bad(s, { kind: 'number', value: 0.35 })).toBe('Выберите значение от 0 до 1');
    expect(bad(s, { kind: 'number', value: Number.NaN })).toBe('Выберите значение от 0 до 1');
  });

  it('PL-15: свайп и ранжирование', () => {
    expect(bad(q('swipe'), { kind: 'swipe', value: 'up' as 'left' })).toBe('Смахните карточку влево или вправо');
    const r = q('ranking');
    const ids = r.props.items.map((i) => i.id);
    expect(normalizeAnswer(r, { kind: 'ranking', order: [...ids].reverse() })).toEqual({ kind: 'ranking', order: [...ids].reverse() });
    expect(bad(r, { kind: 'ranking', order: [ids[0]!, ids[0]!, ids[1]!] })).toBe('Расставьте все пункты по порядку');
  });

  it('PL-15: контакты — только поля блока, проверка почты и телефона', () => {
    const c = q('contacts', { fields: ['name', 'email', 'phone'] });
    expect(normalizeAnswer(c, { kind: 'contacts', values: { name: ' Олег ', email: '' } })).toEqual({ kind: 'contacts', values: { name: 'Олег' } });
    expect(bad(c, { kind: 'contacts', values: { city: 'Казань' } })).toBe('Лишнее поле в контактах');
    expect(bad(c, { kind: 'contacts', values: { email: 'не-почта' } })).toBe('Проверьте адрес почты');
    expect(bad(c, { kind: 'contacts', values: { phone: 'позвони' } })).toBe('Проверьте номер телефона');
    expect(bad(c, { kind: 'contacts', values: { name: 'я'.repeat(201) } })).toBe('Слишком длинное значение в контактах');
  });

  it('PL-15: согласие — только явное «да»', () => {
    expect(normalizeAnswer(q('consent'), { kind: 'consent', value: 'да' as unknown as boolean })).toEqual({ kind: 'consent', value: false });
  });

  it('PL-15: ключ и баллы считаются только по вопросам с вариантами', () => {
    const text = createBlock('text');
    expect([questionScore(text, undefined), maxQuestionScore(text), hasKey(text), isCorrect(text, undefined)]).toEqual([0, 0, false, null]);
    const m = choice('М', [{ text: 'а', score: 5 }, { text: 'б', score: 3 }, { text: 'в', score: -2 }], { multi: true, maxSelected: 1 });
    expect(maxQuestionScore(m)).toBe(5);
    const noKey = choice('Без ключа', ['а', 'б']);
    expect(isCorrect(noKey, { kind: 'choice', optionIds: [noKey.props.options[0]!.id] })).toBeNull();
    const keyed = choice('С ключом', [{ text: 'а', correct: true }, 'б']);
    expect(isCorrect(keyed, { kind: 'choice', optionIds: [] })).toBeNull();
    expect(maxQuestionScore(choice('Минус', [{ text: 'а', score: -1 }, { text: 'б', score: -3 }]))).toBe(0);
  });
});

describe('L-07: что считается ответом и что мешает идти дальше', () => {
  it('L-07: пустые ответы', () => {
    expect(isAnswered(undefined)).toBe(false);
    expect(isAnswered({ kind: 'text', value: '   ' })).toBe(false);
    expect(isAnswered({ kind: 'contacts', values: { name: '' } })).toBe(false);
    expect(isAnswered({ kind: 'consent', value: false })).toBe(false);
    expect(isAnswered({ kind: 'number', value: 0 })).toBe(true);
  });

  it('L-07: обязательность по типам вопросов', () => {
    expect(requiredProblem(q('scale', { required: true }), undefined, false)).toBe('Ответьте на вопрос');
    expect(requiredProblem(q('textInput', { required: true }), undefined, false)).toBe('Заполните ответ');
    expect(requiredProblem(choice('М', ['1', '2'], { multi: true, required: true }), undefined, false)).toBe('Выберите ответ');
    expect(requiredProblem(q('contacts', { required: false }), undefined, false)).toBeNull();
    expect(requiredProblem(q('contacts'), { kind: 'contacts', values: { name: 'Олег' } }, true)).toBe('Заполните все поля контактов');
    expect(requiredProblem(q('consent'), { kind: 'consent', value: true }, true)).toBeNull();
  });

  it('L-07: ответ можно дать только вопросу; завершённое прохождение не принимает ответы', () => {
    const btn = createBlock('button', { name: 'Кнопка' });
    const d = doc([screen('А', [btn, choice('В', ['1', '2'])])]);
    const s = startFlow(d, 0);
    expect(() => answerQuestion(d, s, byName(d, 'Кнопка').id, { kind: 'choice', optionIds: [] })).toThrow('Этот блок не принимает ответы');
    const done = nextScreen(d, s, env()).state;
    expect(() => answerQuestion(d, done, byName(d, 'В').id, { kind: 'choice', optionIds: [] })).toThrow('Прохождение уже завершено');
    expect(() => nextScreen(d, { ...s, screenId: 'udalennyi1' }, env())).toThrow('Экран не найден — обновите страницу');
  });
});

describe('CN-01…CN-06 в ветвлении: сравнения и условия', () => {
  it.each([
    [5, 'gt', 3, true],
    [5, 'lt', 3, false],
    [3, 'gte', 3, true],
    [3, 'lte', 2, false],
    ['abc', 'gt', 1, false],
    [5, 'ne', '5', false],
    ['Ёлка', 'eq', ' ёлка', true],
    [[1, 2], 'eq', [1, 2], true],
    [[1, 2], 'eq', [2, 1], false],
    [[1, 'Снег'], 'contains', 'снег', true],
    ['Снеговик', 'contains', 'гов', true],
    [5, 'contains', 5, false],
    ['', 'empty', undefined, true],
    [[], 'empty', undefined, true],
    [0, 'empty', undefined, false],
    [undefined, 'empty', undefined, true],
  ] as const)('L-02: %j %s %j → %s', (l, op, r, want) => {
    expect(compare(l, op, r)).toBe(want);
  });

  const ctx = (extra: Partial<ConditionContext> = {}): ConditionContext => {
    const d = doc([screen('А')]);
    return { doc: d, answers: {}, variables: {}, rng: createRng(7), random: { next: () => 0.99 }, ...extra };
  };

  it('L-02: состояние блока и счётчик правила без движка сценариев — ложь; с движком — его ответ', () => {
    const c = { kind: 'blockState' as const, blockId: 'shapeblock1', state: 'visible' as const };
    expect(evaluateCondition(c, ctx())).toBe(false);
    expect(evaluateCondition(c, ctx({ blockState: () => true }))).toBe(true);
    expect(evaluateCondition({ kind: 'ruleCount', op: 'eq', value: 0 }, ctx())).toBe(true);
    expect(evaluateCondition({ kind: 'ruleCount', op: 'gte', value: 3 }, ctx({ ruleCount: 3 }))).toBe(true);
  });

  it('L-02: косметическая случайность — из seed, одинаковый seed даёт одинаковый ответ', () => {
    const c = { kind: 'chance' as const, percent: 50, affectsResult: false };
    const a = Array.from({ length: 20 }, () => evaluateCondition(c, ctx({ rng: createRng(42) })));
    expect(new Set(a).size).toBe(1);
  });

  it('L-02: условия на удалённый вопрос ложны', () => {
    for (const op of ['scoreGte', 'correct'] as const) {
      expect(evaluateCondition({ kind: 'answer', questionBlockId: 'net0000001', op, value: 0 }, ctx())).toBe(false);
    }
  });

  it('L-02: «содержит» и «равно» для ранжирования, контактов, свайпа, согласия', () => {
    const r = q('ranking');
    const sw = q('swipe');
    const c = q('contacts');
    const cs = q('consent');
    const d = doc([screen('А', [r, sw, c, cs])]);
    const ids = r.props.items.map((i) => i.id);
    const answers: Record<string, AnswerValue> = {
      [r.id]: { kind: 'ranking', order: ids },
      [sw.id]: { kind: 'swipe', value: 'right' },
      [c.id]: { kind: 'contacts', values: { name: 'Олег', phone: '+79000000000' } },
      [cs.id]: { kind: 'consent', value: true },
    };
    const x = ctx({ doc: d, answers });
    expect(evaluateCondition({ kind: 'answer', questionBlockId: r.id, op: 'contains', value: ids[1] }, x)).toBe(true);
    expect(evaluateCondition({ kind: 'answer', questionBlockId: sw.id, op: 'eq', value: 'right' }, x)).toBe(true);
    expect(evaluateCondition({ kind: 'answer', questionBlockId: c.id, op: 'contains', value: 'олег' }, x)).toBe(true);
    expect(evaluateCondition({ kind: 'answer', questionBlockId: cs.id, op: 'eq', value: true }, x)).toBe(true);
    expect(evaluateCondition({ kind: 'answer', questionBlockId: cs.id, op: 'notSelected', optionId: 'x00000' }, x)).toBe(true);
  });
});

describe('AC-05 через движок прохождения', () => {
  const build = () => {
    const y = screen('Y');
    return { d: doc([screen('А', [choice('В', ['1', '2'], { required: true })]), screen('Б'), y]), y };
  };

  it('AC-05: «экран X» и «следующий» проверяют обязательные вопросы', () => {
    const { d, y } = build();
    const s = startFlow(d, 0);
    expect(() => navigate(d, s, { to: 'screen', screenId: y.id }, env())).toThrow(FlowError);
    const answered = answerQuestion(d, s, byName(d, 'В').id, { kind: 'choice', optionIds: [opt(d, 'В', '1')] }).state;
    expect(navigate(d, answered, { to: 'screen', screenId: y.id }, env()).to).toBe(y.id);
    expect(navigate(d, answered, { to: 'next' }, env()).to).toBe(d.screens[1]!.id);
    expect(navigate(d, answered, { to: 'branch' }, env()).to).toBe(d.screens[1]!.id);
    const atB = navigate(d, answered, { to: 'next' }, env(5)).state;
    expect(navigate(d, atB, { to: 'back' }, env()).to).toBe(d.screens[0]!.id);
    expect(() => navigate(d, answered, { to: 'screen', screenId: 'udalennyi1' }, env())).toThrow('Переход на несуществующий экран');
  });

  it('AC-05: переход действия передаёт свою анимацию', () => {
    const d = doc([screen('А'), screen('Б')]);
    const transition = { kind: 'fade' as const, direction: 'left' as const, durationMs: 100, delayMs: 0, easing: { kind: 'preset' as const, name: 'linear' as const }, blur: 0, scale: 1 };
    expect(navigate(d, startFlow(d, 0), { to: 'next' }, env(), transition).transition).toEqual(transition);
    expect(navigate(d, navigate(d, startFlow(d, 0), { to: 'next' }, env()).state, { to: 'next' }, env(), transition)).toMatchObject({ to: null, transition });
  });

  it('L-06: таймер экрана как данные', () => {
    const d = doc([screen('А', [], { timer: { seconds: 30, onExpire: { kind: 'finish' } } })]);
    expect(screenTimer(d, startFlow(d, 1000))).toEqual({ seconds: 30, endsAt: 31_000, onExpire: { kind: 'finish' } });
    expect(screenTimer(doc([screen('Б')]), startFlow(doc([screen('Б')]), 0))).toBeNull();
  });

  it('L-04: результат указывает на удалённый экран — показывается системный экран конца', () => {
    const d = doc([screen('А')], { results: [{ kind: 'scoreRange', id: createId(), key: 'всё', screenId: 'udalennyi1', min: 0, max: 0 }] });
    const nav = nextScreen(d, startFlow(d, 0), env());
    expect(nav.to).toBeNull();
    expect(nav.state.result?.key).toBe('всё');
  });
});

describe('L-05: форматирование подстановок', () => {
  it('L-05: длительность', () => {
    expect([formatDuration(-5), formatDuration(65_000), formatDuration(3_723_000)]).toEqual(['0:00', '1:05', '1:02:03']);
  });

  it('L-05: значения переменных', () => {
    expect([formatValue(undefined), formatValue(1234.5), formatValue(true), formatValue(false), formatValue('снег'), formatValue([1.5, 'а'])]).toEqual([
      '',
      '1\u00a0234,5',
      'да',
      'нет',
      'снег',
      '1,5, а',
    ]);
  });

  it('L-05: ответы всех видов', () => {
    const sw = q('swipe');
    const r = q('ranking');
    const t = createBlock('text');
    const items = r.props.items;
    const cases: Array<[Block | undefined, AnswerValue | undefined, string]> = [
      [undefined, undefined, ''],
      [t, { kind: 'text', value: 'x' }, ''],
      [q('textInput'), { kind: 'text', value: 'ёлка' }, 'ёлка'],
      [q('scale'), { kind: 'number', value: 4.5 }, '4,5'],
      [sw, { kind: 'swipe', value: 'left' }, 'Нет'],
      [sw, { kind: 'swipe', value: 'right' }, 'Да'],
      [r, { kind: 'ranking', order: [items[2]!.id, items[0]!.id, 'udalennyi1'] }, `${items[2]!.label}, ${items[0]!.label}, `],
      [q('contacts'), { kind: 'contacts', values: { name: 'Олег', phone: '' } }, 'Олег'],
      [q('consent'), { kind: 'consent', value: false }, 'нет'],
      [q('scale'), { kind: 'choice', optionIds: [] }, ''],
      [q('textInput'), { kind: 'swipe', value: 'left' }, ''],
      [q('textInput'), { kind: 'ranking', order: [] }, ''],
    ];
    for (const [block, answer, want] of cases) expect(formatAnswer(block, answer)).toBe(want);
    const c = choice('В', ['Ёлка', 'Шар']);
    c.children[1]!.textLayer = undefined;
    expect(formatAnswer(c, { kind: 'choice', optionIds: c.props.options.map((o) => o.id).concat('udalennyi1') })).toBe('Ёлка, Вариант 2, ');
  });

  it('L-05: системные значения — время, номер экрана, имя из поля «имя»', () => {
    const name = q('textInput', { semantic: 'name' });
    const d = doc([screen('А', [name]), screen('Б')]);
    let s = answerQuestion(d, startFlow(d, 0), name.id, { kind: 'text', value: 'Аня' }).state;
    s = nextScreen(d, s, env(70_000)).state;
    const ctx = { doc: d, state: s, now: 95_000 };
    expect(placeholderValue('время_прохождения', ctx)).toBe('1:35');
    expect(placeholderValue('время_на_экране', ctx)).toBe('0:25');
    expect(placeholderValue('номер_экрана', ctx)).toBe('2');
    expect(placeholderValue('имя_участника', ctx)).toBe('Аня');
    expect(placeholderValue('результат', ctx)).toBe('');
    expect(placeholderValue('имя_участника', { ...ctx, state: startFlow(d, 0) })).toBe('');
    const end = nextScreen(d, s, env(96_000)).state;
    expect(placeholderValue('номер_экрана', { ...ctx, state: end })).toBe('3');
    expect(placeholderValue('баллы', { ...ctx, totals: { score: 7, max: 9, correct: 1, keyed: 2 } })).toBe('7');
  });
});
