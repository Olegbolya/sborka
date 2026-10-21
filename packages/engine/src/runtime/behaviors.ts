import { type Behavior, type Block, parsePath } from '@blokum/schema';
import { type Rng, type RandomSource } from '../random.js';
import { type Box } from './grid.js';

/**
 * Pure geometry of behaviors (BH-01…BH-08): the runtime keeps the state, these functions only compute.
 * All coordinates are artboard units; angles are degrees, 0° to the right, 90° down (screen y grows down).
 */

export type BehaviorOf<K extends Behavior['kind']> = Extract<Behavior, { kind: K }>;

export const behaviorOf = <K extends Behavior['kind']>(block: Block, kind: K): BehaviorOf<K> | undefined => block.behaviors.find((b): b is BehaviorOf<K> => b.kind === kind);

const clamp = (v: number, lo: number, hi: number) => (hi < lo ? lo : Math.min(hi, Math.max(lo, v)));

/** BH-01: the new position of a dragged block — only along its axis and inside its bounds (parent units). */
export function constrainDrag(drag: BehaviorOf<'drag'>, start: { x: number; y: number }, to: { x: number; y: number }, size: { w: number; h: number }): { x: number; y: number } {
  let x = drag.axis === 'y' ? start.x : to.x;
  let y = drag.axis === 'x' ? start.y : to.y;
  if (drag.bounds) {
    x = clamp(x, drag.bounds.x, drag.bounds.x + drag.bounds.w - size.w);
    y = clamp(y, drag.bounds.y, drag.bounds.y + drag.bounds.h - size.h);
  }
  return { x, y };
}

/**
 * BH-02: where a fleeing block runs to (absolute box): away from the pointer by 1.6 × the distance, inside the
 * area; of 12 directions the one that ends farthest from the pointer wins (ties — by the seeded generator).
 */
export function fleeTarget(box: Box, pointer: { x: number; y: number }, distance: number, area: Box, rng: Rng): { x: number; y: number } {
  const cx = box.x + box.w / 2;
  const cy = box.y + box.h / 2;
  const away = Math.atan2(cy - pointer.y, cx - pointer.x);
  let best: { x: number; y: number; score: number } | null = null;
  for (let i = 0; i < 12; i++) {
    const a = away + ((i % 2 === 0 ? 1 : -1) * Math.ceil(i / 2) * Math.PI) / 6 + (rng.next() - 0.5) * 0.2;
    const tx = clamp(cx + Math.cos(a) * distance * 1.6 - box.w / 2, area.x, area.x + area.w - box.w);
    const ty = clamp(cy + Math.sin(a) * distance * 1.6 - box.h / 2, area.y, area.y + area.h - box.h);
    const score = Math.hypot(tx + box.w / 2 - pointer.x, ty + box.h / 2 - pointer.y);
    if (!best || score > best.score + 1e-6) best = { x: tx, y: ty, score };
  }
  return { x: best!.x, y: best!.y };
}

/** BH-04: starting velocity (units per second) from the direction, speed and random spread. */
export function startVelocity(move: BehaviorOf<'move'>, rng: Rng): { vx: number; vy: number } {
  const angle = ((move.angle + (rng.next() - 0.5) * move.spread) * Math.PI) / 180;
  return { vx: Math.cos(angle) * move.speed, vy: Math.sin(angle) * move.speed };
}

/** Result of meeting the edge of the area (BH-04): new place and velocity, or «удалить». */
export function applyEdge(edge: BehaviorOf<'move'>['edge'], p: { x: number; y: number; vx: number; vy: number; ay: number }, size: { w: number; h: number }, area: Box): { x: number; y: number; vx: number; vy: number; ay: number } | 'destroy' {
  const r = { ...p };
  const right = area.x + area.w - size.w;
  const bottom = area.y + area.h - size.h;
  switch (edge) {
    case 'bounce':
      if (r.x < area.x) [r.x, r.vx] = [area.x, Math.abs(r.vx)];
      if (r.x > right) [r.x, r.vx] = [right, -Math.abs(r.vx)];
      if (r.y < area.y) [r.y, r.vy] = [area.y, Math.abs(r.vy)];
      if (r.y > bottom) [r.y, r.vy] = [bottom, -Math.abs(r.vy)];
      return r;
    case 'stop':
      if (r.x < area.x || r.x > right || r.y < area.y || r.y > bottom) return { x: clamp(r.x, area.x, right), y: clamp(r.y, area.y, bottom), vx: 0, vy: 0, ay: 0 };
      return r;
    case 'wrap':
      if (r.x > area.x + area.w) r.x = area.x - size.w;
      else if (r.x + size.w < area.x) r.x = area.x + area.w;
      if (r.y > area.y + area.h) r.y = area.y - size.h;
      else if (r.y + size.h < area.y) r.y = area.y + area.h;
      return r;
    case 'destroy':
      return r.x > area.x + area.w || r.x + size.w < area.x || r.y > area.y + area.h || r.y + size.h < area.y ? 'destroy' : r;
  }
}

