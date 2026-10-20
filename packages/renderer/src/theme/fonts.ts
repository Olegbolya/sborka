import { type FontRef, type ThemeTokens } from '@blokum/schema';

/** System font stacks: no font is downloaded from foreign CDNs (02-ARCHITECTURE §1). */
export const SYSTEM_FONTS: Record<Extract<FontRef, { kind: 'system' }>['name'], string> = {
  sans: 'system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
  serif: 'Georgia, Cambria, "Times New Roman", Times, serif',
  mono: 'ui-monospace, SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace',
  rounded: 'ui-rounded, "SF Pro Rounded", "Nunito", system-ui, sans-serif',
};

/** CSS name of an uploaded or library font; its @font-face is generated from the media service (TH-04). */
export const fontFamilyName = (id: string): string => `bk-font-${id}`;

/** CSS `font-family` for a font reference; theme roles follow the theme (TH-01). */
export function cssFontFamily(font: FontRef, tokens: Pick<ThemeTokens, 'fonts'>, depth = 0): string {
  if (font.kind === 'system') return SYSTEM_FONTS[font.name];
  if (font.kind === 'font') return `"${fontFamilyName(font.id)}", ${SYSTEM_FONTS.sans}`;
  const ref = font.role === 'accent' ? (tokens.fonts.accent ?? tokens.fonts.heading) : tokens.fonts[font.role];
  // A theme role pointing to another role would loop; roles always resolve within two steps.
  return depth > 2 || ref.kind === 'theme' ? SYSTEM_FONTS.sans : cssFontFamily(ref, tokens, depth + 1);
}
