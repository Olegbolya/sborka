import { type BlockInput, type RuleInput } from '@blokum/schema';
import { describe, expect, it } from 'vitest';
import { applyEdge, constrainDrag, createRng, fleeTarget, followShare, pathTrack, pointAt, spinWheel } from '../src/index.js';
import { type Step, b, ev, play, rule, tick } from './runtime-helpers.js';

const pointer = (x: number, y: number) => ({ type: 'pointer' as const, x, y });
const withB = (type: BlockInput['type'], id: string, behaviors: unknown[], extra: Partial<BlockInput> = {}) => b(type, id, { behaviors: behaviors as BlockInput['behaviors'], ...extra });
const zone = (id: string, x: number, y: number) => b('zone', id, { frame: { x, y, w: 100, h: 100 } });

describe('BH-01: перетаскиваемый', () => {
  const box = (drag: Record<string, unknown>, frame = { x: 50, y: 50, w: 40, h: 40 }) => withB('shape', 'kubik1', [{ kind: 'drag', ...drag }], { frame });

  it('BH-01: по оси X блок двигается только по горизонтали, по Y — только по вертикали', () => {
    expect(play({ blocks: [box({ axis: 'x', returnIfMissed: false })] }, [ev.dragStart('kubik1'), ev.dragMove('kubik1', 120, 300)]).view('kubik1')).toMatchObject({ x: 120, y: 50 });
    expect(play({ blocks: [box({ axis: 'y', returnIfMissed: false })] }, [ev.dragStart('kubik1'), ev.dragMove('kubik1', 120, 300)]).view('kubik1')).toMatchObject({ x: 50, y: 300 });
  });

  it('BH-01: границы не выпускают блок целиком', () => {
    const o = play({ blocks: [box({ bounds: { x: 0, y: 0, w: 200, h: 200 }, returnIfMissed: false })] }, [ev.dragStart('kubik1'), ev.dragMove('kubik1', 500, -40)]);
    expect(o.view('kubik1')).toMatchObject({ x: 160, y: 0 });
  });

  it('BH-01: мимо зоны — возвращается на место; без «вернуть» — остаётся', () => {
    const back = play({ blocks: [box({})] }, [ev.dragStart('kubik1'), ev.dragEnd('kubik1', 300, 600), tick(300)]);
    expect(back.view('kubik1')).toMatchObject({ x: 50, y: 50, zoneId: null });
    expect(play({ blocks: [box({ returnIfMissed: false })] }, [ev.dragStart('kubik1'), ev.dragEnd('kubik1', 300, 600), tick(300)]).view('kubik1')).toMatchObject({ x: 300, y: 600 });
  });

  it('BH-01: прилипает к центру своей зоны; чужая зона не притягивает', () => {
    const o = play({ blocks: [box({ snapToZones: ['korzina'] }), zone('korzina', 200, 400), zone('chuzhaya', 0, 600)] }, [ev.dragStart('kubik1'), ev.dragEnd('kubik1', 230, 420), tick(200)]);
    expect(o.view('kubik1')).toMatchObject({ x: 230, y: 430, zoneId: 'korzina' });
    const miss = play({ blocks: [box({ snapToZones: ['korzina'] }), zone('korzina', 200, 400), zone('chuzhaya', 0, 600)] }, [ev.dragStart('kubik1'), ev.dragEnd('kubik1', 20, 620), tick(300)]);
    expect(miss.view('kubik1')).toMatchObject({ x: 50, y: 50, zoneId: null });
  });

  it('BH-01: «только одна копия на зоне» — занятая зона не принимает второй блок', () => {
    const two = [box({ snapToZones: ['korzina'], onePerZone: true }), { ...box({ snapToZones: ['korzina'], onePerZone: true }, { x: 50, y: 150, w: 40, h: 40 }), id: 'kubik2', name: 'kubik2' }, zone('korzina', 200, 400)];
    const o = play({ blocks: two }, [ev.dragStart('kubik1'), ev.dragEnd('kubik1', 230, 420), tick(200), ev.dragStart('kubik2'), ev.dragEnd('kubik2', 230, 430), tick(300)]);
    expect(o.view('kubik1')!.zoneId).toBe('korzina');
    expect(o.view('kubik2')).toMatchObject({ x: 50, y: 150, zoneId: null });
  });

  it('BH-01 · TR-06: отпущенный на зону блок запускает «бросили на зону»', () => {
    const drop: RuleInput = rule({ kind: 'drop', source: { kind: 'block', blockId: 'kubik1' }, target: { kind: 'block', blockId: 'korzina' } }, [{ kind: 'effect', effect: 'confetti', intensity: 1 }]);
    const o = play({ blocks: [box({ snapToZones: ['korzina'] }), zone('korzina', 200, 400)], rules: [drop] }, [ev.dragStart('kubik1'), ev.dragEnd('kubik1', 230, 420)]);
    expect(o.of('effect')).toHaveLength(1);
  });

  it('BH-01: геометрия — ось и границы', () => {
    const d = { kind: 'drag' as const, axis: 'both' as const, bounds: { x: 10, y: 10, w: 100, h: 100 }, snapToZones: [], returnIfMissed: true, onePerZone: false };
    expect(constrainDrag(d, { x: 0, y: 0 }, { x: -50, y: 500 }, { w: 20, h: 20 })).toEqual({ x: 10, y: 90 });
  });
});

