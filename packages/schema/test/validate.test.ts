import { describe, expect, it } from 'vitest';
import {
  createBlock,
  createDocument,
  createRule,
  createScreen,
  createVariable,
  hasErrors,
  isEmptyBlock,
  textOf,
  validateDocument,
  type ProjectDocument,
  type Screen,
} from '../src/index.js';

/** Document with screens; each non-final screen gets a «Дальше» button unless told otherwise. */
const docWith = (screens: Screen[], withButtons = true): ProjectDocument => {
  const doc = createDocument();
  doc.screens = screens.map((s, i) => (withButtons && i < screens.length - 1 ? { ...s, blocks: [...s.blocks, createBlock('button')] } : s));
  return doc;
};
const codes = (doc: ProjectDocument) => validateDocument(doc).map((i) => i.code);

describe('L-08: проверка логики перед публикацией', () => {
  it('L-08: линейная сборка с кнопками — без замечаний', () => {
    const doc = docWith([createScreen('1'), createScreen('2'), createScreen('3')]);
    expect(validateDocument(doc)).toEqual([]);
    expect(hasErrors(validateDocument(doc))).toBe(false);
  });

  it('L-08: экран без выхода — ошибка; последний экран и экран результата выходом не обязаны', () => {
    const doc = docWith([createScreen('Первый'), createScreen('Тупик'), createScreen('Финал')], false);
    const issues = validateDocument(doc);
    expect(issues.filter((i) => i.code === 'NO_EXIT').map((i) => i.message)).toEqual([
      'С экрана «Первый» нельзя уйти: добавьте кнопку перехода, таймер или автопереход',
      'С экрана «Тупик» нельзя уйти: добавьте кнопку перехода, таймер или автопереход',
    ]);
  });

  it('L-08: таймер, автопереход вопроса и видео «дальше после окончания» считаются выходом', () => {
    const q = createBlock('singleChoice');
    if (q.type === 'singleChoice') q.props.autoAdvance = true;
    const v = createBlock('video', { props: { media: null, nextOnEnd: true } });
    const doc = docWith(
      [createScreen('Таймер', { timer: { seconds: 10, onExpire: { kind: 'next' } } }), createScreen('Вопрос', { blocks: [q] }), createScreen('Видео', { blocks: [v] }), createScreen('Финал')],
      false,
    );
    q.children.forEach((c) => (c.textLayer = textOf('Ответ')));
    expect(codes(doc)).toEqual([]);
  });

  it('L-08: недостижимый экран — ошибка', () => {
    const a = createScreen('Старт');
    const b = createScreen('Забытый');
    const c = createScreen('Финал');
    const jump = createBlock('button');
    jump.rules = [createRule({ kind: 'tap', source: { kind: 'block', blockId: jump.id } }, [{ kind: 'goTo', to: 'screen', screenId: c.id }])];
    a.blocks = [jump];
    b.blocks = [createBlock('button')];
    const doc = docWith([a, b, c], false);
    const issue = validateDocument(doc).find((i) => i.code === 'UNREACHABLE_SCREEN');
    expect(issue?.message).toBe('Экран «Забытый» недостижим: на него не ведёт ни один переход');
  });

  it('L-08: ветвление делает экран достижимым; экран результата достижим через результаты', () => {
    const a = createScreen('Вопрос');
    const yes = createScreen('Да');
    const res = createScreen('Итог', { kind: 'result' });
    a.branches = [{ id: 'branch0001', if: { kind: 'chance', percent: 50, affectsResult: false }, to: { kind: 'screen', screenId: yes.id } }];
    const doc = docWith([a, createScreen('Нет', { blocks: [] }), yes, res]);
    doc.results = [{ kind: 'scoreRange', id: 'result0001', key: 'итог', screenId: res.id, min: 0, max: 10 }];
    expect(codes(doc)).not.toContain('UNREACHABLE_SCREEN');
  });

  it('L-08: круг экранов без выхода — ошибка', () => {
    const a = createScreen('А');
    const b = createScreen('Б');
    const c = createScreen('В');
    const fin = createScreen('Финал');
    const toB = createBlock('button');
    toB.rules = [createRule({ kind: 'tap', source: { kind: 'block', blockId: toB.id } }, [{ kind: 'goTo', to: 'screen', screenId: b.id }])];
    const toC = createBlock('button');
    toC.rules = [createRule({ kind: 'tap', source: { kind: 'block', blockId: toC.id } }, [{ kind: 'goTo', to: 'screen', screenId: c.id }])];
    const toB2 = createBlock('button');
    toB2.rules = [createRule({ kind: 'tap', source: { kind: 'block', blockId: toB2.id } }, [{ kind: 'goTo', to: 'screen', screenId: b.id }])];
    a.blocks = [toB];
    b.blocks = [toC];
    c.blocks = [toB2];
    const doc = docWith([a, b, c, fin], false);
    const loop = validateDocument(doc).find((i) => i.code === 'ENDLESS_LOOP');
    expect(loop?.message).toContain('«Б»');
    expect(loop?.message).toContain('«В»');
  });

  it('L-08: круг с выходом (кнопка «завершить») — не ошибка', () => {
    const a = createScreen('А');
    const b = createScreen('Б');
    const toA = createBlock('button');
    toA.rules = [createRule({ kind: 'tap', source: { kind: 'block', blockId: toA.id } }, [{ kind: 'goTo', to: 'screen', screenId: a.id }])];
    const stop = createBlock('button');
    stop.rules = [createRule({ kind: 'tap', source: { kind: 'block', blockId: stop.id } }, [{ kind: 'finish' }])];
    a.blocks = [createBlock('button')];
    b.blocks = [toA, stop];
    const doc = docWith([a, b, createScreen('Финал')], false);
    expect(codes(doc)).not.toContain('ENDLESS_LOOP');
  });

  it('L-08: пустой вариант ответа — ошибка; с текстом или картинкой — нет', () => {
    const q = createBlock('singleChoice');
    q.children[0]!.textLayer = undefined;
    q.children[1]!.textLayer = undefined;
    q.children[1]!.style.fills = [{ kind: 'media', media: { source: 'media', id: 'photo00001' }, fit: 'cover', focal: { x: 0.5, y: 0.5 }, scale: 1 }];
    const doc = docWith([createScreen('В', { blocks: [q] }), createScreen('Ф')]);
    const empty = validateDocument(doc).filter((i) => i.code === 'EMPTY_OPTION');
    expect(empty).toHaveLength(1);
    expect(empty[0]?.message).toContain('Вариант ответа 1');
    expect(isEmptyBlock(q.children[1]!)).toBe(false);
  });

  it('L-08: вариант ответа должен лежать внутри вопроса', () => {
    const q = createBlock('singleChoice');
    if (q.type === 'singleChoice') q.props.options[0]!.blockId = 'elsewhere01';
    const doc = docWith([createScreen('В', { blocks: [q] }), createScreen('Ф')]);
    expect(codes(doc)).toContain('OPTION_NOT_CHILD');
  });

  it('L-08: ветка и таймер на удалённый экран, результат на удалённый экран', () => {
    const s = createScreen('В', {
      branches: [{ id: 'branch0001', if: { kind: 'chance', percent: 10, affectsResult: false }, to: { kind: 'screen', screenId: 'deleted001' } }],
      timer: { seconds: 5, onExpire: { kind: 'screen', screenId: 'deleted002' } },
    });
    const doc = docWith([s, createScreen('Ф')]);
    doc.results = [{ kind: 'tag', id: 'result0001', key: 'снеговик', screenId: 'deleted003', tag: 'снеговик' }];
    expect(codes(doc).filter((c) => c === 'MISSING_SCREEN')).toHaveLength(3);
  });
});

