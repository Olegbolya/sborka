import { type MediaRef, type PublicDocument, type ThemeTokens } from '@blokum/schema';
import { type MediaSource } from '@blokum/renderer';

/** What `GET /play/:slug` answers (docs/01-PRODUCT-SPEC.md §10.3). */
export interface PlayOpen {
  state: 'ok';
  projectId: string;
  versionId: string;
  slug: string;
  title: string;
  description: string;
  ogImageId: string | null;
  indexable: boolean;
  document: PublicDocument;
  /** TS-24: entries with `stub` are not available but need a placeholder in the player. */
  media: Record<string, { kind: string; mime: string; stub?: 'processing' | 'blocked' }>;
  /**
   * TH-04: пользовательские шрифты документа.
   * fontId → { family: "bk-font-{fontId}", styles: { "400": mediaId, ... } }
   */
  fonts: Record<string, { family: string; styles: Record<string, string> }>;
  /** PL-16 · the mark «Сделано в Блоккере — создать свою». */
  watermark: boolean;
  /** P8.7 · the age mark (0, 6, 12, 16, 18) or null. */
  ageRating?: number | null;
  /** PL-18 · «Реклама», the advertiser and the erid. */
  ad: { advertiser: string; inn?: string; erid: string } | null;
  /** The proof of the password (PL-08). */
  unlock?: string;
}

export interface PlayBlocked {
  state: 'not_open' | 'closed' | 'password' | 'age18';
  slug: string;
  projectId: string;
  title: string;
  text: string;
  opensAt?: string;
  theme: ThemeTokens;
  unlock?: string;
}

export type PlayView = PlayOpen | PlayBlocked;

const KIND: Record<string, MediaSource['kind']> = { IMAGE: 'image', GIF: 'video', VIDEO: 'video', AUDIO: 'audio', LOTTIE: 'lottie' };

/** Address of a file of the published version for participants. */
export const playMediaUrl = (slug: string, id: string): string => `/api/v1/play/${encodeURIComponent(slug)}/media/${encodeURIComponent(id)}`;

/** The player draws only the files the published document refers to: a reference becomes an address and a kind. */
export function playMediaResolver(view: Pick<PlayOpen, 'slug' | 'media'>): (ref: MediaRef) => MediaSource | null {
  return (ref) => {
    // Files of the platform library (LB-02) are served by the same address as the project's own: the server finds the item by its number.
    if (ref.source !== 'media' && ref.source !== 'library') return null;
    const known = view.media[ref.id];
    if (!known) return null;
    // TS-24: propagate stub marker so the renderer shows the appropriate placeholder.
    return { url: playMediaUrl(view.slug, ref.id), kind: KIND[known.kind] ?? 'image', ...(known.stub ? { stub: known.stub } : {}) };
  };
}

/**
 * TH-04 · генерирует CSS-строку с @font-face для всех пользовательских шрифтов документа.
 * styleKey формат: "400" → weight=400 style=normal, "400i" → weight=400 style=italic.
 */
export function fontFaceCSS(view: Pick<PlayOpen, 'slug' | 'fonts'>): string {
  const lines: string[] = [];
  for (const [, fontInfo] of Object.entries(view.fonts)) {
    for (const [styleKey, mediaId] of Object.entries(fontInfo.styles)) {
      const isItalic = styleKey.endsWith('i');
      const weight = isItalic ? styleKey.slice(0, -1) : styleKey;
      const url = playMediaUrl(view.slug, mediaId);
      lines.push(
        `@font-face { font-family: "${fontInfo.family}"; src: url("${url}") format("woff2"); font-weight: ${weight}; font-style: ${isItalic ? 'italic' : 'normal'}; font-display: swap; }`,
      );
    }
  }
  return lines.join('\n');
}
