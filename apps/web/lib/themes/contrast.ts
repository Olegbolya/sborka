import { type ThemeTokens, contrastRatio } from '@blokum/schema';

/** What is checked: text needs 4.5 (WCAG AA), large text and signs 3. */
export interface ContrastCheck {
  id: string;
  title: string;
  foreground: string;
  background: string;
  ratio: number;
  needed: number;
  ok: boolean;
}

const PAIRS: ReadonlyArray<readonly [id: string, title: string, fg: string, bg: string, needed: number]> = [
  ['text-background', 'Текст на фоне', 'text', 'background', 4.5],
  ['text-surface', 'Текст на поверхности', 'text', 'surface', 4.5],
  ['muted-background', 'Приглушённый текст на фоне', 'muted', 'background', 4.5],
  ['muted-surface', 'Приглушённый текст на поверхности', 'muted', 'surface', 4.5],
  ['primary-background', 'Основной цвет на фоне', 'primary', 'background', 3],
  ['accent-background', 'Акцент на фоне', 'accent', 'background', 3],
  ['success-background', 'Цвет «верно» на фоне', 'success', 'background', 3],
  ['error-background', 'Цвет «неверно» на фоне', 'error', 'background', 3],
];

/** TH-02 · the check of contrast of the palette: a warning, not a ban. */
export function contrastChecks(tokens: Pick<ThemeTokens, 'colors'>): ContrastCheck[] {
  return PAIRS.flatMap(([id, title, fg, bg, needed]) => {
    const foreground = tokens.colors[fg];
    const background = tokens.colors[bg];
    if (!foreground || !background) return [];
    const ratio = contrastRatio(foreground, background);
    return [{ id, title, foreground, background, ratio, needed, ok: ratio >= needed }];
  });
}
