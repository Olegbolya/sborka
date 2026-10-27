import {
  type AnswerValue,
  FlowError,
  type FlowState,
  type RuntimeEffect,
  answerQuestion,
  computeResult,
  createRng,
  createRuntime,
  expireTimer,
  goBack,
  navigate,
  runText,
  screenTimer,
  scoreTotals,
  startFlow,
} from '@blokum/engine';
import { type FrameScheduler, RuntimeStore } from '@blokum/renderer';
import { type ProjectDocument, type Screen } from '@blokum/schema';

export interface PassageView {
  /** Screen on show; null after the end of the passage. */
  screen: Screen | null;
  /** Changes when the same screen has to start over (the debugger's «перезапустить экран»). */
  screenKey: number;
  ended: boolean;
  /** Key of the chosen result (L-04), if the passage had one. */
  resultKey: string | null;
  /** Why «дальше» did not work (required question…), in Russian. */
  message: string | null;
  canGoBack: boolean;
  /** Place in the passage for «экран N из M». */
  progress: { index: number; total: number } | null;
}

/**
 * A passage through the document: the runtime of scenarios and the flow rules of `@blokum/engine`, the same in the
 * editor's preview (E-20: nothing is sent anywhere, so it never reaches answers, analytics or limits) and in the player.
 * The player has only the public document — no answer key, no result rules (PL-15) — so with `scoring: 'server'`
 * feedback and the result are not worked out here; the server's answers are put in by the player.
 */
export class PassageSession {
  readonly runtime;
  readonly store: RuntimeStore;
  private flow: FlowState;
  private screenKey = 0;
  private ended = false;
  private message: string | null = null;
  private view: PassageView;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private readonly listeners = new Set<() => void>();
  private readonly rng;
  private readonly scoring: 'local' | 'server';

  constructor(
    readonly doc: ProjectDocument,
    options: { seed?: number; scheduler?: FrameScheduler; now?: () => number; scoring?: 'local' | 'server' } = {},
  ) {
    this.scoring = options.scoring ?? 'local';
    const seed = options.seed ?? Math.floor(Math.random() * 2 ** 31);
    this.now = options.now ?? Date.now;
    this.rng = createRng(seed);
    this.runtime = createRuntime(doc, { seed, randomSource: { next: () => Math.random() }, startedAt: this.now() });
    this.store = new RuntimeStore(this.runtime, (effects) => this.onEffects(effects), options.scheduler);
    this.flow = startFlow(doc, this.now());
    this.view = this.compute();
    this.armTimer();
  }

  private readonly now: () => number;

  subscribe = (fn: () => void): (() => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };

  getSnapshot = (): PassageView => this.view;

  private env() {
    return { now: this.now(), rng: this.rng, random: { next: () => Math.random() } };
  }

  /** Flow state with what the runtime knows now (it owns answers and variables). */
  private synced(): FlowState {
    return { ...this.flow, answers: { ...this.runtime.currentAnswers }, variables: this.runtime.variables };
  }

  private compute(): PassageView {
    const screen = this.ended ? null : (this.doc.screens.find((s) => s.id === this.flow.screenId) ?? null);
    const index = screen ? this.doc.screens.findIndex((s) => s.id === screen.id) : -1;
    return {
      screen,
      screenKey: this.screenKey,
      ended: this.ended,
      resultKey: this.flow.result?.key ?? null,
      message: this.message,
      canGoBack: !this.ended && this.doc.settings.allowBack && this.flow.history.length > 0,
      progress: this.doc.settings.showProgress && index >= 0 ? { index: index + 1, total: this.doc.screens.length } : null,
    };
  }

  private publish(): void {
    this.view = this.compute();
    for (const l of this.listeners) l();
  }

  private onEffects(effects: RuntimeEffect[]): void {
    for (const e of effects) {
      if (e.type === 'navigate') this.go(e.to === 'screen' && e.screenId ? { to: 'screen', screenId: e.screenId } : { to: e.to === 'screen' ? 'next' : e.to }, e.transition);
      else if (e.type === 'finish') this.finish();
      else if (e.type === 'answer' && e.answer) this.recordAnswer(e.questionBlockId, e.answer);
    }
  }

  /** Feedback «правильно / неверно» and score for the block that shows them (L-03). */
  private recordAnswer(blockId: string, value: AnswerValue): void {
    if (this.scoring === 'server') return;
    try {
      const { state, feedback } = answerQuestion(this.doc, this.synced(), blockId, value);
      this.flow = state;
      if (feedback) this.runtime.setVerdict(blockId, { correct: feedback.correct, score: feedback.score });
    } catch (e) {
      if (!(e instanceof FlowError)) throw e;
    }
  }

  private go(to: { to: 'next' | 'back' | 'branch' } | { to: 'screen'; screenId: string }, transition?: Parameters<typeof navigate>[4]): void {
    try {
      const nav = navigate(this.doc, this.synced(), to, this.env(), transition);
      this.arrive(nav.state, nav.to);
    } catch (e) {
      if (!(e instanceof FlowError)) throw e;
      this.refused(e.message);
    }
  }

  /** The step was not allowed: the screen goes on (the runtime stopped at `goTo`) and shows why. */
  private refused(message: string): void {
    this.runtime.resume();
    this.message = message;
    this.publish();
  }

  private arrive(state: FlowState, to: string | null): void {
    this.flow = state;
    this.message = null;
    if (to === null) this.ended = true;
    this.armTimer();
    this.publish();
  }

  private finish(): void {
    const state = this.synced();
    if (this.scoring === 'server') {
      this.flow = { ...state, finished: true };
      this.ended = true;
      this.publish();
      return;
    }
    const result = computeResult(this.doc, scoreTotals(this.doc, state.answers), { doc: this.doc, answers: state.answers, variables: state.variables, rng: this.rng, random: { next: () => Math.random() } });
    this.flow = { ...state, finished: true, result };
    this.message = null;
    if (result?.screenId) {
      this.flow = { ...this.flow, screenId: result.screenId, finished: false };
      this.armTimer();
    } else {
      this.ended = true;
    }
    this.publish();
  }

  /** L-06: the screen's timer runs out. */
  private armTimer(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    const t = this.ended ? null : screenTimer(this.doc, this.flow);
    if (!t) return;
    this.timer = setTimeout(() => {
      try {
        const nav = expireTimer(this.doc, this.synced(), this.env());
        this.arrive(nav.state, nav.to);
      } catch (e) {
        if (!(e instanceof FlowError)) throw e;
      }
    }, Math.max(0, t.endsAt - this.now()));
  }

  /** L-04, L-05 · what a variable, an answer or «баллы», «результат»… in a text stands for now. */
  textValue = (run: Parameters<typeof runText>[0]): string | null => runText(run, { doc: this.doc, state: this.synced(), now: this.now() });

  /** The preview's own «Назад» (L-01). */
  back(): void {
    try {
      const nav = goBack(this.doc, this.synced(), this.env());
      this.arrive(nav.state, nav.to);
    } catch (e) {
      if (!(e instanceof FlowError)) throw e;
      this.refused(e.message);
    }
  }

  /** SC-03 «перезапуск экрана»: the screen starts over, answers and variables stay. */
  restartScreen(): void {
    this.screenKey += 1;
    this.message = null;
    this.armTimer();
    this.publish();
  }

  /** SC-03: a variable set by hand; false when the value does not fit the variable. */
  setVariable(id: string, value: Parameters<RuntimeStore['setVariable']>[1]): boolean {
    const ok = this.store.setVariable(id, value);
    this.publish();
    return ok;
  }

  dispose(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.store.stop();
    this.listeners.clear();
  }
}
