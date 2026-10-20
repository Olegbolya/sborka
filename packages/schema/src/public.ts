import { type Block } from './blocks.js';
import { type ProjectDocument } from './document.js';

/**
 * What the participant's browser receives (docs/02-ARCHITECTURE.md §4 п. 3, L-03, PL-15): the same
 * document without the answer key (correct options, scores, result tags), without the result rules
 * and without wheel weights (RN-01). Results, scores and server-side draws are computed by the API.
 */
export type PublicDocument = Omit<ProjectDocument, 'results'> & { results: [] };

/** Field names that must never reach the participant (checked by tests on random documents). */
export const PRIVATE_FIELDS = ['correct', 'score', 'resultTags', 'weight', 'operatorInfo'] as const;

const stripBlock = (b: Block): Block => {
  const children = b.children.map(stripBlock);
  const behaviors = b.behaviors.map((bh) =>
    bh.kind === 'wheel' ? { ...bh, sectors: bh.sectors.map(({ blockId }) => ({ blockId })) } : bh,
  ) as Block['behaviors'];
  if (b.type === 'singleChoice' || b.type === 'multiChoice') {
    const options = b.props.options.map(({ id, blockId }) => ({ id, blockId }));
    return { ...b, children, behaviors, props: { ...b.props, options } } as Block;
  }
  return { ...b, children, behaviors };
};

export function toPublicDocument(doc: ProjectDocument): PublicDocument {
  const copy = structuredClone(doc);
  return {
    ...copy,
    screens: copy.screens.map((s) => ({ ...s, blocks: s.blocks.map(stripBlock) })),
    results: [],
  };
}
