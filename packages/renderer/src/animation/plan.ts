import { easingFunction } from '@blokum/engine';
import { type Block, type Easing, type MediaByAnswer, type MediaOverlay, type ThemeTokens, type Transition, parsePath } from '@blokum/schema';
import { cssColor } from '../theme/color.js';

/**
 * Animations as data (S-12…S-14, T-01…T-08): what to animate, in which keyframes and for how long.
 * The DOM side (`useBlockAnimation`, `ScreenStage`) only hands these plans to Motion. Values are CSS
 * custom properties of the animated layer, in artboard units and degrees — the layer composes them
 * (see `ANIMATED_LAYER_STYLE`), so animations scale with the artboard like everything else.
 */

export type BlockAnimation = NonNullable<Block['animation']>;
export type EnterAnimation = NonNullable<BlockAnimation['enter']>;
export type LoopAnimation = NonNullable<BlockAnimation['loop']>;
export type PressAnimation = NonNullable<BlockAnimation['press']>;

/** Animatable property → CSS variable of the animated layer and its neutral value. */
export const ANIM_VARS = {
  x: ['--bk-ax', 0],
  y: ['--bk-ay', 0],
  rotation: ['--bk-ar', 0],
  scale: ['--bk-as', 1],
  rotateX: ['--bk-arx', 0],
  rotateY: ['--bk-ary', 0],
  blur: ['--bk-ablur', 0],
  backdropBlur: ['--bk-abblur', 0],
  brightness: ['--bk-abri', 1],
  contrast: ['--bk-acon', 1],
  saturate: ['--bk-asat', 1],
  grayscale: ['--bk-agray', 0],
  hueRotate: ['--bk-ahue', 0],
  opacity: ['opacity', 1],
  w: ['--bk-aw', null],
  h: ['--bk-ah', null],
} as const;

export const TINT_VAR = '--bk-atint';
export const REVEAL_VAR = '--bk-areveal';
export const GLOW_VAR = '--bk-aglow';

type Keyframes = Record<string, Array<number | string>>;

export interface AnimationPlan {
  keyframes: Keyframes;
  /** Seconds. */
  duration: number;
  delay: number;
  ease: (t: number) => number;
  /** Per-property keyframe times (0…1), when not evenly spaced. */
  times?: Record<string, number[]>;
  repeat?: number;
  repeatType?: 'loop' | 'mirror';
  repeatDelay?: number;
  /** Side effects that are not CSS (phone vibration on press, S-14). */
  vibrate?: number;
}

const linear = (t: number) => t;
const steps = (n: number) => (t: number) => (t >= 1 ? 1 : Math.floor(t * n) / n);
const ease = (e: Easing | undefined, ms: number) => easingFunction(e, ms);

/** Offset in units for the 8 directions: the block moves in `direction`, so it starts on the other side. */
export function directionOffset(direction: string, distance: number): { x: number; y: number } {
  const v = { up: [0, 1], down: [0, -1], left: [1, 0], right: [-1, 0], upLeft: [1, 1], upRight: [-1, 1], downLeft: [1, -1], downRight: [-1, -1] }[direction] ?? [0, 1];
  return { x: v[0]! * distance, y: v[1]! * distance };
}

/** S-12 own keyframes: every property keeps its own times; the fill colour goes to the tint layer. */
export function customKeyframes(frames: NonNullable<EnterAnimation['keyframes']>, tokens: Pick<ThemeTokens, 'colors'>): { keyframes: Keyframes; times: Record<string, number[]> } {
  const sorted = [...frames].sort((a, b) => a.at - b.at);
  const keyframes: Keyframes = {};
  const times: Record<string, number[]> = {};
  const push = (name: string, at: number, value: number | string) => {
    (keyframes[name] ??= []).push(value);
    (times[name] ??= []).push(at);
  };
  for (const f of sorted) {
    for (const [prop, value] of Object.entries(f.props) as Array<[keyof typeof ANIM_VARS, number]>) push(ANIM_VARS[prop][0], f.at, value);
    if (f.fill) push(TINT_VAR, f.at, cssColor(f.fill, tokens));
  }
  for (const name of Object.keys(keyframes)) {
    const t = times[name]!;
    const v = keyframes[name]!;
    if (t[0]! > 0) {
      t.unshift(0);
      v.unshift(v[0]!);
    }
    if (t[t.length - 1]! < 1) {
      t.push(1);
      v.push(v[v.length - 1]!);
    }
  }
  return { keyframes, times };
}

