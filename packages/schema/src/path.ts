/**
 * Custom contours of blocks (S-02 «произвольный контур», E-21 import). Only SVG path commands
 * M L H V C S Q T A Z with numbers are allowed — no `url(`, scripts or entities. A contour is normalised
 * into the 0…100 box with only absolute M, L, C and Z, so it can be stretched to any block exactly.
 */

/** Longest contour the editor accepts, characters (S-02). */
export const MAX_PATH_LENGTH = 20_000;
/** Most path segments after parsing — protects the renderer from enormous contours. */
export const MAX_PATH_SEGMENTS = 4_000;
/** Largest absolute coordinate in an imported contour. */
export const MAX_PATH_NUMBER = 1_000_000;

export class PathError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PathError';
  }
}

type Cmd = 'M' | 'L' | 'H' | 'V' | 'C' | 'S' | 'Q' | 'T' | 'A' | 'Z';
const ARGS: Record<Cmd, number> = { M: 2, L: 2, H: 1, V: 1, C: 6, S: 4, Q: 4, T: 2, A: 7, Z: 0 };

/** A normalised segment: absolute move, line, cubic curve or close. */
export type Segment = { c: 'M' | 'L'; x: number; y: number } | { c: 'C'; x1: number; y1: number; x2: number; y2: number; x: number; y: number } | { c: 'Z' };

const TOKEN = /([MLHVCSQTAZmlhvcsqtaz])|([+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?)|([\s,]+)|(.)/gy;

/** Commands with their numbers; throws a Russian `PathError` on anything that is not a plain contour. */
export function tokenizePath(d: string): Array<{ cmd: string; args: number[] }> {
  if (d.length > MAX_PATH_LENGTH) throw new PathError(`Контур длиннее ${MAX_PATH_LENGTH} символов`);
  const out: Array<{ cmd: string; args: number[] }> = [];
  TOKEN.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = TOKEN.exec(d)) !== null) {
    if (m[4] !== undefined) throw new PathError('Контур содержит недопустимые символы: разрешены только команды M L H V C S Q T A Z и числа');
    if (m[1] !== undefined) out.push({ cmd: m[1], args: [] });
    else if (m[2] !== undefined) {
      const n = Number(m[2]);
      if (!Number.isFinite(n) || Math.abs(n) > MAX_PATH_NUMBER) throw new PathError('Контур содержит слишком большие числа');
      const last = out[out.length - 1];
      if (!last) throw new PathError('Контур должен начинаться с команды M');
      last.args.push(n);
    }
  }
  if (out.length === 0) throw new PathError('Контур пустой');
  if (out[0]!.cmd.toUpperCase() !== 'M') throw new PathError('Контур должен начинаться с команды M');
  return out;
}