describe('SC-07: проверка сценариев перед публикацией', () => {
  it('SC-07: правило на удалённый блок, переменную, экран и вариант', () => {
    const s = createScreen('Игра');
    s.rules = [
      createRule({ kind: 'tap', source: { kind: 'block', blockId: 'deletedblk' } }, [
        { kind: 'setVariable', variableId: 'deletedvar', op: 'add', value: 1 },
        { kind: 'goTo', to: 'screen', screenId: 'deletedscr' },
        { kind: 'if', if: { kind: 'answer', questionBlockId: 'deletedq01', op: 'selected', optionId: 'deletedopt' }, then: [{ kind: 'finish' }], else: [] },
      ]),
    ];
    const doc = docWith([s, createScreen('Ф')]);
    const c = codes(doc);
    expect(c).toEqual(expect.arrayContaining(['MISSING_BLOCK', 'MISSING_VARIABLE', 'MISSING_SCREEN', 'MISSING_OPTION']));
  });

  it('SC-07: правило экрана не может управлять блоком с другого экрана', () => {
    const other = createBlock('shape');
    const s1 = createScreen('Первый');
    s1.rules = [createRule({ kind: 'screen', phase: 'show' }, [{ kind: 'visibility', targets: [{ kind: 'block', blockId: other.id }], mode: 'show', animate: true }])];
    const doc = docWith([s1, createScreen('Второй', { blocks: [other] })]);
    expect(validateDocument(doc).find((i) => i.code === 'BLOCK_ON_OTHER_SCREEN')?.message).toBe(
      'Правило экрана «Первый» ссылается на блок с экрана «Второй»',
    );
  });

  it('SC-07: ссылки поведений (генератор, зоны, колесо, переворот) и переменные блока «Значение»', () => {
    const b = createBlock('shape', {
      behaviors: [
        { kind: 'spawner', prototypeId: 'ghost00001', area: { x: 0, y: 0, w: 390, h: 100 } },
        { kind: 'drag', snapToZones: ['ghostzone1'] },
      ],
    });
    const v = createBlock('value', { props: { variableId: 'novariable' } });
    const doc = docWith([createScreen('И', { blocks: [b, v] }), createScreen('Ф')]);
    const c = codes(doc);
    expect(c.filter((x) => x === 'MISSING_BLOCK')).toHaveLength(2);
    expect(c).toContain('MISSING_VARIABLE');
  });

  it('SC-07: существующие ссылки и переменные — без ошибок', () => {
    const score = createVariable('счёт', 'number', 0, true);
    const gift = createBlock('image');
    const s = createScreen('Игра', { blocks: [gift] });
    s.rules = [createRule({ kind: 'tap', source: { kind: 'copiesOf', blockId: gift.id } }, [{ kind: 'setVariable', variableId: score.id, op: 'add', value: 1 }, { kind: 'destroy', target: { kind: 'self' } }])];
    const doc = docWith([s, createScreen('Ф')]);
    doc.variables = [score];
    expect(validateDocument(doc)).toEqual([]);
  });

  it('TS-07: ссылка и копирование — только по жесту участника', () => {
    const s = createScreen('Ловушка');
    s.rules = [
      createRule({ kind: 'screen', phase: 'show' }, [{ kind: 'openLink', url: 'https://example.org' }]),
      createRule({ kind: 'timer', mode: 'after', seconds: 1 }, [{ kind: 'if', if: { kind: 'chance', percent: 100, affectsResult: false }, then: [{ kind: 'copyText', text: 'x' }], else: [] }]),
    ];
    const btn = createBlock('button');
    btn.rules.push(createRule({ kind: 'tap', source: { kind: 'block', blockId: btn.id } }, [{ kind: 'openLink', url: 'https://example.org' }]));
    s.blocks = [btn];
    const doc = docWith([s, createScreen('Ф')], false);
    const gesture = validateDocument(doc).filter((i) => i.code === 'LINK_WITHOUT_GESTURE');
    expect(gesture).toHaveLength(2);
    expect(gesture[0]?.message).toContain('только по действию участника');
  });
});

