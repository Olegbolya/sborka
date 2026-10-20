import { type Block, type Condition, type ProjectDocument, walkBlocks } from '@blokum/schema';
import { type Rng, type RandomSource } from '../random.js';
import { type AnswerValue, isAnswered } from './answers.js';
import { isCorrect, questionScore } from './scoring.js';

export type VariableValue = number | string | boolean | Array<number | string>;

/** What a condition can look at. Live block state and rule counters come from the runtime (P1.3). */
export interface ConditionContext {
  /** Only screens are read (answers are looked up there), so the public projection fits too. */
  doc: Pick<ProjectDocument, 'screens'>;
  answers: Readonly<Record<string, AnswerValue>>;
  variables: Readonly<Record<string, VariableValue>>;
  /** Cosmetic randomness (seeded). */
  rng: Rng;
  /** Randomness that affects the result — server-backed (RN-01). */
  random: RandomSource;
  /** CN-03: state of a live block; without a runtime there is no live state and the condition is false. */
  blockState?: (c: Extract<Condition, { kind: 'blockState' }>) => boolean;
  /** CN-04: how many times the current rule has fired. */
  ruleCount?: number;
}

type Op = 'eq' | 'ne' | 'gt' | 'lt' | 'gte' | 'lte' | 'contains' | 'empty';

const norm = (v: unknown) => (typeof v === 'string' ? v.trim().toLocaleLowerCase('ru-RU') : v);

/** Comparison used by CN-01 and CN-04; strings compare case-insensitively, numbers numerically. */
export function compare(left: unknown, op: Op, right: unknown): boolean {
  if (op === 'empty') return left === undefined || left === '' || (Array.isArray(left) && left.length === 0);
  if (op === 'contains') {
    if (Array.isArray(left)) return left.some((x) => norm(x) === norm(right));
    return typeof left === 'string' && right !== undefined && String(norm(left)).includes(String(norm(right)));
  }
  if (op === 'eq' || op === 'ne') {
    const l = typeof left === 'number' && typeof right === 'string' && right.trim() !== '' ? left : norm(left);
    const r = typeof left === 'number' && typeof right === 'string' && right.trim() !== '' ? Number(right.replace(',', '.')) : norm(right);
    const equal = Array.isArray(l) ? Array.isArray(r) && l.length === r.length && l.every((x, i) => x === r[i]) : l === r;
    return op === 'eq' ? equal : !equal;
  }
  const l = Number(left);
  const r = Number(right);
  if (!Number.isFinite(l) || !Number.isFinite(r)) return false;
  return op === 'gt' ? l > r : op === 'lt' ? l < r : op === 'gte' ? l >= r : l <= r;
}

const findBlock = (doc: Pick<ProjectDocument, 'screens'>, id: string): Block | undefined => {
  for (const s of doc.screens) for (const b of walkBlocks(s.blocks)) if (b.id === id) return b;
  return undefined;
};

/** Primary value of an answer for «равен / содержит» comparisons. */
function answerScalar(answer: AnswerValue | undefined): unknown {
  if (!answer) return undefined;
  switch (answer.kind) {
    case 'choice':
      return answer.optionIds;
    case 'ranking':
      return answer.order;
    case 'contacts':
      return Object.values(answer.values).join(' ');
    default:
      return answer.value;
  }
}

function answerCondition(c: Extract<Condition, { kind: 'answer' }>, ctx: ConditionContext): boolean {
  const answer = ctx.answers[c.questionBlockId];
  const block = findBlock(ctx.doc, c.questionBlockId);
  switch (c.op) {
    case 'selected':
    case 'notSelected': {
      const chosen = answer?.kind === 'choice' && c.optionId !== undefined && answer.optionIds.includes(c.optionId);
      return c.op === 'selected' ? chosen : !chosen;
    }
    case 'empty':
      return !isAnswered(answer);
    case 'eq':
      return isAnswered(answer) && compare(answerScalar(answer), 'eq', c.value);
    case 'contains':
      return isAnswered(answer) && compare(answerScalar(answer), 'contains', c.value);
    case 'scoreGte':
    case 'scoreLte': {
      if (!block) return false;
      return compare(questionScore(block, answer), c.op === 'scoreGte' ? 'gte' : 'lte', c.value);
    }
    case 'correct':
    case 'wrong': {
      const verdict = block ? isCorrect(block, answer) : null;
      return verdict !== null && verdict === (c.op === 'correct');
    }
  }
}

/** Evaluates a condition (L-02, CN-01…CN-06). «НЕ» over several items means «ни одно не выполнено». */
export function evaluateCondition(c: Condition, ctx: ConditionContext): boolean {
  switch (c.kind) {
    case 'variable':
      return compare(ctx.variables[c.variableId], c.op, c.value);
    case 'answer':
      return answerCondition(c, ctx);
    case 'blockState':
      return ctx.blockState?.(c) ?? false;
    case 'ruleCount':
      return compare(ctx.ruleCount ?? 0, c.op, c.value);
    case 'chance':
      return (c.affectsResult ? ctx.random.next() : ctx.rng.next()) * 100 < c.percent;
    case 'group':
      if (c.op === 'and') return c.items.every((i) => evaluateCondition(i, ctx));
      if (c.op === 'or') return c.items.some((i) => evaluateCondition(i, ctx));
      return !c.items.some((i) => evaluateCondition(i, ctx));
  }
}
