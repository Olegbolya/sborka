'use client';

import { createRng } from '@blokum/engine';
import { type MediaRef, type ParticlesConfig } from '@blokum/schema';
import { animate } from 'motion';
import { type ReactNode, type Ref, type RefObject, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { useRenderContext } from '../context.js';
import { type Area, type Particle, type ParticleShape, ParticleSystem, particleOptions } from './engine.js';

/** Draws a shape of size `s` around the origin (used once per shape and colour to make a sprite). */
function drawShape(ctx: CanvasRenderingContext2D, shape: Exclude<ParticleShape, 'image'>, color: string, s: number): void {
  ctx.fillStyle = color;
  ctx.strokeStyle = color;
  switch (shape) {
    case 'circle':
      ctx.beginPath();
      ctx.arc(0, 0, s / 2, 0, Math.PI * 2);
      ctx.fill();
      break;
    case 'rect':
      ctx.fillRect(-s / 2, -s * 0.75, s, s * 1.5);
      break;
    case 'heart':
      ctx.beginPath();
      ctx.moveTo(0, s * 0.35);
      ctx.bezierCurveTo(-s, -s * 0.2, -s * 0.45, -s * 0.85, 0, -s * 0.35);
      ctx.bezierCurveTo(s * 0.45, -s * 0.85, s, -s * 0.2, 0, s * 0.35);
      ctx.fill();
      break;
    case 'sparkle':
      ctx.beginPath();
      for (let i = 0; i < 8; i++) {
        const r = i % 2 === 0 ? s / 2 : s / 5;
        const a = (i * Math.PI) / 4;
        ctx.lineTo(Math.cos(a) * r, Math.sin(a) * r);
      }
      ctx.closePath();
      ctx.fill();
      break;
    case 'bubble':
      ctx.lineWidth = Math.max(0.6, s / 10);
      ctx.beginPath();
      ctx.arc(0, 0, s / 2, 0, Math.PI * 2);
      ctx.stroke();
      ctx.globalAlpha = 0.6;
      ctx.beginPath();
      ctx.arc(-s / 6, -s / 6, s / 8, 0, Math.PI * 2);
      ctx.fill();
      break;
    case 'leaf':
      ctx.beginPath();
      ctx.moveTo(0, -s / 2);
      ctx.quadraticCurveTo(s / 2, 0, 0, s / 2);
      ctx.quadraticCurveTo(-s / 2, 0, 0, -s / 2);
      ctx.fill();
      break;
    case 'petal':
      ctx.beginPath();
      ctx.ellipse(0, 0, s / 2, s / 4, 0, 0, Math.PI * 2);
      ctx.fill();
      break;
  }
}

/** Pixels of a sprite for a particle of size 1 (its box is 2 × size: hearts reach past ±size/2). */
const SPRITE_PX = 32;
const SPRITE_LIMIT = 256;
/** Highest pixel density of particle canvases. */
export const PARTICLE_DPR = 1.5;
const sprites = new Map<string, HTMLCanvasElement | null>();

/**
 * A pre-drawn particle: filling a path for every particle every frame is what makes canvas slow on phones,
 * so each shape and colour is drawn once and then stamped with `drawImage` (P1.7: ≥ 30 fps at CPU ×4).
 */
function spriteOf(shape: Exclude<ParticleShape, 'image'>, color: string): HTMLCanvasElement | null {
  const key = `${shape}|${color}`;
  const cached = sprites.get(key);
  if (cached !== undefined) return cached;
  if (sprites.size >= SPRITE_LIMIT) sprites.clear();
  const canvas = document.createElement('canvas');
  canvas.width = SPRITE_PX * 2;
  canvas.height = SPRITE_PX * 2;
  const g = canvas.getContext('2d');
  const sprite = g ? canvas : null;
  if (g) {
    g.translate(SPRITE_PX, SPRITE_PX);
    drawShape(g, shape, color, SPRITE_PX);
  }
  sprites.set(key, sprite);
  return sprite;
}

/** Stamps one particle; `k` is pixels per artboard unit. Only `setTransform` + `drawImage` per particle. */
function drawParticle(ctx: CanvasRenderingContext2D, p: Particle, images: Array<HTMLImageElement | null>, k: number): void {
  const a = (p.rot * Math.PI) / 180;
  const cos = Math.cos(a) * k;
  const sin = Math.sin(a) * k;
  // Confetti turns over while falling.
  const fy = p.shape === 'rect' ? Math.cos(p.phase * 2.5) : 1;
  ctx.globalAlpha = p.opacity;
  ctx.setTransform(cos, sin, -sin * fy, cos * fy, p.x * k, p.y * k);
  const s = p.size;
  if (p.shape === 'image') {
    const img = images[p.image];
    if (img?.complete && img.naturalWidth > 0) ctx.drawImage(img, -s / 2, -s / 2, s, s);
    return;
  }
  const sprite = spriteOf(p.shape, p.color);
  if (sprite) ctx.drawImage(sprite, -s, -s, s * 2, s * 2);
}

/** Whether the participant asked the system to reduce motion (T-31). */
export function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

export interface ParticleLayerHandle {
  burst: (x: number, y: number, count: number, kind: 'confetti' | 'burst', colors?: string[]) => void;
}

export interface ParticleLayerProps {
  /** Ambient particles of the screen or theme; null — only bursts. */
  config: ParticlesConfig | null;
  /** Size of the screen in units; the canvas covers it. */
  width: number;
  height: number;
  seed?: number;
  ref?: Ref<ParticleLayerHandle>;
}

/**
 * Canvas with particles over a screen (P-01…P-08) and bursts of effects. One animation frame loop; nothing
 * is drawn with «уменьшить движение» (T-31) and in the editor and thumbnails.
 */
export function ParticleLayer({ config, width, height, seed = 1, ref }: ParticleLayerProps): ReactNode {
  const ctx = useRenderContext();
  const canvas = useRef<HTMLCanvasElement>(null);
  const system = useRef<ParticleSystem | null>(null);
  const [reduced] = useState(prefersReducedMotion);
  const active = ctx.mode === 'player' && !reduced;
  const area: Area = { x: 0, y: 0, w: width, h: height };

  if (active && system.current === null) {
    const empty: ParticlesConfig = { preset: 'snow', images: [], density: 0, speed: 1, size: 1, rotation: true, wind: 0, onlyAtStart: false };
    system.current = new ParticleSystem(particleOptions(config ?? empty, area), createRng(seed));
  }

  useImperativeHandle(ref, () => ({
    burst: (x, y, count, kind, colors) => system.current?.burst(x, y, count, kind, colors),
  }));

  // The pictures and the media resolver are read through refs: the loop restarts only when the list changes.
  const imageRefs = useRef<MediaRef[]>([]);
  imageRefs.current = config?.images ?? [];
  const media = useRef(ctx.media);
  media.current = ctx.media;
  const imageKey = imageRefs.current.map((m) => m.id).join(',');
  useEffect(() => {
    if (!active) return;
    const images = (imageKey === '' ? [] : imageRefs.current).map((ref) => {
      const src = media.current(ref);
      if (!src || src.kind !== 'image') return null;
      const img = new Image();
      img.src = src.url;
      return img;
    });
    let handle = 0;
    let last = performance.now();
    // A canvas out of the viewport is neither simulated nor drawn; it resumes where it was.
    let onScreen = true;
    const observer =
      typeof IntersectionObserver === 'function' && canvas.current
        ? new IntersectionObserver((entries) => {
            onScreen = entries.some((e) => e.isIntersecting);
          })
        : null;
    if (observer && canvas.current) observer.observe(canvas.current);
    const frame = (now: number) => {
      const el = canvas.current;
      const sys = system.current;
      if (el && sys && onScreen) {
        sys.step(now - last);
        // 1.5× is sharp enough for soft particles and draws ~44 % fewer pixels than 2× on phones.
        const dpr = Math.min(PARTICLE_DPR, window.devicePixelRatio || 1);
        const cw = Math.round(el.clientWidth * dpr);
        const ch = Math.round(el.clientHeight * dpr);
        if (el.width !== cw || el.height !== ch) {
          el.width = cw;
          el.height = ch;
        }
        const g = el.getContext('2d');
        if (g) {
          g.setTransform(1, 0, 0, 1, 0, 0);
          g.globalAlpha = 1;
          g.clearRect(0, 0, cw, ch);
          const k = cw / width;
          for (const p of sys.particles) drawParticle(g, p, images, k);
        }
      }
      last = now;
      handle = requestAnimationFrame(frame);
    };
    handle = requestAnimationFrame(frame);
    return () => {
      cancelAnimationFrame(handle);
      observer?.disconnect();
    };
  }, [active, imageKey, width]);

  if (!active) return null;
  return <canvas ref={canvas} className="bk-particles" aria-hidden style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none', zIndex: 1 }} />;
}

export interface EffectsHandle {
  run: (effect: { effect: 'confetti' | 'burst' | 'shake' | 'flash' | 'vibrate'; intensity: number; at?: { x: number; y: number } }) => void;
}

/**
 * Effects of scenarios (AC-07) over a screen: confetti and bursts on the particle canvas, shaking of the
 * screen, a flash and phone vibration. With «уменьшить движение» there are no particles and no shaking.
 */
export function EffectsLayer({ width, height, shakeTarget, colors, ref }: { width: number; height: number; shakeTarget: RefObject<HTMLElement | null>; colors: string[]; ref?: Ref<EffectsHandle> }): ReactNode {
  const particles = useRef<ParticleLayerHandle>(null);
  const flash = useRef<HTMLDivElement>(null);
  const [reduced] = useState(prefersReducedMotion);
  useImperativeHandle(ref, () => ({
    run: ({ effect, intensity, at }) => {
      const k = Math.max(0.1, intensity);
      if (effect === 'vibrate') {
        if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') navigator.vibrate(Math.round(60 * k));
        return;
      }
      if (effect === 'flash') {
        if (flash.current) void animate(flash.current, { opacity: [Math.min(1, 0.85 * k), 0] }, { duration: reduced ? 0.15 : 0.4 });
        return;
      }
      if (reduced) return;
      if (effect === 'shake') {
        if (shakeTarget.current) void animate(shakeTarget.current, { x: [0, -10 * k, 10 * k, -7 * k, 7 * k, -3 * k, 0] }, { duration: 0.45 });
        return;
      }
      const point = at ?? { x: width / 2, y: effect === 'confetti' ? height * 0.35 : height / 2 };
      particles.current?.burst(point.x, point.y, Math.round((effect === 'confetti' ? 120 : 40) * k), effect === 'confetti' ? 'confetti' : 'burst', effect === 'burst' ? colors : undefined);
    },
  }));
  return (
    <>
      <ParticleLayer config={null} width={width} height={height} ref={particles} />
      <div ref={flash} className="bk-flash" aria-hidden style={{ position: 'absolute', inset: 0, background: '#FFFFFF', opacity: 0, pointerEvents: 'none', zIndex: 2 }} />
    </>
  );
}
