import { type Block, type BranchTarget, type ProjectDocument, type Screen, type Transition, walkBlocks } from '@blokum/schema';
import { type Rng, type RandomSource } from '../random.js';
import { type AnswerValue, type QuestionBlock, hasPersonalData, isAnswered, isQuestion, normalizeAnswer, requiredProblem } from './answers.js';
import { type ConditionContext, type VariableValue, evaluateCondition } from './conditions.js';
import { FlowError } from './errors.js';
import { type FlowResult, computeResult } from './results.js';
import { correctOptionIds, hasKey, isCorrect, questionScore, scoreTotals } from './scoring.js';

/** State of one passage. Plain data: it is stored in the session and restored after a reload. */
export interface FlowState {
  /** Current screen; null after the end when there is no result screen (the system «Спасибо» screen). */
  screenId: string | null;
  /** Screens visited before the current one, for «назад» (L-01). */
  history: string[];
  answers: Record<string, AnswerValue>;
  variables: Record<string, VariableValue>;
  /** Questions whose key was already shown (instant feedback): their answers can no longer change. */
  locked: string[];
  startedAt: number;
  screenStartedAt: number;
  finished: boolean;
  result: FlowResult | null;
}

/** Everything a step needs besides the document and the state. */
export interface FlowEnv {
  now: number;
  rng: Rng;
  random: RandomSource;
  /** Live visibility from the runtime; without it `initiallyHidden` and `visibleIf` decide. */
  isVisible?: (blockId: string) => boolean;
  blockState?: ConditionContext['blockState'];
}

export interface Navigation {
  state: FlowState;
  /** Screen shown after the step; null — the system end screen. */
  to: string | null;
  /** Transition of the branch that fired; otherwise the target screen's own `transitionIn` applies (T-30). */
  transition?: Transition;
}

export interface AnswerFeedback {
  correct: boolean | null;
  correctOptionIds: string[];
  score: number;
}

const screenById = (doc: ProjectDocument, id: string | null): Screen | undefined => doc.screens.find((s) => s.id === id);

function currentScreen(doc: ProjectDocument, state: FlowState): Screen {
  if (state.finished) throw new FlowError('FINISHED', 'Прохождение уже завершено');
  const s = screenById(doc, state.screenId);
  if (!s) throw new FlowError('UNKNOWN_SCREEN', 'Экран не найден — обновите страницу');
  return s;
}

const contextOf = (doc: ProjectDocument, state: FlowState, env: FlowEnv): ConditionContext => ({
  doc,
  answers: state.answers,
  variables: state.variables,
  rng: env.rng,
  random: env.random,
  ...(env.blockState ? { blockState: env.blockState } : {}),
});

/** A new passage: first screen, initial values of variables (VR-01). */
export function startFlow(doc: ProjectDocument, now: number): FlowState {
  return {
    screenId: doc.screens[0]!.id,
    history: [],
    answers: {},
    variables: Object.fromEntries(doc.variables.map((v) => [v.id, structuredClone(v.initial)])),
    locked: [],
    startedAt: now,
    screenStartedAt: now,
    finished: false,
    result: null,
  };
}

/** Questions of a screen the participant can see now (hidden blocks hide their children too). */
export function visibleQuestions(doc: ProjectDocument, screen: Screen, state: FlowState, env: FlowEnv): QuestionBlock[] {
  const ctx = contextOf(doc, state, env);
  const out: QuestionBlock[] = [];
  const walk = (blocks: readonly Block[]) => {
    for (const b of blocks) {
      const visible = env.isVisible ? env.isVisible(b.id) : !b.initiallyHidden && (!b.visibleIf || evaluateCondition(b.visibleIf, ctx));
      if (!visible) continue;
      if (isQuestion(b)) out.push(b);
      walk(b.children);
    }
  };
  walk(screen.blocks);
  return out;
}

