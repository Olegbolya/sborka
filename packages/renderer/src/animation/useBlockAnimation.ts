'use client';

import { type ThemeTokens } from '@blokum/schema';
import { animate } from 'motion';
import { type CSSProperties, type RefObject, useCallback, useEffect, useRef } from 'react';
import { type AnimationPlan, type BlockAnimation, GLOW_VAR, REVEAL_VAR, TINT_VAR, enterPlan, holdsWhilePressed, loopPlan, neutralOf, pressPlan } from './plan.js';

type Controls = ReturnType<typeof animate>;

/** Hands a plan to Motion: shared timing plus per-property keyframe times. */
export function runPlan(el: Element, plan: AnimationPlan): Controls {
  const timing = {
    duration: plan.duration,
    delay: plan.delay,
    ease: plan.ease,
    ...(plan.repeat !== undefined ? { repeat: plan.repeat, repeatType: plan.repeatType ?? 'loop', repeatDelay: plan.repeatDelay ?? 0 } : {}),
  };
  const perValue = Object.fromEntries(Object.entries(plan.times ?? {}).map(([name, times]) => [name, { ...timing, times }]));
  if (plan.vibrate && typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') navigator.vibrate(plan.vibrate);
  return animate(el, plan.keyframes as Parameters<typeof animate>[1], { ...timing, ...perValue } as Parameters<typeof animate>[2]);
}

/**
 * Static style of the animated layer: it composes the animation variables (in artboard units and degrees)
 * into transform and filter, so Motion only changes numbers and the block keeps its own rotation, flips
 * and 3D on the outer element.
 */
/** Transform of every animated layer (blocks and screens): offsets in units, angles in degrees. */
export const ANIMATED_TRANSFORM =
  'translate(calc(var(--bk-ax, 0) * var(--u)), calc(var(--bk-ay, 0) * var(--u))) rotate(calc(var(--bk-ar, 0) * 1deg)) rotateX(calc(var(--bk-arx, 0) * 1deg)) rotateY(calc(var(--bk-ary, 0) * 1deg)) scale(var(--bk-as, 1))';
export const ANIMATED_FILTER =
  'blur(calc(var(--bk-ablur, 0) * var(--u))) brightness(var(--bk-abri, 1)) contrast(var(--bk-acon, 1)) saturate(var(--bk-asat, 1)) grayscale(var(--bk-agray, 0)) hue-rotate(calc(var(--bk-ahue, 0) * 1deg))';

export function animatedLayerStyle(animation: BlockAnimation, glowColor: string): CSSProperties {
  const usesReveal = animation.enter?.kind === 'typewriter';
  const usesGlow = animation.press?.kind === 'glow';
  return {
    position: 'absolute',
    inset: 0,
    transform: ANIMATED_TRANSFORM,
    filter: `${ANIMATED_FILTER}${usesGlow ? ` drop-shadow(0 0 calc(var(${GLOW_VAR}, 0) * var(--u)) ${glowColor})` : ''}`,
    backdropFilter: 'blur(calc(var(--bk-abblur, 0) * var(--u)))',
    ...(usesReveal ? { clipPath: `inset(0 calc((1 - var(${REVEAL_VAR}, 1)) * 100%) 0 0)` } : {}),
  };
}

/** True when any keyframe of the block changes the fill colour — then a tint layer is drawn (S-12, S-04). */
export function usesTint(animation: BlockAnimation): boolean {
  return [animation.enter, animation.loop, animation.press].some((a) => a?.keyframes?.some((k) => k.fill !== undefined));
}

export const TINT_STYLE: CSSProperties = { position: 'absolute', inset: 0, background: `var(${TINT_VAR}, transparent)`, pointerEvents: 'none' };

export interface BlockAnimationOptions {
  animation: BlockAnimation | undefined;
  tokens: ThemeTokens;
  reducedMotion: boolean;
  /** Appeared by a scenario «показать с анимацией» (AC-01) — a fade when the block has no own appearance. */
  appear: boolean;
  /** The block is being hidden with animation: fade out, then call `onExited`. */
  leaving: boolean;
  onExited: () => void;
}

/**
 * Plays the animations of one block in the player: appearance once, then the endless one; press and hover
 * reactions while the pointer is down or over it; a fade when hidden by a scenario. Returns handlers.
 */
export function useBlockAnimation(ref: RefObject<HTMLElement | null>, o: BlockAnimationOptions) {
  const loop = useRef<Controls | null>(null);
  const press = useRef<Controls | null>(null);
  const opts = useRef(o);
  opts.current = o;

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const { animation, tokens, reducedMotion, appear } = opts.current;
    let cancelled = false;
    const startLoop = () => {
      if (cancelled || !animation?.loop) return;
      const plan = loopPlan(animation.loop, tokens, reducedMotion);
      if (plan) loop.current = runPlan(el, plan);
    };
    let enter: Controls | null = null;
    if (animation?.enter) enter = runPlan(el, enterPlan(animation.enter, tokens, reducedMotion));
    else if (appear) enter = runPlan(el, { keyframes: { opacity: [0, 1] }, duration: reducedMotion ? 0.15 : 0.25, delay: 0, ease: (t) => t });
    if (enter) void enter.finished.then(startLoop);
    else startLoop();
    return () => {
      cancelled = true;
      enter?.stop();
      loop.current?.stop();
    };
  }, [ref]);

  useEffect(() => {
    const el = ref.current;
    if (!o.leaving || !el) return;
    loop.current?.stop();
    const fade = runPlan(el, { keyframes: { opacity: [Number(getComputedStyle(el).opacity) || 1, 0] }, duration: o.reducedMotion ? 0.15 : 0.2, delay: 0, ease: (t) => t });
    void fade.finished.then(() => opts.current.onExited());
    return () => fade.stop();
  }, [o.leaving, o.reducedMotion, ref]);

  const down = useCallback(() => {
    const el = ref.current;
    const anim = opts.current.animation?.press;
    if (!el || !anim) return;
    const plan = pressPlan(anim, opts.current.tokens, opts.current.reducedMotion);
    if (!plan) return;
    press.current?.stop();
    press.current = runPlan(el, plan);
    if (!holdsWhilePressed(anim)) void press.current.finished.then(() => runPlan(el, { keyframes: Object.fromEntries(Object.entries(neutralOf(plan)).map(([k, v]) => [k, [v]])), duration: 0.12, delay: 0, ease: (t) => t }));
  }, [ref]);

  const up = useCallback(() => {
    const el = ref.current;
    const anim = opts.current.animation?.press;
    if (!el || !anim || !holdsWhilePressed(anim)) return;
    const plan = pressPlan(anim, opts.current.tokens, opts.current.reducedMotion);
    if (!plan) return;
    press.current?.stop();
    press.current = runPlan(el, { keyframes: Object.fromEntries(Object.entries(neutralOf(plan)).map(([k, v]) => [k, [v]])), duration: 0.18, delay: 0, ease: plan.ease });
  }, [ref]);

  return { onPressStart: down, onPressEnd: up };
}
