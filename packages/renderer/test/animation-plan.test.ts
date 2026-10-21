import { BlockAnimation as BlockAnimationSchema, MediaByAnswer, ThemeTokens, Transition } from '@blokum/schema';
import { describe, expect, it } from 'vitest';
import {
  DEV_THEMES,
  REVEAL_VAR,
  TINT_VAR,
  TRANSITION_DEFAULT,
  directionOffset,
  enterPlan,
  holdsWhilePressed,
  loopPlan,
  mediaForAnswer,
  neutralOf,
  pathPoints,
  pressPlan,
  resolveTransition,
  transitionPlan,
} from '../src/index.js';

const tokens = DEV_THEMES.light;
const anim = (a: Record<string, unknown>) => BlockAnimationSchema.parse(a);
const enter = (e: Record<string, unknown>) => anim({ enter: e }).enter!;
const loop = (l: Record<string, unknown>) => anim({ loop: l }).loop!;
const press = (p: Record<string, unknown>) => anim({ press: p }).press!;
const frames = [
  { at: 0.2, props: { opacity: 0, x: -20 }, fill: { token: 'primary' } },
  { at: 0.8, props: { opacity: 1 } },
];

describe('S-12: анимация появления', () => {
  it.each(['fade', 'slide', 'zoom', 'bounce', 'flip', 'rotate', 'typewriter', 'snowflake'])('S-12: «%s» — ключевые кадры, длительность и задержка в секундах', (kind) => {
    const p = enterPlan(enter({ kind, durationMs: 800, delayMs: 300 }), tokens, false);
    expect(Object.keys(p.keyframes).length).toBeGreaterThan(0);
    expect(p.duration).toBe(0.8);
    expect(p.delay).toBe(0.3);
    for (const values of Object.values(p.keyframes)) expect(values.length).toBeGreaterThanOrEqual(2);
    for (const [name, times] of Object.entries(p.times ?? {})) expect(times).toHaveLength(p.keyframes[name]!.length);
  });

  it('S-12: выезд с 8 направлений начинается с противоположной стороны', () => {
    expect(directionOffset('up', 60)).toEqual({ x: 0, y: 60 });
    expect(directionOffset('downLeft', 60)).toEqual({ x: 60, y: -60 });
    expect(directionOffset('upRight', 10)).toEqual({ x: -10, y: 10 });
    expect(directionOffset('нет', 10)).toEqual({ x: 0, y: 10 });
    const p = enterPlan(enter({ kind: 'slide', direction: 'right' }), tokens, false);
    expect(p.keyframes).toMatchObject({ '--bk-ax': [-60, 0], '--bk-ay': [0, 0], opacity: [0, 1] });
  });

  it('S-12: «печатная машинка» открывает текст ступенями', () => {
    const p = enterPlan(enter({ kind: 'typewriter' }), tokens, false);
    expect(p.keyframes[REVEAL_VAR]).toEqual([0, 1]);
    expect([p.ease(0.01), p.ease(0.5), p.ease(1)]).toEqual([0, 0.5, 1]);
    expect(p.ease(0.02)).toBe(0);
  });

  it('S-12: свои ключевые кадры — у каждого свойства свои времена, цвет заливки — в слой оттенка', () => {
    const p = enterPlan(enter({ kind: 'keyframes', keyframes: frames, easing: { kind: 'preset', name: 'linear' } }), tokens, false);
    expect(p.keyframes).toEqual({ opacity: [0, 0, 1, 1], '--bk-ax': [-20, -20, -20], [TINT_VAR]: ['#D9480F', '#D9480F', '#D9480F'] });
    expect(p.times).toEqual({ opacity: [0, 0.2, 0.8, 1], '--bk-ax': [0, 0.2, 1], [TINT_VAR]: [0, 0.2, 1] });
    expect(p.ease(0.5)).toBe(0.5);
  });

  it('T-31: при «уменьшить движение» любое появление — короткое проявление', () => {
    for (const kind of ['slide', 'bounce', 'snowflake']) expect(enterPlan(enter({ kind, delayMs: 100 }), tokens, true)).toMatchObject({ keyframes: { opacity: [0, 1] }, duration: 0.2, delay: 0.1 });
  });
});