/** Arc (A) → cubic curves (SVG implementation notes, F.6.5). */
function arcToCubics(x1: number, y1: number, rxIn: number, ryIn: number, angle: number, large: number, sweep: number, x2: number, y2: number): Segment[] {
  if (rxIn === 0 || ryIn === 0 || (x1 === x2 && y1 === y2)) return [{ c: 'L', x: x2, y: y2 }];
  let rx = Math.abs(rxIn);
  let ry = Math.abs(ryIn);
  const phi = (angle * Math.PI) / 180;
  const cos = Math.cos(phi);
  const sin = Math.sin(phi);
  const dx = (x1 - x2) / 2;
  const dy = (y1 - y2) / 2;
  const xp = cos * dx + sin * dy;
  const yp = -sin * dx + cos * dy;
  const lambda = (xp * xp) / (rx * rx) + (yp * yp) / (ry * ry);
  if (lambda > 1) {
    rx *= Math.sqrt(lambda);
    ry *= Math.sqrt(lambda);
  }
  const sign = large === sweep ? -1 : 1;
  const num = rx * rx * ry * ry - rx * rx * yp * yp - ry * ry * xp * xp;
  const coef = sign * Math.sqrt(Math.max(0, num / (rx * rx * yp * yp + ry * ry * xp * xp)));
  const cxp = (coef * rx * yp) / ry;
  const cyp = (-coef * ry * xp) / rx;
  const cx = cos * cxp - sin * cyp + (x1 + x2) / 2;
  const cy = sin * cxp + cos * cyp + (y1 + y2) / 2;
  const ang = (ux: number, uy: number, vx: number, vy: number) => {
    const a = Math.atan2(ux * vy - uy * vx, ux * vx + uy * vy);
    return a;
  };
  const t1 = ang(1, 0, (xp - cxp) / rx, (yp - cyp) / ry);
  let dt = ang((xp - cxp) / rx, (yp - cyp) / ry, (-xp - cxp) / rx, (-yp - cyp) / ry);
  if (!sweep && dt > 0) dt -= 2 * Math.PI;
  if (sweep && dt < 0) dt += 2 * Math.PI;
  const parts = Math.max(1, Math.ceil(Math.abs(dt) / (Math.PI / 2)));
  const delta = dt / parts;
  const k = (4 / 3) * Math.tan(delta / 4);
  const point = (t: number) => ({ x: cx + rx * Math.cos(t) * cos - ry * Math.sin(t) * sin, y: cy + rx * Math.cos(t) * sin + ry * Math.sin(t) * cos });
  const deriv = (t: number) => ({ x: -rx * Math.sin(t) * cos - ry * Math.cos(t) * sin, y: -rx * Math.sin(t) * sin + ry * Math.cos(t) * cos });
  const out: Segment[] = [];
  for (let i = 0; i < parts; i++) {
    const a = t1 + i * delta;
    const b = a + delta;
    const p1 = point(a);
    const p2 = point(b);
    const d1 = deriv(a);
    const d2 = deriv(b);
    out.push({ c: 'C', x1: p1.x + k * d1.x, y1: p1.y + k * d1.y, x2: p2.x - k * d2.x, y2: p2.y - k * d2.y, x: p2.x, y: p2.y });
  }
  const last = out[out.length - 1] as Extract<Segment, { c: 'C' }>;
  last.x = x2;
  last.y = y2;
  return out;
}

/** Any valid contour → absolute M, L, C, Z segments (relative commands, shorthands and arcs resolved). */
export function parsePath(d: string): Segment[] {
  const tokens = tokenizePath(d);
  const segs: Segment[] = [];
  let x = 0;
  let y = 0;
  let sx = 0;
  let sy = 0;
  let lastC: { x: number; y: number } | null = null;
  let lastQ: { x: number; y: number } | null = null;
  for (const { cmd, args } of tokens) {
    const C = cmd.toUpperCase() as Cmd;
    const rel = cmd !== C;
    const n = ARGS[C];
    if (C === 'Z') {
      if (args.length) throw new PathError('После команды Z не должно быть чисел');
      segs.push({ c: 'Z' });
      x = sx;
      y = sy;
      lastC = lastQ = null;
      continue;
    }
    if (args.length === 0 || args.length % n !== 0) throw new PathError(`У команды ${cmd} неверное количество чисел`);
    for (let i = 0; i < args.length; i += n) {
      const a = args.slice(i, i + n);
      const ox = rel ? x : 0;
      const oy = rel ? y : 0;
      let curC: { x: number; y: number } | null = null;
      let curQ: { x: number; y: number } | null = null;
      switch (C) {
        case 'M': {
          const cmdHere = i === 0 ? 'M' : 'L';
          x = ox + a[0]!;
          y = oy + a[1]!;
          if (cmdHere === 'M') {
            sx = x;
            sy = y;
          }
          segs.push({ c: cmdHere, x, y });
          break;
        }
        case 'L':
          x = ox + a[0]!;
          y = oy + a[1]!;
          segs.push({ c: 'L', x, y });
          break;
        case 'H':
          x = (rel ? x : 0) + a[0]!;
          segs.push({ c: 'L', x, y });
          break;
        case 'V':
          y = (rel ? y : 0) + a[0]!;
          segs.push({ c: 'L', x, y });
          break;
        case 'C': {
          const s: Segment = { c: 'C', x1: ox + a[0]!, y1: oy + a[1]!, x2: ox + a[2]!, y2: oy + a[3]!, x: ox + a[4]!, y: oy + a[5]! };
          segs.push(s);
          curC = { x: s.x2, y: s.y2 };
          x = s.x;
          y = s.y;
          break;
        }
        case 'S': {
          const r: { x: number; y: number } = lastC ? { x: 2 * x - lastC.x, y: 2 * y - lastC.y } : { x, y };
          const s: Segment = { c: 'C', x1: r.x, y1: r.y, x2: ox + a[0]!, y2: oy + a[1]!, x: ox + a[2]!, y: oy + a[3]! };
          segs.push(s);
          curC = { x: s.x2, y: s.y2 };
          x = s.x;
          y = s.y;
          break;
        }
        case 'Q':
        case 'T': {
          const q: { x: number; y: number } = C === 'Q' ? { x: ox + a[0]!, y: oy + a[1]! } : lastQ ? { x: 2 * x - lastQ.x, y: 2 * y - lastQ.y } : { x, y };
          const ex = ox + a[C === 'Q' ? 2 : 0]!;
          const ey = oy + a[C === 'Q' ? 3 : 1]!;
          segs.push({ c: 'C', x1: x + (2 / 3) * (q.x - x), y1: y + (2 / 3) * (q.y - y), x2: ex + (2 / 3) * (q.x - ex), y2: ey + (2 / 3) * (q.y - ey), x: ex, y: ey });
          curQ = q;
          x = ex;
          y = ey;
          break;
        }
        case 'A': {
          const ex = ox + a[5]!;
          const ey = oy + a[6]!;
          segs.push(...arcToCubics(x, y, a[0]!, a[1]!, a[2]!, a[3]! ? 1 : 0, a[4]! ? 1 : 0, ex, ey));
          x = ex;
          y = ey;
          break;
        }
      }
      lastC = curC;
      lastQ = curQ;
      if (segs.length > MAX_PATH_SEGMENTS) throw new PathError(`В контуре больше ${MAX_PATH_SEGMENTS} отрезков`);
    }
  }
  return segs;
}