/** Animation of appearance (S-12). With «уменьшить движение» every appearance is a short fade (T-31). */
export function enterPlan(anim: EnterAnimation, tokens: Pick<ThemeTokens, 'colors'>, reducedMotion: boolean): AnimationPlan {
  const duration = anim.durationMs / 1000;
  const delay = anim.delayMs / 1000;
  if (reducedMotion) return { keyframes: { opacity: [0, 1] }, duration: 0.2, delay, ease: linear };
  const e = ease(anim.easing, anim.durationMs);
  switch (anim.kind) {
    case 'fade':
      return { keyframes: { opacity: [0, 1] }, duration, delay, ease: e };
    case 'slide': {
      const o = directionOffset(anim.direction, 60);
      return { keyframes: { '--bk-ax': [o.x, 0], '--bk-ay': [o.y, 0], opacity: [0, 1] }, duration, delay, ease: e };
    }
    case 'zoom':
      return { keyframes: { '--bk-as': [0.5, 1], opacity: [0, 1] }, duration, delay, ease: e };
    case 'bounce':
      return {
        keyframes: { '--bk-ay': [-60, 0, -18, 0, -5, 0], opacity: [0, 1, 1, 1, 1, 1] },
        times: { '--bk-ay': [0, 0.45, 0.65, 0.8, 0.9, 1], opacity: [0, 0.2, 0.45, 0.65, 0.8, 1] },
        duration,
        delay,
        ease: linear,
      };
    case 'flip':
      return { keyframes: { '--bk-ary': [90, 0], opacity: [0, 1] }, duration, delay, ease: e };
    case 'rotate':
      return { keyframes: { '--bk-ar': [-180, 0], '--bk-as': [0.4, 1], opacity: [0, 1] }, duration, delay, ease: e };
    case 'typewriter':
      return { keyframes: { [REVEAL_VAR]: [0, 1] }, duration, delay, ease: steps(24) };
    case 'snowflake':
      return {
        keyframes: { '--bk-ay': [-80, 0], '--bk-ax': [-10, 10, -6, 0], '--bk-ar': [-30, 0], opacity: [0, 1, 1, 1] },
        times: { '--bk-ax': [0, 0.35, 0.7, 1], opacity: [0, 0.25, 0.6, 1] },
        duration,
        delay,
        ease: e,
      };
    case 'keyframes': {
      const k = customKeyframes(anim.keyframes!, tokens);
      return { ...k, duration, delay, ease: e };
    }
  }
}

/** Points along a contour in units, relative to its start (S-13 «движение по своему контуру»). */
export function pathPoints(d: string, samples = 48): Array<{ x: number; y: number }> {
  const segs = parsePath(d);
  const pts: Array<{ x: number; y: number }> = [];
  let x0 = 0;
  let y0 = 0;
  for (const s of segs) {
    if (s.c === 'Z') continue;
    if (s.c === 'M') {
      if (pts.length === 0) pts.push({ x: s.x, y: s.y });
    } else if (s.c === 'L') pts.push({ x: s.x, y: s.y });
    else if (s.c === 'C') {
      for (let i = 1; i <= 8; i++) {
        const t = i / 8;
        const m = 1 - t;
        pts.push({ x: m * m * m * x0 + 3 * m * m * t * s.x1 + 3 * m * t * t * s.x2 + t * t * t * s.x, y: m * m * m * y0 + 3 * m * m * t * s.y1 + 3 * m * t * t * s.y2 + t * t * t * s.y });
      }
    }
    x0 = s.x;
    y0 = s.y;
  }
  const step = Math.max(1, Math.floor(pts.length / samples));
  const picked = pts.filter((_, i) => i % step === 0);
  if (picked[picked.length - 1] !== pts[pts.length - 1]) picked.push(pts[pts.length - 1]!);
  const start = picked[0]!;
  return picked.map((q) => ({ x: q.x - start.x, y: q.y - start.y }));
}

