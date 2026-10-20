'use client';

import { type CSSProperties, type ReactNode } from 'react';
import { RenderContext, type RenderContextValue, defaultRenderContext } from '../context.js';
import { fillLayers } from '../style/style-to-css.js';
import { ARTBOARD_WIDTH, MAX_PLAYER_WIDTH, UNIT_VAR, u } from '../units.js';

export interface ArtboardProps extends Partial<RenderContextValue> {
  /**
   * Pixels per unit. Without it (the player) the unit follows the screen in pure CSS: the artboard fills
   * the phone width and stays a 480 px column on a computer (E-02). Never `transform: scale`.
   */
  unit?: number;
  children: ReactNode;
}

/** Fluid unit of the player: min(100vw, 480px) / 390. */
export const PLAYER_UNIT = `calc(min(100vw, ${MAX_PLAYER_WIDTH}px) / ${ARTBOARD_WIDTH})`;

/**
 * The artboard (E-01, E-02): defines the size of one unit through a CSS variable and provides the render
 * context. In the player the theme background fills the whole window around the column.
 */
export function Artboard({ unit, children, ...context }: ArtboardProps): ReactNode {
  const value: RenderContextValue = { ...defaultRenderContext, ...context };
  const unitValue = unit === undefined ? PLAYER_UNIT : `${unit}px`;
  const board: CSSProperties & Record<string, string> = { [UNIT_VAR]: unitValue, position: 'relative', width: u(ARTBOARD_WIDTH), flex: 'none' };
  if (value.mode !== 'player') {
    return (
      <RenderContext.Provider value={value}>
        <div className="bk-artboard" data-mode={value.mode} style={board}>
          {children}
        </div>
      </RenderContext.Provider>
    );
  }
  const layers = fillLayers(value.tokens.background, { tokens: value.tokens, media: value.media });
  const stage: CSSProperties & Record<string, string> = {
    [UNIT_VAR]: unitValue,
    position: 'relative',
    minHeight: '100dvh',
    display: 'flex',
    justifyContent: 'center',
    overflowX: 'hidden',
    backgroundColor: value.tokens.colors.background ?? '#FFFFFF',
  };
  return (
    <RenderContext.Provider value={value}>
      <div className="bk-stage" style={stage}>
        {layers.map((layer, i) =>
          layer.kind === 'paint' ? (
            <div key={i} aria-hidden style={{ position: 'fixed', inset: 0, ...layer.style }} />
          ) : (
            <video key={i} aria-hidden src={layer.src} autoPlay muted loop playsInline style={{ position: 'fixed', inset: 0, width: '100%', height: '100%', ...layer.style }} />
          ),
        )}
        <main className="bk-artboard" data-mode="player" style={board}>
          {children}
        </main>
      </div>
    </RenderContext.Provider>
  );
}
