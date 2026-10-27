import { describe, expect, it } from 'vitest';
import { GRID, measureGaps, snapRect } from '../lib/editor/snap';
import { boundsOf, intersects, rectFromPoints, resizeBox, resizeFrame, rotationFromPointer, scaleFrames, unionOf } from '../lib/editor/geometry';

const frame = { x: 100, y: 100, w: 100, h: 50, rotation: 0 };

describe('E-05 · изменение размера за маркеры', () => {
  it('E-05 · правый нижний угол тянет размер, верхний левый остаётся на месте', () => {
    expect(resizeFrame(frame, 'se', { x: 20, y: 10 })).toMatchObject({ x: 100, y: 100, w: 120, h: 60 });
  });

  it('E-05 · левый верхний угол: противоположный угол остаётся на месте', () => {
    expect(resizeFrame(frame, 'nw', { x: -20, y: -10 })).toMatchObject({ x: 80, y: 90, w: 120, h: 60 });
  });

  it('E-05 · боковые маркеры меняют только одну сторону', () => {
    expect(resizeFrame(frame, 'e', { x: 30, y: 99 })).toMatchObject({ x: 100, y: 100, w: 130, h: 50 });
    expect(resizeFrame(frame, 'w', { x: -30, y: 99 })).toMatchObject({ x: 70, y: 100, w: 130, h: 50 });
    expect(resizeFrame(frame, 's', { x: 99, y: 10 })).toMatchObject({ x: 100, y: 100, w: 100, h: 60 });
    expect(resizeFrame(frame, 'n', { x: 99, y: -10 })).toMatchObject({ x: 100, y: 90, w: 100, h: 60 });
  });

  it('E-05 · Shift сохраняет пропорции: угол и боковой маркер', () => {
    const corner = resizeFrame(frame, 'se', { x: 50, y: 0 }, { keepAspect: true });
    expect(corner.w / corner.h).toBeCloseTo(2, 1);
    expect(corner.w).toBe(150);
    const edge = resizeFrame(frame, 'e', { x: 50, y: 0 }, { keepAspect: true });
    expect(edge).toMatchObject({ w: 150, h: 75 });
    const vertical = resizeFrame(frame, 's', { x: 0, y: 25 }, { keepAspect: true });
    expect(vertical).toMatchObject({ w: 150, h: 75 });
    const tall = resizeFrame(frame, 'se', { x: 0, y: 50 }, { keepAspect: true });
    expect(tall.w / tall.h).toBeCloseTo(2, 1);
  });

  it('E-05 · Alt растит от центра: центр на месте, размер меняется в обе стороны', () => {
    const r = resizeFrame(frame, 'se', { x: 20, y: 10 }, { fromCenter: true });
    expect(r).toMatchObject({ w: 140, h: 70, x: 80, y: 90 });
    expect(r.x + r.w / 2).toBe(150);
    expect(r.y + r.h / 2).toBe(125);
  });

  it('S-01 · размер ограничен 1…3000, блок не «выворачивается»', () => {
    expect(resizeFrame(frame, 'e', { x: -500, y: 0 }).w).toBe(1);
    expect(resizeFrame(frame, 'e', { x: 9000, y: 0 }).w).toBe(3000);
  });

  it('E-05 · повёрнутый блок: движение читается по его осям, противоположный угол остаётся на месте', () => {
    const turned = { x: 100, y: 100, w: 100, h: 50, rotation: 90 };
    // Turned by 90°, the block's own «right» is the screen's «down».
    const r = resizeFrame(turned, 'e', { x: 0, y: 40 });
    expect(r.w).toBe(140);
    const c0 = { x: 150, y: 125 };
    // The west edge of the block (screen: top) did not move: the centre went down by half the growth.
    expect(r.x + r.w / 2).toBeCloseTo(c0.x, 5);
    expect(r.y + r.h / 2).toBeCloseTo(c0.y + 20, 5);
  });

  it('E-05 · округление до 0,1', () => {
    const r = resizeFrame(frame, 'se', { x: 0.04, y: 0.06 });
    expect(r.w).toBe(100);
    expect(r.h).toBe(50.1);
  });

  it('E-05 · несколько блоков: рамка вокруг них растягивается, блоки пропорционально', () => {
    const a = { x: 0, y: 0, w: 100, h: 100 };
    const b = { x: 100, y: 0, w: 100, h: 100 };
    const box = unionOf([a, b])!;
    const grown = resizeBox(box, 'e', { x: 200, y: 0 });
    expect(grown).toEqual({ x: 0, y: 0, w: 400, h: 100 });
    expect(scaleFrames([a, b], box, grown)).toEqual([
      { x: 0, y: 0, w: 200, h: 100 },
      { x: 200, y: 0, w: 200, h: 100 },
    ]);
    expect(scaleFrames([a], { x: 0, y: 0, w: 0, h: 0 }, { x: 5, y: 5, w: 0, h: 0 })[0]).toMatchObject({ w: 100 });
  });
});

describe('E-05 · поворот', () => {
  const c = { x: 0, y: 0 };
  it('E-05 · блок поворачивается на угол, на который сместили указатель', () => {
    expect(rotationFromPointer(c, 0, { x: 100, y: 0 }, { x: 0, y: 100 }, false)).toBe(90);
    expect(rotationFromPointer(c, 30, { x: 100, y: 0 }, { x: 100, y: 0 }, false)).toBe(30);
  });
  it('E-05 · Shift — шаг 15°', () => {
    expect(rotationFromPointer(c, 0, { x: 100, y: 0 }, { x: 100, y: 30 }, true) % 15).toBe(0);
    expect(rotationFromPointer(c, 0, { x: 100, y: 0 }, { x: 100, y: 100 }, true)).toBe(45);
  });
  it('S-01 · угол приводится к −180…180', () => {
    expect(rotationFromPointer(c, 170, { x: 100, y: 0 }, { x: 0, y: 100 }, false)).toBe(-100);
  });
});