/** Problems that block leaving the screen (L-07), one per question. */
export function requiredProblems(doc: ProjectDocument, state: FlowState, env: FlowEnv): Array<{ blockId: string; message: string }> {
  const screen = currentScreen(doc, state);
  const questions = visibleQuestions(doc, screen, state, env);
  const personal = questions.some((q) => hasPersonalData(q, state.answers[q.id]));
  return questions.flatMap((q) => {
    const message = requiredProblem(q, state.answers[q.id], personal);
    return message ? [{ blockId: q.id, message }] : [];
  });
}

/**
 * Stores an answer to a question on the current screen. In «сразу» feedback mode (L-03) the answer to a
 * question with a key is locked and its feedback is returned; otherwise feedback is null.
 */
export function answerQuestion(doc: ProjectDocument, state: FlowState, blockId: string, value: AnswerValue): { state: FlowState; feedback: AnswerFeedback | null } {
  const screen = currentScreen(doc, state);
  const block = [...walkBlocks(screen.blocks)].find((b) => b.id === blockId);
  if (!block) throw new FlowError('NOT_ON_SCREEN', 'Этого вопроса нет на текущем экране');
  if (!isQuestion(block)) throw new FlowError('NOT_A_QUESTION', 'Этот блок не принимает ответы');
  if (state.locked.includes(blockId)) throw new FlowError('ANSWER_LOCKED', 'Ответ уже засчитан — изменить его нельзя');
  const answer = normalizeAnswer(block, value);
  const instant = doc.settings.feedbackMode === 'instant' && hasKey(block) && isAnswered(answer);
  const next: FlowState = {
    ...state,
    answers: { ...state.answers, [blockId]: answer },
    locked: instant ? [...state.locked, blockId] : state.locked,
  };
  const feedback = instant ? { correct: isCorrect(block, answer), correctOptionIds: correctOptionIds(block), score: questionScore(block, answer) } : null;
  return { state: next, feedback };
}

/** Screens that only results lead to; linear «дальше» skips them. */
const resultTargets = (doc: ProjectDocument) => new Set(doc.results.map((r) => r.screenId));

function finish(doc: ProjectDocument, state: FlowState, env: FlowEnv, transition?: Transition): Navigation {
  const ctx = contextOf(doc, state, env);
  const result = computeResult(doc, scoreTotals(doc, state.answers), ctx);
  const target = result?.screenId && screenById(doc, result.screenId) ? result.screenId : null;
  const history = state.screenId ? [...state.history, state.screenId] : state.history;
  const next: FlowState = { ...state, screenId: target, history, screenStartedAt: env.now, finished: true, result };
  return transition ? { state: next, to: target, transition } : { state: next, to: target };
}

function enter(doc: ProjectDocument, state: FlowState, screenId: string, env: FlowEnv, transition?: Transition): Navigation {
  const screen = screenById(doc, screenId);
  if (!screen) throw new FlowError('UNKNOWN_SCREEN', 'Переход на несуществующий экран');
  const history = state.screenId ? [...state.history, state.screenId] : state.history;
  let next: FlowState = { ...state, screenId, history, screenStartedAt: env.now };
  if (screen.kind === 'result') {
    // Result «по ветке» (L-04): reaching a result screen ends the passage with that screen's result.
    const rule = doc.results.find((r) => r.screenId === screenId);
    next = { ...next, finished: true, result: { ruleId: rule?.id ?? null, key: rule?.key ?? screen.name, screenId } };
  }
  return transition ? { state: next, to: screenId, transition } : { state: next, to: screenId };
}

function linearNext(doc: ProjectDocument, state: FlowState, env: FlowEnv, transition?: Transition): Navigation {
  const targets = resultTargets(doc);
  const index = doc.screens.findIndex((s) => s.id === state.screenId);
  const following = doc.screens.slice(index + 1).find((s) => !targets.has(s.id));
  return following ? enter(doc, state, following.id, env, transition) : finish(doc, state, env, transition);
}

function goToTarget(doc: ProjectDocument, state: FlowState, to: BranchTarget, env: FlowEnv, transition?: Transition): Navigation {
  if (to.kind === 'finish') return finish(doc, state, env, transition);
  if (to.kind === 'screen') return enter(doc, state, to.screenId, env, transition);
  return linearNext(doc, state, env, transition);
}

