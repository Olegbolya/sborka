import { walkBlocks } from './walk.js';
import { type ProjectDocument } from './document.js';

/** B-24 · an option with a limit of choices, where it lives and what the player may say about it. */
export interface LimitedOption {
  questionBlockId: string;
  optionId: string;
  /** The child block that draws the option: its text names the option in the cabinet. */
  blockId: string;
  limit: number;
  showRemaining: boolean;
  multi: boolean;
}

/** Every option of the document that has a limit, in the order of the screens. */
export function limitedOptions(doc: Pick<ProjectDocument, 'screens'>): LimitedOption[] {
  const out: LimitedOption[] = [];
  for (const screen of doc.screens) {
    for (const block of walkBlocks(screen.blocks)) {
      if (block.type !== 'singleChoice' && block.type !== 'multiChoice') continue;
      for (const o of block.props.options) {
        if (o.limit !== undefined) out.push({ questionBlockId: block.id, optionId: o.id, blockId: o.blockId, limit: o.limit, showRemaining: o.showRemaining === true, multi: block.type === 'multiChoice' });
      }
    }
  }
  return out;
}

/**
 * B-25 · before publishing: a required question whose options are all limited and whose limits add up to fewer places than the
 * assembly lets people finish it (`maxCompletions`) — the last ones could not answer. Returns texts for the creator; it blocks nothing.
 */
export function choiceLimitWarnings(doc: Pick<ProjectDocument, 'screens'>, maxCompletions: number | undefined): string[] {
  if (!maxCompletions) return [];
  const warnings: string[] = [];
  for (const screen of doc.screens) {
    for (const block of walkBlocks(screen.blocks)) {
      if (block.type !== 'singleChoice' || !block.props.required) continue;
      const options = block.props.options;
      if (options.some((o) => o.limit === undefined)) continue;
      const places = options.reduce((sum, o) => sum + (o.limit ?? 0), 0);
      if (places < maxCompletions) {
        warnings.push(`В обязательном вопросе «${block.name}» всего ${places} мест на вариантах, а пройти сборку могут ${maxCompletions} человек: последние не смогут ответить.`);
      }
    }
  }
  return warnings;
}
