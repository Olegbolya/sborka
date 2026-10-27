import { type Block, type ProjectDocument, type Screen, createScreen } from '@blokum/schema';
import { DOCUMENT_LIMITS } from '@blokum/schema';
import { cloneWithNewIds, findBlock } from './tree';

/**
 * Commands that change the document (E-11). Each one is a recipe for Immer: it changes the draft in place, the
 * store turns the changes into one step of the history. A command that has nothing to do changes nothing.
 */
export type Recipe = (doc: ProjectDocument) => void;

export const setTitle =
  (title: string): Recipe =>
  (doc) => {
    doc.meta.title = title.trim().slice(0, 120) || doc.meta.title;
  };

const screenIndex = (doc: ProjectDocument, id: string): number => doc.screens.findIndex((s) => s.id === id);

export const addScreen =
  (afterScreenId: string | null, onCreated?: (screen: Screen) => void): Recipe =>
  (doc) => {
    if (doc.screens.length >= DOCUMENT_LIMITS.screens) return;
    const at = afterScreenId ? screenIndex(doc, afterScreenId) + 1 : doc.screens.length;
    const screen = createScreen(`Экран ${doc.screens.length + 1}`);
    doc.screens.splice(at, 0, screen);
    onCreated?.(screen);
  };

export const renameScreen =
  (screenId: string, name: string): Recipe =>
  (doc) => {
    const s = doc.screens[screenIndex(doc, screenId)];
    const clean = name.trim().slice(0, 80);
    if (s && clean) s.name = clean;
  };

export const setScreenHeight =
  (screenId: string, height: number): Recipe =>
  (doc) => {
    const s = doc.screens[screenIndex(doc, screenId)];
    if (s && Number.isFinite(height)) s.height = Math.min(5000, Math.max(400, Math.round(height)));
  };

export const duplicateScreen =
  (screenId: string, onCreated?: (screen: Screen) => void): Recipe =>
  (doc) => {
    const i = screenIndex(doc, screenId);
    if (i < 0 || doc.screens.length >= DOCUMENT_LIMITS.screens) return;
    const copy = cloneWithNewIds(doc.screens[i]!);
    copy.name = `${copy.name} (копия)`.slice(0, 80);
    doc.screens.splice(i + 1, 0, copy);
    onCreated?.(copy);
  };

/** The last screen cannot be deleted: a document always has one (E-13). */
export const deleteScreen =
  (screenId: string): Recipe =>
  (doc) => {
    const i = screenIndex(doc, screenId);
    if (i < 0 || doc.screens.length <= 1) return;
    doc.screens.splice(i, 1);
  };

export const moveScreen =
  (screenId: string, toIndex: number): Recipe =>
  (doc) => {
    const from = screenIndex(doc, screenId);
    const to = Math.min(doc.screens.length - 1, Math.max(0, toIndex));
    if (from < 0 || from === to) return;
    const [s] = doc.screens.splice(from, 1);
    doc.screens.splice(to, 0, s!);
  };

/** Changes the same fields of several blocks at once (the inspector, E-15). */
export const patchBlocks =
  (ids: readonly string[], patch: (block: Block) => void): Recipe =>
  (doc) => {
    for (const id of ids) {
      const loc = findBlock(doc, id);
      if (loc) patch(loc.siblings[loc.index]!);
    }
  };

export const setFrame =
  (ids: readonly string[], frame: Partial<Pick<Block['frame'], 'x' | 'y' | 'w' | 'h'>>): Recipe =>
  patchBlocks(ids, (b) => {
    for (const k of ['x', 'y', 'w', 'h'] as const) {
      const v = frame[k];
      if (v !== undefined && Number.isFinite(v)) b.frame[k] = Math.round(v * 10) / 10;
    }
  });

/** Deletes blocks together with everything inside them. */
export const removeBlocks =
  (ids: readonly string[]): Recipe =>
  (doc) => {
    for (const id of ids) {
      const loc = findBlock(doc, id);
      if (loc) loc.siblings.splice(loc.index, 1);
    }
  };

const NUDGE = 12;

/** Copies next to the originals, shifted a little, on top; `onCreated` gets the new identifiers. */
export const duplicateBlocks =
  (ids: readonly string[], onCreated?: (ids: string[]) => void): Recipe =>
  (doc) => {
    const created: string[] = [];
    for (const id of ids) {
      const loc = findBlock(doc, id);
      if (!loc) continue;
      const copy = cloneWithNewIds(loc.siblings[loc.index]!);
      copy.frame.x += NUDGE;
      copy.frame.y += NUDGE;
      copy.z = Math.max(0, ...loc.siblings.map((b) => b.z)) + 1;
      delete copy.groupId;
      loc.siblings.splice(loc.index + 1, 0, copy);
      created.push(copy.id);
    }
    onCreated?.(created);
  };
