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

/** An item of the platform library as the server describes it (LB-01, LB-02). */
export interface LibraryItem {
  id: string;
  collectionId: string;
  mediaId: string | null;
  fontId: string | null;
  kind: MediaKind | null;
  width: number | null;
  height: number | null;
  title: string;
  tags: string[];
  license: string;
  author: string;
  source: string;
  attribution: string | null;
}

/** Address of a library file for the editor (the player uses the address of the published project). */
export const libraryUrl = (id: string): string => `/api/v1/library/items/${encodeURIComponent(id)}/file`;

/** Library references (`{ source: 'library', id }`) found anywhere in a document. */
export function libraryRefs(value: unknown, into: Set<string> = new Set()): Set<string> {
  if (Array.isArray(value)) for (const v of value) libraryRefs(v, into);
  else if (value && typeof value === 'object') {
    const o = value as Record<string, unknown>;
    if (o.source === 'library' && typeof o.id === 'string') into.add(o.id);
    for (const v of Object.values(o)) libraryRefs(v, into);
  }
  return into;
}

/** Address of the owner's file for the editor (the player uses the media domain, P4.3). */
export const mediaUrl = (id: string): string => `/api/v1/media/${encodeURIComponent(id)}/file`;

const RENDER_KIND: Record<MediaKind, MediaSource['kind']> = { IMAGE: 'image', GIF: 'video', VIDEO: 'video', AUDIO: 'audio', LOTTIE: 'lottie', FONT_SOURCE: 'image' };

/** The files of the creator's library that the editor knows about: what the renderer needs to draw a media reference. */
export class MediaCatalog {
  private readonly byId = new Map<string, MediaItem>();
  private readonly library = new Map<string, LibraryItem>();
  /** Library items the document uses but the library no longer has (withdrawn, LB-04): drawn as a stub. */
  private readonly withdrawn = new Set<string>();
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

  /**
   * Обработка файла идёт в фоне (проверка, перекодирование) и может не пропустить его уже после загрузки. Пока статус не стал
   * окончательным, раз в несколько секунд читаем его заново, чтобы холст показал правду без перезагрузки страницы.
   */
  watch(id: string): void {
    const FINAL = new Set(['READY', 'REJECTED', 'BLOCKED']);
    let tries = 0;
    const tick = (): void => {
      const item = this.byId.get(id);
      if (!item || FINAL.has(item.status) || tries >= 8) return;
      tries += 1;
      setTimeout(() => {
        void this.load().then(tick, tick);
      }, 3000);
    };
    tick();
  }

  libraryItem(id: string): LibraryItem | undefined {
    return this.library.get(id);
  }

  /** Items the person has looked at in the platform library: needed to draw them and to choose the block. */
  addLibrary(items: LibraryItem[]): void {
    for (const it of items) {
      this.library.set(it.id, it);
      this.withdrawn.delete(it.id);
    }
    this.version += 1;
    for (const l of this.listeners) l();
  }

  /** LB-04 · asks the server about the library items the document already uses; those it does not return are withdrawn. */
  async loadLibraryRefs(doc: unknown): Promise<void> {
    const ids = [...libraryRefs(doc)].filter((id) => !this.library.has(id));
    if (ids.length === 0) return;
    for (let i = 0; i < ids.length; i += 100) {
      const part = ids.slice(i, i + 100);
      const found = await api<LibraryItem[]>(`/library/items?ids=${part.map(encodeURIComponent).join(',')}`);
      for (const it of found) this.library.set(it.id, it);
      for (const id of part) if (!found.some((f) => f.id === id)) this.withdrawn.add(id);
    }
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
    if (ref.source === 'library') {
      if (this.withdrawn.has(ref.id)) return { url: '', kind: 'image', stub: 'blocked' };
      const lib = this.library.get(ref.id);
      return { url: libraryUrl(ref.id), kind: lib?.kind ? RENDER_KIND[lib.kind] : 'image' };
    }
    if (ref.source !== 'media') return null;
    const item = this.byId.get(ref.id);
    const kind = item ? RENDER_KIND[item.kind] : 'image';
    // Проверка не пропустила файл: холст прямо говорит об этом, а не делает вид, что файла нет.
    if (item && (item.status === 'BLOCKED' || item.status === 'REJECTED')) return { url: '', kind, stub: 'blocked' };
    return { url: mediaUrl(ref.id), kind };
  };
}