/** Endless animation (S-13): speed shortens the cycle, amplitude scales the motion, pause between cycles. */
export function loopPlan(anim: LoopAnimation, tokens: Pick<ThemeTokens, 'colors'>, reducedMotion: boolean): AnimationPlan | null {
  if (reducedMotion) return null;
  const a = anim.amplitude;
  const base: Record<LoopAnimation['kind'], number> = { pulse: 1.2, sway: 2, float: 3, spin: 4, shake: 0.5, blink: 1.5, heartbeat: 1.2, followPath: 4, keyframes: 2 };
  const common = { duration: base[anim.kind] / anim.speed, delay: 0, repeat: Infinity, repeatDelay: anim.pauseMs / 1000 };
  const sine = (t: number) => (1 - Math.cos(Math.PI * t)) / 2;
  switch (anim.kind) {
    case 'pulse':
      return { ...common, keyframes: { '--bk-as': [1, 1 + 0.06 * a, 1] }, ease: sine };
    case 'sway':
      return { ...common, keyframes: { '--bk-ar': [-5 * a, 5 * a] }, ease: sine, repeatType: 'mirror' };
    case 'float':
      return { ...common, keyframes: { '--bk-ay': [0, -8 * a] }, ease: sine, repeatType: 'mirror' };
    case 'spin':
      return { ...common, keyframes: { '--bk-ar': [0, 360] }, ease: linear };
    case 'shake':
      return { ...common, keyframes: { '--bk-ax': [0, -4 * a, 4 * a, -3 * a, 3 * a, 0] }, ease: linear };
    case 'blink':
      return { ...common, keyframes: { opacity: [1, Math.max(0, 1 - 0.7 * a), 1] }, ease: sine };
    case 'heartbeat':
      return { ...common, keyframes: { '--bk-as': [1, 1 + 0.15 * a, 1, 1 + 0.1 * a, 1] }, times: { '--bk-as': [0, 0.15, 0.3, 0.45, 1] }, ease: linear };
    case 'followPath': {
      const pts = pathPoints(anim.path!);
      return { ...common, keyframes: { '--bk-ax': pts.map((q) => q.x * a), '--bk-ay': pts.map((q) => q.y * a) }, ease: linear };
    }
    case 'keyframes':
      return { ...common, ...customKeyframes(anim.keyframes!, tokens), ease: sine };
  }
}

/** Reaction to press and hover (S-14): the plan forward; the block returns to neutral on release. */
export function pressPlan(anim: PressAnimation, tokens: Pick<ThemeTokens, 'colors'>, reducedMotion: boolean): AnimationPlan | null {
  if (reducedMotion) return null;
  const fast = { duration: 0.18, delay: 0, ease: easingFunction({ kind: 'preset', name: 'easeOut' }, 180) };
  switch (anim.kind) {
    case 'grow':
      return { ...fast, keyframes: { '--bk-as': [1, 1.06] } };
    case 'shrink':
      return { ...fast, keyframes: { '--bk-as': [1, 0.94] } };
    case 'glow':
      return { ...fast, keyframes: { [GLOW_VAR]: [0, 14] } };
    case 'bounce':
      return { ...fast, duration: 0.35, keyframes: { '--bk-ay': [0, -8, 0] } };
    case 'vibrate':
      return { ...fast, duration: 0.25, keyframes: { '--bk-ax': [0, -2, 2, -2, 2, 0] }, ease: linear, vibrate: 30 };
    case 'keyframes':
      return { ...fast, duration: 0.3, ...customKeyframes(anim.keyframes!, tokens) };
  }
}

/** Press animations that hold while pressed and spring back on release; the rest play once. */
export const holdsWhilePressed = (anim: PressAnimation): boolean => anim.kind === 'grow' || anim.kind === 'shrink' || anim.kind === 'glow';

/** Neutral values of every variable a plan touches — the state the block returns to. */
export function neutralOf(plan: AnimationPlan): Record<string, number | string> {
  const out: Record<string, number | string> = {};
  for (const name of Object.keys(plan.keyframes)) {
    const entry = Object.values(ANIM_VARS).find(([v]) => v === name);
    out[name] = name === TINT_VAR ? 'rgba(0, 0, 0, 0)' : name === REVEAL_VAR ? 1 : name === GLOW_VAR ? 0 : entry && entry[1] !== null ? entry[1] : 0;
  }
  return out;
}

// ── Screen transitions (T-01…T-08, T-30…T-32) ─────────────────────────────────

export type BasicTransition = Extract<Transition, { kind: 'none' | 'fade' | 'slide' | 'zoom' | 'flip' | 'blinds' | 'particles' | 'page' }>;

/** Phase plans of a transition: the leaving screen and the coming one. */
export interface TransitionPlan {
  kind: BasicTransition['kind'];
  out: AnimationPlan | null;
  in: AnimationPlan | null;
  /** Transform origin of the layers (the page turns around its left edge). */
  origin?: string;
  /** Particles over the leaving screen (T-07). */
  particles?: boolean;
}

