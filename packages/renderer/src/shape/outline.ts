import { createRng } from '@blokum/engine';
import { type BlockStyle, type Shape, parsePath, serializePath, transformPath } from '@blokum/schema';

/** A point in block units (0…w, 0…h). */
export interface Pt {
  x: number;
  y: number;
}

type Radius = BlockStyle['radius'];

const fmt = (n: number) => String(Math.round(n * 100) / 100);
const p = (pt: Pt) => `${fmt(pt.x)} ${fmt(pt.y)}`;

/** Shapes drawn by CSS `border-radius` — they keep CSS shadows and need no mask. */
export const isCssShape = (shape: Shape): boolean => shape.kind === 'rect' || shape.kind === 'pill' || shape.kind === 'ellipse';

/** Corner radii in units (x and y separately for percent radii), shrunk like CSS when they overlap. */
export function cornerRadii(r: Radius, w: number, h: number): Array<{ rx: number; ry: number }> {
  const corners = [r.tl, r.tr, r.br, r.bl].map((v) => (r.unit === '%' ? { rx: (v / 100) * w, ry: (v / 100) * h } : { rx: v, ry: v }));
  const [tl, tr, br, bl] = corners as [{ rx: number; ry: number }, { rx: number; ry: number }, { rx: number; ry: number }, { rx: number; ry: number }];
  const f = Math.min(1, w / (tl.rx + tr.rx || 1), w / (bl.rx + br.rx || 1), h / (tl.ry + bl.ry || 1), h / (tr.ry + br.ry || 1));
  return corners.map((c) => ({ rx: c.rx * f, ry: c.ry * f }));
}

/** Rounded rectangle path (S-03): each corner its own radius. */
export function roundedRect(w: number, h: number, radii: Array<{ rx: number; ry: number }>): string {
  const [tl, tr, br, bl] = radii as [{ rx: number; ry: number }, { rx: number; ry: number }, { rx: number; ry: number }, { rx: number; ry: number }];
  const arc = (c: { rx: number; ry: number }, to: Pt) => (c.rx > 0 && c.ry > 0 ? `A${fmt(c.rx)} ${fmt(c.ry)} 0 0 1 ${p(to)}` : `L${p(to)}`);
  return [
    `M${p({ x: tl.rx, y: 0 })}`,
    `L${p({ x: w - tr.rx, y: 0 })}`,
    arc(tr, { x: w, y: tr.ry }),
    `L${p({ x: w, y: h - br.ry })}`,
    arc(br, { x: w - br.rx, y: h }),
    `L${p({ x: bl.rx, y: h })}`,
    arc(bl, { x: 0, y: h - bl.ry }),
    `L${p({ x: 0, y: tl.ry })}`,
    arc(tl, { x: tl.rx, y: 0 }),
    'Z',
  ].join('');
}

/** Stretches points so their bounding box fills 0…w × 0…h. */
function fit(points: Pt[], w: number, h: number): Pt[] {
  const xs = points.map((q) => q.x);
  const ys = points.map((q) => q.y);
  const [minX, maxX, minY, maxY] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  return points.map((q) => ({ x: ((q.x - minX) / (maxX - minX || 1)) * w, y: ((q.y - minY) / (maxY - minY || 1)) * h }));
}

/** Closed polygon; `round` (0…0.5) rounds every vertex by that share of the shorter adjacent edge (S-03). */
export function roundedPolygon(points: Pt[], round: number): string {
  if (round <= 0) return `M${points.map(p).join('L')}Z`;
  const n = points.length;
  const parts: string[] = [];
  for (let i = 0; i < n; i++) {
    const prev = points[(i - 1 + n) % n]!;
    const cur = points[i]!;
    const next = points[(i + 1) % n]!;
    const dPrev = Math.hypot(prev.x - cur.x, prev.y - cur.y);
    const dNext = Math.hypot(next.x - cur.x, next.y - cur.y);
    const cut = round * Math.min(dPrev, dNext);
    const a = { x: cur.x + ((prev.x - cur.x) / (dPrev || 1)) * cut, y: cur.y + ((prev.y - cur.y) / (dPrev || 1)) * cut };
    const b = { x: cur.x + ((next.x - cur.x) / (dNext || 1)) * cut, y: cur.y + ((next.y - cur.y) / (dNext || 1)) * cut };
    parts.push(`${i === 0 ? 'M' : 'L'}${p(a)}Q${p(cur)} ${p(b)}`);
  }
  return `${parts.join('')}Z`;
}

