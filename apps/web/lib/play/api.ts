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
  media: Record<string, { kind: string; mime: string }>;
  /** PL-16 · the mark «Сделано в Блокуме — создать свою». */
  watermark: boolean;
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
    if (ref.source !== 'media') return null;
    const known = view.media[ref.id];
    return known ? { url: playMediaUrl(view.slug, ref.id), kind: KIND[known.kind] ?? 'image' } : null;
  };
}
