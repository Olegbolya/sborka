'use client';

import { type CSSProperties, type ReactNode } from 'react';
import { cssColor } from '../theme/color.js';
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

/**
 * Keyboard focus is always visible in the player (PL-21): pressable blocks, options and fields get a ring in the theme's main
 * colour. The rules are in the style sheet of the site (`app/globals.css`) and read the colour from this variable; a `<style>`
 * element of its own would need the nonce of the page (N-04, CSP). The same sheet keeps the player page from leaving by a
 * horizontal swipe (BH-01, BH-03): the gesture past a block would be taken by the browser for «back».
 */
export const FOCUS_VAR = '--bk-focus';

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
  const focusBoard = { ...board, [FOCUS_VAR]: cssColor({ token: 'primary', alpha: 1 }, value.tokens) } as CSSProperties & Record<string, string>;
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
        <main className="bk-artboard" data-mode="player" style={focusBoard}>
          {children}
        </main>
      </div>
    </RenderContext.Provider>
  );
}
