import { describe, expect, it } from 'vitest';
import {
  ANIMATABLE,
  Behavior,
  BLOCK_STATES,
  BLOCK_TYPE_IDS,
  BlockStyle,
  BranchRule,
  ChoiceOption,
  Condition,
  createBlock,
  Frame,
  MediaByAnswer,
  PARTICLE_PRESETS,
  REDUCED_MOTION_FALLBACK,
  ResultRule,
  Rule,
  SCENARIO_LIMITS,
  Screen,
  Settings,
  Shape,
  SYSTEM_VARIABLES,
  ThemeTokens,
  TextRun,
  Transition,
  TRANSITION_KINDS,
  Trigger,
  Variable,
  Action,
  EnterAnimation,
  Keyframe,
  LoopAnimation,
  PressAnimation,
} from '../src/index.js';

/** Keys of a zod object schema (strict objects expose `.shape`). */
const keys = (schema: unknown): string[] => {
  const s = schema as { shape?: Record<string, unknown>; def?: { in?: { shape?: Record<string, unknown> } } };
  return Object.keys(s.shape ?? s.def?.in?.shape ?? {});
};
/** Discriminator values of a discriminated union / union of objects (follows lazy wrappers). */
const kinds = (schema: unknown, key = 'kind'): string[] => {
  let s = schema as { def: { type: string; getter?: () => unknown; options?: unknown[] } };
  while (s.def.type === 'lazy') s = s.def.getter!() as typeof s;
  const out: string[] = [];
  for (const o of s.def.options ?? []) {
    const opt = o as { def: { type: string; options?: unknown[] }; shape?: Record<string, { def: { values?: unknown[] } }> };
    if (opt.def.type === 'union' || opt.def.type === 'discriminatedUnion' || opt.def.options) out.push(...kinds(opt, key));
    else {
      const lit = (opt.shape ?? (opt as unknown as { def: { in: { shape: Record<string, { def: { values?: unknown[] } }> } } }).def.in?.shape)?.[key];
      for (const v of lit?.def.values ?? []) out.push(String(v));
    }
  }
  return out;
};

const STYLE: Record<string, string> = {
  'S-02': 'shape',
  'S-03': 'radius',
  'S-04': 'fills',
  'S-05': 'stroke',
  'S-06': 'shadows',
  'S-07': 'effects',
  'S-08': 'filters',
  'S-09': 'padding',
  'S-10': 'text',
  'S-11': 'media',
  'S-18': 'transform3d',
  'S-19': 'mask',
  'S-20': 'layout',
};

