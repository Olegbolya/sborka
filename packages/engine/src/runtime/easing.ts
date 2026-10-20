import { type Easing } from '@blokum/schema';

const PRESETS: Record<Extract<Easing, { kind: 'preset' }>['name'], [number, number, number, number]> = {
  linear: [0, 0, 1, 1],
  ease: [0.25, 0.1, 0.25, 1],
  easeIn: [0.42, 0, 1, 1],
  easeOut: [0, 0, 0.58, 1],
  easeInOut: [0.42, 0, 0.58, 1],
};

/** Cubic Bézier timing function (as in CSS): Newton steps with a bisection fallback. */
function bezier(x1: number, y1: number, x2: number, y2: number): (t: number) => number {
  const cx = 3 * x1;
  const bx = 3 * (x2 - x1) - cx;
  const ax = 1 - cx - bx;
  const cy = 3 * y1;
  const by = 3 * (y2 - y1) - cy;
  const ay = 1 - cy - by;
  const sx = (t: number) => ((ax * t + bx) * t + cx) * t;
  const sy = (t: number) => ((ay * t + by) * t + cy) * t;
  const dx = (t: number) => (3 * ax * t + 2 * bx) * t + cx;
  return (x) => {
    let t = x;
    for (let i = 0; i < 8; i++) {
      const err = sx(t) - x;
      const d = dx(t);
      if (Math.abs(err) < 1e-6) return sy(t);
      if (Math.abs(d) < 1e-6) break;
      t -= err / d;
    }
    let lo = 0;
    let hi = 1;
    t = x;
    for (let i = 0; i < 30; i++) {
      if (sx(t) < x) lo = t;
      else hi = t;
      t = (lo + hi) / 2;
    }
    return sy(t);
  };
}

/** Damped spring (mass 1) sampled over the tween duration; the tween snaps to the end value when it ends. */
function spring(stiffness: number, damping: number, durationMs: number): (t: number) => number {
  const w0 = Math.sqrt(stiffness);
  const zeta = damping / (2 * w0);
  return (p) => {
    const t = (p * durationMs) / 1000;
    if (zeta < 1) {
      const wd = w0 * Math.sqrt(1 - zeta * zeta);
      return 1 - Math.exp(-zeta * w0 * t) * (Math.cos(wd * t) + ((zeta * w0) / wd) * Math.sin(wd * t));
    }
    return 1 - Math.exp(-w0 * t) * (1 + w0 * t);
  };
}

/** Progress 0…1 → eased progress (may overshoot for springs and some curves). */
export function easingFunction(easing: Easing | undefined, durationMs: number): (t: number) => number {
  const e = easing ?? { kind: 'preset', name: 'easeOut' };
  if (e.kind === 'spring') return spring(e.stiffness, e.damping, durationMs);
  const [x1, y1, x2, y2] = e.kind === 'preset' ? PRESETS[e.name] : [e.x1, e.y1, e.x2, e.y2];
  if (x1 === 0 && y1 === 0 && x2 === 1 && y2 === 1) return (t) => t;
  return bezier(x1, y1, x2, y2);
}