describe('E-06 · прилипание и направляющие', () => {
  const artboard = { w: 390, h: 844 };
  const o = (extra = {}) => ({ artboard, others: [], grid: false, threshold: 6, ...extra });

  it('E-06 · к краям артборда: левая и верхняя грани', () => {
    const r = snapRect({ x: 4, y: 3, w: 50, h: 50 }, o());
    expect(r).toMatchObject({ dx: -4, dy: -3 });
    expect(r.guides.map((g) => [g.axis, g.at, g.kind])).toEqual([['x', 0, 'artboard'], ['y', 0, 'artboard']]);
  });

  it('E-06 · к центру артборда по горизонтали, к правому краю', () => {
    expect(snapRect({ x: 168, y: 300, w: 50, h: 50 }, o()).dx).toBe(2); // centre 193 → 195
    expect(snapRect({ x: 335, y: 300, w: 50, h: 50 }, o()).dx).toBe(5); // right 385 → 390
  });

  it('E-06 · далеко от всего — не двигается, направляющих нет', () => {
    const r = snapRect({ x: 60, y: 300, w: 50, h: 50 }, o());
    expect(r).toEqual({ dx: 0, dy: 0, guides: [], gaps: [] });
  });

  it('E-06 · к граням и центру других блоков, с направляющей между ними', () => {
    const other = { x: 100, y: 200, w: 80, h: 40 };
    const r = snapRect({ x: 103, y: 100, w: 60, h: 30 }, o({ others: [other] }));
    expect(r.dx).toBe(-3);
    const g = r.guides.find((x) => x.axis === 'x')!;
    expect(g).toMatchObject({ at: 100, kind: 'block', from: 100, to: 240 });
  });

  it('E-06 · ближайшая линия выигрывает; порог настраивается', () => {
    const others = [{ x: 100, y: 0, w: 10, h: 10 }, { x: 104, y: 0, w: 10, h: 10 }];
    expect(snapRect({ x: 103, y: 400, w: 20, h: 20 }, o({ others })).dx).toBe(1);
    expect(snapRect({ x: 109, y: 400, w: 20, h: 20 }, o({ others, threshold: 2 })).dx).toBe(0);
  });

  it('E-06 · сетка 8: левая и верхняя грани, только когда сетка включена', () => {
    const on = snapRect({ x: 51, y: 61, w: 30, h: 30 }, o({ grid: true }));
    expect(on).toMatchObject({ dx: -3, dy: 3 }); // 51 → 48, 61 → 64
    expect(on.guides.every((g) => g.kind === 'grid')).toBe(true);
    expect((51 + on.dx) % GRID).toBe(0);
    expect(snapRect({ x: 51, y: 61, w: 30, h: 30 }, o()).dx).toBe(0);
  });

  it('E-06 · границы блоков и артборда сильнее сетки при равном расстоянии', () => {
    const r = snapRect({ x: 3, y: 300, w: 30, h: 30 }, o({ grid: true, threshold: 6 }));
    expect(r.dx).toBe(-3); // the artboard edge, not the grid line at 0 or 8
    expect(r.guides[0]!.kind).toBe('artboard');
  });

  it('E-06 · расстояния до соседей и краёв артборда по обе стороны', () => {
    const others = [{ x: 0, y: 100, w: 50, h: 50 }, { x: 300, y: 100, w: 50, h: 50 }];
    const gaps = measureGaps({ x: 100, y: 110, w: 60, h: 30 }, { artboard, others });
    const byKey = (axis: string, v: number) => gaps.find((g) => g.axis === axis && g.value === v);
    expect(byKey('x', 50)).toBeDefined(); // 50 → 100
    expect(byKey('x', 140)).toBeDefined(); // 160 → 300
    expect(byKey('y', 110)).toBeDefined(); // top edge of the artboard
    expect(byKey('y', 704)).toBeDefined(); // down to the bottom
    expect(gaps.every((g) => g.value > 0)).toBe(true);
  });

  it('E-06 · расстояние «0» (блоки вплотную) не рисуется', () => {
    const gaps = measureGaps({ x: 50, y: 100, w: 50, h: 50 }, { artboard, others: [{ x: 0, y: 100, w: 50, h: 50 }] });
    expect(gaps.some((g) => g.axis === 'x' && g.from.x === 50 && g.to.x === 50)).toBe(false);
  });
});

describe('E-04/E-05 · вспомогательные прямоугольники', () => {
  it('рамка выделения из двух точек в любом порядке; пересечение; объединение', () => {
    expect(rectFromPoints({ x: 50, y: 60 }, { x: 10, y: 20 })).toEqual({ x: 10, y: 20, w: 40, h: 40 });
    expect(intersects({ x: 0, y: 0, w: 10, h: 10 }, { x: 5, y: 5, w: 10, h: 10 })).toBe(true);
    expect(intersects({ x: 0, y: 0, w: 10, h: 10 }, { x: 10, y: 0, w: 10, h: 10 })).toBe(false);
    expect(unionOf([])).toBeNull();
  });
  it('повёрнутый блок занимает больше места', () => {
    const b = boundsOf({ x: 0, y: 0, w: 100, h: 100, rotation: 45 });
    expect(b.w).toBeCloseTo(141.42, 1);
    expect(boundsOf({ x: 5, y: 6, w: 7, h: 8 })).toEqual({ x: 5, y: 6, w: 7, h: 8 });
  });
});
