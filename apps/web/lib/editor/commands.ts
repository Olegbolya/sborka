import {
  BLOCK_PROPS,
  type Block,
  type BlockInput,
  type BlockType,
  type ProjectDocument,
  type Screen,
  Screen as ScreenSchema,
  createBlock,
  createId,
  createScreen,
  createVariable,
  textOf,
} from '@blokum/schema';
import { DOCUMENT_LIMITS } from '@blokum/schema';
import { SCREEN_KEYS } from './screen-specs';
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

export const setFrame = (ids: readonly string[], frame: Partial<Pick<Block['frame'], 'x' | 'y' | 'w' | 'h'>>): Recipe =>
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

/** Copies next to the originals, shifted a little, on top; `onCreated` gets the new identifiers. Groups stay groups. */
export const duplicateBlocks =
  (ids: readonly string[], onCreated?: (ids: string[]) => void): Recipe =>
  (doc) => {
    const created: string[] = [];
    // One level at a time, so the copies of a group share a new group identifier.
    const levels = new Map<Block[], Block[]>();
    for (const id of ids) {
      const loc = findBlock(doc, id);
      if (loc) levels.set(loc.siblings, [...(levels.get(loc.siblings) ?? []), loc.siblings[loc.index]!]);
    }
    for (const [siblings, originals] of levels) {
      const copies = cloneWithNewIds(originals);
      const top = Math.max(0, ...siblings.map((b) => b.z));
      copies.forEach((copy, i) => {
        copy.frame.x += NUDGE;
        copy.frame.y += NUDGE;
        copy.z = top + 1 + i;
        siblings.push(copy);
        created.push(copy.id);
      });
    }
    onCreated?.(created);
  };

/**
 * E-05/E-07 · puts frames of blocks where the gesture says: every entry is the whole frame to set. Written from the
 * state at the start of the gesture, so repeating a move changes nothing.
 */
export const setFrames =
  (frames: ReadonlyMap<string, Pick<Block['frame'], 'x' | 'y' | 'w' | 'h' | 'rotation'>>): Recipe =>
  (doc) => {
    for (const [id, f] of frames) {
      const loc = findBlock(doc, id);
      if (!loc) continue;
      const frame = loc.siblings[loc.index]!.frame;
      for (const k of ['x', 'y', 'w', 'h', 'rotation'] as const) {
        const v = f[k];
        const r = Math.round(v * 10) / 10;
        if (Number.isFinite(r) && frame[k] !== r) frame[k] = r;
      }
    }
  };

/** E-07 · moves blocks by a distance (keyboard arrows). */
export const moveBlocksBy = (ids: readonly string[], dx: number, dy: number): Recipe =>
  patchBlocks(ids, (b) => {
    b.frame.x = Math.round((b.frame.x + dx) * 10) / 10;
    b.frame.y = Math.round((b.frame.y + dy) * 10) / 10;
  });

/** E-05 · flips a block (S-01 «отражение»). */
export const flipBlocks = (ids: readonly string[], axis: 'x' | 'y'): Recipe =>
  patchBlocks(ids, (b) => {
    if (axis === 'x') b.frame.flipX = !b.frame.flipX;
    else b.frame.flipY = !b.frame.flipY;
  });

const MARGIN = 16;

/**
 * E-14 · puts a new block of the given type on the screen (or into a container): below the lowest block that fits, on top
 * of the others. Contact data come with the consent to personal-data processing (B-19, B-20, PL-23) under them.
 * `onCreated` gets the identifiers of everything added, the main block first.
 */
export const addBlock =
  (
    screenId: string,
    type: BlockType,
    parentId: string | null,
    onCreated?: (ids: string[]) => void,
    overrides: Partial<BlockInput> = {},
  ): Recipe =>
  (doc) => {
    const screen = doc.screens.find((s) => s.id === screenId);
    if (!screen) return;
    const parent = parentId ? findBlock(doc, parentId)?.siblings[findBlock(doc, parentId)!.index] : undefined;
    const siblings = parent ? parent.children : screen.blocks;
    const block = createBlock(type, overrides);
    const extra = type === 'contacts' ? [createBlock('consent')] : [];
    const room = parent ? parent.frame.h : screen.height;
    let y = siblings.length === 0 ? block.frame.y : Math.max(...siblings.map((b) => b.frame.y + b.frame.h)) + MARGIN;
    const placed: Block[] = [];
    for (const b of [block, ...extra]) {
      if (parent) b.frame.x = Math.max(0, Math.min(b.frame.x, parent.frame.w - b.frame.w));
      b.frame.y = Math.max(0, Math.min(y, Math.max(0, room - b.frame.h)));
      y = b.frame.y + b.frame.h + MARGIN;
      b.z = Math.max(-1, ...siblings.map((x) => x.z), ...placed.map((x) => x.z)) + 1;
      placed.push(b);
    }
    siblings.push(...placed);
    onCreated?.(placed.map((b) => b.id));
  };

/**
 * B-01…B-23 · changes the type-specific properties of blocks. `change` gets a copy of the current ones; a result the
 * schema does not accept (a number out of range, a missing option) changes nothing.
 */
export const setBlockProps =
  (ids: readonly string[], change: (props: Record<string, unknown>) => unknown): Recipe =>
  (doc) => {
    for (const id of ids) {
      const loc = findBlock(doc, id);
      if (!loc) continue;
      const block = loc.siblings[loc.index]!;
      const next = BLOCK_PROPS[block.type].safeParse(
        change(JSON.parse(JSON.stringify(block.props)) as Record<string, unknown>),
      );
      if (next.success) (block as { props: unknown }).props = next.data;
    }
  };