export const TRANSITION_DEFAULT: BasicTransition = { kind: 'fade', direction: 'left', durationMs: 400, delayMs: 0, easing: { kind: 'preset', name: 'easeOut' }, blur: 0, scale: 1 };

/**
 * Which transition applies (T-30, T-32): the one of the branch or AC-05 action overrides the screen's;
 * a preset is looked up in the theme; reduced motion turns everything into a short fade (T-31).
 */
export function resolveTransition(screenTransition: Transition | undefined, override: Transition | undefined, tokens: Pick<ThemeTokens, 'transitions'>, reducedMotion: boolean): BasicTransition | null {
  let t = override ?? screenTransition ?? TRANSITION_DEFAULT;
  if (t.kind === 'preset') {
    const id = t.presetId;
    t = tokens.transitions.find((p) => p.id === id)?.transition ?? TRANSITION_DEFAULT;
  }
  if (t.kind === 'media') return null;
  if (reducedMotion && t.kind !== 'none') return { ...TRANSITION_DEFAULT, kind: 'fade', durationMs: 200, delayMs: 0 };
  return t;
}

/** Keyframes of both screens for a transition, in screen widths (slides) and degrees. */
export function transitionPlan(t: BasicTransition): TransitionPlan {
  const duration = t.durationMs / 1000;
  const delay = t.delayMs / 1000;
  const e = ease(t.easing, t.durationMs);
  const blurIn: Keyframes = t.blur > 0 ? { '--bk-ablur': [t.blur, 0] } : {};
  const base = { duration, delay, ease: e };
  switch (t.kind) {
    case 'none':
      return { kind: 'none', out: null, in: null };
    case 'fade':
      return { kind: 'fade', out: { ...base, keyframes: { opacity: [1, 0] } }, in: { ...base, keyframes: { opacity: [0, 1], ...blurIn } } };
    case 'slide': {
      const o = directionOffset(t.direction, 390);
      return {
        kind: 'slide',
        out: { ...base, keyframes: { '--bk-ax': [0, -o.x], '--bk-ay': [0, -o.y] } },
        in: { ...base, keyframes: { '--bk-ax': [o.x, 0], '--bk-ay': [o.y, 0], ...blurIn } },
      };
    }
    case 'zoom': {
      const from = t.scale === 1 ? 0.8 : t.scale;
      return {
        kind: 'zoom',
        out: { ...base, keyframes: { opacity: [1, 0], '--bk-as': [1, from < 1 ? 1.15 : 0.85] } },
        in: { ...base, keyframes: { opacity: [0, 1], '--bk-as': [from, 1], ...blurIn } },
      };
    }
    case 'flip':
      return {
        kind: 'flip',
        out: { ...base, duration: duration / 2, keyframes: { '--bk-ary': [0, 90], opacity: [1, 1] } },
        in: { ...base, duration: duration / 2, delay: delay + duration / 2, keyframes: { '--bk-ary': [-90, 0], opacity: [1, 1] } },
      };
    case 'blinds':
      return { kind: 'blinds', out: null, in: { ...base, keyframes: { '--bk-blinds': [0, 1], ...blurIn } } };
    case 'particles':
      return { kind: 'particles', out: { ...base, keyframes: { opacity: [1, 0], '--bk-ablur': [0, 6] } }, in: { ...base, delay: delay + duration * 0.3, keyframes: { opacity: [0, 1] } }, particles: true };
    case 'page':
      return { kind: 'page', out: { ...base, keyframes: { '--bk-ary': [0, -110], opacity: [1, 0.6] } }, in: null, origin: '0% 50%' };
  }
}

/**
 * T-21: the media insert for an answer — the first case that fits: «правильно» and «неправильно» by the
 * server's verdict (the key is not in the browser, PL-15), or a chosen option.
 */
export function mediaForAnswer(rule: MediaByAnswer | undefined, chosenOptionIds: readonly string[], verdict: boolean | null): MediaOverlay | null {
  if (!rule) return null;
  for (const c of rule.cases) {
    if (c.when.kind === 'correct' && verdict === true) return c.overlay;
    if (c.when.kind === 'wrong' && verdict === false) return c.overlay;
    if (c.when.kind === 'option' && chosenOptionIds.includes(c.when.optionId)) return c.overlay;
  }
  return null;
}
