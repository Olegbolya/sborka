import { BlockStyle, type Shape, parsePath } from '@blokum/schema';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it } from 'vitest';
import { Artboard, BlockView, DEV_THEMES, cornerRadii, dashArray, isCssShape, shapeOutline, strokeExtent, styleToCss } from '../src/index.js';
import { block, media, render, styleOf } from './helpers.js';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const ctx = { tokens: DEV_THEMES.light, media };
const shape = (s: Record<string, unknown>): Shape => BlockStyle.parse({ shape: s }).shape;
const radius = (r: Record<string, unknown> = {}) => BlockStyle.parse({ radius: r }).radius;

/** All end and control points of an outline. */
function points(d: string): Array<[number, number]> {
  return parsePath(d).flatMap((s) => (s.c === 'Z' ? [] : s.c === 'C' ? ([[s.x1, s.y1], [s.x2, s.y2], [s.x, s.y]] as Array<[number, number]>) : ([[s.x, s.y]] as Array<[number, number]>)));
}
/** Points ON the outline (curves sampled), not control points — those may legitimately lie outside. */
function curvePoints(d: string): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  let x0 = 0;
  let y0 = 0;
  for (const s of parsePath(d)) {
    if (s.c === 'Z') continue;
    if (s.c === 'C') {
      for (let i = 1; i <= 20; i++) {
        const t = i / 20;
        const m = 1 - t;
        out.push([m * m * m * x0 + 3 * m * m * t * s.x1 + 3 * m * t * t * s.x2 + t * t * t * s.x, m * m * m * y0 + 3 * m * m * t * s.y1 + 3 * m * t * t * s.y2 + t * t * t * s.y]);
      }
    } else out.push([s.x, s.y]);
    x0 = s.x;
    y0 = s.y;
  }
  return out;
}
const within = (d: string, w: number, h: number, slack = 0.05) => curvePoints(d).every(([x, y]) => x >= -slack && x <= w + slack && y >= -slack && y <= h + slack);
const extent = (d: string) => {
  const ps = points(d);
  return { minX: Math.min(...ps.map((q) => q[0])), maxX: Math.max(...ps.map((q) => q[0])), minY: Math.min(...ps.map((q) => q[1])), maxY: Math.max(...ps.map((q) => q[1])) };
};

const ALL: Array<[string, Record<string, unknown>]> = [
  ['прямоугольник', { kind: 'rect' }],
  ['капсула', { kind: 'pill' }],
  ['эллипс', { kind: 'ellipse' }],
  ['многоугольник', { kind: 'polygon', sides: 7, cornerRadius: 0.2 }],
  ['звезда', { kind: 'star', points: 12, depth: 0.4, cornerRadius: 0.1 }],
  ['сердце', { kind: 'heart' }],
  ['клякса', { kind: 'blob', seed: 42, complexity: 9 }],
  ['облачко', { kind: 'bubble', tail: { x: 0.8, y: 1 }, tailWidth: 0.2 }],
  ['стрелка', { kind: 'arrow', thickness: 0.3, head: 'chevron' }],
  ['волна', { kind: 'wave', amplitude: 0.1, frequency: 5, edges: ['top', 'bottom'] }],
  ['контур', { kind: 'path', d: 'M0 100L50 0L100 100Z' }],
];