type Choice = Extract<Block, { type: 'singleChoice' | 'multiChoice' }>;
const choiceOf = (doc: ProjectDocument, id: string): Choice | null => {
  const loc = findBlock(doc, id);
  const block = loc?.siblings[loc.index];
  return block && (block.type === 'singleChoice' || block.type === 'multiChoice') ? block : null;
};

/** B-11, B-12 · a new option: the block that draws it and the line with its score. */
export const addOption =
  (blockId: string): Recipe =>
  (doc) => {
    const q = choiceOf(doc, blockId);
    if (!q || q.props.options.length >= 30 || q.children.length >= 100) return;
    const last = q.children[q.children.length - 1];
    const n = q.props.options.length + 1;
    const child = createBlock('shape', {
      name: `Вариант ${n}`,
      textLayer: textOf(`Вариант ${n}`),
      frame: last
        ? { x: last.frame.x, y: last.frame.y + last.frame.h + MARGIN, w: last.frame.w, h: last.frame.h }
        : { x: 0, y: 0, w: 326, h: 56 },
    });
    q.children.push(child);
    q.props.options.push({ id: createId(), blockId: child.id, correct: false, score: 0, resultTags: [] });
  };

export const removeOption =
  (blockId: string, optionId: string): Recipe =>
  (doc) => {
    const q = choiceOf(doc, blockId);
    const option = q?.props.options.find((o) => o.id === optionId);
    if (!q || !option || q.props.options.length <= 2) return;
    q.props.options = q.props.options.filter((o) => o.id !== optionId);
    q.children = q.children.filter((c) => c.id !== option.blockId);
  };

/** Moves an option; the blocks that draw them swap places too, so the order on the screen follows the list. */
export const moveOption =
  (blockId: string, from: number, to: number): Recipe =>
  (doc) => {
    const q = choiceOf(doc, blockId);
    if (!q || from === to || from < 0 || to < 0 || from >= q.props.options.length || to >= q.props.options.length)
      return;
    const drawn = q.props.options.map((o) => q.children.find((c) => c.id === o.blockId));
    const slots = drawn.map((c) => (c ? { x: c.frame.x, y: c.frame.y } : null));
    const [moved] = q.props.options.splice(from, 1);
    q.props.options.splice(to, 0, moved!);
    const [movedBlock] = drawn.splice(from, 1);
    drawn.splice(to, 0, movedBlock);
    drawn.forEach((c, i) => {
      const slot = slots[i];
      if (c && slot) {
        c.frame.x = slot.x;
        c.frame.y = slot.y;
      }
    });
  };

export const setOptionText =
  (blockId: string, optionId: string, text: string): Recipe =>
  (doc) => {
    const q = choiceOf(doc, blockId);
    const option = q?.props.options.find((o) => o.id === optionId);
    const child = q?.children.find((c) => c.id === option?.blockId);
    if (child) child.textLayer = textOf(text.slice(0, 200));
  };

/** B-11 · in a single-choice question only one option is right. */
export const patchOption =
  (blockId: string, optionId: string, patch: { correct?: boolean; score?: number; resultTags?: string[] }): Recipe =>
  (doc) => {
    const q = choiceOf(doc, blockId);
    const option = q?.props.options.find((o) => o.id === optionId);
    if (!q || !option) return;
    if (patch.correct !== undefined) {
      if (patch.correct && q.type === 'singleChoice') for (const o of q.props.options) o.correct = false;
      option.correct = patch.correct;
    }
    if (patch.score !== undefined && Number.isFinite(patch.score))
      option.score = Math.max(-1000, Math.min(1000, patch.score));
    if (patch.resultTags !== undefined)
      option.resultTags = patch.resultTags
        .map((t) => t.trim().slice(0, 40))
        .filter(Boolean)
        .slice(0, 10);
  };

/** VR-01 · a new number variable with the given name; the name must pass the schema and be free. */
export const addVariable =
  (name: string, onCreated?: (id: string) => void): Recipe =>
  (doc) => {
    const clean = name.trim();
    if (!clean || doc.variables.some((v) => v.name === clean)) return;
    try {
      const v = createVariable(clean, 'number', 0);
      doc.variables.push(v);
      onCreated?.(v.id);
    } catch {
      // The name does not fit the rules for names of variables: nothing is added.
    }
  };

/**
 * E-13, L-06 · changes the properties of a screen the panel sets (name, kind, height, background, particles,
 * transition in, timer). `change` gets a copy of them; a result the schema does not accept changes nothing.
 */
export const setScreenProps =
  (screenId: string, change: (props: Record<string, unknown>) => unknown): Recipe =>
  (doc) => {
    const screen = doc.screens[screenIndex(doc, screenId)];
    if (!screen) return;
    const current = Object.fromEntries(SCREEN_KEYS.map((k) => [k, screen[k]]));
    const next = change(JSON.parse(JSON.stringify(current)) as Record<string, unknown>) as Record<string, unknown>;
    const parsed: Record<string, unknown> = {};
    for (const key of SCREEN_KEYS) {
      const result = ScreenSchema.shape[key].safeParse(next[key]);
      if (!result.success) return;
      parsed[key] = result.data;
    }
    Object.assign(screen, parsed);
    for (const key of SCREEN_KEYS) if (parsed[key] === undefined) delete (screen as Record<string, unknown>)[key];
  };
