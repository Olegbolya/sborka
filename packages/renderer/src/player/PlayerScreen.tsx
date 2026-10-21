'use client';

import { type MediaOverlay, type Screen } from '@blokum/schema';
import { type ReactNode, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { MediaOverlayView } from '../components/MediaOverlayView.js';
import { ScreenView } from '../components/ScreenView.js';
import { RenderContext, useRenderContext } from '../context.js';
import { type EffectsHandle, EffectsLayer, ParticleLayer } from '../particles/ParticleLayer.js';
import { cssColor } from '../theme/color.js';
import { ARTBOARD_WIDTH } from '../units.js';
import { type RuntimeStore } from './runtime-store.js';

/**
 * A screen driven by the scenario runtime: enters the screen, runs the frame loop while mounted and
 * passes the live views and `dispatch` to every block. Effects of scenarios are played here: particles
 * of the screen or theme (P-01…P-08), confetti, bursts, shaking, flashes and vibration (AC-07), media
 * inserts (AC-08) and sounds (AC-06) — sounds only after the first action of the participant.
 */
export function PlayerScreen({ screen, store }: { screen: Screen; store: RuntimeStore }): ReactNode {
  const ctx = useRenderContext();
  const shakeTarget = useRef<HTMLDivElement>(null);
  const effects = useRef<EffectsHandle>(null);
  const [overlays, setOverlays] = useState<MediaOverlay[]>([]);
  useEffect(() => {
    store.enter(screen.id);
    store.start();
    return () => {
      store.leave();
      store.stop();
    };
  }, [screen.id, store]);
  useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);

  const sound = useRef(ctx.sound);
  sound.current = ctx.sound;
  useEffect(
    () =>
      store.subscribeEffects((list) => {
        for (const e of list) {
          if (e.type === 'effect') effects.current?.run(e);
          else if (e.type === 'mediaOverlay') setOverlays((q) => [...q, e.overlay]);
          else if (e.type === 'playSound') sound.current?.play(e.media);
        }
      }),
    [store],
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      sound.current?.unlock();
      store.dispatch({ type: 'key', key: e.key });
    };
    const onPointer = () => sound.current?.unlock();
    window.addEventListener('keydown', onKey);
    window.addEventListener('pointerdown', onPointer);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('pointerdown', onPointer);
    };
  }, [store]);

  const tapSound = ctx.tokens.sounds.tap;
  const dispatch: typeof store.dispatch = (event) => {
    if (event.type === 'tap') sound.current?.play(tapSound, 0.6);
    store.dispatch(event);
  };
  const particles = screen.particles ?? ctx.tokens.particles ?? null;
  const colors = ['primary', 'accent', 'success'].map((token) => cssColor({ token, alpha: 1 }, ctx.tokens));
  return (
    <RenderContext.Provider value={{ ...ctx, views: store.views, dispatch }}>
      <div ref={shakeTarget} className="bk-player-screen" style={{ position: 'relative' }}>
        <ScreenView screen={screen} />
        {particles && <ParticleLayer key={screen.id} config={particles} width={ARTBOARD_WIDTH} height={screen.height} seed={screen.id.length} />}
        <EffectsLayer width={ARTBOARD_WIDTH} height={screen.height} shakeTarget={shakeTarget} colors={colors} ref={effects} />
        {overlays[0] && <MediaOverlayView key={overlays.length} overlay={overlays[0]} onDone={() => setOverlays((q) => q.slice(1))} />}
      </div>
    </RenderContext.Provider>
  );
}
