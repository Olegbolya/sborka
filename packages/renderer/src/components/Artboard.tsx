'use client';

import { type CSSProperties, type ReactNode, useEffect, useRef } from 'react';
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
  /**
   * Published player (PL-16): height of the screen in units. On a phone a screen shorter than the window is stretched down to fill it
   * (vertical only, at most 1.5 times; width and type stay): the sides are never cropped (the rule is in `app/globals.css`).
   */
  coverHeight?: number;
  /**
   * The editor's preview of a phone: the height of the phone window in pixels. With `unit` and `coverHeight` the screen is stretched the
   * same way as on a real phone of that size (PL-16), so the preview and the published work look alike.
   */
  viewportHeight?: number;
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
/** The most a low screen is stretched vertically on a phone (PL-16); keep in step with `app/globals.css`. */
const MAX_STRETCH = 1.5;

export const PLAYER_UNIT = `calc(min(100vw, ${MAX_PLAYER_WIDTH}px) / ${ARTBOARD_WIDTH})`;

/**
 * The artboard (E-01, E-02): defines the size of one unit through a CSS variable and provides the render
 * context. In the player the theme background fills the whole window around the column.
 */
/** Same keys, same values (by reference). */
function sameContext(a: RenderContextValue, b: RenderContextValue): boolean {
  const ka = Object.keys(a) as Array<keyof RenderContextValue>;
  return ka.length === Object.keys(b).length && ka.every((k) => a[k] === b[k]);
}

export function Artboard({ unit, coverHeight, viewportHeight, children, ...context }: ArtboardProps): ReactNode {
  const merged: RenderContextValue = { ...defaultRenderContext, ...context };
  // E-05: while a block is dragged the editor redraws the artboard many times a second; a context that did not change keeps its
  // object, so every block that did not change skips drawing (BlockView is memo). The player passes new views on every change.
  const last = useRef(merged);
  if (!sameContext(last.current, merged)) last.current = merged;
  const value = last.current;
  const stageRef = useRef<HTMLDivElement>(null);
  const covers = coverHeight !== undefined && unit === undefined;
  // PL-16: the exact stretch of a low screen on a phone (`--ky`, unitless) — pictures use it to stay whole; `--uy` follows it.
  useEffect(() => {
    const el = stageRef.current;
    if (!el || !covers || coverHeight === undefined) return;
    const apply = () => {
      const w = window.innerWidth;
      const ky = w <= 480 ? Math.min(MAX_STRETCH, Math.max(1, window.innerHeight / (coverHeight * (w / ARTBOARD_WIDTH)))) : 1;
      el.style.setProperty('--ky', String(ky));
      el.style.setProperty('--uy', `calc(var(--u) * ${ky})`);
    };
    apply();
    window.addEventListener('resize', apply);
    return () => window.removeEventListener('resize', apply);
  }, [covers, coverHeight]);
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
    // The artboard is as tall as the screen, not the window: the footer lies on the screen's own bottom-right corner (PL-16).
    alignItems: 'flex-start',
    overflowX: 'hidden',
    backgroundColor: value.tokens.colors.background ?? '#FFFFFF',
    ...(coverHeight !== undefined && unit === undefined ? { '--bk-cover-h': String(coverHeight) } : {}),
  };
  // The preview of a phone (unit and window height known): the same stretch as `apply` above computes from the real window.
  if (unit !== undefined && viewportHeight !== undefined) {
    stage.minHeight = `${String(viewportHeight)}px`;
    if (coverHeight !== undefined) {
      const ky = Math.min(MAX_STRETCH, Math.max(1, viewportHeight / (coverHeight * unit)));
      stage['--ky'] = String(ky);
      stage['--uy'] = `calc(var(--u) * ${String(ky)})`;
    }
  }
  const focusBoard = { ...board, [FOCUS_VAR]: cssColor({ token: 'primary', alpha: 1 }, value.tokens) } as CSSProperties & Record<string, string>;
  return (
    <RenderContext.Provider value={value}>
      <div ref={stageRef} className="bk-stage" data-cover={coverHeight !== undefined && unit === undefined ? '' : undefined} style={stage}>
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
