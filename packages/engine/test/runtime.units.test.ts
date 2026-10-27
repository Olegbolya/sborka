import { describe, expect, it } from 'vitest';
import { SpatialGrid, createRuntime, easingFunction } from '../src/index.js';
import { type BlockInput, textOf } from '@blokum/schema';
import { act, b, bool, buildDoc, ev, list, num, on, play, question, rule, tick, txt } from './runtime-helpers.js';

describe('S-12…S-14 · AC-02: кривые плавности', () => {
  it('AC-02: линейная кривая и границы', () => {
    const f = easingFunction({ kind: 'preset', name: 'linear' }, 1000);
    expect([f(0), f(0.25), f(1)]).toEqual([0, 0.25, 1]);
  });

  it.each(['ease', 'easeIn', 'easeOut', 'easeInOut'] as const)('AC-02: кривая «%s» монотонна от 0 до 1', (name) => {
    const f = easingFunction({ kind: 'preset', name }, 1000);
    const xs = Array.from({ length: 11 }, (_, i) => f(i / 10));
    expect(xs[0]).toBeCloseTo(0, 5);
    expect(xs[10]).toBeCloseTo(1, 5);
    for (let i = 1; i < xs.length; i++) expect(xs[i]!).toBeGreaterThanOrEqual(xs[i - 1]! - 1e-9);
  });

  it('AC-02: «ease-in» медленнее в начале, «ease-out» — быстрее', () => {
    expect(easingFunction({ kind: 'preset', name: 'easeIn' }, 1000)(0.3)).toBeLessThan(0.3);
    expect(easingFunction({ kind: 'preset', name: 'easeOut' }, 1000)(0.3)).toBeGreaterThan(0.3);
    expect(easingFunction(undefined, 1000)(0.3)).toBeGreaterThan(0.3);
  });

  it('AC-02: своя кривая Безье с выходом за пределы и вертикальным участком', () => {
    const back = easingFunction({ kind: 'bezier', x1: 0.3, y1: -0.6, x2: 0.7, y2: 1.6 }, 1000);
    expect(back(0.1)).toBeLessThan(0);
    expect(back(0.9)).toBeGreaterThan(1);
    const steep = easingFunction({ kind: 'bezier', x1: 0, y1: 1, x2: 0, y2: 1 }, 1000);
    expect(steep(0.5)).toBeGreaterThan(0.9);
  });

  it('AC-02: S-образная кривая с горизонтальной касательной — без скачков', () => {
    const f = easingFunction({ kind: 'bezier', x1: 1, y1: 0, x2: 0, y2: 1 }, 1000);
    const xs = Array.from({ length: 101 }, (_, i) => f(i / 100));
    for (let i = 1; i < xs.length; i++) expect(xs[i]!).toBeGreaterThanOrEqual(xs[i - 1]! - 1e-6);
    expect(f(0.5)).toBeCloseTo(0.5, 3);
  });

  it('AC-02: пружина — с колебаниями и без', () => {
    const bouncy = easingFunction({ kind: 'spring', stiffness: 300, damping: 5 }, 2000);
    expect(Math.max(...Array.from({ length: 50 }, (_, i) => bouncy(i / 50)))).toBeGreaterThan(1);
    const stiff = easingFunction({ kind: 'spring', stiffness: 100, damping: 40 }, 2000);
    expect(stiff(0)).toBe(0);
    expect(stiff(1)).toBeGreaterThan(0.99);
    expect(stiff(1)).toBeLessThanOrEqual(1);
  });
});

describe('TR-07: пространственная сетка', () => {
  it('TR-07: находит пересечения, в том числе на отрицательных координатах и большие блоки', () => {
    const g = new SpatialGrid<{ box: { x: number; y: number; w: number; h: number }; id: string }>(50);
    g.insert({ box: { x: -100, y: -100, w: 30, h: 30 }, id: 'а' });
    g.insert({ box: { x: 0, y: 0, w: 500, h: 500 }, id: 'б' });
    g.insert({ box: { x: 600, y: 600, w: 10, h: 10 }, id: 'в' });
    expect(g.query({ x: -90, y: -90, w: 5, h: 5 }).map((i) => i.id)).toEqual(['а']);
    expect(g.query({ x: 200, y: 200, w: 300, h: 300 }).map((i) => i.id)).toEqual(['б']);
    expect(g.query({ x: 500, y: 0, w: 5, h: 5 })).toEqual([]);
  });
});