/** Regular polygon or star on a circle, the first vertex at the top, stretched to the block. */
function radialPoints(count: number, radiusAt: (i: number) => number): Pt[] {
  return Array.from({ length: count }, (_, i) => {
    const a = -Math.PI / 2 + (i * 2 * Math.PI) / count;
    const r = radiusAt(i);
    return { x: Math.cos(a) * r, y: Math.sin(a) * r };
  });
}

const HEART = 'M50 100C22 78 0 56 0 31C0 13 13 0 28 0C38 0 46 6 50 16C54 6 62 0 72 0C87 0 100 13 100 31C100 56 78 78 50 100Z';

/** Smooth closed curve through the points (Catmull–Rom → cubic Bézier). */
function smoothClosed(points: Pt[]): string {
  const n = points.length;
  const at = (i: number) => points[(i + n) % n]!;
  let d = `M${p(points[0]!)}`;
  for (let i = 0; i < n; i++) {
    const p0 = at(i - 1);
    const p1 = at(i);
    const p2 = at(i + 1);
    const p3 = at(i + 2);
    const c1 = { x: p1.x + (p2.x - p0.x) / 6, y: p1.y + (p2.y - p0.y) / 6 };
    const c2 = { x: p2.x - (p3.x - p1.x) / 6, y: p2.y - (p3.y - p1.y) / 6 };
    d += `C${p(c1)} ${p(c2)} ${p(p2)}`;
  }
  return `${d}Z`;
}

/** «Клякса»: the same seed always gives the same blob. */
function blob(seed: number, complexity: number, w: number, h: number): string {
  const rng = createRng(seed);
  const raw = Array.from({ length: complexity }, (_, i) => {
    const a = -Math.PI / 2 + ((i + (rng.next() - 0.5) * 0.5) * 2 * Math.PI) / complexity;
    const r = 0.65 + rng.next() * 0.35;
    return { x: Math.cos(a) * r, y: Math.sin(a) * r };
  });
  return fitPath(smoothClosed(raw), w, h);
}

/** Stretches a finished contour so that its curves (not just its points) fill 0…w × 0…h. */
function fitPath(d: string, w: number, h: number): string {
  const segs = parsePath(d);
  const xs: number[] = [];
  const ys: number[] = [];
  let x0 = 0;
  let y0 = 0;
  for (const s of segs) {
    if (s.c === 'Z') continue;
    if (s.c === 'C') {
      for (let i = 1; i <= 16; i++) {
        const t = i / 16;
        const m = 1 - t;
        xs.push(m * m * m * x0 + 3 * m * m * t * s.x1 + 3 * m * t * t * s.x2 + t * t * t * s.x);
        ys.push(m * m * m * y0 + 3 * m * m * t * s.y1 + 3 * m * t * t * s.y2 + t * t * t * s.y);
      }
    } else {
      xs.push(s.x);
      ys.push(s.y);
    }
    x0 = s.x;
    y0 = s.y;
  }
  const [minX, maxX, minY, maxY] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  return serializePath(transformPath(segs, (x) => ((x - minX) / (maxX - minX || 1)) * w, (y) => ((y - minY) / (maxY - minY || 1)) * h));
}

type Edge = 'top' | 'right' | 'bottom' | 'left';