/** A contour sampled by length (BH-04 «по своему контуру»): points relative to its start and their distances. */
export interface PathTrack {
  points: Array<{ x: number; y: number }>;
  /** Distance from the start to each point. */
  at: number[];
  length: number;
}

export function pathTrack(d: string): PathTrack {
  const pts: Array<{ x: number; y: number }> = [];
  let x0 = 0;
  let y0 = 0;
  let sx = 0;
  let sy = 0;
  for (const s of parsePath(d)) {
    if (s.c === 'Z') {
      pts.push({ x: sx, y: sy });
      [x0, y0] = [sx, sy];
      continue;
    }
    if (s.c === 'M') {
      if (pts.length === 0) pts.push({ x: s.x, y: s.y });
      [sx, sy] = [s.x, s.y];
    } else if (s.c === 'L') pts.push({ x: s.x, y: s.y });
    else if (s.c === 'C') {
      for (let i = 1; i <= 16; i++) {
        const t = i / 16;
        const m = 1 - t;
        pts.push({ x: m * m * m * x0 + 3 * m * m * t * s.x1 + 3 * m * t * t * s.x2 + t * t * t * s.x, y: m * m * m * y0 + 3 * m * m * t * s.y1 + 3 * m * t * t * s.y2 + t * t * t * s.y });
      }
    }
    [x0, y0] = [s.x, s.y];
  }
  const start = pts[0] ?? { x: 0, y: 0 };
  const points = pts.map((p) => ({ x: p.x - start.x, y: p.y - start.y }));
  const at = [0];
  for (let i = 1; i < points.length; i++) at.push(at[i - 1]! + Math.hypot(points[i]!.x - points[i - 1]!.x, points[i]!.y - points[i - 1]!.y));
  return { points, at, length: at[at.length - 1] ?? 0 };
}

/** Point at a distance along the contour; the motion goes round and round. */
export function pointAt(track: PathTrack, distance: number): { x: number; y: number } {
  if (track.length <= 0 || track.points.length < 2) return track.points[0] ?? { x: 0, y: 0 };
  const s = ((distance % track.length) + track.length) % track.length;
  let i = 1;
  while (i < track.at.length - 1 && track.at[i]! < s) i++;
  const a = track.points[i - 1]!;
  const b = track.points[i]!;
  const span = track.at[i]! - track.at[i - 1]!;
  const t = span > 0 ? (s - track.at[i - 1]!) / span : 0;
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
}

/**
 * BH-06: the drawn sector by weights (the source is the server in the player, RN-01) and the final turn of the
 * wheel that brings its middle under the pointer at the top: sectors go clockwise from the top in their order.
 */
export function spinWheel(wheel: BehaviorOf<'wheel'>, current: number, random: RandomSource): { index: number; rotation: number } {
  const total = wheel.sectors.reduce((s, x) => s + x.weight, 0);
  const last = wheel.sectors.length - 1;
  let index: number;
  if (total > 0) {
    let r = random.next() * total;
    index = wheel.sectors.findIndex((x) => (r -= x.weight) < 0);
    if (index < 0) index = last;
  } else index = Math.min(last, Math.floor(random.next() * wheel.sectors.length));
  const size = 360 / wheel.sectors.length;
  const want = (((360 - (index * size + size / 2)) % 360) + 360) % 360;
  const turns = Math.max(3, Math.round(wheel.spinMs / 1000));
  const base = current - (((current % 360) + 360) % 360);
  return { index, rotation: base + turns * 360 + want };
}

/** BH-08: share of the remaining way covered in `dtMs` with a lag (exponential smoothing; 0 lag — at once). */
export const followShare = (lagMs: number, dtMs: number): number => (lagMs <= 0 ? 1 : 1 - Math.exp(-dtMs / lagMs));