describe('AC-02: значения свойств проверяются по схеме стиля', () => {
  const K = b('shape', 'knopka');
  it.each([
    ['props.media', { source: 'media', id: 'foto000001' }, true],
    ['props.media', null, true],
    ['props.media', { source: 'internet', id: 'x' }, false],
    ['textLayer', { paragraphs: 'нет' }, false],
    ['frame.flipY', 'да', false],
    ['frame.x', Number.NaN, false],
    ['style.radius', { tl: 20 }, true],
    ['style.shadows', [{ blur: 99999 }], false],
  ] as const)('AC-02: %s = %j → %s', (property, value, accepted) => {
    const o = play({ blocks: [K], rules: [rule(on.tap('knopka'), [act.prop('knopka', property, value)])] }, [ev.tap('knopka')]);
    expect(o.warnings.length === 0).toBe(accepted);
  });

  it('AC-02: плавные фильтры и 3D начинаются со значений стиля, после новых фильтров — заново', () => {
    const K3 = b('shape', 'knopka', { style: { filters: { brightness: 2 }, transform3d: { rotateX: 30 } } });
    const o = play(
      {
        blocks: [K3],
        rules: [
          rule(on.tap('knopka'), [act.animate('knopka', 'brightness', 1, 1000), act.animate('knopka', 'rotateX', 0, 1000), act.animate('knopka', 'scale', 2, 1000), act.animate('knopka', 'blur', 10, 1000)]),
          rule(on.doubleTap('knopka'), [act.prop('knopka', 'style.filters', { brightness: 0.5 }), act.prop('knopka', 'style.transform3d', { rotateX: 5 })]),
        ],
      },
      [ev.tap('knopka'), tick(500)],
    );
    expect(o.view('knopka')?.anim).toEqual({ brightness: 1.5, rotateX: 15, scale: 1.5, blur: 5 });
    o.rt.dispatch(ev.doubleTap('knopka'));
    expect(o.view('knopka')?.anim).toEqual({ scale: 1.5, blur: 5 });
  });

  it('AC-02: смена позиции сразу отменяет плавное движение', () => {
    const o = play({ blocks: [K], rules: [rule(on.tap('knopka'), [act.moveTo('knopka', 300, 0, 1000), act.prop('knopka', 'frame.x', 50)])] }, [ev.tap('knopka'), tick(500)]);
    expect(o.view('knopka')?.x).toBe(50);
  });
});