/** Speech bubble (S-02): rounded body and a tail towards any point of the block. */
function bubble(tail: Pt, tailWidth: number, w: number, h: number): string {
  const side: Edge = tail.y >= 0.75 ? 'bottom' : tail.y <= 0.25 ? 'top' : tail.x >= 0.75 ? 'right' : tail.x <= 0.25 ? 'left' : 'bottom';
  const zone = 0.2;
  const body = {
    x0: side === 'left' ? w * zone : 0,
    y0: side === 'top' ? h * zone : 0,
    x1: side === 'right' ? w * (1 - zone) : w,
    y1: side === 'bottom' ? h * (1 - zone) : h,
  };
  const bw = body.x1 - body.x0;
  const bh = body.y1 - body.y0;
  const r = Math.min(bw, bh) * 0.22;
  // The tip lies in the tail zone; a point inside the body is moved to the edge of the block.
  const tip = {
    x: side === 'left' ? (tail.x * w < body.x0 ? tail.x * w : 0) : side === 'right' ? (tail.x * w > body.x1 ? tail.x * w : w) : tail.x * w,
    y: side === 'top' ? (tail.y * h < body.y0 ? tail.y * h : 0) : side === 'bottom' ? (tail.y * h > body.y1 ? tail.y * h : h) : tail.y * h,
  };
  const horizontal = side === 'top' || side === 'bottom';
  const len = horizontal ? bw : bh;
  const half = (tailWidth * len) / 2;
  const along = horizontal ? tip.x - body.x0 : tip.y - body.y0;
  const center = Math.min(len - r - half, Math.max(r + half, along));
  const tailOn = (edge: Edge): string => {
    if (edge !== side) return '';
    const pts =
      edge === 'top'
        ? [{ x: body.x0 + center - half, y: body.y0 }, tip, { x: body.x0 + center + half, y: body.y0 }]
        : edge === 'right'
          ? [{ x: body.x1, y: body.y0 + center - half }, tip, { x: body.x1, y: body.y0 + center + half }]
          : edge === 'bottom'
            ? [{ x: body.x0 + center + half, y: body.y1 }, tip, { x: body.x0 + center - half, y: body.y1 }]
            : [{ x: body.x0, y: body.y0 + center + half }, tip, { x: body.x0, y: body.y0 + center - half }];
    return pts.map((q) => `L${p(q)}`).join('');
  };
  const a = (to: Pt) => `A${fmt(r)} ${fmt(r)} 0 0 1 ${p(to)}`;
  return [
    `M${p({ x: body.x0 + r, y: body.y0 })}`,
    tailOn('top'),
    `L${p({ x: body.x1 - r, y: body.y0 })}`,
    a({ x: body.x1, y: body.y0 + r }),
    tailOn('right'),
    `L${p({ x: body.x1, y: body.y1 - r })}`,
    a({ x: body.x1 - r, y: body.y1 }),
    tailOn('bottom'),
    `L${p({ x: body.x0 + r, y: body.y1 })}`,
    a({ x: body.x0, y: body.y1 - r }),
    tailOn('left'),
    `L${p({ x: body.x0, y: body.y0 + r })}`,
    a({ x: body.x0 + r, y: body.y0 }),
    'Z',
  ].join('');
}

/** Arrow to the right (S-02): shaft thickness and head form. */
function arrow(thickness: number, head: 'triangle' | 'round' | 'chevron', w: number, h: number): string {
  const headLen = Math.min(w * 0.5, h);
  const hx = w - headLen;
  const y1 = (h * (1 - thickness)) / 2;
  const y2 = (h * (1 + thickness)) / 2;
  if (head === 'round') return `M0 ${fmt(y1)}L${fmt(hx)} ${fmt(y1)}L${fmt(hx)} 0A${fmt(headLen)} ${fmt(h / 2)} 0 0 1 ${fmt(hx)} ${fmt(h)}L${fmt(hx)} ${fmt(y2)}L0 ${fmt(y2)}Z`;
  const back = head === 'chevron' ? headLen * 0.35 : 0;
  return `M0 ${fmt(y1)}L${fmt(hx)} ${fmt(y1)}L${fmt(hx - back)} 0L${fmt(w)} ${fmt(h / 2)}L${fmt(hx - back)} ${fmt(h)}L${fmt(hx)} ${fmt(y2)}L0 ${fmt(y2)}Z`;
}

