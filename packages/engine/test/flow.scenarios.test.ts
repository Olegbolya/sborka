import { type ProjectDocument, createBlock, createId, textOf, toPublicDocument } from '@blokum/schema';
import { describe, expect, it } from 'vitest';
import { type FlowError, finalFeedback, scoreTotals, substituteText } from '../src/index.js';
import { type Run, type Step, branch, byName, choice, doc, opt, play, screen, text } from './helpers.js';

interface Scenario {
  name: string;
  build: () => ProjectDocument;
  steps: Step[];
  random?: number;
  path?: string[];
  result?: string | null;
  error?: FlowError['code'];
  check?: (run: Run, d: ProjectDocument) => void;
}

const yesNo = (name = 'В1', required = false) => choice(name, ['Да', 'Нет'], { required });
const next: Step = { do: 'next' };
const back: Step = { do: 'back' };

/** Quiz: two questions with a key, results by score ranges. */
const quiz = () => {
  const q1 = choice('Столица', [{ text: 'Москва', correct: true, score: 1 }, { text: 'Казань', score: 0 }]);
  const q2 = choice('Цвета флага', [{ text: 'Белый', correct: true, score: 1 }, { text: 'Синий', correct: true, score: 1 }, { text: 'Зелёный', score: -1 }], { multi: true });
  const low = screen('Мало', [], { kind: 'result' });
  const high = screen('Много', [], { kind: 'result' });
  return doc([screen('Старт'), screen('Вопрос 1', [q1]), screen('Вопрос 2', [q2]), low, high], {
    results: [
      { kind: 'scoreRange', id: createId(), key: 'новичок', screenId: low.id, min: -10, max: 1 },
      { kind: 'scoreRange', id: createId(), key: 'знаток', screenId: high.id, min: 2, max: 3 },
    ],
  });
};

/** Personality test «Какой вы новогодний персонаж» with tags. */
const personality = (tieBreak: 'first' | 'random' = 'first') => {
  const q1 = choice('Утро', [{ text: 'Сплю', tags: ['снеговик'] }, { text: 'Бегу', tags: ['олень'] }]);
  const q2 = choice('Вечер', [{ text: 'Чай', tags: ['снеговик'] }, { text: 'Танцы', tags: ['олень'] }, { text: 'Подарки', tags: ['дед'] }]);
  const r1 = screen('Снеговик', [], { kind: 'result' });
  const r2 = screen('Олень', [], { kind: 'result' });
  const r3 = screen('Дед Мороз', [], { kind: 'result' });
  return doc([screen('Утро', [q1]), screen('Вечер', [q2]), r1, r2, r3], {
    settings: { tieBreak },
    results: [
      { kind: 'tag', id: createId(), key: 'снеговик', screenId: r1.id, tag: 'снеговик' },
      { kind: 'tag', id: createId(), key: 'олень', screenId: r2.id, tag: 'олень' },
      { kind: 'tag', id: createId(), key: 'дед', screenId: r3.id, tag: 'дед' },
    ],
  });
};

/** Screens «А» (questions, branches), «Б» (the default next) and «Y» (the branch target). */
const branching = (blocksA = [yesNo()]) => doc([screen('А', blocksA), screen('Б'), screen('Y')]);

