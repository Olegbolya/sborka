import { type MediaSource } from '@blokum/renderer';
import { type MediaRef } from '@blokum/schema';
import { api } from '../api-browser';

export type MediaKind = 'IMAGE' | 'GIF' | 'VIDEO' | 'AUDIO' | 'LOTTIE' | 'FONT_SOURCE';

export interface MediaItem {
  id: string;
  kind: MediaKind;
  status: string;
  mime: string;
  bytes: number;
  width: number | null;
  height: number | null;
  createdAt: string;
}

/** Address of the owner's file for the editor (the player uses the media domain, P4.3). */
export const mediaUrl = (id: string): string => `/api/v1/media/${encodeURIComponent(id)}/file`;

const RENDER_KIND: Record<MediaKind, MediaSource['kind']> = { IMAGE: 'image', GIF: 'video', VIDEO: 'video', AUDIO: 'audio', LOTTIE: 'lottie', FONT_SOURCE: 'image' };

/** The files of the creator's library that the editor knows about: what the renderer needs to draw a media reference. */
export class MediaCatalog {
  private readonly byId = new Map<string, MediaItem>();
  private version = 0;
  private readonly listeners = new Set<() => void>();

  subscribe = (fn: () => void): (() => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };

  getSnapshot = (): number => this.version;

  items(kinds?: readonly MediaKind[]): MediaItem[] {
    return [...this.byId.values()].filter((m) => !kinds || kinds.includes(m.kind)).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  add(item: MediaItem): void {
    this.byId.set(item.id, item);
    this.version += 1;
    for (const l of this.listeners) l();
  }

  /** The whole library, page by page. */
  async load(): Promise<void> {
    let cursor: string | null = null;
    for (let page = 0; page < 20; page++) {
      const res: { items: MediaItem[]; nextCursor: string | null } = await api(`/media?limit=100${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`);
      for (const m of res.items) this.byId.set(m.id, m);
      cursor = res.nextCursor;
      if (!cursor) break;
    }
    this.version += 1;
    for (const l of this.listeners) l();
  }

  /** For `Artboard`: a reference becomes an address. A file the catalog has not seen yet is drawn as a picture. */
  resolver = (ref: MediaRef): MediaSource | null => {
    if (ref.source !== 'media') return null;
    const item = this.byId.get(ref.id);
    if (item && (item.status === 'BLOCKED' || item.status === 'REJECTED')) return null;
    return { url: mediaUrl(ref.id), kind: item ? RENDER_KIND[item.kind] : 'image' };
  };
}
