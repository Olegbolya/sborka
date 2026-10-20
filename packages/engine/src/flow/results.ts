import { type ProjectDocument } from '@blokum/schema';
import { type AnswerValue } from './answers.js';
import { type ConditionContext, evaluateCondition } from './conditions.js';
import { type ScoreTotals, tagCounts } from './scoring.js';

/** Chosen result (L-04). `ruleId` is null for a result screen reached by a branch without a result rule. */
export interface FlowResult {
  ruleId: string | null;
  key: string;
  screenId: string | null;
}

type TagRule = Extract<ProjectDocument['results'][number], { kind: 'tag' }>;

/** Personality test: the tag rule with the most chosen tags; ties are broken by `settings.tieBreak`. */
function winningTagRule(doc: ProjectDocument, answers: Readonly<Record<string, AnswerValue>>, ctx: ConditionContext): TagRule | null {
  const rules = doc.results.filter((r): r is TagRule => r.kind === 'tag');
  if (rules.length === 0) return null;
  const counts = tagCounts(doc, answers);
  const best = Math.max(...rules.map((r) => counts.get(r.tag) ?? 0));
  if (best === 0) return null;
  const tied = rules.filter((r) => (counts.get(r.tag) ?? 0) === best);
  if (doc.settings.tieBreak === 'first' || tied.length === 1) return tied[0]!;
  return tied[Math.min(tied.length - 1, Math.floor(ctx.random.next() * tied.length))]!;
}

/**
 * The result of a finished passage: result rules are checked in the order the creator set them; the
 * first that fits wins — a score range, the winning personality tag or a variable condition.
 */
export function computeResult(doc: ProjectDocument, totals: ScoreTotals, ctx: ConditionContext): FlowResult | null {
  const tagWinner = winningTagRule(doc, ctx.answers, ctx);
  for (const r of doc.results) {
    const fits =
      r.kind === 'scoreRange'
        ? totals.score >= r.min && totals.score <= r.max
        : r.kind === 'tag'
          ? tagWinner?.id === r.id
          : evaluateCondition(r.if, ctx);
    if (fits) return { ruleId: r.id, key: r.key, screenId: r.screenId };
  }
  return null;
}
