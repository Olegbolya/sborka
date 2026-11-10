import { contrastRatio } from '../color-math.js';
import { plainText } from '../plain-text.js';
import { walkBlocks } from '../walk.js';
import type { ProjectDocument } from '../document.js';
import { usedMediaIds } from './scan.js';

/** SR-01 · what the creator is told before publishing and may leave as it is: nothing here stops the publication. */
export interface PublishWarning {
  code: 'NO_ALT' | 'LOW_CONTRAST' | 'EMPTY_SCREEN' | 'HEAVY_MEDIA';
  path: Array<string | number>;
  message: string;
}

/** WCAG AA: 4.5 for normal text, 3 for large text (24 px and more, or 19 px and bold). */
export const CONTRAST_MIN = 4.5;
export const CONTRAST_MIN_LARGE = 3;
/** One file above this size, or all the files together above the second figure, load slowly on a phone. */
export const HEAVY_MEDIA_FILE_BYTES = 10 * 1024 * 1024;
export const HEAVY_MEDIA_TOTAL_BYTES = 40 * 1024 * 1024;

const hexOf = (c: unknown): string | null => {
  const hex = (c as { hex?: unknown } | undefined)?.hex;
  return typeof hex === 'string' && /^#[0-9a-fA-F]{6}([0-9a-fA-F]{2})?$/.test(hex) ? hex.slice(0, 7) : null;
};
const solidHex = (fills: ReadonlyArray<{ kind: string; color?: unknown }> | undefined): string | null => {
  const f = fills?.find((x) => x.kind === 'solid');
  return f ? hexOf(f.color) : null;
};

/** The warnings that need only the document. Colours given by a theme token are not judged: the theme is checked when it is made. */
export function publishWarnings(doc: ProjectDocument): PublishWarning[] {
  const out: PublishWarning[] = [];
  doc.screens.forEach((screen, si) => {
    const hasBackgroundMedia = screen.background.some((f) => f.kind === 'media');
    if (screen.blocks.length === 0 && !hasBackgroundMedia) {
      out.push({ code: 'EMPTY_SCREEN', path: ['screens', si], message: `Экран «${screen.name}» пустой — на нём нет ни одного блока.` });
    }
    const screenBg = solidHex(screen.background);
    for (const b of walkBlocks(screen.blocks)) {
      const label = b.name || 'Без названия';
      const hasText = !!b.textLayer && plainText(b.textLayer).trim().length > 0;
      const showsPicture = (b.style.fills ?? []).some((f) => f.kind === 'media');
      if (showsPicture && !hasText && !(b.a11y.alt ?? '').trim()) {
        out.push({ code: 'NO_ALT', path: ['screens', si, 'blocks', b.id], message: `У картинки «${label}» нет описания для людей, которые не видят экран. Добавьте его в разделе «Доступность».` });
      }
      const ts = b.style.text;
      if (hasText && ts && ts.paint.kind === 'solid') {
        const fg = hexOf(ts.paint.color);
        const bg = solidHex(b.style.fills ?? []) ?? screenBg;
        if (fg && bg) {
          const large = ts.size >= 24 || (ts.size >= 19 && ts.weight >= 700);
          const ratio = contrastRatio(fg, bg);
          if (ratio < (large ? CONTRAST_MIN_LARGE : CONTRAST_MIN)) {
            out.push({ code: 'LOW_CONTRAST', path: ['screens', si, 'blocks', b.id], message: `Текст «${label}» плохо читается на своём фоне (контраст ${ratio.toFixed(1)} из ${large ? CONTRAST_MIN_LARGE : CONTRAST_MIN} нужных).` });
          }
        }
      }
    }
  });
  return out;
}

/** Heavy files: the sizes come from the media table, the ids from the document. */
export function heavyMediaWarnings(doc: ProjectDocument, sizes: ReadonlyMap<string, number>): PublishWarning[] {
  const ids = usedMediaIds(doc);
  const total = ids.reduce((sum, id) => sum + (sizes.get(id) ?? 0), 0);
  const out: PublishWarning[] = [];
  const big = ids.filter((id) => (sizes.get(id) ?? 0) > HEAVY_MEDIA_FILE_BYTES).length;
  if (big > 0) out.push({ code: 'HEAVY_MEDIA', path: ['media'], message: `Файлов больше ${HEAVY_MEDIA_FILE_BYTES / 1048576} МБ: ${big}. Такая сборка медленно открывается на телефоне — сожмите их.` });
  else if (total > HEAVY_MEDIA_TOTAL_BYTES) out.push({ code: 'HEAVY_MEDIA', path: ['media'], message: `Все файлы сборки вместе весят около ${Math.round(total / 1048576)} МБ — на телефоне она будет открываться долго.` });
  return out;
}
