import { type Block } from './blocks.js';

/** All blocks of a tree, depth-first, children after their parent. */
export function* walkBlocks(blocks: readonly Block[]): Generator<Block> {
  for (const b of blocks) {
    yield b;
    yield* walkBlocks(b.children);
  }
}