describe('S-02: контуры всех форм', () => {
  it.each(ALL)('S-02: «%s» — замкнутый разбираемый контур внутри блока', (_name, s) => {
    for (const [w, h] of [[200, 120], [80, 300]] as const) {
      const d = shapeOutline(shape(s), radius(), w, h);
      expect(d.endsWith('Z')).toBe(true);
      expect(() => parsePath(d)).not.toThrow();
      expect(within(d, w, h)).toBe(true);
    }
  });

  it('S-02: прямоугольник, капсула и эллипс рисуются CSS, остальные — маской', () => {
    expect(ALL.filter(([, s]) => isCssShape(shape(s))).map(([n]) => n)).toEqual(['прямоугольник', 'капсула', 'эллипс']);
  });

  it('S-02: многоугольник 3–24 стороны и звезда 3–48 лучей — число вершин', () => {
    const count = (d: string) => (d.match(/[ML]/g) ?? []).length;
    expect(count(shapeOutline(shape({ kind: 'polygon', sides: 3 }), radius(), 100, 100))).toBe(3);
    expect(count(shapeOutline(shape({ kind: 'polygon', sides: 24 }), radius(), 100, 100))).toBe(24);
    expect(count(shapeOutline(shape({ kind: 'star', points: 48 }), radius(), 100, 100))).toBe(96);
  });

  it('S-02: многоугольник и звезда заполняют блок целиком', () => {
    for (const s of [{ kind: 'polygon', sides: 5 }, { kind: 'star', points: 5, depth: 0.6 }]) {
      const e = extent(shapeOutline(shape(s), radius(), 300, 200));
      expect([e.minX, e.maxX, e.minY, e.maxY].map(Math.round)).toEqual([0, 300, 0, 200]);
    }
  });

  it('S-03: скругление вершин многоугольников и звёзд', () => {
    expect(shapeOutline(shape({ kind: 'polygon', sides: 6 }), radius(), 100, 100)).not.toContain('Q');
    expect((shapeOutline(shape({ kind: 'polygon', sides: 6, cornerRadius: 0.3 }), radius(), 100, 100).match(/Q/g) ?? []).length).toBe(6);
    expect((shapeOutline(shape({ kind: 'star', points: 5, cornerRadius: 0.2 }), radius(), 100, 100).match(/Q/g) ?? []).length).toBe(10);
  });

  it('S-03: скругление углов прямоугольника — каждый угол свой, перекрывающиеся уменьшаются', () => {
    expect(shapeOutline(shape({ kind: 'rect' }), radius({ tl: 10, tr: 0, br: 20, bl: 5 }), 100, 60)).toBe('M10 0L100 0L100 0L100 40A20 20 0 0 1 80 60L5 60A5 5 0 0 1 0 55L0 10A10 10 0 0 1 10 0Z');
    expect(cornerRadii(radius({ tl: 1500, tr: 1500, br: 1500, bl: 1500 }), 100, 50).map((c) => c.rx)).toEqual([25, 25, 25, 25]);
    expect(cornerRadii(radius({ unit: '%', tl: 50, tr: 50, br: 50, bl: 50 }), 200, 100)[0]).toEqual({ rx: 100, ry: 50 });
  });

  it('S-02: клякса — одно зерно даёт одну форму, другое — другую', () => {
    const a = shapeOutline(shape({ kind: 'blob', seed: 7 }), radius(), 100, 100);
    expect(shapeOutline(shape({ kind: 'blob', seed: 7 }), radius(), 100, 100)).toBe(a);
    expect(shapeOutline(shape({ kind: 'blob', seed: 8 }), radius(), 100, 100)).not.toBe(a);
    expect((a.match(/C/g) ?? []).length).toBe(6);
  });

  it.each([
    ['снизу', { x: 0.3, y: 1 }, [60, 100]],
    ['сверху', { x: 0.9, y: 0 }, [180, 0]],
    ['справа', { x: 1, y: 0.5 }, [200, 50]],
    ['слева', { x: 0, y: 0.4 }, [0, 40]],
    ['внутри (уводится к краю)', { x: 0.5, y: 0.5 }, [100, 100]],
  ] as const)('S-02: хвостик облачка %s', (_name, tail, tip) => {
    const d = shapeOutline(shape({ kind: 'bubble', tail }), radius(), 200, 100);
    expect(points(d)).toContainEqual(tip);
  });

  it('S-02: наконечники стрелки различаются, толщина задаёт древко', () => {
    const [t, r, c] = (['triangle', 'round', 'chevron'] as const).map((head) => shapeOutline(shape({ kind: 'arrow', head, thickness: 0.5 }), radius(), 200, 100));
    expect(new Set([t, r, c]).size).toBe(3);
    expect(t).toBe('M0 25L100 25L100 0L200 50L100 100L100 75L0 75Z');
    expect(r).toContain('A100 50');
    expect(c).toContain('L65 0');
  });

  it('S-02: волна и зигзаг только по выбранным краям', () => {
    const waveBottom = shapeOutline(shape({ kind: 'wave', frequency: 3, amplitude: 0.1, edges: ['bottom'] }), radius(), 300, 100);
    expect((waveBottom.match(/Q/g) ?? []).length).toBe(6);
    const zig = shapeOutline(shape({ kind: 'wave', frequency: 2, zigzag: true, edges: ['left', 'right'] }), radius(), 100, 100);
    expect(zig).not.toContain('Q');
    expect((zig.match(/L/g) ?? []).length).toBe(2 + 2 * 2 * 2 * 2);
    expect(shapeOutline(shape({ kind: 'wave', amplitude: 0 }), radius(), 100, 100)).toBe('M0 0L100 0L100 100L0 100L0 0Z');
  });

  it('S-02: произвольный контур растягивается на блок, незамкнутый остаётся открытым', () => {
    expect(shapeOutline(shape({ kind: 'path', d: 'M0 0L100 0L100 100Z' }), radius(), 200, 50)).toBe('M0 0L200 0L200 50Z');
    expect(shapeOutline(shape({ kind: 'path', d: 'M0 0L100 100', closed: false }), radius(), 10, 10)).toBe('M0 0L10 10');
    expect(shapeOutline(shape({ kind: 'path', d: 'M0 0L100 100L0 100' }), radius(), 10, 10)).toBe('M0 0L10 10L0 10Z');
  });
});