/**
 * «Дальше» (L-01, L-02, L-07): checks required questions, then the screen's branches in order — the first
 * whose condition holds decides — otherwise the next screen in order; after the last one — the result.
 */
export function nextScreen(doc: ProjectDocument, state: FlowState, env: FlowEnv): Navigation {
  const screen = currentScreen(doc, state);
  const problems = requiredProblems(doc, state, env);
  if (problems.length) throw new FlowError('REQUIRED', problems[0]!.message, problems);
  const ctx = contextOf(doc, state, env);
  const branch = screen.branches.find((b) => evaluateCondition(b.if, ctx));
  return branch ? goToTarget(doc, state, branch.to, env, branch.transition) : linearNext(doc, state, env);
}

/** «Назад» (L-01): to the previous visited screen, if the creator allowed it. Answers are kept. */
export function goBack(doc: ProjectDocument, state: FlowState, env: FlowEnv): Navigation {
  currentScreen(doc, state);
  if (!doc.settings.allowBack) throw new FlowError('BACK_FORBIDDEN', 'В этой сборке нельзя вернуться назад');
  const prev = state.history[state.history.length - 1];
  if (!prev) throw new FlowError('BACK_FORBIDDEN', 'Это первый экран');
  const next: FlowState = { ...state, screenId: prev, history: state.history.slice(0, -1), screenStartedAt: env.now };
  return { state: next, to: prev };
}

/** Timer of the current screen as data (L-06); null when the screen has none. */
export function screenTimer(doc: ProjectDocument, state: FlowState): { seconds: number; endsAt: number; onExpire: BranchTarget } | null {
  const timer = screenById(doc, state.screenId)?.timer;
  return timer ? { seconds: timer.seconds, endsAt: state.screenStartedAt + timer.seconds * 1000, onExpire: timer.onExpire } : null;
}

/** Allowed early arrival of the «time is up» event (clock drift and network), in ms. */
export const TIMER_TOLERANCE_MS = 1000;

/**
 * Time of the screen is up (L-06): goes where the creator set, without the required-answer check.
 * The server refuses an expiry that comes noticeably before the end — a protection against skipping.
 */
export function expireTimer(doc: ProjectDocument, state: FlowState, env: FlowEnv): Navigation {
  currentScreen(doc, state);
  const timer = screenTimer(doc, state);
  if (!timer) throw new FlowError('NO_TIMER', 'На этом экране нет таймера');
  if (env.now + TIMER_TOLERANCE_MS < timer.endsAt) throw new FlowError('TIMER_NOT_EXPIRED', 'Время ещё не вышло');
  return goToTarget(doc, state, timer.onExpire, env);
}

/**
 * Navigation requested by a scenario action (AC-05): «следующий экран», «экран X», «назад», «по ветвлению».
 * Required questions are still checked when moving forward.
 */
export function navigate(
  doc: ProjectDocument,
  state: FlowState,
  to: { to: 'next' | 'back' | 'branch' } | { to: 'screen'; screenId: string },
  env: FlowEnv,
  transition?: Transition,
): Navigation {
  if (to.to === 'back') return goBack(doc, state, env);
  if (to.to === 'branch') return nextScreen(doc, state, env);
  currentScreen(doc, state);
  const problems = requiredProblems(doc, state, env);
  if (problems.length) throw new FlowError('REQUIRED', problems[0]!.message, problems);
  return to.to === 'screen' ? enter(doc, state, to.screenId, env, transition) : linearNext(doc, state, env, transition);
}

/** Feedback at the end (L-03, режим «в конце»): verdict for every question with a key. Empty for «не показывать». */
export function finalFeedback(doc: ProjectDocument, state: FlowState): Array<{ blockId: string } & AnswerFeedback> {
  if (!state.finished || doc.settings.feedbackMode === 'none') return [];
  return doc.screens
    .flatMap((s) => [...walkBlocks(s.blocks)])
    .filter(hasKey)
    .map((b) => ({
      blockId: b.id,
      correct: isCorrect(b, state.answers[b.id]),
      correctOptionIds: correctOptionIds(b),
      score: questionScore(b, state.answers[b.id]),
    }));
}