describe('S-13: постоянная анимация', () => {
  it.each(['pulse', 'sway', 'float', 'spin', 'shake', 'blink', 'heartbeat'])('S-13: «%s» повторяется бесконечно', (kind) => {
    const p = loopPlan(loop({ kind }), tokens, false)!;
    expect(p.repeat).toBe(Infinity);
    expect(p.repeatDelay).toBe(0);
  });

  it('S-13: скорость ускоряет цикл, амплитуда усиливает движение, пауза — между повторами', () => {
    const slow = loopPlan(loop({ kind: 'float' }), tokens, false)!;
    const fast = loopPlan(loop({ kind: 'float', speed: 2, amplitude: 3, pauseMs: 500 }), tokens, false)!;
    expect(fast.duration).toBe(slow.duration / 2);
    expect(fast.keyframes['--bk-ay']).toEqual([0, -24]);
    expect(fast.repeatDelay).toBe(0.5);
    expect(fast.repeatType).toBe('mirror');
    expect(loopPlan(loop({ kind: 'spin' }), tokens, false)!.keyframes['--bk-ar']).toEqual([0, 360]);
  });

  it('S-13: движение по своему контуру и свои ключевые кадры по кругу', () => {
    const p = loopPlan(loop({ kind: 'followPath', path: 'M10 10 L110 10 C110 60 10 60 10 10' }), tokens, false)!;
    expect(p.keyframes['--bk-ax']![0]).toBe(0);
    expect(Math.max(...(p.keyframes['--bk-ax'] as number[]))).toBeCloseTo(100, 0);
    expect(p.keyframes['--bk-ax']).toHaveLength(p.keyframes['--bk-ay']!.length);
    const k = loopPlan(loop({ kind: 'keyframes', keyframes: frames }), tokens, false)!;
    expect(k.times?.opacity).toEqual([0, 0.2, 0.8, 1]);
  });

  it('S-13: точки контура — относительно начала', () => {
    expect(pathPoints('M5 5 L15 5 L15 25')).toEqual([{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 20 }]);
    expect(pathPoints('M0 0 L100 0', 1)).toEqual([{ x: 0, y: 0 }, { x: 100, y: 0 }]);
  });

  it('T-31: при «уменьшить движение» постоянных анимаций нет', () => {
    expect(loopPlan(loop({ kind: 'pulse' }), tokens, true)).toBeNull();
  });
});

describe('S-14: реакция на нажатие и наведение', () => {
  it.each([
    ['grow', '--bk-as', [1, 1.06], true],
    ['shrink', '--bk-as', [1, 0.94], true],
    ['glow', '--bk-aglow', [0, 14], true],
    ['bounce', '--bk-ay', [0, -8, 0], false],
    ['vibrate', '--bk-ax', [0, -2, 2, -2, 2, 0], false],
  ] as const)('S-14: «%s»', (kind, name, values, holds) => {
    const a = press({ kind });
    const p = pressPlan(a, tokens, false)!;
    expect(p.keyframes[name]).toEqual(values);
    expect(holdsWhilePressed(a)).toBe(holds);
    expect(neutralOf(p)[name]).toBe(name === '--bk-as' ? 1 : 0);
  });

  it('S-14: вибрация телефона и своя анимация на нажатие', () => {
    expect(pressPlan(press({ kind: 'vibrate' }), tokens, false)!.vibrate).toBe(30);
    const own = pressPlan(press({ kind: 'keyframes', keyframes: frames }), tokens, false)!;
    expect(neutralOf(own)).toEqual({ opacity: 1, '--bk-ax': 0, [TINT_VAR]: 'rgba(0, 0, 0, 0)' });
    expect(pressPlan(press({ kind: 'grow' }), tokens, true)).toBeNull();
  });

  it('S-12: нейтральные значения раскрытия и размера', () => {
    expect(neutralOf({ keyframes: { [REVEAL_VAR]: [0, 1], '--bk-aw': [10, 20] }, duration: 1, delay: 0, ease: (t) => t })).toEqual({ [REVEAL_VAR]: 1, '--bk-aw': 0 });
  });
});

