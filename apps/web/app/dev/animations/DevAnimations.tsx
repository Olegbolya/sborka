'use client';

import { Artboard, DEV_THEMES, ParticleLayer, ScreenStage, ScreenView, mediaForAnswer, u } from '@blokum/renderer';
import { type MediaOverlay, type Transition } from '@blokum/schema';
import { type CSSProperties, useState } from 'react';
import { devMedia } from '../../../lib/dev/dev-media';
import {
  ANIMATIONS_GALLERY,
  GALLERY_MEDIA_BY_ANSWER,
  GALLERY_FULL_SCREEN,
  GALLERY_PARTICLES,
  GALLERY_PRESET,
  GALLERY_TRANSITIONS,
  PARTICLE_LABELS,
  TRANSITION_SCREENS,
} from '../../../lib/dev/animations-gallery';

const button: CSSProperties = {
  font: 'inherit',
  fontSize: u(13),
  padding: `${u(8)} ${u(10)}`,
  borderRadius: u(10),
  border: `${u(1)} solid currentColor`,
  background: 'transparent',
  color: 'inherit',
  cursor: 'pointer',
};

const heading: CSSProperties = { fontSize: u(20), fontWeight: 800, margin: `${u(24)} ${u(15)} ${u(10)}` };

/**
 * Service page of P1.7: every block animation (S-12…S-14), every screen transition with the media
 * transition and an own preset (T-01…T-08, T-20, T-21, T-32) and every particle preset (P-01…P-08).
 */
export function DevAnimations({
  theme,
  only,
}: {
  theme: 'light' | 'dark';
  only?: 'blocks' | 'transitions' | 'particles';
}) {
  const show = (part: 'blocks' | 'transitions' | 'particles') => only === undefined || only === part;
  const tokens = { ...DEV_THEMES[theme], transitions: [GALLERY_PRESET] };
  const [replay, setReplay] = useState(0);
  const [stage, setStage] = useState<{ index: number; transition?: Transition; overlay?: MediaOverlay | null }>({
    index: 0,
  });
  const go = (transition: Transition) => setStage((s) => ({ index: 1 - s.index, transition, overlay: null }));
  const answer = (verdict: boolean) =>
    setStage((s) => ({ index: 1 - s.index, overlay: mediaForAnswer(GALLERY_MEDIA_BY_ANSWER, [], verdict) }));
  return (
    <Artboard mode="player" tokens={tokens} media={devMedia}>
      <div style={{ color: tokens.colors.text, fontFamily: 'system-ui, sans-serif' }}>
        {show('blocks') && (
          <>
            <div style={{ display: 'flex', justifyContent: 'flex-end', padding: `${u(10)} ${u(15)} 0` }}>
              <button type="button" style={button} data-dev="replay" onClick={() => setReplay((n) => n + 1)}>
                Повторить появление
              </button>
            </div>
            <div key={replay}>
              {ANIMATIONS_GALLERY.screens.map((screen) => (
                <ScreenView key={screen.id} screen={screen} />
              ))}
            </div>
          </>
        )}

        {show('transitions') && (
          <>
            <h2 style={heading}>Переходы (T-01…T-08, T-20, T-21, T-32)</h2>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: u(6), padding: `0 ${u(15)} ${u(10)}` }}>
              {GALLERY_TRANSITIONS.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  style={button}
                  data-dev-transition={t.id}
                  onClick={() => go(t.transition)}
                >
                  {t.label}
                </button>
              ))}
              <button type="button" style={button} data-dev-answer="correct" onClick={() => answer(true)}>
                По ответу: верно
              </button>
              <button type="button" style={button} data-dev-answer="wrong" onClick={() => answer(false)}>
                По ответу: неверно
              </button>
            </div>
            <ScreenStage
              screen={TRANSITION_SCREENS[stage.index]!}
              {...(stage.transition ? { transition: stage.transition } : {})}
              overlay={stage.overlay ?? null}
            >
              {(screen) => <ScreenView screen={screen} />}
            </ScreenStage>
          </>
        )}

        {show('particles') && (
          <>
            <h2 style={heading}>Частицы (P-01…P-08)</h2>
            <div
              style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: u(10), padding: `0 ${u(15)} ${u(30)}` }}
            >
              {GALLERY_PARTICLES.map((config, i) => (
                <div key={config.preset} className="dev-particles" data-preset={config.preset}>
                  <div style={{ fontSize: u(13), marginBottom: u(4) }}>{PARTICLE_LABELS[config.preset]}</div>
                  <div
                    style={{
                      position: 'relative',
                      height: u(150),
                      borderRadius: u(12),
                      overflow: 'hidden',
                      background: theme === 'dark' ? '#1D2A44' : '#7A9CC6',
                    }}
                  >
                    <ParticleLayer config={config} width={175} height={150} seed={i + 1} />
                  </div>
                </div>
              ))}
            </div>
            <h2 style={heading}>Весь экран, плотность 100 %</h2>
            <div className="dev-particles-full" style={{ position: 'relative', height: u(844), background: theme === 'dark' ? '#1D2A44' : '#7A9CC6' }}>
              <ParticleLayer config={GALLERY_FULL_SCREEN} width={390} height={844} seed={99} />
            </div>
          </>
        )}
      </div>
    </Artboard>
  );
}