/** Rectangle whose chosen edges are a wave or a zigzag (S-02); the shape stays inside the block. */
function wave(shape: Extract<Shape, { kind: 'wave' }>, w: number, h: number): string {
  const A = shape.amplitude * Math.min(w, h);
  const has = (e: Edge) => shape.edges.includes(e);
  const inset = { top: has('top') ? A : 0, right: has('right') ? A : 0, bottom: has('bottom') ? A : 0, left: has('left') ? A : 0 };
  const corners: Record<'tl' | 'tr' | 'br' | 'bl', Pt> = {
    tl: { x: inset.left, y: inset.top },
    tr: { x: w - inset.right, y: inset.top },
    br: { x: w - inset.right, y: h - inset.bottom },
    bl: { x: inset.left, y: h - inset.bottom },
  };
  // Outward normal of each edge in clockwise order.
  const edges: Array<[Edge, Pt, Pt, Pt]> = [
    ['top', corners.tl, corners.tr, { x: 0, y: -1 }],
    ['right', corners.tr, corners.br, { x: 1, y: 0 }],
    ['bottom', corners.br, corners.bl, { x: 0, y: 1 }],
    ['left', corners.bl, corners.tl, { x: -1, y: 0 }],
  ];
  let d = `M${p(corners.tl)}`;
  for (const [edge, from, to, nrm] of edges) {
    if (!has(edge) || A === 0) {
      d += `L${p(to)}`;
      continue;
    }
    const halves = shape.frequency * 2;
    for (let k = 0; k < halves; k++) {
      const t0 = k / halves;
      const t1 = (k + 1) / halves;
      const sign = k % 2 === 0 ? 1 : -1;
      const mid = { x: from.x + (to.x - from.x) * ((t0 + t1) / 2), y: from.y + (to.y - from.y) * ((t0 + t1) / 2) };
      const end = { x: from.x + (to.x - from.x) * t1, y: from.y + (to.y - from.y) * t1 };
      if (shape.zigzag) d += `L${p({ x: mid.x + nrm.x * A * sign, y: mid.y + nrm.y * A * sign })}L${p(end)}`;
      else d += `Q${p({ x: mid.x + nrm.x * 2 * A * sign, y: mid.y + nrm.y * 2 * A * sign })} ${p(end)}`;
    }
  }
  return `${d}Z`;
}

const pathCache = new Map<string, ReturnType<typeof parsePath>>();

/** Custom contour (normalised 0…100) stretched to the block. */
function customPath(d: string, closed: boolean, w: number, h: number): string {
  let segs = pathCache.get(d);
  if (!segs) {
    segs = parsePath(d);
    if (pathCache.size > 500) pathCache.clear();
    pathCache.set(d, segs);
  }
  const out = serializePath(transformPath(segs, (x) => (x / 100) * w, (y) => (y / 100) * h));
  return closed && !out.endsWith('Z') ? `${out}Z` : out;
}

/**
 * Outline of a block of size w×h units (S-02, S-03): the one contour used for clipping, the stroke along
 * the contour (S-05), contour shadows and masks.
 */
export function shapeOutline(shape: Shape, radius: Radius, w: number, h: number): string {
  switch (shape.kind) {
    case 'rect':
      return roundedRect(w, h, cornerRadii(radius, w, h));
    case 'pill': {
      const r = Math.min(w, h) / 2;
      return roundedRect(w, h, Array.from({ length: 4 }, () => ({ rx: r, ry: r })));
    }
    case 'ellipse':
      return `M0 ${fmt(h / 2)}A${fmt(w / 2)} ${fmt(h / 2)} 0 1 1 ${fmt(w)} ${fmt(h / 2)}A${fmt(w / 2)} ${fmt(h / 2)} 0 1 1 0 ${fmt(h / 2)}Z`;
    case 'polygon':
      return roundedPolygon(fit(radialPoints(shape.sides, () => 1), w, h), shape.cornerRadius);
    case 'star':
      return roundedPolygon(fit(radialPoints(shape.points * 2, (i) => (i % 2 === 0 ? 1 : 1 - shape.depth)), w, h), shape.cornerRadius);
    case 'heart':
      return customPath(HEART, true, w, h);
    case 'blob':
      return blob(shape.seed, shape.complexity, w, h);
    case 'bubble':
      return bubble(shape.tail, shape.tailWidth, w, h);
    case 'arrow':
      return arrow(shape.thickness, shape.head, w, h);
    case 'wave':
      return wave(shape, w, h);
    case 'path':
      return customPath(shape.d, shape.closed, w, h);
  }
}

/** CSS `border-radius` for the shapes CSS draws itself; rectangles use the radius group as is (CSS clamps it). */
export function cssShapeRadius(shape: Shape, w: number, h: number, unit: (n: number) => string, rectRadius: string): string {
  if (shape.kind === 'ellipse') return '50%';
  if (shape.kind === 'pill') return unit(Math.min(w, h) / 2);
  return rectRadius;
}
