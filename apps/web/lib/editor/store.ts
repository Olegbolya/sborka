import { type Patch, applyPatches, enablePatches, produceWithPatches } from 'immer';
import { type Block, type ProjectDocument } from '@blokum/schema';
import { createStore } from 'zustand/vanilla';
import { type Recipe } from './commands';
import { findBlock } from './tree';

enablePatches();

/** E-11: at least 100 steps of undo; more are kept while the memory allows (a step is a few patches). */
export const HISTORY_LIMIT = 200;
/** Steps with the same `mergeKey` closer than this are one step (typing in a field, nudging with the keyboard). */
export const MERGE_WINDOW_MS = 1000;

interface Entry {
  label: string;
  patches: Patch[];
  inverse: Patch[];
  mergeKey?: string;
  at: number;
}

export interface Selection {
  screenId: string;
  blockIds: string[];
}

export interface EditorState {
  doc: ProjectDocument;
  /** Grows with every change of the document (also undo and redo) — what autosave watches. */
  docVersion: number;
  selection: Selection;
  past: Entry[];
  future: Entry[];
  /** While a gesture (dragging) is on, every change is added to one step. */
  gesture: { label: string; patches: Patch[]; inverse: Patch[] } | null;
}

export interface ApplyOptions {
  label: string;
  /** Changes with the same key in quick succession are merged into one step. */
  mergeKey?: string;
  /** Moment of the change; tests set it, the editor uses the clock. */
  now?: number;
}

export interface EditorActions {
  apply: (recipe: Recipe, options: ApplyOptions) => boolean;
  /** Dragging, resizing, rotating: everything between `beginGesture` and `endGesture` is one step (E-11). */
  beginGesture: (label: string) => void;
  endGesture: () => void;
  undo: () => boolean;
  redo: () => boolean;
  /** Replaces the whole document (loading the fresh version, restoring a version) and forgets the history. */
  replaceDocument: (doc: ProjectDocument) => void;
  select: (screenId: string, blockIds: string[]) => void;
  selectScreen: (screenId: string) => void;
  canUndo: () => boolean;
  canRedo: () => boolean;
}

export type EditorStore = ReturnType<typeof createEditorStore>;

/** Selection that still points at something that exists (after undo, deleting a screen…). */
function sanitize(doc: ProjectDocument, sel: Selection): Selection {
  const screen = doc.screens.find((s) => s.id === sel.screenId) ?? doc.screens[0]!;
  const blockIds = sel.blockIds.filter((id) => {
    const loc = findBlock(doc, id);
    return loc !== null && loc.screen.id === screen.id;
  });
  return { screenId: screen.id, blockIds };
}

export function createEditorStore(initial: ProjectDocument) {
  return createStore<EditorState & EditorActions>()((set, get) => ({
    doc: initial,
    docVersion: 0,
    selection: { screenId: initial.screens[0]!.id, blockIds: [] },
    past: [],
    future: [],
    gesture: null,

    apply(recipe, { label, mergeKey, now = Date.now() }) {
      const state = get();
      const [doc, patches, inverse] = produceWithPatches(state.doc, recipe);
      if (patches.length === 0) return false;
      const selection = sanitize(doc, state.selection);
      if (state.gesture) {
        set({
          doc,
          selection,
          docVersion: state.docVersion + 1,
          gesture: { ...state.gesture, patches: [...state.gesture.patches, ...patches], inverse: [...inverse, ...state.gesture.inverse] },
          future: [],
        });
        return true;
      }
      const top = state.past[state.past.length - 1];
      const merge = top && mergeKey !== undefined && top.mergeKey === mergeKey && now - top.at < MERGE_WINDOW_MS;
      const past = merge
        ? [...state.past.slice(0, -1), { ...top, patches: [...top.patches, ...patches], inverse: [...inverse, ...top.inverse], at: now }]
        : [...state.past, { label, patches, inverse, ...(mergeKey !== undefined ? { mergeKey } : {}), at: now }].slice(-HISTORY_LIMIT);
      set({ doc, selection, docVersion: state.docVersion + 1, past, future: [] });
      return true;
    },

    beginGesture: (label) => {
      if (!get().gesture) set({ gesture: { label, patches: [], inverse: [] } });
    },

    endGesture: () => {
      const { gesture, past } = get();
      if (!gesture) return;
      if (gesture.patches.length === 0) {
        set({ gesture: null });
        return;
      }
      set({ gesture: null, past: [...past, { label: gesture.label, patches: gesture.patches, inverse: gesture.inverse, at: Date.now() }].slice(-HISTORY_LIMIT) });
    },

    undo: () => {
      const state = get();
      const entry = state.past[state.past.length - 1];
      if (!entry || state.gesture) return false;
      const doc = applyPatches(state.doc, entry.inverse);
      set({ doc, selection: sanitize(doc, state.selection), docVersion: state.docVersion + 1, past: state.past.slice(0, -1), future: [entry, ...state.future] });
      return true;
    },

    redo: () => {
      const state = get();
      const entry = state.future[0];
      if (!entry || state.gesture) return false;
      const doc = applyPatches(state.doc, entry.patches);
      set({ doc, selection: sanitize(doc, state.selection), docVersion: state.docVersion + 1, past: [...state.past, entry], future: state.future.slice(1) });
      return true;
    },

    replaceDocument: (doc) => {
      set((s) => ({ doc, selection: sanitize(doc, s.selection), docVersion: s.docVersion + 1, past: [], future: [], gesture: null }));
    },

    select: (screenId, blockIds) => {
      set({ selection: sanitize(get().doc, { screenId, blockIds }) });
    },

    selectScreen: (screenId) => {
      set({ selection: sanitize(get().doc, { screenId, blockIds: [] }) });
    },

    canUndo: () => get().past.length > 0 && !get().gesture,
    canRedo: () => get().future.length > 0 && !get().gesture,
  }));
}

/** Blocks of the current selection that still exist (for panels). */
export function selectedBlocks(state: Pick<EditorState, 'doc' | 'selection'>): Block[] {
  return state.selection.blockIds.map((id) => findBlock(state.doc, id)).filter((l): l is NonNullable<typeof l> => l !== null).map((l) => l.siblings[l.index]!);
}