describe('BH-02: убегает от пальца', () => {
  const runner = (flee: Record<string, unknown> = {}) => withB('button', 'knopka_net', [{ kind: 'flee', distance: 80, times: 3, ...flee }], { frame: { x: 175, y: 400, w: 40, h: 40 } });

  it('BH-02: палец ближе дистанции — блок отбегает и не выходит за экран', () => {
    const o = play({ blocks: [runner()] }, [pointer(190, 415), tick(400)]);
    const v = o.view('knopka_net')!;
    expect(Math.hypot(v.x + 20 - 190, v.y + 20 - 415)).toBeGreaterThan(80);
    expect(v.x).toBeGreaterThanOrEqual(0);
    expect(v.x + 40).toBeLessThanOrEqual(390);
  });

  it('BH-02: далеко — не двигается; после «сколько раз» — больше не убегает', () => {
    expect(play({ blocks: [runner()] }, [pointer(10, 10), tick(400)]).view('knopka_net')).toMatchObject({ x: 175, y: 400 });
    // The finger chases the button: it runs away 3 times, the 4th time it stays.
    const chase: Step = (rt) => {
      const v = rt.view('knopka_net')!;
      rt.dispatch(pointer(v.x + 20, v.y + 20));
      rt.tick(400);
    };
    const places: Array<{ x: number; y: number }> = [];
    const spy: Step = (rt) => {
      const v = rt.view('knopka_net')!;
      places.push({ x: v.x, y: v.y });
    };
    play({ blocks: [runner({ times: 3 })] }, [chase, spy, chase, spy, chase, spy, chase, spy]);
    expect(new Set(places.slice(0, 3).map((p) => `${p.x},${p.y}`)).size).toBe(3);
    expect(places[3]).toEqual(places[2]);
  });

  it('BH-02: убегает только внутри своей области', () => {
    const o = play({ blocks: [runner({ area: { x: 100, y: 300, w: 200, h: 200 } })] }, [pointer(190, 415), tick(400)]);
    const v = o.view('knopka_net')!;
    expect(v.x).toBeGreaterThanOrEqual(100);
    expect(v.y).toBeGreaterThanOrEqual(300);
    expect(v.x + 40).toBeLessThanOrEqual(300);
    expect(v.y + 40).toBeLessThanOrEqual(500);
  });

  it('BH-02: геометрия — направление от пальца', () => {
    const to = fleeTarget({ x: 100, y: 100, w: 20, h: 20 }, { x: 90, y: 110 }, 50, { x: 0, y: 0, w: 390, h: 844 }, createRng(1));
    expect(to.x).toBeGreaterThan(100);
  });
});

describe('BH-03: стираемый слой', () => {
  it('BH-03 · TR-14: порог срабатывает один раз', () => {
    const r = rule({ kind: 'scratched', source: { kind: 'block', blockId: 'sloi01' }, percent: 60 }, [{ kind: 'effect', effect: 'confetti', intensity: 1 }]);
    const o = play({ blocks: [withB('shape', 'sloi01', [{ kind: 'scratch', threshold: 60 }])], rules: [r] }, [ev.scratched('sloi01', 30), ev.scratched('sloi01', 65), ev.scratched('sloi01', 90)]);
    expect(o.of('effect')).toHaveLength(1);
  });
});