describe('AC-04: краевые случаи переменных', () => {
  const K = b('shape', 'knopka');
  const run = (vars: Parameters<typeof play>[0]['vars'], actions: Parameters<typeof rule>[1]) => play({ blocks: [K], vars, rules: [rule(on.tap('knopka'), actions)] }, [ev.tap('knopka')]);

  it('AC-04: дробный случайный диапазон и неверный диапазон', () => {
    const o = run([num('chislo')], [act.op('chislo', 'random', undefined, [0.5, 1.5])]);
    expect(o.v('chislo')).toBeGreaterThanOrEqual(0.5);
    expect(o.v('chislo')).toBeLessThanOrEqual(1.5);
    expect(run([num('chislo')], [act.op('chislo', 'random', undefined, [5, 1])]).warnings).toEqual(['Переменная «chislo»: Неверный диапазон случайного числа']);
    expect(run([num('chislo')], [{ kind: 'setVariable', variableId: 'chislo', op: 'random' }]).v('chislo')).toBeLessThanOrEqual(100);
  });

  it('AC-04: случайный элемент числового списка в число; ошибки выбора', () => {
    expect(run([num('chislo'), list('spisok', ['а', 7])], [act.op('chislo', 'pickRandom', 'spisok')]).v('chislo')).toBe(7);
    expect(run([num('chislo'), list('spisok', ['а'])], [act.op('chislo', 'pickRandom', 'spisok')]).warnings).toEqual(['Переменная «chislo»: В списке нет подходящих элементов']);
    expect(run([txt('slovo1')], [act.op('slovo1', 'pickRandom', 'netsuch1')]).warnings).toEqual(['Переменная «slovo1»: Укажите переменную-список, из которой выбирать']);
  });

  it('AC-04: недопустимые действия для типа', () => {
    const w = (vars: Parameters<typeof play>[0]['vars'], a: Parameters<typeof rule>[1][number]) => run(vars, [a]).warnings[0];
    expect(w([num('chislo')], act.op('chislo', 'toggle'))).toBe('Переменная «chislo»: Действие недоступно для числа');
    expect(w([txt('slovo1')], act.op('slovo1', 'mul', 2))).toBe('Переменная «slovo1»: Действие недоступно для текста');
    expect(w([bool('danet1')], act.op('danet1', 'add', 1))).toBe('Переменная «danet1»: Действие недоступно для «да/нет»');
    expect(w([list('spisok')], act.op('spisok', 'toggle'))).toBe('Переменная «spisok»: Действие недоступно для списка');
    expect(w([list('spisok')], { kind: 'setVariable', variableId: 'spisok', op: 'append', value: true })).toBe('Переменная «spisok»: В список можно добавить число или текст');
    expect(w([list('spisok', Array.from({ length: 500 }, (_, i) => i))], act.op('spisok', 'append', 1))).toBe('Переменная «spisok»: В списке уже 500 элементов');
    expect(w([txt('slovo1', 'я'.repeat(999))], act.op('slovo1', 'append', 'ой'))).toBe('Переменная «slovo1»: текст длиннее 1000 символов');
    expect(w([], act.add('udalena1'))).toBe('Изменить переменную: переменная удалена');
  });

  it('AC-04: «задать» для текста и списка без значения', () => {
    const o = run([txt('slovo1', 'а'), list('spisok', [1])], [{ kind: 'setVariable', variableId: 'slovo1', op: 'set' }, { kind: 'setVariable', variableId: 'spisok', op: 'set', value: 'один' }]);
    expect([o.v('slovo1'), o.v('spisok')]).toEqual(['', ['один']]);
    expect(run([list('spisok', [1])], [{ kind: 'setVariable', variableId: 'spisok', op: 'set' }]).v('spisok')).toEqual([]);
    expect(run([txt('slovo1', 'а')], [{ kind: 'setVariable', variableId: 'slovo1', op: 'add' }]).v('slovo1')).toBe('а');
  });
});

describe('TR-10 · AC-13: таймер B-08 «до даты»', () => {
  it('AC-13: длительность считается от времени старта', () => {
    const doc = buildDoc({ blocks: [b('timer', 'taimer', { props: { mode: 'until', until: '2026-12-31T21:00:00Z' } })] });
    const rt = createRuntime(doc, { seed: 1, startedAt: Date.parse('2026-12-31T20:59:00Z') });
    rt.enterScreen('ekran1');
    expect(rt.timerRemaining('taimer')).toBe(60_000);
    expect(rt.timerRemaining('netakogo')).toBeUndefined();
  });

  it('AC-13: команда несуществующему таймеру ничего не ломает', () => {
    const o = play({ blocks: [b('shape', 'knopka')], rules: [rule(on.tap('knopka'), [act.timer('netakogo', 'start')])] }, [ev.tap('knopka')]);
    expect(o.warnings).toEqual([]);
  });
});

