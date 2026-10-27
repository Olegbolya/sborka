import { type BLOCK_STATES, type Block, BlockStyle, type ProjectDocument, type ThemeTokens, resolveBlockStyle } from '@blokum/schema';
import { type Recipe } from './commands';
import { findBlock } from './tree';

export type StyleGroup = keyof BlockStyle;
export type BlockState = (typeof BLOCK_STATES)[number];

/** Every style group of a block (S-02…S-11, S-18…S-20): the keys of `BlockStyle`. */
export const STYLE_GROUPS = Object.keys(BlockStyle.shape) as StyleGroup[];

export const STATE_TITLES: Record<BlockState, string> = {
  hover: 'Наведение',
  pressed: 'Нажато',
  selected: 'Выбрано',
  correct: 'Правильно',
  wrong: 'Неправильно',
  disabled: 'Недоступно',
  dragging: 'Перетаскивается',
  overZone: 'Над зоной',
};

/** What a block looks like now in the chosen state (null — the normal look): theme default ← own values ← state. */
export function effectiveStyle(block: Block, tokens: Pick<ThemeTokens, 'blockDefaults'>, state: BlockState | null): BlockStyle {
  return resolveBlockStyle(block, tokens, state ?? undefined);
}

/** Is the group set by hand (TH-06), in the normal look or in the state? */
export function isOwn(block: Block, group: StyleGroup, state: BlockState | null): boolean {
  const source = state ? block.states?.[state] : block.style;
  return source?.[group] !== undefined;
}

/** Equal by value (groups are plain JSON). */
export const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);

/** The value all of them share, or `null` when they differ («смешанно», E-15). */
export function common<T>(values: readonly T[]): T | null {
  return values.length > 0 && values.every((v) => same(v, values[0])) ? values[0]! : null;
}

/**
 * Changes one style group of blocks (E-15): the new value is made from what the block looks like now and written as
 * the whole group, so it becomes «своё» and no longer follows the theme (TH-06). With a state chosen it goes to that
 * state (S-15). A value the schema refuses is not written.
 */
export const setStyleGroup =
  <K extends StyleGroup>(ids: readonly string[], group: K, tokens: Pick<ThemeTokens, 'blockDefaults'>, state: BlockState | null, update: (current: BlockStyle[K]) => BlockStyle[K]): Recipe =>
  (doc) => {
    for (const id of ids) {
      const loc = findBlock(doc, id);
      if (!loc) continue;
      const block = loc.siblings[loc.index]!;
      const next = update(structuredClone(effectiveStyle(block, tokens, state)[group]));
      const parsed = (BlockStyle.shape[group] as { safeParse: (v: unknown) => { success: boolean; data?: unknown } }).safeParse(next);
      if (!parsed.success) continue;
      if (state) {
        block.states ??= {};
        block.states[state] = { ...(block.states[state] ?? {}), [group]: parsed.data };
      } else {
        block.style = { ...block.style, [group]: parsed.data };
      }
    }
  };

/** «Сбросить к теме» (TH-06): the block forgets its own value of the group (in the state: the state's value). */
export const resetStyleGroup =
  (ids: readonly string[], groups: readonly StyleGroup[] | null, state: BlockState | null): Recipe =>
  (doc) => {
    for (const id of ids) {
      const loc = findBlock(doc, id);
      if (!loc) continue;
      const block = loc.siblings[loc.index]!;
      if (state) {
        const current = block.states?.[state];
        if (!current) continue;
        const next = { ...current };
        for (const g of groups ?? (Object.keys(current) as StyleGroup[])) delete next[g];
        const states = { ...block.states };
        if (Object.keys(next).length === 0) delete states[state];
        else states[state] = next;
        if (Object.keys(states).length === 0) delete block.states;
        else block.states = states;
      } else {
        const gone = (groups ?? (Object.keys(block.style) as StyleGroup[])).filter((g) => block.style[g] !== undefined);
        if (gone.length === 0) continue;
        const next = { ...block.style };
        for (const g of gone) delete next[g];
        block.style = next;
      }
    }
  };

type Animation = NonNullable<Block['animation']>;

/** S-12…S-14 · sets or removes one of the animations of blocks. */
export const setAnimation =
  <K extends keyof Animation>(ids: readonly string[], key: K, value: Animation[K] | undefined): Recipe =>
  (doc) => {
    for (const id of ids) {
      const loc = findBlock(doc, id);
      if (!loc) continue;
      const block = loc.siblings[loc.index]!;
      const next: Animation = { ...(block.animation ?? {}) };
      if (value === undefined) delete next[key];
      else next[key] = value;
      if (Object.keys(next).length === 0) delete block.animation;
      else block.animation = next;
    }
  };

/** Which groups of the selection are set by hand — for the «своё» marks. */
export function ownGroups(blocks: readonly Block[], state: BlockState | null): StyleGroup[] {
  return STYLE_GROUPS.filter((g) => blocks.some((b) => isOwn(b, g, state)));
}

export const documentTokens = (doc: ProjectDocument): ThemeTokens => doc.theme.tokens;

/** S-12…S-14 · changes the whole `animation` of blocks from what it is now (the inspector's tree writes through this). */
export const editAnimation =
  (ids: readonly string[], change: (current: Animation) => Animation): Recipe =>
  (doc) => {
    for (const id of ids) {
      const loc = findBlock(doc, id);
      if (!loc) continue;
      const block = loc.siblings[loc.index]!;
      // A draft of Immer cannot be cloned directly: JSON is enough for plain data.
      const next = change(JSON.parse(JSON.stringify(block.animation ?? {})) as Animation);
      if (same(next, block.animation ?? {})) continue;
      if (Object.keys(next).length === 0) delete block.animation;
      else block.animation = next;
    }
  };