describe('BH-04: движение', () => {
  const mover = (move: Record<string, unknown>, extra: Partial<BlockInput> = {}) => withB('shape', 'snezhok', [{ kind: 'move', ...move }], { frame: { x: 100, y: 100, w: 20, h: 20 }, ...extra });

  it('BH-04: направление и скорость — 90° вниз со скоростью 120 за секунду', () => {
    expect(play({ blocks: [mover({ angle: 90, speed: 120, edge: 'stop' })] }, [tick(1000)]).view('snezhok')).toMatchObject({ x: expect.closeTo(100, 6) as number, y: expect.closeTo(220, 6) as number });
    expect(play({ blocks: [mover({ angle: 0, speed: 50 })] }, [tick(1000)]).view('snezhok')!.x).toBeCloseTo(150, 6);
  });

  it('BH-04: гравитация ускоряет, разброс зависит от зерна', () => {
    const g = play({ blocks: [mover({ angle: 0, speed: 0, gravity: 200, edge: 'stop' })] }, [tick(500), tick(500)]).view('snezhok')!;
    expect(g.y).toBeGreaterThan(100 + 0.5 * 200 * 1 * 0.9);
    const xs = [1, 2, 3].map((seed) => play({ blocks: [mover({ angle: 90, speed: 100, spread: 90 })], seed }, [tick(500)]).view('snezhok')!.x);
    expect(new Set(xs.map((x) => x.toFixed(3))).size).toBeGreaterThan(1);
  });

  it('BH-04: отскок от края разворачивает движение', () => {
    const o = play({ blocks: [mover({ angle: 0, speed: 400, edge: 'bounce' }, { frame: { x: 350, y: 100, w: 20, h: 20 } })] }, [tick(100), tick(100)]);
    expect(o.view('snezhok')!.x).toBeLessThan(370);
  });

  it('BH-04: «исчезнуть за краем» удаляет блок, «по кругу» — переносит, «остановиться» — останавливает', () => {
    const gone = play({ blocks: [mover({ angle: 90, speed: 1000, edge: 'destroy' })] }, [tick(1000)]);
    expect(gone.view('snezhok')).toBeUndefined();
    const wrap = play({ blocks: [mover({ angle: 90, speed: 1000, edge: 'wrap' })] }, [tick(800)]);
    expect(wrap.view('snezhok')!.y).toBeLessThan(0);
    const stop = play({ blocks: [mover({ angle: 0, speed: 1000, edge: 'stop' })] }, [tick(1000), tick(1000)]);
    expect(stop.view('snezhok')!.x).toBe(370);
  });

  it('BH-04: по своему контуру — с постоянной скоростью от точки старта', () => {
    const o = play({ blocks: [mover({ speed: 50, path: 'M0 0 L100 0 L100 100' })] }, [tick(1000)]);
    expect(o.view('snezhok')).toMatchObject({ x: expect.closeTo(150, 3) as number, y: expect.closeTo(100, 3) as number });
    const later = play({ blocks: [mover({ speed: 50, path: 'M0 0 L100 0 L100 100' })] }, [tick(3000)]);
    expect(later.view('snezhok')).toMatchObject({ x: expect.closeTo(200, 3) as number, y: expect.closeTo(150, 3) as number });
  });

  it('BH-04: скрытый блок не двигается', () => {
    expect(play({ blocks: [mover({ speed: 100 }, { initiallyHidden: true })] }, [tick(1000)]).view('snezhok')!.y).toBe(100);
  });

  it('BH-04: геометрия краёв и контура', () => {
    expect(applyEdge('bounce', { x: -5, y: 10, vx: -10, vy: 0, ay: 0 }, { w: 10, h: 10 }, { x: 0, y: 0, w: 100, h: 100 })).toMatchObject({ x: 0, vx: 10 });
    const track = pathTrack('M0 0 C 0 100 100 100 100 0 Z');
    expect(track.length).toBeGreaterThan(200);
    expect(pointAt(track, track.length)).toEqual(track.points[0]);
    expect(pointAt(pathTrack('M5 5'), 10)).toEqual({ x: 0, y: 0 });
  });
});