const scenarios: Scenario[] = [
  // ── L-01 порядок экранов и «назад» ───────────────────────────────────────────
  { name: 'L-01: экраны идут подряд, после последнего — конец', build: () => doc([screen('А'), screen('Б'), screen('В')]), steps: [next, next, next], path: ['А', 'Б', 'В', '∎'], result: null },
  { name: 'L-01: «назад» возвращает на предыдущий экран', build: () => doc([screen('А'), screen('Б'), screen('В')]), steps: [next, next, back, back], path: ['А', 'Б', 'В', 'Б', 'А'] },
  { name: 'L-01: создатель запретил «назад»', build: () => doc([screen('А'), screen('Б')], { settings: { allowBack: false } }), steps: [next, back], error: 'BACK_FORBIDDEN' },
  { name: 'L-01: с первого экрана назад нельзя', build: () => doc([screen('А'), screen('Б')]), steps: [back], error: 'BACK_FORBIDDEN' },
  {
    name: 'L-01: после «назад» ответы сохраняются',
    build: () => doc([screen('А', [yesNo()]), screen('Б')]),
    steps: [{ answer: 'В1', choose: ['Нет'] }, next, back],
    check: (r, d) => expect(r.state.answers[byName(d, 'В1').id]).toEqual({ kind: 'choice', optionIds: [opt(d, 'В1', 'Нет')] }),
  },
  { name: 'L-01: после завершения дальше идти некуда', build: () => doc([screen('А')]), steps: [next, next], error: 'FINISHED' },
  { name: 'L-01: после завершения назад нельзя', build: () => doc([screen('А'), screen('Б')]), steps: [next, next, back], error: 'FINISHED' },

];

/** Branch scenarios need ids of options, so branches are added to the built document. */
function wired(name: string, setup: (d: ProjectDocument) => void, steps: Step[], path: string[], blocksA?: ReturnType<typeof choice>[], random?: number): Scenario {
  return {
    name,
    build: () => {
      const d = branching(blocksA);
      setup(d);
      return d;
    },
    steps,
    path,
    ...(random !== undefined ? { random } : {}),
  };
}

const A = (d: ProjectDocument) => d.screens[0]!;
const Y = (d: ProjectDocument) => d.screens[2]!;
const sel = (d: ProjectDocument, q: string, label: string) => ({ kind: 'answer' as const, questionBlockId: byName(d, q).id, op: 'selected' as const, optionId: opt(d, q, label) });
const toY = (d: ProjectDocument) => ({ kind: 'screen' as const, screenId: Y(d).id });
const two = () => [yesNo('В1'), yesNo('В2')];

