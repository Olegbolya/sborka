/** Artboard width in design units (E-01): 1 unit = 1 px on a 390 px wide phone. */
export const ARTBOARD_WIDTH = 390;
/** Widest player column on desktop, px (E-02). */
export const MAX_PLAYER_WIDTH = 480;
/** CSS custom property holding the size of one unit in px. */
export const UNIT_VAR = '--u';

/** CSS length for `n` design units. Scaling goes through the variable, never `transform: scale` (E-02). */
export function u(n: number): string {
  if (!Number.isFinite(n)) throw new RangeError('Размер в единицах должен быть конечным числом');
  return n === 0 ? '0px' : `calc(${n} * var(${UNIT_VAR}))`;
}

/** Pixels per unit for a viewport: the artboard fills the phone width, capped by the desktop column. */
export function unitScale(viewportWidthPx: number): number {
  if (!(viewportWidthPx > 0)) throw new RangeError('Ширина окна должна быть больше нуля');
  return Math.min(viewportWidthPx, MAX_PLAYER_WIDTH) / ARTBOARD_WIDTH;
}