describe('BH-05: генератор копий', () => {
  const world = (sp: Record<string, unknown>, rules: RuleInput[] = []) => ({
    blocks: [
      withB('shape', 'obrazec', [{ kind: 'move', angle: 90, speed: 100, edge: 'destroy' }], { frame: { x: 0, y: 0, w: 30, h: 30 }, initiallyHidden: true }),
      withB('shape', 'generator', [{ kind: 'spawner', prototypeId: 'obrazec', everyMs: 500, area: { x: 0, y: 0, w: 390, h: 50 }, max: 3, ...sp }], { frame: { x: 0, y: 700, w: 10, h: 10 } }),
    ],
    rules,
  });
  const copies = (o: ReturnType<typeof play>) => o.rt.views().filter((v) => v.copy && v.protoId === 'obrazec');

  it('BH-05: копии появляются по интервалу в области и двигаются как образец', () => {
    const o = play(world({}), [tick(1100)]);
    const list = copies(o);
    expect(list).toHaveLength(2);
    expect(list.every((v) => v.x >= 0 && v.x <= 360 && v.visible)).toBe(true);
    expect(list.some((v) => v.y > 30)).toBe(true);
  });

  it('BH-05: не больше лимита; ушедшие за край освобождают место', () => {
    expect(copies(play(world({}), [tick(1600)]))).toHaveLength(3);
    expect(copies(play(world({}), [tick(1600), tick(400)]))).toHaveLength(3);
    const long = play(world({ max: 2 }), [tick(10_000)]);
    expect(copies(long).length).toBeLessThanOrEqual(2);
  });

  it('BH-05: без автозапуска молчит, «проиграть» запускает, «пауза» останавливает', () => {
    expect(copies(play(world({ autoStart: false }), [tick(2000)]))).toHaveLength(0);
    const start = rule({ kind: 'tap', source: { kind: 'block', blockId: 'generator' } }, [{ kind: 'media', target: { kind: 'block', blockId: 'generator' }, command: 'play' }]);
    const stop = rule({ kind: 'key', key: 'p' }, [{ kind: 'media', target: { kind: 'block', blockId: 'generator' }, command: 'pause' }]);
    const o = play(world({ autoStart: false }, [start, stop]), [ev.tap('generator'), tick(600), ev.key('p'), tick(2000)]);
    expect(copies(o)).toHaveLength(1);
  });
});

describe('BH-06: колесо', () => {
  const wheelWorld = (weights: number[], rules: RuleInput[] = []) => ({
    blocks: [
      withB('container', 'koleso', [{ kind: 'wheel', spinMs: 2000, sectors: weights.map((weight, i) => ({ blockId: `sektor${i}`, weight })) }], {
        frame: { x: 45, y: 200, w: 300, h: 300 },
        children: weights.map((_, i) => b('shape', `sektor${i}`, { frame: { x: 140, y: 0, w: 20, h: 150, rotation: (i * 360) / weights.length } })),
      }),
    ],
    rules,
  });

  it('BH-06: нажатие крутит, сектор выбирает источник случайности сервера, колесо встаёт на него', () => {
    const end = rule({ kind: 'mediaEnd', source: { kind: 'block', blockId: 'koleso' } }, [{ kind: 'effect', effect: 'confetti', intensity: 1 }]);
    const o = play({ ...wheelWorld([1, 1, 1, 1], [end]), random: 0.6 }, [ev.tap('koleso'), tick(1000), ev.tap('koleso'), tick(1100)]);
    expect(o.of('wheel')).toEqual([{ type: 'wheel', blockId: 'koleso', sectorBlockId: 'sektor2' }]);
    expect(((o.view('koleso')!.rotation % 360) + 360) % 360).toBeCloseTo(135, 6);
    expect(o.view('sektor2')!.selected).toBe(true);
    expect(o.view('sektor1')!.selected).toBe(false);
    expect(o.of('effect')).toHaveLength(1);
  });

  it('BH-06: веса меняют вероятность; во время вращения нажатие не перезапускает', () => {
    expect(spinWheel({ kind: 'wheel', spinMs: 1000, sectors: [{ blockId: 'a', weight: 9 }, { blockId: 'b', weight: 1 }] }, 0, { next: () => 0.85 }).index).toBe(0);
    expect(spinWheel({ kind: 'wheel', spinMs: 1000, sectors: [{ blockId: 'a', weight: 9 }, { blockId: 'b', weight: 1 }] }, 0, { next: () => 0.95 }).index).toBe(1);
    expect(spinWheel({ kind: 'wheel', spinMs: 1000, sectors: [{ blockId: 'a', weight: 0 }, { blockId: 'b', weight: 0 }] }, 0, { next: () => 0.7 }).index).toBe(1);
    const o = play({ ...wheelWorld([1, 1]), random: 0.1 }, [ev.tap('koleso'), tick(500), ev.tap('koleso'), tick(2000)]);
    expect(o.of('wheel')).toHaveLength(1);
  });

  it('BH-06: «проиграть» действием тоже крутит колесо', () => {
    const go = rule({ kind: 'key', key: ' ' }, [{ kind: 'media', target: { kind: 'block', blockId: 'koleso' }, command: 'play' }]);
    expect(play({ ...wheelWorld([1, 1, 1], [go]), random: 0.99 }, [ev.key(' '), tick(2100)]).of('wheel')).toEqual([{ type: 'wheel', blockId: 'koleso', sectorBlockId: 'sektor2' }]);
  });
});

