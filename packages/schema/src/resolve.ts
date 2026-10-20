import { type Block } from './blocks.js';
import { type BLOCK_STATES, BlockStyle, type StyleOverride } from './style.js';
import { type ThemeTokens } from './theme.js';

type StyleGroup = keyof BlockStyle;

/**
 * Effective style of a block (TH-01, TH-06): base defaults ← the theme's default style for the block
 * type ← the block's own style groups ← the active state (S-15). Groups merge as a whole: the editor
 * writes the full group when the creator changes any field of it, so the group becomes «own».
 */
export function resolveBlockStyle(
  block: Pick<Block, 'type' | 'style' | 'states'>,
  tokens: Pick<ThemeTokens, 'blockDefaults'> | undefined,
  state?: (typeof BLOCK_STATES)[number],
): BlockStyle {
  const themeDefault: StyleOverride = tokens?.blockDefaults[block.type] ?? {};
  const stateStyle: StyleOverride = (state && block.states?.[state]) ?? {};
  return BlockStyle.parse({ ...themeDefault, ...block.style, ...stateStyle });
}

/** Style groups the creator set by hand on this block (TH-06): they do not follow theme changes. */
export function ownStyleGroups(block: Pick<Block, 'style'>): StyleGroup[] {
  return (Object.keys(block.style) as StyleGroup[]).filter((k) => block.style[k] !== undefined);
}

/** «Сбросить к теме» (TH-06): forgets own values of the given groups (all when none are given). */
export function resetToTheme<B extends Pick<Block, 'style'>>(block: B, groups?: readonly StyleGroup[]): B {
  if (!groups) return { ...block, style: {} };
  const style: StyleOverride = { ...block.style };
  for (const g of groups) delete style[g];
  return { ...block, style };
}