describe('устойчивость к неверным вызовам', () => {
  it('TR-05: перемещение без начала перетаскивания и события для несуществующих блоков игнорируются', () => {
    const o = play({ blocks: [b('shape', 'podarok')] }, [
      ev.dragMove('podarok', 50, 50),
      ev.dragEnd('podarok', 50, 50),
      ev.scratched('netakogo', 90),
      ev.mediaEnd('netakogo'),
      ev.swipe('left', 'netakogo'),
      (rt) => rt.setMotion('netakogo', { vx: 1, vy: 1 }),
    ]);
    expect(o.view('podarok')).toMatchObject({ x: 0, y: 0 });
  });

  it('TR-09: несуществующий экран — понятная ошибка; события до показа экрана не обрабатываются', () => {
    const rt = createRuntime(buildDoc({}), { seed: 1 });
    expect(rt.dispatch(ev.tap('knopka')).effects).toEqual([]);
    expect(rt.tick(100).effects).toEqual([]);
    expect(rt.leaveScreen().effects).toEqual([]);
    expect(() => rt.enterScreen('netakogo')).toThrow('Экран netakogo не найден');
    expect(rt.screenId).toBeUndefined();
  });

  it('AC-03 · AC-09: перемещение и копия к удалённому блоку', () => {
    const o = play(
      { blocks: [b('shape', 'knopka'), b('shape', 'zvezda', { initiallyHidden: true, frame: { x: 30, y: 40, w: 10, h: 10 } })], rules: [rule(on.tap('knopka'), [act.moveToBlock('knopka', 'udalen01'), act.spawn('zvezda', { kind: 'block', blockId: 'udalen01' })])] },
      [ev.tap('knopka')],
    );
    expect(o.view('knopka')).toMatchObject({ x: 0, y: 0 });
    expect(o.view('zvezda~1')).toMatchObject({ x: 30, y: 40 });
  });

  it('AC-09: копия вложенного блока и движение с гравитацией', () => {
    const o = play(
      { blocks: [b('container', 'konteiner', { frame: { x: 100, y: 100, w: 200, h: 200 }, children: [b('shape', 'vnutri1', { frame: { x: 10, y: 10, w: 20, h: 20 } })] }), b('shape', 'knopka')], rules: [rule(on.tap('knopka'), [act.spawn('vnutri1', { kind: 'by', dx: 0, dy: 0 })])] },
      [ev.tap('knopka'), (rt) => rt.setMotion('vnutri1~1', { vx: 0, vy: 0, ay: 100 }), tick(1000)],
    );
    expect(o.view('vnutri1~1')).toMatchObject({ x: 110, parentId: null });
    expect(o.view('vnutri1~1')?.y).toBeCloseTo(210);
  });

  it('TR-07: пересечение блока со своим вложенным блоком не считается', () => {
    const o = play(
      { vars: [num('schet01')], blocks: [b('container', 'konteiner', { children: [b('shape', 'vnutri1')] })], rules: [rule({ kind: 'collide', source: { kind: 'block', blockId: 'konteiner' }, target: { kind: 'block', blockId: 'vnutri1' } }, [act.add('schet01')])] },
      [tick(16)],
    );
    expect(o.v('schet01')).toBe(0);
  });

  it('TR-07: конец пересечения для удалённой копии срабатывает без «себя»', () => {
    const o = play(
      {
        vars: [num('schet01')],
        blocks: [b('shape', 'zvezda', { initiallyHidden: true }), b('shape', 'stena01')],
        rules: [rule(on.show(), [act.spawn('zvezda', { kind: 'point', point: { x: 0, y: 0 } })]), rule(on.collideCopies('zvezda', 'stena01'), [act.destroy('self')]), rule(on.collideCopies('zvezda', 'stena01', 'end'), [act.add('schet01'), act.hide('self')])],
      },
      [tick(16), tick(16)],
    );
    expect(o.v('schet01')).toBe(1);
  });

  it('TR-06: на вложенный блок можно уронить его соседа, но не родителя', () => {
    const o = play(
      {
        vars: [num('schet01')],
        blocks: [b('container', 'konteiner', { frame: { x: 0, y: 0, w: 300, h: 300 }, children: [b('shape', 'vnutri1', { frame: { x: 200, y: 200, w: 50, h: 50 } })] }), b('shape', 'podarok')],
        rules: [rule(on.drop('podarok', 'vnutri1'), [act.add('schet01')]), rule(on.drop('podarok', 'konteiner'), [act.add('schet01', 10)])],
      },
      [ev.dragStart('podarok'), ev.dragEnd('podarok', 200, 200)],
    );
    expect(o.v('schet01')).toBe(11);
  });

  it('AC-19: сброс ответа на вопрос без ответа и ответ с восстановлением после перезагрузки', () => {
    const q = b('singleChoice', 'vopros', { props: { options: [1, 2].map((n) => ({ id: `vopros_otvet${n}`, blockId: `vopros_variant${n}` })) }, children: [1, 2].map((n) => b('shape', `vopros_variant${n}`)) });
    const o = play({ blocks: [q, b('shape', 'knopka')], vars: [num('schet01')], rules: [rule(on.answer(), [act.add('schet01')]), rule(on.tap('knopka'), [act.resetAnswer()])] }, [
      (rt) => rt.setAnswers({ vopros: { kind: 'choice', optionIds: ['vopros_otvet2'] } }),
      (rt) => expect(rt.view('vopros_variant2')?.selected).toBe(true),
      ev.tap('knopka'),
    ]);
    expect(o.v('schet01')).toBe(1);
    expect(o.view('vopros_variant2')?.selected).toBe(false);
  });

  it('CN-03: состояние вложенного варианта в чужом контейнере не «выбран»; несуществующий — не «перетаскивается»', () => {
    const o = play(
      { vars: [num('schet01')], blocks: [b('container', 'konteiner', { children: [b('shape', 'vnutri1')] }), b('shape', 'knopka')], rules: [rule(on.tap('knopka'), [act.add('schet01')], { if: { kind: 'group', op: 'or', items: [{ kind: 'blockState', blockId: 'vnutri1', state: 'selected' }, { kind: 'blockState', blockId: 'netakogo', state: 'dragging' }, { kind: 'blockState', blockId: 'netakogo', state: 'copiesCount' }] } })] },
      [ev.tap('knopka')],
    );
    expect(o.v('schet01')).toBe(0);
  });
});