describe('T-01…T-08 · T-30…T-32: переходы между экранами', () => {
  const t = (x: Record<string, unknown>) => Transition.parse(x) as Parameters<typeof transitionPlan>[0];

  it.each([
    ['T-01', 'none', false, false],
    ['T-02', 'fade', true, true],
    ['T-03', 'slide', true, true],
    ['T-04', 'zoom', true, true],
    ['T-05', 'flip', true, true],
    ['T-06', 'blinds', false, true],
    ['T-07', 'particles', true, true],
    ['T-08', 'page', true, false],
  ] as const)('%s: «%s» — анимации уходящего и приходящего экрана', (_id, kind, out, inn) => {
    const p = transitionPlan(t({ kind }));
    expect(p.kind).toBe(kind);
    expect(p.out !== null).toBe(out);
    expect(p.in !== null).toBe(inn);
  });

  it('T-03: сдвиг на ширину экрана в выбранную сторону; T-04: масштаб; T-05: половины переворота', () => {
    expect(transitionPlan(t({ kind: 'slide', direction: 'left' })).in!.keyframes['--bk-ax']).toEqual([390, 0]);
    expect(transitionPlan(t({ kind: 'slide', direction: 'up' })).out!.keyframes['--bk-ay']).toEqual([0, -390]);
    expect(transitionPlan(t({ kind: 'zoom', scale: 1.5 })).in!.keyframes['--bk-as']).toEqual([1.5, 1]);
    expect(transitionPlan(t({ kind: 'zoom' })).in!.keyframes['--bk-as']).toEqual([0.8, 1]);
    const flip = transitionPlan(t({ kind: 'flip', durationMs: 600 }));
    expect([flip.out!.duration, flip.in!.delay]).toEqual([0.3, 0.3]);
  });

  it('T-07: частицы; T-08: страница поворачивается у левого края; T-32: размытие на входе', () => {
    expect(transitionPlan(t({ kind: 'particles' })).particles).toBe(true);
    expect(transitionPlan(t({ kind: 'page' })).origin).toBe('0% 50%');
    expect(transitionPlan(t({ kind: 'fade', blur: 8 })).in!.keyframes['--bk-ablur']).toEqual([8, 0]);
    expect(transitionPlan(t({ kind: 'blinds' })).in!.keyframes['--bk-blinds']).toEqual([0, 1]);
  });

  it('T-30: переход ветки или действия важнее перехода экрана; без них — переход по умолчанию', () => {
    const screen = Transition.parse({ kind: 'zoom' });
    const branch = Transition.parse({ kind: 'slide', direction: 'up' });
    expect(resolveTransition(screen, branch, tokens, false)?.kind).toBe('slide');
    expect(resolveTransition(screen, undefined, tokens, false)?.kind).toBe('zoom');
    expect(resolveTransition(undefined, undefined, tokens, false)).toEqual(TRANSITION_DEFAULT);
  });

  it('T-32: свой переход берётся из пресетов темы; неизвестный — переход по умолчанию', () => {
    const themed = ThemeTokens.parse({ transitions: [{ id: 'moi-perehod', name: 'Мой', transition: { kind: 'flip', durationMs: 900 } }] });
    expect(resolveTransition(Transition.parse({ kind: 'preset', presetId: 'moi-perehod' }), undefined, themed, false)).toMatchObject({ kind: 'flip', durationMs: 900 });
    expect(resolveTransition(Transition.parse({ kind: 'preset', presetId: 'net-takogo' }), undefined, themed, false)).toEqual(TRANSITION_DEFAULT);
  });

  it('T-31: при «уменьшить движение» любой переход — проявление 200 мс, «без перехода» остаётся', () => {
    expect(resolveTransition(Transition.parse({ kind: 'page' }), undefined, tokens, true)).toMatchObject({ kind: 'fade', durationMs: 200 });
    expect(resolveTransition(Transition.parse({ kind: 'none' }), undefined, tokens, true)?.kind).toBe('none');
  });

  it('T-20: медиа-переход — не анимация экранов, а вставка', () => {
    expect(resolveTransition(Transition.parse({ kind: 'media', overlay: { media: { source: 'media', id: 'mem0000001' } } }), undefined, tokens, false)).toBeNull();
  });
});

describe('T-21: медиа-вставка по ответу', () => {
  const rule = MediaByAnswer.parse({
    questionBlockId: 'vopros0001',
    cases: [
      { when: { kind: 'option', optionId: 'otvet00002' }, overlay: { media: { source: 'media', id: 'mem-variant' } } },
      { when: { kind: 'correct' }, overlay: { media: { source: 'media', id: 'mem-verno01' } } },
      { when: { kind: 'wrong' }, overlay: { media: { source: 'media', id: 'mem-neverno' } } },
    ],
  });

  it('T-21: первый подходящий случай — вариант, «правильно» или «неправильно» по вердикту', () => {
    expect(mediaForAnswer(rule, ['otvet00002'], true)?.media.id).toBe('mem-variant');
    expect(mediaForAnswer(rule, ['otvet00001'], true)?.media.id).toBe('mem-verno01');
    expect(mediaForAnswer(rule, ['otvet00001'], false)?.media.id).toBe('mem-neverno');
    expect(mediaForAnswer(rule, [], null)).toBeNull();
    expect(mediaForAnswer(undefined, ['otvet00002'], true)).toBeNull();
  });
});