describe('BH-07: карточка-переворот', () => {
  const card = (on: 'tap' | 'action', rules: RuleInput[] = []) => ({
    blocks: [withB('container', 'kartochka', [{ kind: 'flip', frontId: 'licevaya', backId: 'rubashka', on, durationMs: 400 }], { frame: { x: 0, y: 0, w: 100, h: 140 }, children: [b('shape', 'licevaya'), b('shape', 'rubashka')] })],
    rules,
  });

  it('BH-07: нажатие переворачивает и возвращает обратно', () => {
    const o = play(card('tap'), [ev.tap('kartochka'), tick(400)]);
    expect(o.view('kartochka')).toMatchObject({ flipped: true, anim: { rotateY: 180 } });
    expect(play(card('tap'), [ev.tap('kartochka'), tick(400), ev.tap('kartochka'), tick(400)]).view('kartochka')).toMatchObject({ flipped: false, anim: { rotateY: 0 } });
  });

  it('BH-07: «по действию» — нажатие не переворачивает, «проиграть» переворачивает', () => {
    expect(play(card('action'), [ev.tap('kartochka'), tick(400)]).view('kartochka')!.flipped).toBe(false);
    const r = rule({ kind: 'key', key: 'f' }, [{ kind: 'media', target: { kind: 'block', blockId: 'kartochka' }, command: 'play' }]);
    expect(play(card('action', [r]), [ev.key('f'), tick(400)]).view('kartochka')!.flipped).toBe(true);
  });
});

describe('BH-08: следует за пальцем', () => {
  const follower = (follow: Record<string, unknown>) => withB('shape', 'zvezda', [{ kind: 'follow', ...follow }], { frame: { x: 0, y: 0, w: 20, h: 20 } });

  it('BH-08: без задержки — сразу под пальцем, с задержкой — догоняет', () => {
    expect(play({ blocks: [follower({ lagMs: 0 })] }, [pointer(200, 300), tick(16)]).view('zvezda')).toMatchObject({ x: 190, y: 290 });
    const lag = play({ blocks: [follower({ lagMs: 200 })] }, [pointer(200, 300), tick(100)]).view('zvezda')!;
    expect(lag.x).toBeGreaterThan(0);
    expect(lag.x).toBeLessThan(190);
    expect(play({ blocks: [follower({ lagMs: 200 })] }, [pointer(200, 300), tick(100), tick(3000)]).view('zvezda')).toMatchObject({ x: 190, y: 290 });
  });

  it('BH-08: не выходит из своей области', () => {
    expect(play({ blocks: [follower({ lagMs: 0, bounds: { x: 0, y: 0, w: 100, h: 100 } })] }, [pointer(300, 50), tick(16)]).view('zvezda')).toMatchObject({ x: 80, y: 40 });
    expect(followShare(0, 16)).toBe(1);
    expect(followShare(100, 100)).toBeCloseTo(1 - Math.exp(-1));
  });
});