describe('B-04 · B-11 · B-12: поведение блоков в движке', () => {
  const autoQuestion = (autoAdvance: boolean, multi = false) => {
    const q = question('vopros', multi);
    return { ...q, props: { ...(q.props as object), ...(multi ? {} : { autoAdvance }) } } as BlockInput;
  };

  it('B-11: «перейти сразу после выбора» — переход по ветвлению после выбора участника', () => {
    const o = play({ blocks: [autoQuestion(true)] }, [ev.answer(1)]);
    expect(o.of('navigate')).toEqual([{ type: 'navigate', to: 'branch' }]);
    expect(o.rt.currentAnswers).toEqual({ vopros: { kind: 'choice', optionIds: ['vopros_otvet1'] } });
  });

  it('B-11: без флажка, при сбросе ответа и у вопроса с несколькими ответами переход не начинается', () => {
    expect(play({ blocks: [autoQuestion(false)] }, [ev.answer(1)]).of('navigate')).toEqual([]);
    expect(play({ blocks: [autoQuestion(true)] }, [ev.answer(null)]).of('navigate')).toEqual([]);
    expect(play({ blocks: [autoQuestion(true, true)] }, [{ type: 'answer', questionBlockId: 'vopros', answer: { kind: 'choice', optionIds: ['vopros_otvet1'] } }]).of('navigate')).toEqual([]);
  });

  it('B-04: «дальше после окончания» — конец видео ведёт по ветвлению; без флажка — нет', () => {
    const video = (nextOnEnd: boolean) => b('video', 'video1', { props: { media: { source: 'media', id: 'roliki0001' }, nextOnEnd } });
    expect(play({ blocks: [video(true)] }, [ev.mediaEnd('video1')]).of('navigate')).toEqual([{ type: 'navigate', to: 'branch' }]);
    expect(play({ blocks: [video(false)] }, [ev.mediaEnd('video1')]).of('navigate')).toEqual([]);
  });

  it('B-11: «перемешивать» меняет местами варианты (по зерну), не трогая другие блоки', () => {
    const q = question('vopros');
    const many = {
      ...q,
      props: { shuffle: true, options: [1, 2, 3, 4, 5].map((n) => ({ id: `vopros_otvet${n}`, blockId: `vopros_variant${n}` })) },
      children: [...[1, 2, 3, 4, 5].map((n) => b('shape', `vopros_variant${n}`, { frame: { x: 0, y: n * 60, w: 300, h: 50 }, textLayer: textOf(`В${n}`) })), b('text', 'vopros_podpis', { frame: { x: 0, y: 0, w: 300, h: 40 } })],
    } as BlockInput;
    const ys = (seed: number) => [1, 2, 3, 4, 5].map((n) => play({ blocks: [many], seed }).view(`vopros_variant${n}`)!.y);
    expect([...ys(3)].sort((a, c) => a - c)).toEqual([60, 120, 180, 240, 300]);
    expect(ys(3)).toEqual(ys(3));
    expect([1, 2, 3, 4, 5, 6, 7].some((seed) => ys(seed).join() !== '60,120,180,240,300')).toBe(true);
    expect(play({ blocks: [many], seed: 3 }).view('vopros_podpis')!.y).toBe(0);
    expect(play({ blocks: [question('vopros')], seed: 3 }).view('vopros_variant1')!.y).toBe(60);
  });
});