scenarios.push(
  wired('L-02: ответ «Да» уводит на экран Y', (d) => (A(d).branches = [branch({ if: sel(d, 'В1', 'Да'), to: toY(d) })]), [{ answer: 'В1', choose: ['Да'] }, next], ['А', 'Y']),
  wired('L-02: условие ветки не выполнено — следующий экран', (d) => (A(d).branches = [branch({ if: sel(d, 'В1', 'Да'), to: toY(d) })]), [{ answer: 'В1', choose: ['Нет'] }, next], ['А', 'Б']),
  wired(
    'L-02: «И» — выполнены оба условия',
    (d) => (A(d).branches = [branch({ if: { kind: 'group', op: 'and', items: [sel(d, 'В1', 'Да'), sel(d, 'В2', 'Да')] }, to: toY(d) })]),
    [{ answer: 'В1', choose: ['Да'] }, { answer: 'В2', choose: ['Да'] }, next],
    ['А', 'Y'],
    two(),
  ),
  wired(
    'L-02: «И» — одно условие не выполнено',
    (d) => (A(d).branches = [branch({ if: { kind: 'group', op: 'and', items: [sel(d, 'В1', 'Да'), sel(d, 'В2', 'Да')] }, to: toY(d) })]),
    [{ answer: 'В1', choose: ['Да'] }, { answer: 'В2', choose: ['Нет'] }, next],
    ['А', 'Б'],
    two(),
  ),
  wired(
    'L-02: «ИЛИ» — достаточно одного',
    (d) => (A(d).branches = [branch({ if: { kind: 'group', op: 'or', items: [sel(d, 'В1', 'Да'), sel(d, 'В2', 'Да')] }, to: toY(d) })]),
    [{ answer: 'В1', choose: ['Нет'] }, { answer: 'В2', choose: ['Да'] }, next],
    ['А', 'Y'],
    two(),
  ),
  wired(
    'L-02: «ИЛИ» — ни одно не выполнено',
    (d) => (A(d).branches = [branch({ if: { kind: 'group', op: 'or', items: [sel(d, 'В1', 'Да'), sel(d, 'В2', 'Да')] }, to: toY(d) })]),
    [{ answer: 'В1', choose: ['Нет'] }, { answer: 'В2', choose: ['Нет'] }, next],
    ['А', 'Б'],
    two(),
  ),
  wired(
    'L-02: «НЕ» — ни одно из условий',
    (d) => (A(d).branches = [branch({ if: { kind: 'group', op: 'not', items: [sel(d, 'В1', 'Да'), sel(d, 'В2', 'Да')] }, to: toY(d) })]),
    [{ answer: 'В1', choose: ['Нет'] }, { answer: 'В2', choose: ['Нет'] }, next],
    ['А', 'Y'],
    two(),
  ),
  wired(
    'L-02: вложенные группы (В1=Да И (В2=Да ИЛИ НЕ В2=Нет))',
    (d) =>
      (A(d).branches = [
        branch({
          if: { kind: 'group', op: 'and', items: [sel(d, 'В1', 'Да'), { kind: 'group', op: 'or', items: [sel(d, 'В2', 'Да'), { kind: 'group', op: 'not', items: [sel(d, 'В2', 'Нет')] }] }] },
          to: toY(d),
        }),
      ]),
    [{ answer: 'В1', choose: ['Да'] }, next],
    ['А', 'Y'],
    two(),
  ),
  wired(
    'L-02: ветка по баллам за ответ (≥ N)',
    (d) => (A(d).branches = [branch({ if: { kind: 'answer', questionBlockId: byName(d, 'Б1').id, op: 'scoreGte', value: 5 }, to: toY(d) })]),
    [{ answer: 'Б1', choose: ['Пять'] }, next],
    ['А', 'Y'],
    [choice('Б1', [{ text: 'Пять', score: 5 }, { text: 'Ноль' }])],
  ),
  wired(
    'L-02: ветка по баллам — меньше порога',
    (d) => (A(d).branches = [branch({ if: { kind: 'answer', questionBlockId: byName(d, 'Б1').id, op: 'scoreGte', value: 5 }, to: toY(d) })]),
    [{ answer: 'Б1', choose: ['Ноль'] }, next],
    ['А', 'Б'],
    [choice('Б1', [{ text: 'Пять', score: 5 }, { text: 'Ноль' }])],
  ),
  wired(
    'L-02: ветка «содержит» по текстовому ответу без учёта регистра',
    (d) => (A(d).branches = [branch({ if: { kind: 'answer', questionBlockId: byName(d, 'Текстовый ответ').id, op: 'contains', value: 'ёлк' }, to: toY(d) })]),
    [{ answer: 'Текстовый ответ', value: { kind: 'text', value: '  Большая ЁЛКА ' } }, next],
    ['А', 'Y'],
    [createBlock('textInput') as never],
  ),
  wired(
    'L-02: ветка «равно» по шкале (число и строка «4»)',
    (d) => (A(d).branches = [branch({ if: { kind: 'answer', questionBlockId: byName(d, 'Шкала').id, op: 'eq', value: '4' }, to: toY(d) })]),
    [{ answer: 'Шкала', value: { kind: 'number', value: 4 } }, next],
    ['А', 'Y'],
    [createBlock('scale') as never],
  ),
  wired(
    'L-02: ветка «пусто» — необязательный вопрос пропущен',
    (d) => (A(d).branches = [branch({ if: { kind: 'answer', questionBlockId: byName(d, 'В1').id, op: 'empty' }, to: toY(d) })]),
    [next],
    ['А', 'Y'],
  ),
  wired(
    'L-02: из нескольких подходящих веток срабатывает первая',
    (d) =>
      (A(d).branches = [
        branch({ if: sel(d, 'В1', 'Да'), to: { kind: 'screen', screenId: d.screens[1]!.id } }),
        branch({ if: sel(d, 'В1', 'Да'), to: toY(d) }),
      ]),
    [{ answer: 'В1', choose: ['Да'] }, next],
    ['А', 'Б'],
  ),
  wired('L-02: ветка «завершить» сразу ведёт к концу', (d) => (A(d).branches = [branch({ if: sel(d, 'В1', 'Нет'), to: { kind: 'finish' } })]), [{ answer: 'В1', choose: ['Нет'] }, next], ['А', '∎']),
  wired('L-02: ветка «следующий экран»', (d) => (A(d).branches = [branch({ if: sel(d, 'В1', 'Нет'), to: { kind: 'next' } })]), [{ answer: 'В1', choose: ['Нет'] }, next], ['А', 'Б']),
  wired(
    'L-02: ветка по правильности ответа',
    (d) => (A(d).branches = [branch({ if: { kind: 'answer', questionBlockId: byName(d, 'Ключ').id, op: 'wrong' }, to: toY(d) })]),
    [{ answer: 'Ключ', choose: ['Неверно'] }, next],
    ['А', 'Y'],
    [choice('Ключ', [{ text: 'Верно', correct: true }, 'Неверно'])],
  ),
  wired(
    'L-02: «случайно 30 %», влияющее на результат, берётся из серверного источника — выпало',
    (d) => (A(d).branches = [branch({ if: { kind: 'chance', percent: 30, affectsResult: true }, to: toY(d) })]),
    [next],
    ['А', 'Y'],
    undefined,
    0.1,
  ),
  wired(
    'L-02: «случайно 30 %», влияющее на результат — не выпало',
    (d) => (A(d).branches = [branch({ if: { kind: 'chance', percent: 30, affectsResult: true }, to: toY(d) })]),
    [next],
    ['А', 'Б'],
    undefined,
    0.9,
  ),
  {
    name: 'L-02: ветка по ответу с прошлого экрана',
    build: () => {
      const q = yesNo();
      const s2 = screen('Развилка');
      const y = screen('Y');
      const d = doc([screen('А', [q]), s2, screen('Б'), y]);
      s2.branches = [branch({ if: sel(d, 'В1', 'Да'), to: { kind: 'screen', screenId: y.id } })];
      return d;
    },
    steps: [{ answer: 'В1', choose: ['Да'] }, next, next],
    path: ['А', 'Развилка', 'Y'],
  },
  {
    name: 'L-02: ветка по переменной (CN-01)',
    build: () => {
      const d = branching([]);
      d.variables = [{ id: 'monetki01', name: 'монетки', type: 'number', initial: 7, saveToAnswers: false }];
      A(d).branches = [branch({ if: { kind: 'variable', variableId: 'monetki01', op: 'gte', value: 5 }, to: toY(d) })];
      return d;
    },
    steps: [next],
    path: ['А', 'Y'],
  },
  {
    name: 'L-02: переход ветки берёт её собственную анимацию',
    build: () => {
      const d = branching();
      A(d).branches = [branch({ if: sel(d, 'В1', 'Да'), to: toY(d), transition: { kind: 'zoom', direction: 'left', durationMs: 300, delayMs: 0, easing: { kind: 'preset', name: 'easeOut' }, blur: 0, scale: 1 } })];
      return d;
    },
    steps: [{ answer: 'В1', choose: ['Да'] }, next],
    path: ['А', 'Y'],
  },

  // ── L-03 баллы, правильные ответы, обратная связь ──────────────────────────
  {
    name: 'L-03: баллы суммируются по одиночным и множественным вопросам',
    build: quiz,
    steps: [next, { answer: 'Столица', choose: ['Москва'] }, next, { answer: 'Цвета флага', choose: ['Белый', 'Зелёный'] }, next],
    check: (r, d) => expect(scoreTotals(d, r.state.answers)).toEqual({ score: 1, max: 3, correct: 1, keyed: 2 }),
  },
  {
    name: 'L-03: множественный выбор верен только при точном наборе',
    build: quiz,
    steps: [next, { answer: 'Столица', choose: ['Казань'] }, next, { answer: 'Цвета флага', choose: ['Синий', 'Белый'] }, next],
    check: (r, d) => expect(scoreTotals(d, r.state.answers)).toMatchObject({ correct: 1, score: 2 }),
  },
  {
    name: 'L-03: обратная связь «сразу» — вердикт после ответа, ответ больше не меняется',
    build: () => {
      const d = quiz();
      d.settings.feedbackMode = 'instant';
      return d;
    },
    steps: [next, { answer: 'Столица', choose: ['Казань'] }, { answer: 'Столица', choose: ['Москва'] }],
    error: 'ANSWER_LOCKED',
    check: (r, d) => expect(r.feedback).toEqual([{ correct: false, correctOptionIds: [opt(d, 'Столица', 'Москва')], score: 0 }]),
  },
  {
    name: 'L-03: обратная связь «в конце» — после ответа ключ не раскрывается, в конце — по каждому вопросу',
    build: quiz,
    steps: [next, { answer: 'Столица', choose: ['Москва'] }, next, next],
    check: (r, d) => {
      expect(r.feedback).toEqual([]);
      expect(finalFeedback(d, r.state).map((f) => f.correct)).toEqual([true, null]);
    },
  },
  {
    name: 'L-03: обратная связь «не показывать» — пусто и в конце',
    build: () => {
      const d = quiz();
      d.settings.feedbackMode = 'none';
      return d;
    },
    steps: [next, { answer: 'Столица', choose: ['Москва'] }, next, next],
    check: (r, d) => expect(finalFeedback(d, r.state)).toEqual([]),
  },

  // ── L-04 результаты ─────────────────────────────────────────────────────────
  { name: 'L-04: результат по диапазону баллов — низкий', build: quiz, steps: [next, { answer: 'Столица', choose: ['Казань'] }, next, next], path: ['Старт', 'Вопрос 1', 'Вопрос 2', 'Мало'], result: 'новичок' },
  {
    name: 'L-04: результат по диапазону баллов — граница включается',
    build: quiz,
    steps: [next, { answer: 'Столица', choose: ['Москва'] }, next, { answer: 'Цвета флага', choose: ['Белый'] }, next],
    path: ['Старт', 'Вопрос 1', 'Вопрос 2', 'Много'],
    result: 'знаток',
  },
  {
    name: 'L-04: личностный тест — побеждает тег, выбранный чаще',
    build: () => personality(),
    steps: [{ answer: 'Утро', choose: ['Бегу'] }, next, { answer: 'Вечер', choose: ['Танцы'] }, next],
    path: ['Утро', 'Вечер', 'Олень'],
    result: 'олень',
  },
  {
    name: 'L-04: ничья — правило «первый по порядку»',
    build: () => personality('first'),
    steps: [{ answer: 'Утро', choose: ['Бегу'] }, next, { answer: 'Вечер', choose: ['Чай'] }, next],
    result: 'снеговик',
  },
  {
    name: 'L-04: ничья — правило «случайно» (серверный источник)',
    build: () => personality('random'),
    steps: [{ answer: 'Утро', choose: ['Бегу'] }, next, { answer: 'Вечер', choose: ['Чай'] }, next],
    random: 0.75,
    result: 'олень',
  },
  { name: 'L-04: ни одного тега — результата нет, системный экран конца', build: () => personality(), steps: [next, next], path: ['Утро', 'Вечер', '∎'], result: null },
  {
    name: 'L-04: результат по значению переменной',
    build: () => {
      const win = screen('Победа', [], { kind: 'result' });
      return doc([screen('Игра'), win], {
        variables: [{ id: 'ochki0001', name: 'очки', type: 'number', initial: 12, saveToAnswers: true }],
        results: [{ kind: 'variable', id: createId(), key: 'победа', screenId: win.id, if: { kind: 'variable', variableId: 'ochki0001', op: 'gt', value: 10 } }],
      });
    },
    steps: [next],
    path: ['Игра', 'Победа'],
    result: 'победа',
  },
  {
    name: 'L-04: результат по ветке — экран результата без правила',
    build: () => doc([screen('А'), screen('Финал по ветке', [], { kind: 'result' })]),
    steps: [next, next],
    path: ['А', 'Финал по ветке'],
    result: 'Финал по ветке',
    error: 'FINISHED',
  },
  {
    name: 'L-04: правила результатов проверяются по порядку — первое подходящее',
    build: () => {
      const d = quiz();
      d.results.unshift({ kind: 'scoreRange', id: createId(), key: 'любой', screenId: d.screens[3]!.id, min: -100, max: 100 });
      return d;
    },
    steps: [next, next, next],
    result: 'любой',
  },
  {
    name: 'L-04: экраны результатов пропускаются при обычном «дальше»',
    build: () => {
      const r = screen('Итог', [], { kind: 'result' });
      return doc([screen('А'), r, screen('Б')], { results: [{ kind: 'scoreRange', id: createId(), key: 'всё', screenId: r.id, min: 0, max: 0 }] });
    },
    steps: [next, next],
    path: ['А', 'Б', 'Итог'],
  },
  {
    name: 'L-04: подстановки «баллы», «максимум», «результат» на экране результата',
    build: quiz,
    steps: [next, { answer: 'Столица', choose: ['Москва'] }, next, { answer: 'Цвета флага', choose: ['Белый', 'Синий'] }, next],
    check: (r, d) => {
      const t = substituteText(text([{ t: 'Вы ' }, { sys: 'результат' }, { t: ': ' }, { sys: 'баллы' }, { t: ' из ' }, { sys: 'максимум' }, { t: ', верно ' }, { sys: 'правильных' }, { t: '/' }, { sys: 'вопросов' }]), { doc: d, state: r.state, now: 0 });
      expect(t.paragraphs[0]!.runs.map((x) => ('t' in x ? x.t : '')).join('')).toBe('Вы знаток: 3 из 3, верно 2/2');
    },
  },

  // ── L-05 подстановки ────────────────────────────────────────────────────────
  {
    name: 'L-05: в текст подставляются переменные и ответы',
    build: () => {
      const d = doc([screen('А', [yesNo('Подарок'), createBlock('scale'), createBlock('contacts'), createBlock('consent')]), screen('Б')], {
        variables: [{ id: 'snezhki01', name: 'снежки', type: 'list', initial: [1, 'два'], saveToAnswers: false }],
      });
      return d;
    },
    steps: [
      { answer: 'Подарок', choose: ['Да'] },
      { answer: 'Шкала', value: { kind: 'number', value: 3 } },
      { answer: 'Контакты', value: { kind: 'contacts', values: { name: 'Олег', phone: '+7 900 000-00-00' } } },
      { answer: 'Согласие на обработку ПД', value: { kind: 'consent', value: true } },
      next,
    ],
    path: ['А', 'Б'],
    check: (r, d) => {
      const t = substituteText(text([{ answer: byName(d, 'Подарок').id }, { t: ' · ' }, { answer: byName(d, 'Шкала').id }, { t: ' · ' }, { sys: 'имя_участника' }, { t: ' · ' }, { v: 'snezhki01' }]), { doc: d, state: r.state, now: 0 });
      expect(t.paragraphs[0]!.runs.map((x) => ('t' in x ? x.t : '')).join('')).toBe('Да · 3 · Олег · 1, два');
    },
  },

  // ── L-06 таймер экрана ──────────────────────────────────────────────────────
  {
    name: 'L-06: время вышло — переход по таймеру без проверки обязательных',
    build: () => {
      const y = screen('Время вышло');
      return doc([screen('Вопрос', [yesNo('В1', true)], { timer: { seconds: 10, onExpire: { kind: 'screen', screenId: y.id } } }), screen('Б'), y]);
    },
    steps: [{ wait: 10_000 }, { do: 'timer' }],
    path: ['Вопрос', 'Время вышло'],
  },
  {
    name: 'L-06: сигнал таймера раньше времени отклоняется',
    build: () => doc([screen('Вопрос', [], { timer: { seconds: 10, onExpire: { kind: 'next' } } }), screen('Б')]),
    steps: [{ wait: 8_000 }, { do: 'timer' }],
    error: 'TIMER_NOT_EXPIRED',
  },
  {
    name: 'L-06: допуск на расхождение часов — 1 секунда',
    build: () => doc([screen('Вопрос', [], { timer: { seconds: 10, onExpire: { kind: 'next' } } }), screen('Б')]),
    steps: [{ wait: 9_000 }, { do: 'timer' }],
    path: ['Вопрос', 'Б'],
  },
  {
    name: 'L-06: таймер «завершить» показывает результат',
    build: () => {
      const d = quiz();
      d.screens[1]!.timer = { seconds: 5, onExpire: { kind: 'finish' } };
      return d;
    },
    steps: [next, { wait: 5_000 }, { do: 'timer' }],
    path: ['Старт', 'Вопрос 1', 'Мало'],
    result: 'новичок',
  },
  { name: 'L-06: на экране без таймера сигнал отклоняется', build: () => doc([screen('А'), screen('Б')]), steps: [{ do: 'timer' }], error: 'NO_TIMER' },
  {
    name: 'L-06: отсчёт идёт заново после возврата на экран',
    build: () => doc([screen('А', [], { timer: { seconds: 10, onExpire: { kind: 'next' } } }), screen('Б')]),
    steps: [{ wait: 9_500 }, next, back, { wait: 500 }, { do: 'timer' }],
    error: 'TIMER_NOT_EXPIRED',
  },

  // ── L-07 обязательные вопросы ───────────────────────────────────────────────
  { name: 'L-07: без ответа на обязательный вопрос дальше нельзя', build: () => doc([screen('А', [yesNo('В1', true)]), screen('Б')]), steps: [next], error: 'REQUIRED' },
  { name: 'L-07: необязательный вопрос можно пропустить', build: () => doc([screen('А', [yesNo('В1', false)]), screen('Б')]), steps: [next], path: ['А', 'Б'] },
  {
    name: 'L-07: скрытый до события обязательный вопрос не мешает',
    build: () => {
      const q = yesNo('В1', true);
      q.initiallyHidden = true;
      return doc([screen('А', [q]), screen('Б')]);
    },
    steps: [next],
    path: ['А', 'Б'],
  },
  {
    name: 'L-07: вопрос внутри скрытого контейнера не обязателен',
    build: () => doc([screen('А', [createBlock('container', { initiallyHidden: true, children: [yesNo('В1', true)] })]), screen('Б')]),
    steps: [next],
    path: ['А', 'Б'],
  },
  {
    name: 'L-07: вопрос, видимый по условию, обязателен, когда условие выполнено',
    build: () => {
      const q1 = yesNo('В1');
      const q2 = yesNo('В2', true);
      const d = doc([screen('А', [q1, q2]), screen('Б')]);
      byName(d, 'В2').visibleIf = sel(d, 'В1', 'Да');
      return d;
    },
    steps: [{ answer: 'В1', choose: ['Да'] }, next],
    error: 'REQUIRED',
  },
  {
    name: 'L-07: вопрос, видимый по условию, не обязателен, пока скрыт',
    build: () => {
      const q1 = yesNo('В1');
      const q2 = yesNo('В2', true);
      const d = doc([screen('А', [q1, q2]), screen('Б')]);
      byName(d, 'В2').visibleIf = sel(d, 'В1', 'Да');
      return d;
    },
    steps: [{ answer: 'В1', choose: ['Нет'] }, next],
    path: ['А', 'Б'],
  },
  {
    name: 'L-07: минимум выбранных вариантов',
    build: () => doc([screen('А', [choice('Мульти', ['1', '2', '3'], { multi: true, minSelected: 2 })]), screen('Б')]),
    steps: [{ answer: 'Мульти', choose: ['1'] }, next],
    error: 'REQUIRED',
  },
  {
    name: 'L-07: контакты обязательны целиком, согласие — когда контакты оставлены',
    build: () => doc([screen('А', [createBlock('contacts'), createBlock('consent')]), screen('Б')]),
    steps: [{ answer: 'Контакты', value: { kind: 'contacts', values: { name: 'Олег', phone: '+79000000000' } } }, next],
    error: 'REQUIRED',
    check: (r) => expect(r.error?.message).toBe('Чтобы отправить контакты, отметьте согласие на обработку персональных данных'),
  },
  {
    name: 'L-07: согласие не требуется, если персональные данные не вводились',
    build: () => doc([screen('А', [yesNo('В1'), createBlock('consent')]), screen('Б')]),
    steps: [next],
    path: ['А', 'Б'],
  },
  {
    name: 'L-07: минимальная длина текстового ответа',
    build: () => {
      const t = createBlock('textInput', { props: { minLength: 10 } });
      return doc([screen('А', [t]), screen('Б')]);
    },
    steps: [{ answer: 'Текстовый ответ', value: { kind: 'text', value: 'коротко' } }, next],
    error: 'REQUIRED',
  },

  // ── PL-15 сервер считает по полному документу ──────────────────────────────
  {
    name: 'PL-15: ответ с чужим вариантом отклоняется',
    build: quiz,
    steps: [next, { answer: 'Столица', value: { kind: 'choice', optionIds: ['podmena0001'] } }],
    error: 'INVALID_ANSWER',
  },
  {
    name: 'PL-15: в вопрос с одним ответом нельзя прислать два варианта',
    build: quiz,
    steps: [next, { answer: 'Столица', choose: ['Москва', 'Казань'] }],
    error: 'INVALID_ANSWER',
  },
  { name: 'PL-15: ответ на вопрос с другого экрана отклоняется', build: quiz, steps: [{ answer: 'Столица', choose: ['Москва'] }], error: 'NOT_ON_SCREEN' },
  {
    name: 'PL-15: по публичной проекции баллы не посчитать — результат считает сервер по полному документу',
    build: quiz,
    steps: [next, { answer: 'Столица', choose: ['Москва'] }, next, { answer: 'Цвета флага', choose: ['Белый', 'Синий'] }, next],
    result: 'знаток',
    check: (r, d) => {
      const pub = toPublicDocument(d) as unknown as ProjectDocument;
      expect(scoreTotals(pub, r.state.answers)).toEqual({ score: 0, max: 0, correct: 0, keyed: 0 });
      expect(scoreTotals(d, r.state.answers).score).toBe(3);
    },
  },
);

describe('движок прохождения: сценарии', () => {
  it('сценариев не меньше 40', () => {
    expect(scenarios.length).toBeGreaterThanOrEqual(40);
  });

  it.each(scenarios.map((s) => [s.name, s] as const))('%s', (_name, s) => {
    const d = s.build();
    const run = play(d, s.steps, s.random !== undefined ? { random: s.random } : {});
    if (s.error) expect(run.error?.code).toBe(s.error);
    else expect(run.error).toBeUndefined();
    if (s.path) expect(run.path).toEqual(s.path);
    if (s.result !== undefined) expect(run.state.result?.key ?? null).toBe(s.result);
    s.check?.(run, d);
  });
});

it('L-05: названия вариантов берутся из их текста', () => {
  const q = choice('В', [{ text: 'Снежок' }, 'Ёлка']);
  q.children[1]!.textLayer = textOf('  ');
  const d = doc([screen('А', [q])]);
  const r = play(d, [{ answer: 'В', choose: ['Снежок'] }]);
  expect(r.state.answers[q.id]).toEqual({ kind: 'choice', optionIds: [q.props.options[0]!.id] });
});