describe('схема покрывает каждое требование P1.1', () => {
  it.each(Object.entries(STYLE))('%s: группа стиля «%s» есть в BlockStyle', (_id, key) => {
    expect(keys(BlockStyle)).toContain(key);
  });

  it('S-01: положение, размер, поворот и отражение блока', () => {
    expect(keys(Frame)).toEqual(expect.arrayContaining(['x', 'y', 'w', 'h', 'rotation', 'flipX', 'flipY']));
    expect(keys(BlockStyle)).toEqual(expect.arrayContaining(['autoHeight', 'lockAspect']));
  });

  it('S-02: все формы, включая произвольный контур', () => {
    expect(kinds(Shape)).toEqual(['rect', 'pill', 'ellipse', 'polygon', 'star', 'heart', 'blob', 'bubble', 'arrow', 'wave', 'path']);
  });

  const frames = [{ at: 0, props: { opacity: 0, y: 40 } }, { at: 1, props: { opacity: 1, y: 0 } }];

  it('S-12: анимация появления — готовые виды, 8 направлений и свои ключевые кадры', () => {
    expect(EnterAnimation.shape.kind.options).toEqual(['fade', 'slide', 'zoom', 'bounce', 'flip', 'rotate', 'typewriter', 'snowflake', 'keyframes']);
    expect(EnterAnimation.parse({ kind: 'slide', direction: 'downLeft' })).toMatchObject({ durationMs: 600, delayMs: 0 });
    expect(createBlock('shape', { animation: { enter: { kind: 'keyframes', keyframes: frames } } }).animation?.enter?.keyframes).toHaveLength(2);
    expect(EnterAnimation.safeParse({ kind: 'keyframes' }).error?.issues[0]?.message).toBe('Для своей анимации нужны ключевые кадры');
    expect(Keyframe.safeParse({ at: 0.5, props: { color: 1 } }).success).toBe(false);
    expect(ANIMATABLE).toEqual(expect.arrayContaining(['x', 'rotation', 'opacity', 'blur', 'brightness', 'rotateX']));
  });

  it('S-13: постоянная анимация — скорость, амплитуда, пауза, движение по своему контуру', () => {
    expect(LoopAnimation.shape.kind.options).toEqual(['pulse', 'sway', 'float', 'spin', 'shake', 'blink', 'heartbeat', 'followPath', 'keyframes']);
    expect(LoopAnimation.parse({ kind: 'heartbeat', speed: 2, amplitude: 0.5, pauseMs: 1000 })).toMatchObject({ speed: 2, amplitude: 0.5, pauseMs: 1000 });
    expect(LoopAnimation.parse({ kind: 'followPath', path: 'M0 0 C 50 100 100 0 150 100' }).path).toBeDefined();
    expect(LoopAnimation.safeParse({ kind: 'followPath' }).error?.issues[0]?.message).toBe('Для движения по контуру нарисуйте контур');
    expect(LoopAnimation.safeParse({ kind: 'followPath', path: 'M0 0 url(x)' }).success).toBe(false);
    expect(LoopAnimation.safeParse({ kind: 'keyframes' }).success).toBe(false);
  });

  it('S-14: реакция на нажатие и наведение, включая вибрацию и свою анимацию', () => {
    expect(PressAnimation.shape.kind.options).toEqual(['grow', 'shrink', 'glow', 'bounce', 'vibrate', 'keyframes']);
    expect(PressAnimation.parse({ kind: 'keyframes', keyframes: frames }).keyframes).toHaveLength(2);
    expect(PressAnimation.safeParse({ kind: 'keyframes' }).success).toBe(false);
  });

  it('S-15: состояния блока переопределяют любые свойства', () => {
    expect(BLOCK_STATES).toEqual(['hover', 'pressed', 'selected', 'correct', 'wrong', 'disabled', 'dragging', 'overZone']);
    const b = createBlock('shape', { states: { pressed: { effects: { opacity: 0.5 } }, selected: { shape: { kind: 'star' } } } });
    expect(b.states?.selected?.shape).toEqual({ kind: 'star', points: 5, depth: 0.5, cornerRadius: 0 });
  });

  it('S-16: видимость по условию и скрытие до события', () => {
    const b = createBlock('shape', { visibleIf: { kind: 'chance', percent: 50 }, initiallyHidden: true });
    expect(b.initiallyHidden).toBe(true);
    expect(b.visibleIf).toMatchObject({ kind: 'chance' });
  });

  it('S-17: служебные поля — имя, блокировка, скрытие, альтернативный текст, слой', () => {
    const b = createBlock('image', { name: 'Фото ёлки', locked: true, hiddenInEditor: true, z: 7, a11y: { alt: 'Ёлка' } });
    expect(b).toMatchObject({ name: 'Фото ёлки', locked: true, hiddenInEditor: true, z: 7, a11y: { alt: 'Ёлка' } });
  });

  const BLOCKS = [
    ['B-01', 'text'],
    ['B-02', 'image'],
    ['B-03', 'gif'],
    ['B-04', 'video'],
    ['B-05', 'audio'],
    ['B-06', 'shape'],
    ['B-07', 'animation'],
    ['B-08', 'timer'],
    ['B-09', 'progress'],
    ['B-11', 'singleChoice'],
    ['B-12', 'multiChoice'],
    ['B-13', 'textInput'],
    ['B-14', 'scale'],
    ['B-15', 'swipe'],
    ['B-16', 'ranking'],
    ['B-17', 'date'],
    ['B-18', 'button'],
    ['B-19', 'contacts'],
    ['B-20', 'consent'],
    ['B-21', 'container'],
    ['B-22', 'zone'],
    ['B-23', 'value'],
  ] as const;
  it('B-01…B-23: каждому типу блока соответствует своё требование', () => {
    expect(Object.fromEntries(BLOCKS.map(([id, type]) => [type, id]))).toEqual(BLOCK_TYPE_IDS);
  });

  it.each(BLOCKS)('%s: тип блока «%s»', (id, type) => {
    const b = createBlock(type);
    expect(b.type).toBe(type);
    expect(BLOCK_TYPE_IDS[type]).toBe(id);
  });

  it('L-01: порядок экранов и запрет «назад»', () => {
    expect(Settings.parse({}).allowBack).toBe(true);
    expect(Settings.parse({ allowBack: false }).allowBack).toBe(false);
  });

  it('L-02: ветвление по условию с переходом на экран', () => {
    expect(keys(BranchRule)).toEqual(['id', 'if', 'to', 'transition']);
  });

  it('L-03: правильные ответы, баллы и режим обратной связи', () => {
    expect(keys(ChoiceOption)).toEqual(expect.arrayContaining(['correct', 'score']));
    expect(Settings.parse({}).feedbackMode).toBe('end');
  });

  it('L-04: результаты по баллам, тегам и переменным, правило ничьей', () => {
    expect(kinds(ResultRule)).toEqual(['scoreRange', 'tag', 'variable']);
    expect(keys(ChoiceOption)).toContain('resultTags');
    expect(Settings.parse({}).tieBreak).toBe('first');
  });

  it('L-05: подстановка переменных в текст', () => {
    expect(TextRun.parse({ v: 'variable01' })).toEqual({ v: 'variable01' });
  });

  it('L-06: таймер экрана', () => {
    expect(keys(Screen)).toContain('timer');
  });

  it('L-07: обязательные вопросы', () => {
    for (const t of ['singleChoice', 'multiChoice', 'textInput', 'scale', 'swipe', 'ranking', 'date'] as const) {
      expect(createBlock(t).props).toHaveProperty('required', false);
    }
  });

  it('L-08: валидатор логики есть и возвращает коды ошибок (подробно — validate.test.ts)', async () => {
    const { validateDocument } = await import('../src/index.js');
    expect(typeof validateDocument).toBe('function');
  });

  it('SC-01: правило «Когда → Если → Сделать» с именем, включением, однократностью и приоритетом', () => {
    expect(keys(Rule)).toEqual(['id', 'name', 'enabled', 'once', 'priority', 'when', 'if', 'do']);
  });

  it('SC-07: контракт предпубликационной проверки сценариев (подробно — validate.test.ts)', async () => {
    const { validateDocument } = await import('../src/index.js');
    expect(validateDocument.length).toBe(1);
    expect(SCENARIO_LIMITS.stepsPerSecond).toBe(1000);
  });

  const TRIGGERS = [
    ['TR-01', 'tap'],
    ['TR-02', 'doubleTap'],
    ['TR-03', 'longPress'],
    ['TR-04', 'hover'],
    ['TR-05', 'drag'],
    ['TR-06', 'drop'],
    ['TR-07', 'collide'],
    ['TR-08', 'swipe'],
    ['TR-09', 'screen'],
    ['TR-10', 'timer'],
    ['TR-11', 'variableChange'],
    ['TR-12', 'answer'],
    ['TR-13', 'mediaEnd'],
    ['TR-14', 'scratched'],
    ['TR-15', 'deviceMotion'],
    ['TR-16', 'key'],
  ] as const;
  it('TR: у каждого триггера схемы есть требование', () => {
    expect([...new Set(kinds(Trigger))].sort()).toEqual([...new Set(TRIGGERS.map(([, k]) => k))].sort());
  });

  it.each(TRIGGERS)('%s: триггер «%s»', (_id, kind) => {
    expect(kinds(Trigger)).toContain(kind);
  });

  const CONDITIONS = [
    ['CN-01', 'variable'],
    ['CN-02', 'answer'],
    ['CN-03', 'blockState'],
    ['CN-04', 'ruleCount'],
    ['CN-05', 'chance'],
    ['CN-06', 'group'],
  ] as const;
  it('CN: у каждого условия схемы есть требование', () => {
    expect([...new Set(kinds(Condition))].sort()).toEqual([...new Set(CONDITIONS.map(([, k]) => k))].sort());
  });

  it.each(CONDITIONS)('%s: условие «%s»', (_id, kind) => {
    expect(kinds(Condition)).toContain(kind);
  });

  const ACTIONS = [
    ['AC-01', 'visibility'],
    ['AC-02', 'setProperty'],
    ['AC-02', 'animateProperty'],
    ['AC-03', 'move'],
    ['AC-04', 'setVariable'],
    ['AC-05', 'goTo'],
    ['AC-06', 'media'],
    ['AC-06', 'playSound'],
    ['AC-07', 'effect'],
    ['AC-08', 'mediaOverlay'],
    ['AC-09', 'spawn'],
    ['AC-10', 'destroy'],
    ['AC-11', 'wait'],
    ['AC-12', 'repeat'],
    ['AC-13', 'timer'],
    ['AC-14', 'record'],
    ['AC-15', 'finish'],
    ['AC-16', 'openLink'],
    ['AC-17', 'copyText'],
    ['AC-18', 'interaction'],
    ['AC-19', 'answer'],
    ['AC-20', 'shuffle'],
    ['CN-06', 'if'],
  ] as const;
  it('AC: у каждого действия схемы есть требование', () => {
    expect([...new Set(kinds(Action))].sort()).toEqual([...new Set(ACTIONS.map(([, k]) => k))].sort());
  });

  it.each(ACTIONS)('%s: действие «%s»', (_id, kind) => {
    expect(kinds(Action)).toContain(kind);
  });

  const BEHAVIORS = [
    ['BH-01', 'drag'],
    ['BH-02', 'flee'],
    ['BH-03', 'scratch'],
    ['BH-04', 'move'],
    ['BH-05', 'spawner'],
    ['BH-06', 'wheel'],
    ['BH-07', 'flip'],
    ['BH-08', 'follow'],
  ] as const;
  it('BH: у каждого поведения схемы есть требование', () => {
    expect([...new Set(kinds(Behavior))].sort()).toEqual([...new Set(BEHAVIORS.map(([, k]) => k))].sort());
  });

  it.each(BEHAVIORS)('%s: поведение «%s»', (_id, kind) => {
    expect(kinds(Behavior)).toContain(kind);
  });

  it('VR-01: переменные четырёх типов', () => {
    for (const [type, initial] of [['number', 0], ['text', ''], ['bool', false], ['list', []]] as const) {
      expect(Variable.safeParse({ id: 'variable01', name: 'счёт', type, initial }).success).toBe(true);
    }
  });

  it('VR-02: переменные адресуются по id, поэтому переименование не ломает ссылки', () => {
    expect(keys(Variable)).toEqual(expect.arrayContaining(['id', 'name']));
  });

  it('VR-03: системные переменные только для чтения', () => {
    expect(SYSTEM_VARIABLES).toContain('время_прохождения');
  });

  it('VR-04: флаг «сохранять в ответы»', () => {
    expect(Variable.parse({ id: 'variable01', name: 'x', type: 'number', initial: 1 }).saveToAnswers).toBe(false);
  });

  const TRANSITIONS = [
    ['T-01', 'none'],
    ['T-02', 'fade'],
    ['T-03', 'slide'],
    ['T-04', 'zoom'],
    ['T-05', 'flip'],
    ['T-06', 'blinds'],
    ['T-07', 'particles'],
    ['T-08', 'page'],
  ] as const;
  it('T-01…T-08: перечень переходов совпадает со схемой', () => {
    expect(TRANSITIONS.map(([, k]) => k)).toEqual([...TRANSITION_KINDS]);
  });

  it.each(TRANSITIONS)('%s: переход «%s»', (_id, kind) => {
    expect(Transition.safeParse({ kind }).success).toBe(true);
  });

  it('T-20: медиа-переход со своим файлом и подписью в стиле мема', () => {
    const t = Transition.parse({ kind: 'media', overlay: { media: { source: 'media', id: 'mediafile01' }, caption: { text: 'Ура!' } } });
    expect(t).toMatchObject({ kind: 'media', overlay: { seconds: 1.5, skippable: true, caption: { position: 'bottom' } } });
  });

  it('T-21: разный медиа-переход в зависимости от ответа', () => {
    expect(keys(MediaByAnswer)).toEqual(['questionBlockId', 'cases']);
  });

  it('T-30: переход задаётся для экрана, ветки и действия перехода', () => {
    expect(keys(Screen)).toContain('transitionIn');
    expect(keys(BranchRule)).toContain('transition');
  });

  it('T-31: замена анимаций при «уменьшить движение»', () => {
    expect(REDUCED_MOTION_FALLBACK).toEqual({ kind: 'fade', durationMs: 200 });
  });

  it('T-32: свой переход как пресет', () => {
    expect(Transition.parse({ kind: 'preset', presetId: 'mypreset01' })).toEqual({ kind: 'preset', presetId: 'mypreset01' });
  });

  const PARTICLES = [
    ['P-01', 'snow'],
    ['P-02', 'confetti'],
    ['P-03', 'hearts'],
    ['P-04', 'sparkles'],
    ['P-05', 'bubbles'],
    ['P-06', 'leaves'],
    ['P-07', 'petals'],
    ['P-08', 'custom'],
  ] as const;
  it('P-01…P-08: перечень частиц совпадает со схемой', () => {
    expect(PARTICLES.map(([, k]) => k)).toEqual([...PARTICLE_PRESETS]);
  });

  it.each(PARTICLES)('%s: частицы «%s»', (_id, preset) => {
    const images = preset === 'custom' ? [{ source: 'media', id: 'snowflake1' }] : [];
    expect(Screen.parse({ id: 'screen0001', name: 'Э', blocks: [], particles: { preset, images } }).particles?.preset).toBe(preset);
  });

  it('TH-01: состав темы — цвета, шрифты, фон, частицы, стили блоков, переходы, декор, звуки, служебные экраны', () => {
    expect(keys(ThemeTokens)).toEqual(['colors', 'fonts', 'background', 'particles', 'blockDefaults', 'transitions', 'decor', 'sounds', 'systemScreens']);
  });
});