/** Bounding box of the segments (control points included — enough to fit a contour into a box). */
function bounds(segs: readonly Segment[]): { x: number; y: number; w: number; h: number } {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  const add = (px: number, py: number) => {
    minX = Math.min(minX, px);
    minY = Math.min(minY, py);
    maxX = Math.max(maxX, px);
    maxY = Math.max(maxY, py);
  };
  for (const s of segs) {
    if (s.c === 'Z') continue;
    add(s.x, s.y);
    if (s.c === 'C') {
      add(s.x1, s.y1);
      add(s.x2, s.y2);
    }
  }
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

const fmt = (n: number) => String(Math.round(n * 100) / 100);

/** Segments → path data. */
export function serializePath(segs: readonly Segment[]): string {
  return segs.map((s) => (s.c === 'Z' ? 'Z' : s.c === 'C' ? `C${fmt(s.x1)} ${fmt(s.y1)} ${fmt(s.x2)} ${fmt(s.y2)} ${fmt(s.x)} ${fmt(s.y)}` : `${s.c}${fmt(s.x)} ${fmt(s.y)}`)).join('');
}

/** Maps every point of the segments (used to stretch a normalised contour to a block). */
export function transformPath(segs: readonly Segment[], fx: (x: number) => number, fy: (y: number) => number): Segment[] {
  return segs.map((s) => (s.c === 'Z' ? s : s.c === 'C' ? { c: 'C', x1: fx(s.x1), y1: fy(s.y1), x2: fx(s.x2), y2: fy(s.y2), x: fx(s.x), y: fy(s.y) } : { c: s.c, x: fx(s.x), y: fy(s.y) }));
}

/**
 * Contour from the pen, pencil or an imported SVG (S-02, E-21) → canonical form in the 0…100 box:
 * absolute M/L/C/Z only, two decimals. A flat contour (zero width or height) is rejected.
 */
export function normalizePath(d: string): string {
  const segs = parsePath(d);
  const b = bounds(segs);
  if (!(b.w > 0) || !(b.h > 0)) throw new PathError('Контур плоский: у него нет ширины или высоты');
  return serializePath(transformPath(segs, (x) => ((x - b.x) / b.w) * 100, (y) => ((y - b.y) / b.h) * 100));
}

/** True when the contour can be parsed (for schema refinement). */
export function isValidPath(d: string): boolean {
  try {
    parsePath(d);
    return true;
  } catch {
    return false;
  }
}