describe('S-05 · S-06 · S-19: обводка, тени и маски по контуру', () => {
  const css = (s: Record<string, unknown>, w = 200, h = 100) => styleToCss(BlockStyle.parse(s), ctx, { w, h });

  it('S-02: фигура вырезается маской по контуру, без тени CSS', () => {
    const c = css({ shape: { kind: 'star' }, shadows: [{ x: 2, y: 4, blur: 8, spread: 2 }] });
    expect(c.surface.maskImage).toMatch(/^url\("data:image\/svg\+xml,/);
    expect(decodeURIComponent(String(c.surface.maskImage))).toContain('viewBox="0 0 200 100"');
    expect(c.surface.boxShadow).toBeUndefined();
    expect(c.content.maskImage).toBe(c.surface.maskImage);
    expect(c.shadowLayers).toHaveLength(1);
  });

  it('S-06: тень, свечение и внутренняя тень по контуру', () => {
    const c = css({ shape: { kind: 'heart' }, shadows: [{ x: 3, y: 5, blur: 10, spread: 2, color: { hex: '#FF000080' } }, { inset: true, blur: 6, spread: -1 }], glow: { color: { token: 'primary' }, size: 12 } });
    expect(c.shadowLayers).toHaveLength(2);
    expect(c.innerLayers).toHaveLength(1);
    const outer = decodeURIComponent(String(c.shadowLayers[0]!.backgroundImage));
    expect(outer).toContain('feMorphology operator="dilate" radius="2"');
    expect(outer).toContain('stdDeviation="5"');
    expect(outer).toContain('translate(3 5)');
    expect(outer).toContain('fill="#FF000080"');
    expect(c.shadowLayers[0]!.inset).toBe('calc(-23 * var(--u))');
    expect(decodeURIComponent(String(c.shadowLayers[1]!.backgroundImage))).toContain('fill="#D9480F"');
    const inner = decodeURIComponent(String(c.innerLayers[0]!.backgroundImage));
    expect(inner).toContain('operator="dilate" radius="1"');
    expect(inner).toContain('clip-path="url(#c)"');
    // Пустой SVG-фильтр делает элемент прозрачным, поэтому без размытия и растяжения фильтров нет вовсе.
    const sharpInner = decodeURIComponent(String(css({ shape: { kind: 'heart' }, shadows: [{ blur: 0, spread: 0, inset: true }] }).innerLayers[0]!.backgroundImage));
    expect(sharpInner).not.toContain('<filter');
    expect(sharpInner).not.toContain('filter=');
    const sharpOuter = decodeURIComponent(String(css({ shape: { kind: 'heart' }, shadows: [{ blur: 0, spread: 0 }] }).shadowLayers[0]!.backgroundImage));
    expect(sharpOuter).not.toContain('<filter');
    expect(decodeURIComponent(String(css({ shape: { kind: 'heart' }, shadows: [{ blur: 4, spread: 0, inset: true }] }).innerLayers[0]!.backgroundImage))).not.toContain('id="hole"');
  });

  it('S-06: у прямоугольных форм тени остаются CSS', () => {
    const c = css({ shape: { kind: 'pill' }, shadows: [{}] });
    expect(c.shadowLayers).toEqual([]);
    expect(c.surface.boxShadow).toBeDefined();
    expect(c.surface.borderRadius).toBe('calc(50 * var(--u))');
    expect(css({ shape: { kind: 'ellipse' } }).surface.borderRadius).toBe('50%');
  });

  it.each([
    ['inside', 0, 'clip-path="url(#c)"', '4'],
    ['center', 1, 'stroke-width="2"', '2'],
    ['outside', 2, 'mask="url(#m)"', '4'],
  ] as const)('S-05: обводка %s повторяет контур', (align, ext, marker, width) => {
    const c = css({ shape: { kind: 'star' }, stroke: { width: 2, align, paint: { kind: 'linear', stops: [{ offset: 0, color: { hex: '#FF0000' } }, { offset: 1, color: { hex: '#0000FF' } }] } } });
    const svg = decodeURIComponent(String(c.stroke!.maskImage));
    expect(strokeExtent(BlockStyle.parse({ stroke: { width: 2, align } }).stroke)).toBe(ext);
    expect(c.stroke!.inset).toBe(ext === 0 ? 0 : `calc(${-ext} * var(--u))`);
    expect(svg).toContain(marker);
    expect(svg).toContain(`stroke-width="${width}"`);
    expect(c.stroke!.backgroundImage).toBe('linear-gradient(180deg, #FF0000 0%, #0000FF 100%)');
  });

  it('S-05: пунктир, свой штрих, точки; без толщины — без обводки', () => {
    const s = (stroke: Record<string, unknown>) => BlockStyle.parse({ stroke }).stroke;
    expect(dashArray(s({ width: 2 }))).toBeNull();
    expect(dashArray(s({ width: 2, style: 'dashed' }))).toBe('6 4');
    expect(dashArray(s({ width: 2, style: 'dashed', dash: [10, 3, 1, 3] }))).toBe('10 3 1 3');
    expect(dashArray(s({ width: 3, style: 'dotted' }))).toBe('0 6');
    expect(decodeURIComponent(String(css({ stroke: { width: 3, style: 'dotted' } }).stroke!.maskImage))).toContain('stroke-linecap="round"');
    expect(css({ stroke: { width: 0 } }).stroke).toBeNull();
    expect(css({ stroke: { width: 1, paint: { kind: 'conic', stops: [{ offset: 0, color: { hex: '#000000' } }, { offset: 1, color: { hex: '#FFFFFF' } }] } } }).stroke!.backgroundImage).toContain('conic-gradient');
  });

  it('S-19: маска по картинке и затухание краёв пересекаются; обрезка по форме отключается', () => {
    const c = css({ mask: { image: { source: 'media', id: 'maska00001' }, fade: { edges: ['bottom', 'left'], size: 0.3 } } });
    expect(c.root.maskImage).toBe('url("https://media.blokum.ru/maska00001.webp"), linear-gradient(to top, transparent 0%, #000 30%), linear-gradient(to right, transparent 0%, #000 30%)');
    expect(c.root).toMatchObject({ maskSize: 'contain, 100% 100%, 100% 100%', maskComposite: 'intersect', WebkitMaskComposite: 'source-in' });
    expect(css({ mask: { fade: { edges: ['top'], size: 0.5 } } }).root.maskComposite).toBeUndefined();
    expect(css({ mask: { image: { source: 'media', id: 'maska00001' } } }).root.maskImage).toBe('url("https://media.blokum.ru/maska00001.webp")');
    expect(styleToCss(BlockStyle.parse({ mask: { image: { source: 'media', id: 'maska00001' } } }), { ...ctx, media: () => null }).root.maskImage).toBeUndefined();
    expect(css({ shape: { kind: 'star' }, mask: { clipToShape: false } }).content).toMatchObject({ overflow: 'visible' });
    expect(css({ shape: { kind: 'star' }, mask: { clipToShape: false } }).content.maskImage).toBeUndefined();
  });

  it('S-18: наклон за курсором добавляет переменные к повороту', () => {
    const c = css({ transform3d: { rotateX: 10, tiltFollow: true } });
    expect(c.transform3d).toBe('perspective(calc(1000 * var(--u))) rotateX(calc((10 + var(--bk-tilt-x, 0)) * 1deg)) rotateY(calc((0 + var(--bk-tilt-y, 0)) * 1deg))');
  });
});

describe('S-05 · S-18: блоки с формой в DOM', () => {
  it('S-05: тень, внутренняя тень и обводка — отдельные слои блока', () => {
    const host = render(<BlockView block={block('shape', { style: { shape: { kind: 'star' }, shadows: [{}, { inset: true }], stroke: { width: 2 } } })} />);
    expect(host.querySelectorAll('.bk-shadow')).toHaveLength(1);
    expect(host.querySelectorAll('.bk-surface .bk-inner-shadow')).toHaveLength(1);
    expect(styleOf(host.querySelector('.bk-stroke'))).toContain('mask-image');
  });

  it('S-18: в плеере блок наклоняется к курсору и возвращается при уходе', () => {
    const host = document.createElement('div');
    document.body.append(host);
    const root = createRoot(host);
    const b = block('shape', { frame: { x: 0, y: 0, w: 100, h: 100 }, style: { transform3d: { tiltFollow: true, tiltStrength: 20 } } });
    act(() => {
      root.render(
        <Artboard mode="player" tokens={DEV_THEMES.light} media={media}>
          <BlockView block={b} />
        </Artboard>,
      );
    });
    const el = host.querySelector<HTMLElement>('.bk-block')!;
    expect(el.style.touchAction).toBe('none');
    el.getBoundingClientRect = () => ({ left: 0, top: 0, width: 100, height: 100, right: 100, bottom: 100, x: 0, y: 0, toJSON: () => ({}) });
    act(() => {
      el.dispatchEvent(new MouseEvent('pointermove', { bubbles: true, clientX: 100, clientY: 0 }));
    });
    expect([el.style.getPropertyValue('--bk-tilt-y'), el.style.getPropertyValue('--bk-tilt-x')]).toEqual(['20', '20']);
    act(() => {
      el.dispatchEvent(new MouseEvent('pointerout', { bubbles: true, relatedTarget: document.body }));
    });
    expect(el.style.getPropertyValue('--bk-tilt-x')).toBe('0');
    act(() => root.unmount());
    host.remove();
  });
});
