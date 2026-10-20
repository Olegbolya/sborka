import { type Block, type ProjectDocument, walkBlocks } from '@blokum/schema';
import { type AnswerValue, type QuestionBlock, isQuestion } from './answers.js';

type ChoiceBlock = Extract<Block, { type: 'singleChoice' | 'multiChoice' }>;
const isChoice = (b: Block): b is ChoiceBlock => b.type === 'singleChoice' || b.type === 'multiChoice';

/** All question blocks of the document in screen order (nested ones included). */
export function questionBlocks(doc: ProjectDocument): QuestionBlock[] {
  return doc.screens.flatMap((s) => [...walkBlocks(s.blocks)].filter(isQuestion));
}

const selected = (answer: AnswerValue | undefined): string[] => (answer?.kind === 'choice' ? answer.optionIds : []);

/** Score of an option; the public projection has no scores (PL-15), so they count as 0 there. */
const scoreOf = (o: { score: number }) => (Number.isFinite(o.score) ? o.score : 0);

/** Points for one answer (L-03): the sum of scores of the chosen options. Questions without options give 0. */
export function questionScore(block: Block, answer: AnswerValue | undefined): number {
  if (!isChoice(block)) return 0;
  const ids = new Set(selected(answer));
  return block.props.options.reduce((sum, o) => (ids.has(o.id) ? sum + scoreOf(o) : sum), 0);
}

/** Best possible points for a question: the best option, or the best allowed set of options. */
export function maxQuestionScore(block: Block): number {
  if (!isChoice(block)) return 0;
  const scores = block.props.options.map(scoreOf).sort((a, b) => b - a);
  if (block.type === 'singleChoice') return Math.max(0, scores[0] ?? 0);
  const limit = block.props.maxSelected ?? scores.length;
  return scores.slice(0, limit).reduce((sum, s) => (s > 0 ? sum + s : sum), 0);
}

/** True if the question has an answer key (at least one option marked correct). */
export function hasKey(block: Block): boolean {
  return isChoice(block) && block.props.options.some((o) => o.correct === true);
}

/**
 * Correctness of an answer (L-03): one answer — the chosen option is correct; several answers — exactly
 * the set of correct options. `null` when the question has no key or there is no answer.
 */
export function isCorrect(block: Block, answer: AnswerValue | undefined): boolean | null {
  if (!isChoice(block) || !hasKey(block)) return null;
  const ids = selected(answer);
  if (ids.length === 0) return null;
  const correct = block.props.options.filter((o) => o.correct === true).map((o) => o.id);
  if (block.type === 'singleChoice') return ids.length === 1 && correct.includes(ids[0]!);
  return ids.length === correct.length && ids.every((id) => correct.includes(id));
}

/** Ids of the correct options — revealed to the participant only by feedback rules (L-03). */
export function correctOptionIds(block: Block): string[] {
  return isChoice(block) ? block.props.options.filter((o) => o.correct === true).map((o) => o.id) : [];
}

export interface ScoreTotals {
  /** Sum of points over all answers. */
  score: number;
  /** Maximum reachable points («{{максимум}}»). */
  max: number;
  /** Number of correctly answered questions with a key. */
  correct: number;
  /** Number of questions with a key. */
  keyed: number;
}

/** Totals over the whole document (the server computes them from the full document, PL-15). */
export function scoreTotals(doc: ProjectDocument, answers: Readonly<Record<string, AnswerValue>>): ScoreTotals {
  const totals: ScoreTotals = { score: 0, max: 0, correct: 0, keyed: 0 };
  for (const q of questionBlocks(doc)) {
    totals.score += questionScore(q, answers[q.id]);
    totals.max += maxQuestionScore(q);
    if (hasKey(q)) {
      totals.keyed += 1;
      if (isCorrect(q, answers[q.id]) === true) totals.correct += 1;
    }
  }
  return totals;
}

/** How many times each result tag was chosen (personality tests, L-04). */
export function tagCounts(doc: ProjectDocument, answers: Readonly<Record<string, AnswerValue>>): Map<string, number> {
  const counts = new Map<string, number>();
  for (const q of questionBlocks(doc)) {
    if (!isChoice(q)) continue;
    const ids = new Set(selected(answers[q.id]));
    for (const o of q.props.options) {
      if (!ids.has(o.id) || !Array.isArray(o.resultTags)) continue;
      for (const tag of o.resultTags) counts.set(tag, (counts.get(tag) ?? 0) + 1);
    }
  }
  return counts;
}