describe('AC-02 · значения свойств в «Изменить свойство»', () => {
  const withValue = (property: 'style.effects' | 'frame.x' | 'textLayer' | 'props.media', value: unknown) => {
    const s = createScreen('Экран');
    const btn = createBlock('button');
    btn.rules.push(createRule({ kind: 'tap', source: { kind: 'block', blockId: btn.id } }, [{ kind: 'setProperty', target: { kind: 'block', blockId: btn.id }, property, value, durationMs: 0 }]));
    s.blocks = [btn];
    return docWith([s, createScreen('Ф')]);
  };

  it('AC-02: подходящее значение (прозрачность, сдвиг, текст, пустое медиа) — без замечаний', () => {
    expect(codes(withValue('style.effects', { opacity: 0.5 }))).not.toContain('INVALID_PROPERTY_VALUE');
    expect(codes(withValue('frame.x', 40))).not.toContain('INVALID_PROPERTY_VALUE');
    expect(codes(withValue('textLayer', textOf('Привет')))).not.toContain('INVALID_PROPERTY_VALUE');
    expect(codes(withValue('props.media', null))).not.toContain('INVALID_PROPERTY_VALUE');
  });

  it('AC-02: неподходящее значение — ошибка публикации с русским пояснением', () => {
    for (const [property, value] of [['style.effects', { opacity: 7 }], ['frame.x', 'влево'], ['textLayer', 'просто строка'], ['props.media', { kind: 'нет' }]] as const) {
      const issues = validateDocument(withValue(property, value)).filter((i) => i.code === 'INVALID_PROPERTY_VALUE');
      expect(issues, property).toHaveLength(1);
      expect(issues[0]?.severity).toBe('error');
      expect(issues[0]?.message).toContain(property);
    }
  });
});

describe('L-02 · L-05: ссылки на ответы и переменные', () => {
  it('L-02: ветка по ответу на вопрос с прошлого экрана — не ошибка', () => {
    const q = createBlock('singleChoice');
    const opt = q.type === 'singleChoice' ? q.props.options[0]!.id : '';
    const s1 = createScreen('Вопрос', { blocks: [q] });
    const s2 = createScreen('Развилка', {
      branches: [{ id: 'branch0001', if: { kind: 'answer', questionBlockId: q.id, op: 'selected', optionId: opt }, to: { kind: 'finish' } }],
    });
    const doc = docWith([s1, s2, createScreen('Финал')]);
    expect(codes(doc)).toEqual([]);
  });

  it('L-05: текст подставляет удалённую переменную или ответ на удалённый вопрос — ошибка', () => {
    const t = createBlock('text', { name: 'Итог', textLayer: { paragraphs: [{ runs: [{ t: 'Вы набрали ' }, { sys: 'баллы' }, { v: 'deletedvar' }, { answer: 'deletedq01' }] }] } });
    const doc = docWith([createScreen('Э', { blocks: [t] }), createScreen('Ф')]);
    const issues = validateDocument(doc);
    expect(issues.map((i) => i.code)).toEqual(['MISSING_VARIABLE', 'MISSING_BLOCK']);
    expect(issues[1]?.message).toBe('Текст блока «Итог» подставляет ответ на удалённый вопрос');
  });
});

