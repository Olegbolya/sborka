import { fontFamilyName } from '@blokum/renderer';
import { useSyncExternalStore } from 'react';
import { api } from '../api-browser';
import { type FontDto, type FontLicense, deleteFont, listFonts, uploadFont } from '../fonts/api';
import { mediaUrl } from './media';

/** A font the editor can offer: the person's own (TH-04) or one of the platform library (LB-02). */
export interface EditorFont {
  id: string;
  family: string;
  hasCyrillic: boolean;
  source: 'mine' | 'library';
  /** Weights found in the file: «400», «700i»… with the address of the WOFF2 file. */
  faces: Array<{ style: string; url: string }>;
}

interface LibraryFont {
  id: string;
  title: string;
  family: string;
  hasCyrillic: boolean;
  styles: string[];
}

interface State {
  loaded: boolean;
  mine: EditorFont[];
  library: EditorFont[];
}

let state: State = { loaded: false, mine: [], library: [] };
const listeners = new Set<() => void>();
const set = (next: State): void => {
  state = next;
  applyFaces(next);
  listeners.forEach((l) => l());
};

/** `@font-face` of the font: the style key «700i» is the weight 700 italic. */
export function faceCss(font: EditorFont): string {
  return font.faces
    .map(({ style, url }) => {
      const italic = style.endsWith('i');
      return `@font-face { font-family: "${fontFamilyName(font.id)}"; src: url("${url}") format("woff2"); font-weight: ${italic ? style.slice(0, -1) : style}; font-style: ${italic ? 'italic' : 'normal'}; font-display: swap; }`;
    })
    .join('\n');
}

/** The canvas and the preview draw text with `bk-font-{id}`: the faces are put into the page once and replaced when the list changes. */
function applyFaces(s: State): void {
  if (typeof document === 'undefined') return;
  let el = document.getElementById('bk-editor-fonts');
  if (!el) {
    el = document.createElement('style');
    el.id = 'bk-editor-fonts';
    document.head.appendChild(el);
  }
  el.textContent = [...s.mine, ...s.library].map(faceCss).join('\n');
}

const fromOwn = (f: FontDto): EditorFont => ({
  id: f.id,
  family: f.family,
  hasCyrillic: f.hasCyrillic,
  source: 'mine',
  faces: Object.entries(f.styles).map(([style, v]) => ({ style, url: mediaUrl(v.mediaId) })),
});

const fromLibrary = (f: LibraryFont): EditorFont => ({
  id: f.id,
  family: f.title || f.family,
  hasCyrillic: f.hasCyrillic,
  source: 'library',
  faces: f.styles.map((style) => ({ style, url: `/api/v1/library/fonts/${encodeURIComponent(f.id)}/${encodeURIComponent(style)}/file` })),
});

/** Reads «Мои шрифты» and the fonts of the library; the faces go into the page. */
export async function loadEditorFonts(): Promise<void> {
  const [mine, library] = await Promise.all([listFonts().catch(() => [] as FontDto[]), api<LibraryFont[]>('/library/fonts').catch(() => [] as LibraryFont[])]);
  set({ loaded: true, mine: mine.map(fromOwn), library: library.map(fromLibrary) });
}

/** TH-04 · uploads a file; the new font is at once in the list. */
export async function addMyFont(file: File, license: FontLicense): Promise<EditorFont> {
  const dto = await uploadFont(file, license);
  const font = fromOwn(dto);
  set({ ...state, mine: [...state.mine.filter((f) => f.id !== font.id), font] });
  return font;
}

export async function removeMyFont(id: string): Promise<void> {
  await deleteFont(id);
  set({ ...state, mine: state.mine.filter((f) => f.id !== id) });
}

const subscribe = (l: () => void): (() => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};

export function useEditorFonts(): State {
  return useSyncExternalStore(subscribe, () => state, () => state);
}
