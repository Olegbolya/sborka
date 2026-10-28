/*
 * Colour roles of a theme and the default palette. A module of its own, without the schema parser: the player reads them,
 * and importing them must not bring the parser along (P5.7, PL-19).
 */
export const THEME_COLOR_ROLES = ['background', 'surface', 'primary', 'accent', 'text', 'muted', 'success', 'error'] as const;
/** Default palette for new themes: neutral light. Every role exists in every theme. */
export const DEFAULT_COLORS: Record<(typeof THEME_COLOR_ROLES)[number], string> = {
  background: '#FBFAF7',
  surface: '#FFFFFF',
  primary: '#E4572E',
  accent: '#2E86AB',
  text: '#1D1B18',
  muted: '#6B665D',
  success: '#2F9E44',
  error: '#D6336C',
};
