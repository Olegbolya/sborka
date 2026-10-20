import {
  type Block,
  type BranchRule,
  type ProjectDocument,
  type RichText,
  type Screen,
  createBlock,
  createDocument,
  createId,
  createScreen,
  textOf,
  walkBlocks,
} from '@blokum/schema';
import {
  type AnswerValue,
  type FlowEnv,
  type FlowState,
  FlowError,
  answerQuestion,
  expireTimer,
  goBack,
  nextScreen,
  optionLabel,
  createRng,
  startFlow,
} from '../src/index.js';

export interface Opt {
  text: string;
  correct?: boolean;
  score?: number;
  tags?: string[];
}

type ChoiceBlock = Extract<Block, { type: 'singleChoice' | 'multiChoice' }>;

/** A choice question with options made of text blocks (as the editor creates them). */
export function choice(name: string, options: Array<string | Opt>, opts: { multi?: boolean; required?: boolean; minSelected?: number; maxSelected?: number } = {}): ChoiceBlock {
  const b = createBlock(opts.multi ? 'multiChoice' : 'singleChoice', { name }) as ChoiceBlock;
  const list = options.map((o) => (typeof o === 'string' ? { text: o } : o));
  b.children = list.map((o, i) => createBlock('shape', { name: `Вариант ${i + 1}`, textLayer: textOf(o.text), frame: { x: 0, y: i * 64, w: 326, h: 56 } }));
  b.props.options = list.map((o, i) => ({ id: createId(), blockId: b.children[i]!.id, correct: o.correct ?? false, score: o.score ?? 0, resultTags: o.tags ?? [] }));
  if (opts.required !== undefined) b.props.required = opts.required;
  if (b.type === 'multiChoice') {
    if (opts.minSelected !== undefined) b.props.minSelected = opts.minSelected;
    if (opts.maxSelected !== undefined) b.props.maxSelected = opts.maxSelected;
  }
  return b;
}

export const screen = (name: string, blocks: Block[] = [], extra: Partial<Screen> = {}): Screen => createScreen(name, { blocks, ...extra });

export function doc(screens: Screen[], extra: Partial<Pick<ProjectDocument, 'results' | 'variables'>> & { settings?: Partial<ProjectDocument['settings']> } = {}): ProjectDocument {
  const d = createDocument();
  d.screens = screens;
  if (extra.results) d.results = extra.results;
  if (extra.variables) d.variables = extra.variables;
  if (extra.settings) d.settings = { ...d.settings, ...extra.settings };
  return d;
}

export const branch = (rule: Omit<BranchRule, 'id'>): BranchRule => ({ id: createId(), ...rule });
export const text = (runs: RichText['paragraphs'][number]['runs']): RichText => ({ paragraphs: [{ kind: 'p', runs }] });

/** Finds a block anywhere in the document by its name. */
export function byName(d: ProjectDocument, name: string): Block {
  for (const s of d.screens) for (const b of walkBlocks(s.blocks)) if (b.name === name) return b;
  throw new Error(`нет блока «${name}»`);
}

/** Option id by its visible text. */
export function opt(d: ProjectDocument, question: string, label: string): string {
  const q = byName(d, question) as ChoiceBlock;
  const o = q.props.options.find((x) => optionLabel(q, x.id) === label);
  if (!o) throw new Error(`нет варианта «${label}»`);
  return o.id;
}

export const env = (now = 0, random = 0.5, seed = 1): FlowEnv => ({ now, rng: createRng(seed), random: { next: () => random } });

export type Step =
  | { answer: string; choose: string[] }
  | { answer: string; value: AnswerValue }
  | { do: 'next' | 'back' }
  | { wait: number }
  | { do: 'timer' };

export interface Run {
  state: FlowState;
  /** Names of screens shown, «∎» — the system end screen. */
  path: string[];
  error?: FlowError;
  feedback: unknown[];
}

/** Plays the steps of a participant; stops at the first flow error. */
export function play(d: ProjectDocument, steps: Step[], opts: { random?: number } = {}): Run {
  let now = 0;
  let state = startFlow(d, now);
  const name = (id: string | null) => (id ? (d.screens.find((s) => s.id === id)?.name ?? '?') : '∎');
  const path = [name(state.screenId)];
  const feedback: unknown[] = [];
  try {
    for (const step of steps) {
      const e = env(now, opts.random ?? 0.5);
      if ('wait' in step) now += step.wait;
      else if ('answer' in step) {
        const value: AnswerValue = 'choose' in step ? { kind: 'choice', optionIds: step.choose.map((l) => opt(d, step.answer, l)) } : step.value;
        const r = answerQuestion(d, state, byName(d, step.answer).id, value);
        state = r.state;
        if (r.feedback) feedback.push(r.feedback);
      } else {
        const nav = step.do === 'next' ? nextScreen(d, state, e) : step.do === 'back' ? goBack(d, state, e) : expireTimer(d, state, e);
        state = nav.state;
        path.push(name(nav.to));
      }
    }
  } catch (err) {
    if (!(err instanceof FlowError)) throw err;
    return { state, path, error: err, feedback };
  }
  return { state, path, feedback };
}