describe('SC-03 · отладчик: ручная правка переменной', () => {
  it('SC-03 · значение меняется, срабатывает «переменная изменилась», блок «значение» перерисовывается', () => {
    const rt = createRuntime(
      buildDoc({
        vars: [num('ochkiv', 1), num('kopiya', 0)],
        blocks: [b('value', 'znachenie', { props: { variableId: 'ochkiv' } })],
        rules: [rule(on.change('ochkiv'), [act.add('kopiya', 10)])],
      }),
      { seed: 1 },
    );
    rt.enterScreen('ekran1');
    const { ok, step } = rt.setVariableValue('ochkiv', 7);
    expect(ok).toBe(true);
    expect(rt.variables).toMatchObject({ ochkiv: 7, kopiya: 10 });
    expect(step.variables).toMatchObject({ ochkiv: 7, kopiya: 10 });
    expect(step.changed).toContain('znachenie');
  });

  it('SC-03 · то же значение — ничего не происходит; неверный тип или несуществующая переменная — отказ без изменений', () => {
    const rt = createRuntime(buildDoc({ vars: [num('ochkiv', 1), txt('imyaaa', 'a'), bool('flagzz'), list('spisok')] }), { seed: 1 });
    rt.enterScreen('ekran1');
    expect(rt.setVariableValue('ochkiv', 1)).toMatchObject({ ok: true, step: { variables: {} } });
    for (const [id, bad] of [
      ['ochkiv', 'семь'],
      ['ochkiv', Number.NaN],
      ['imyaaa', 5],
      ['imyaaa', 'я'.repeat(1001)],
      ['flagzz', 'да'],
      ['spisok', 'не список'],
      ['net_takoj', 1],
    ] as const) {
      expect(rt.setVariableValue(id, bad as never).ok).toBe(false);
    }
    expect(rt.variables).toEqual({ ochkiv: 1, imyaaa: 'a', flagzz: false, spisok: [] });
    expect(rt.setVariableValue('imyaaa', 'б').ok && rt.setVariableValue('flagzz', true).ok && rt.setVariableValue('spisok', [1, 'a']).ok).toBe(true);
    expect(rt.variables).toEqual({ ochkiv: 1, imyaaa: 'б', flagzz: true, spisok: [1, 'a'] });
  });

  it('SC-03 · до входа на экран правка значения работает, правила не запускаются', () => {
    const rt = createRuntime(buildDoc({ vars: [num('ochkiv', 1), num('kopiya', 0)], rules: [rule(on.change('ochkiv'), [act.add('kopiya', 10)])] }), { seed: 1 });
    expect(rt.setVariableValue('ochkiv', 5).ok).toBe(true);
    expect(rt.variables).toMatchObject({ ochkiv: 5, kopiya: 0 });
  });
});

describe('L-07 · хозяин отклонил переход', () => {
  it('L-07 · после goTo экран заморожен; resume() возвращает управление, и ответ принимается', () => {
    const rt = createRuntime(
      buildDoc({ blocks: [question('vopros'), b('shape', 'knopka1')], rules: [rule(on.tap('knopka1'), [act.goNext()])] }),
      { seed: 1 },
    );
    rt.enterScreen('ekran1');
    const step = rt.dispatch(ev.tap('knopka1'));
    expect(step.effects).toContainEqual({ type: 'navigate', to: 'next' });
    rt.dispatch({ type: 'answer', questionBlockId: 'vopros', answer: { kind: 'choice', optionIds: ['vopros_otvet1'] } });
    expect(rt.currentAnswers).toEqual({}); // frozen
    rt.resume();
    rt.dispatch({ type: 'answer', questionBlockId: 'vopros', answer: { kind: 'choice', optionIds: ['vopros_otvet1'] } });
    expect(rt.currentAnswers).toHaveProperty('vopros');
    expect(rt.dispatch(ev.tap('knopka1')).effects).toContainEqual({ type: 'navigate', to: 'next' }); // and «дальше» works again
  });

  it('L-07 · resume() не оживляет экран, который уже покидают, и не нужен до входа на экран', () => {
    const rt = createRuntime(buildDoc({ blocks: [b('shape', 'knopka1')], rules: [rule(on.tap('knopka1'), [act.goNext()])] }), { seed: 1 });
    rt.resume(); // no screen yet: nothing happens
    rt.enterScreen('ekran1');
    rt.leaveScreen();
    rt.resume();
    expect(rt.dispatch(ev.tap('knopka1')).effects).toEqual([]);
  });
});
