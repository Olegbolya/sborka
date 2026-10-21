'use client';

import { type MediaOverlay, type Screen, type Transition } from '@blokum/schema';
import { type CSSProperties, type ReactNode, useEffect, useRef, useState } from 'react';
import { MediaOverlayView } from '../components/MediaOverlayView.js';
import { useRenderContext } from '../context.js';
import { ParticleLayer, type ParticleLayerHandle, prefersReducedMotion } from '../particles/ParticleLayer.js';
import { cssColor } from '../theme/color.js';
import { ARTBOARD_WIDTH, u } from '../units.js';
import { resolveTransition, transitionPlan } from './plan.js';
import { ANIMATED_FILTER, ANIMATED_TRANSFORM, runPlan } from './useBlockAnimation.js';

interface Shown {
  screen: Screen;
  key: number;
}

const layer = (extra: CSSProperties = {}): CSSProperties => ({ position: 'absolute', left: 0, top: 0, width: '100%', transform: ANIMATED_TRANSFORM, filter: ANIMATED_FILTER, ...extra });

/** Stripes of «шторка / жалюзи» (T-06): ten bands opening together. */
const BLINDS: CSSProperties = {
  maskImage: 'repeating-linear-gradient(to bottom, #000 0, #000 calc(var(--bk-blinds, 0) * 10%), transparent calc(var(--bk-blinds, 0) * 10%), transparent 10%)',
  WebkitMaskImage: 'repeating-linear-gradient(to bottom, #000 0, #000 calc(var(--bk-blinds, 0) * 10%), transparent calc(var(--bk-blinds, 0) * 10%), transparent 10%)',
};

export interface ScreenStageProps {
  screen: Screen;
  /** Transition of the branch or AC-05 action that led here (T-30); the screen's own one otherwise. */
  transition?: Transition;
  /** Media insert to show on the way (T-20 as a transition, T-21 by answer). */
  overlay?: MediaOverlay | null;
  children: (screen: Screen) => ReactNode;
}

/**
 * Changes screens with transitions (T-01…T-08): the leaving and the coming screen are animated together,
 * then the old one is removed. A media transition or an answer insert (T-20, T-21) is shown first.
 * «Уменьшить движение» turns every transition into a short fade (T-31).
 */
export function ScreenStage({ screen, transition, overlay, children }: ScreenStageProps): ReactNode {
  const ctx = useRenderContext();
  const [reduced] = useState(prefersReducedMotion);
  const [current, setCurrent] = useState<Shown>({ screen, key: 0 });
  const [leaving, setLeaving] = useState<Shown | null>(null);
  const [mediaFirst, setMediaFirst] = useState<MediaOverlay | null>(null);
  const inRef = useRef<HTMLDivElement>(null);
  const outRef = useRef<HTMLDivElement>(null);
  const particles = useRef<ParticleLayerHandle>(null);
  const pending = useRef<{ transition: Transition | undefined; started: boolean }>({ transition, started: false });

  if (screen.id !== current.screen.id) {
    const media = overlay ?? (transition?.kind === 'media' ? transition.overlay : null);
    pending.current = { transition, started: false };
    setLeaving(media ? null : current);
    setCurrent({ screen, key: current.key + 1 });
    setMediaFirst(media);
  }

  useEffect(() => {
    if (pending.current.started || current.key === 0 || mediaFirst) return;
    pending.current.started = true;
    const t = resolveTransition(current.screen.transitionIn, pending.current.transition, ctx.tokens, reduced);
    const plan = transitionPlan(t ?? { kind: 'none', direction: 'left', durationMs: 50, delayMs: 0, easing: { kind: 'preset', name: 'linear' }, blur: 0, scale: 1 });
    const runs = [plan.in && inRef.current ? runPlan(inRef.current, plan.in) : null, plan.out && outRef.current ? runPlan(outRef.current, plan.out) : null].filter((r) => r !== null);
    if (plan.particles && !reduced) {
      const colors = ['primary', 'accent', 'surface', 'text'].map((token) => cssColor({ token, alpha: 1 }, ctx.tokens));
      const height = leaving?.screen.height ?? screen.height;
      for (let i = 0; i < 12; i++) particles.current?.burst(((i % 4) + 0.5) * (ARTBOARD_WIDTH / 4), (Math.floor(i / 4) + 0.5) * (height / 3), 14, 'burst', colors);
    }
    ctx.sound?.play(ctx.tokens.sounds.transition);
    if (runs.length === 0) {
      setLeaving(null);
      return;
    }
    void Promise.all(runs.map((r) => r.finished)).then(() => setLeaving(null));
  }, [current, mediaFirst, leaving, screen.height, reduced, ctx.tokens, ctx.sound]);

  const kind = leaving ? transitionPlan(resolveTransition(current.screen.transitionIn, pending.current.transition, ctx.tokens, reduced) ?? { kind: 'none', direction: 'left', durationMs: 50, delayMs: 0, easing: { kind: 'preset', name: 'linear' }, blur: 0, scale: 1 }) : null;
  const height = Math.max(current.screen.height, leaving?.screen.height ?? 0);
  // The coming screen starts at the first keyframe right in the markup — no flash before Motion starts.
  const initialIn = leaving && kind?.in ? (Object.fromEntries(Object.entries(kind.in.keyframes).map(([k, v]) => [k, v[0]])) as CSSProperties) : {};
  return (
    <div className="bk-stage-screens" style={{ position: 'relative', width: u(ARTBOARD_WIDTH), height: u(height), overflow: 'hidden', perspective: u(1200) }}>
      {leaving && (
        <div key={`out-${leaving.key}`} ref={outRef} className="bk-screen-out" aria-hidden style={layer({ zIndex: kind?.kind === 'page' ? 2 : 0, transformOrigin: kind?.origin ?? '50% 50%', backfaceVisibility: 'hidden' })}>
          {children(leaving.screen)}
        </div>
      )}
      <div key={`in-${current.key}`} ref={inRef} className="bk-screen-in" data-transition={kind?.kind ?? 'none'} style={layer({ zIndex: 1, ...(kind?.kind === 'blinds' ? BLINDS : {}), backfaceVisibility: 'hidden', ...initialIn })}>
        {children(current.screen)}
      </div>
      <ParticleLayer config={null} width={ARTBOARD_WIDTH} height={height} ref={particles} />
      {mediaFirst && <MediaOverlayView overlay={mediaFirst} onDone={() => setMediaFirst(null)} />}
    </div>
  );
}
