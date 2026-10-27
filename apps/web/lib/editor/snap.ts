import { type Point, type Rect } from './geometry';

/** E-06 · step of the grid, units. */
export const GRID = 8;
/** Distance in screen pixels within which a block is pulled to a line. */
export const SNAP_PX = 6;

export interface Guide {
  axis: 'x' | 'y';
  /** Position of the line on the artboard. */
  at: number;
  /** Extent of the line along the other axis. */
  from: number;
  to: number;
  /** What the line was matched with. */
  kind: 'artboard' | 'block' | 'grid';
}

export interface Gap {
  axis: 'x' | 'y';
  /** Segment on the artboard that shows the distance. */
  from: Point;
  to: Point;
  value: number;
}

export interface SnapResult {
  dx: number;
  dy: number;
  guides: Guide[];
  gaps: Gap[];
}

export interface SnapOptions {
  artboard: { w: number; h: number };
  /** Rectangles of the other blocks on the screen. */
  others: readonly Rect[];
  grid: boolean;
  /** Threshold in units (pixels / pixels per unit). */
  threshold: number;
}

interface Line {
  at: number;
  kind: Guide['kind'];
  /** Extent of the rectangle the line comes from. */
  from: number;
  to: number;
}

const near = (a: number, b: number): boolean => Math.abs(a - b) < 1e-6;

function linesOf(axis: 'x' | 'y', o: SnapOptions): Line[] {
  const size = axis === 'x' ? o.artboard.w : o.artboard.h;
  const other = axis === 'x' ? o.artboard.h : o.artboard.w;
  const lines: Line[] = [0, size / 2, size].map((at) => ({ at, kind: 'artboard' as const, from: 0, to: other }));
  for (const r of o.others) {
    const start = axis === 'x' ? r.x : r.y;
    const len = axis === 'x' ? r.w : r.h;
    const from = axis === 'x' ? r.y : r.x;
    const to = from + (axis === 'x' ? r.h : r.w);
    for (const at of [start, start + len / 2, start + len]) lines.push({ at, kind: 'block', from, to });
  }
  return lines;
}

/** The smallest shift of `edges` (left/centre/right or top/middle/bottom) that puts one of them on a line, if any. */
function bestShift(edges: readonly number[], lines: readonly Line[], gridEdge: number | null, threshold: number): { shift: number; matched: Line[] } | null {
  let shift = Number.POSITIVE_INFINITY;
  let matched: Line[] = [];
  for (const e of edges) {
    for (const l of lines) {
      const s = l.at - e;
      if (Math.abs(s) > threshold) continue;
      if (Math.abs(s) < Math.abs(shift) - 1e-6) {
        shift = s;
        matched = [l];
      } else if (near(s, shift)) {
        matched.push(l);
      }
    }
  }
  if (gridEdge !== null) {
    const snapped = Math.round(gridEdge / GRID) * GRID;
    const s = snapped - gridEdge;
    // Blocks and the artboard win over the grid when both are as close.
    if (Math.abs(s) <= threshold && Math.abs(s) < Math.abs(shift) - 1e-6) {
      shift = s;
      matched = [{ at: snapped, kind: 'grid', from: 0, to: 0 }];
    }
  }
  return matched.length > 0 ? { shift, matched } : null;
}

/**
 * E-06 · where a moving rectangle lands when it is pulled to the edges and centre of the artboard, of other blocks and
 * (with the grid on) to the 8-unit grid. Returns the correction, the guide lines to draw and the distances to the
 * nearest blocks. `dx`/`dy` are zero when nothing is close.
 */
export function snapRect(moving: Rect, options: SnapOptions): SnapResult {
  const xs = [moving.x, moving.x + moving.w / 2, moving.x + moving.w];
  const ys = [moving.y, moving.y + moving.h / 2, moving.y + moving.h];
  const bx = bestShift(xs, linesOf('x', options), options.grid ? moving.x : null, options.threshold);
  const by = bestShift(ys, linesOf('y', options), options.grid ? moving.y : null, options.threshold);
  const dx = bx?.shift ?? 0;
  const dy = by?.shift ?? 0;
  const placed: Rect = { ...moving, x: moving.x + dx, y: moving.y + dy };
  const guides: Guide[] = [];
  for (const [axis, hit] of [['x', bx], ['y', by]] as const) {
    if (!hit) continue;
    for (const line of hit.matched) {
      const mFrom = axis === 'x' ? placed.y : placed.x;
      const mTo = mFrom + (axis === 'x' ? placed.h : placed.w);
      const full = line.kind === 'grid';
      guides.push({
        axis,
        at: line.at,
        from: full ? 0 : Math.min(mFrom, line.from),
        to: full ? (axis === 'x' ? options.artboard.h : options.artboard.w) : Math.max(mTo, line.to),
        kind: line.kind,
      });
    }
  }
  return { dx, dy, guides, gaps: guides.length > 0 ? measureGaps(placed, options) : [] };
}

/** Distances from a rectangle to the nearest neighbour (or the artboard edge) on each side, where they face each other. */
export function measureGaps(r: Rect, o: Pick<SnapOptions, 'artboard' | 'others'>): Gap[] {
  const gaps: Gap[] = [];
  const midY = r.y + r.h / 2;
  const midX = r.x + r.w / 2;
  const facingY = (b: Rect) => b.y < r.y + r.h && r.y < b.y + b.h;
  const facingX = (b: Rect) => b.x < r.x + r.w && r.x < b.x + b.w;
  const left = o.others.filter((b) => facingY(b) && b.x + b.w <= r.x).sort((a, b) => b.x + b.w - (a.x + a.w))[0];
  const right = o.others.filter((b) => facingY(b) && b.x >= r.x + r.w).sort((a, b) => a.x - b.x)[0];
  const above = o.others.filter((b) => facingX(b) && b.y + b.h <= r.y).sort((a, b) => b.y + b.h - (a.y + a.h))[0];
  const below = o.others.filter((b) => facingX(b) && b.y >= r.y + r.h).sort((a, b) => a.y - b.y)[0];
  const add = (axis: 'x' | 'y', a: number, b: number, cross: number) => {
    const value = Math.round((b - a) * 10) / 10;
    if (value > 0) gaps.push({ axis, from: axis === 'x' ? { x: a, y: cross } : { x: cross, y: a }, to: axis === 'x' ? { x: b, y: cross } : { x: cross, y: b }, value });
  };
  add('x', left ? left.x + left.w : 0, r.x, midY);
  add('x', r.x + r.w, right ? right.x : o.artboard.w, midY);
  add('y', above ? above.y + above.h : 0, r.y, midX);
  add('y', r.y + r.h, below ? below.y : o.artboard.h, midX);
  return gaps;
}

/** E-06 · pulls single edges (the ones a resize handle moves) to the lines of the artboard, blocks and grid. */
export function snapEdges(axis: 'x' | 'y', edges: readonly number[], options: SnapOptions): { shift: number; guides: Guide[] } {
  if (edges.length === 0) return { shift: 0, guides: [] };
  const hit = bestShift(edges, linesOf(axis, options), options.grid ? edges[0]! : null, options.threshold);
  if (!hit) return { shift: 0, guides: [] };
  const extent = axis === 'x' ? options.artboard.h : options.artboard.w;
  return { shift: hit.shift, guides: hit.matched.map((l) => ({ axis, at: l.at, from: l.kind === 'grid' ? 0 : l.from, to: l.kind === 'grid' ? extent : l.to, kind: l.kind })) };
}
