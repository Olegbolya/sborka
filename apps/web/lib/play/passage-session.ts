import {
  type AnswerValue,
  FlowError,
  type FlowState,
  type RuntimeEffect,
  type ScoreTotals,
  answerQuestion,
  computeResult,
  createRng,
  createRuntime,
  expireTimer,
  goBack,
  navigate,
  normalizeAnswer,
  runText,
  screenTimer,
  scoreTotals,
  startFlow,
} from '@blokum/engine';
import { type FrameScheduler, RuntimeStore } from '@blokum/renderer';
import { type ProjectDocument, type Screen, walkBlocks } from '@blokum/schema';

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
  /** The end has been sent to the server and the result is awaited. */
  completing: boolean;
}

/** What the player's side of a server passage does with the events of the session (PL-11…PL-15). */
export interface PassageHooks {
  /** An answer was given (already checked here). */
  answer?: (blockId: string, value: AnswerValue, timeOnScreenMs: number) => void;
  /** The place or the variables changed. */
  state?: (state: { screenId: string | null; history: string[]; variables: Record<string, unknown> }) => void;
  /** The end: resolves with what the server worked out (PL-15). */
  complete?: () => Promise<{ totals: ScoreTotals; result: { key: string; screenId: string | null } | null }>;
  /** AC-14 · «записать в ответы»: a labelled value, and (VR-04) at the end the variables kept in the answers. */
  values?: (values: Array<{ variableId?: string; label?: string; value: unknown }>) => void;
  /** RN-01 · randomness that affects the result: the sector a server drew for a wheel, and the stream for the rest. */
  random?: { drawWheel: (blockId: string) => number | undefined; next: () => number };
  /** AC-16, AC-17 · a rule started by a gesture of the participant opens a link or copies a text. */
  openLink?: (url: string) => void;
  copyText?: (text: string) => void;
  /** Branches that read the key of answers are decided by the server (L-02, PL-15): the screen to go to, `null` — the end. */
  branch?: (screenId: string) => Promise<{ to: string | null }>;
}

/** Where a passage continues from after a reload (PL-11). */
export interface PassageResume {
  screenId?: string;
  history?: string[];
  variables?: Record<string, unknown>;
  answers?: Record<string, AnswerValue>;
}

/** Conditions that need the answer key: in the browser they cannot be told (the public document has none). */
const KEY_OPS = new Set(['correct', 'wrong', 'scoreGte', 'scoreLte']);
function needsKey(c: unknown): boolean {
  if (!c || typeof c !== 'object') return false;
  const o = c as { kind?: string; op?: string; items?: unknown[] };
  if (o.kind === 'group') return (o.items ?? []).some(needsKey);
  return o.kind === 'answer' && KEY_OPS.has(o.op ?? '');
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
  private readonly hooks: PassageHooks;
  /** The document the flow rules read: in the player the result rules are the server's, so result screens are marked here as targets no step leads to. */
  private readonly flowDoc: ProjectDocument;
  private totals: ScoreTotals | null = null;
  private completedOnServer = false;
  private completing = false;

  constructor(
    readonly doc: ProjectDocument,
    options: { seed?: number; scheduler?: FrameScheduler; now?: () => number; scoring?: 'local' | 'server'; hooks?: PassageHooks; resume?: PassageResume } = {},
  ) {
    this.scoring = options.scoring ?? 'local';
    this.hooks = options.hooks ?? {};
    // A rule that never fits: the engine then skips the result screens at «дальше» and finishes after the last other screen.
    this.flowDoc = this.scoring === 'server' ? { ...doc, results: doc.screens.filter((sc) => sc.kind === 'result').map((sc) => ({ kind: 'scoreRange' as const, id: `skip_${sc.id}`, key: '', screenId: sc.id, min: Number.POSITIVE_INFINITY, max: Number.POSITIVE_INFINITY })) } : doc;
    const seed = options.seed ?? Math.floor(Math.random() * 2 ** 31);
    this.now = options.now ?? Date.now;
    this.rng = createRng(seed);
    this.runtime = createRuntime(doc, { seed, randomSource: options.hooks?.random ? { next: options.hooks.random.next } : { next: () => Math.random() }, ...(options.hooks?.random ? { drawWheel: options.hooks.random.drawWheel } : {}), startedAt: this.now() });
    this.store = new RuntimeStore(this.runtime, (effects) => this.onEffects(effects), options.scheduler);
    this.flow = startFlow(doc, this.now());
    const resume = options.resume;
    if (resume) {
      if (resume.screenId && doc.screens.some((sc) => sc.id === resume.screenId)) this.flow = { ...this.flow, screenId: resume.screenId, history: (resume.history ?? []).filter((id) => doc.screens.some((sc) => sc.id === id)) };
      this.runtime.setAnswers(resume.answers ?? {});
      for (const [id, value] of Object.entries(resume.variables ?? {})) this.runtime.setVariableValue(id, value as never);
      this.flow = { ...this.flow, answers: { ...(resume.answers ?? {}) } };
    }
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
      completing: this.completing,
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
      else if (e.type === 'record') this.hooks.values?.([{ label: e.label, value: e.value }]);
      else if (e.type === 'openLink') this.hooks.openLink?.(e.url);
      else if (e.type === 'copyText') this.hooks.copyText?.(e.text);
    }
  }

  /** Feedback «правильно / неверно» and score for the block that shows them (L-03). */
  private recordAnswer(blockId: string, value: AnswerValue): void {
    if (this.scoring === 'server') {
      this.recordServerAnswer(blockId, value);
      return;
    }
    try {
      const { state, feedback } = answerQuestion(this.doc, this.synced(), blockId, value);
      this.flow = state;
      if (feedback) this.runtime.setVerdict(blockId, { correct: feedback.correct, score: feedback.score });
    } catch (e) {
      if (!(e instanceof FlowError)) throw e;
    }
  }

  /** The player: the answer is checked as the server will check it (a card number never leaves the browser), then handed over to be sent. */
  private recordServerAnswer(blockId: string, value: AnswerValue): void {
    const block = this.doc.screens.flatMap((sc) => [...walkBlocks(sc.blocks)]).find((b) => b.id === blockId);
    if (!block) return;
    try {
      const answer = normalizeAnswer(block as Parameters<typeof normalizeAnswer>[0], value);
      this.hooks.answer?.(blockId, answer, Math.max(0, this.now() - this.flow.screenStartedAt));
    } catch (e) {
      if (!(e instanceof FlowError)) throw e;
      // Not accepted: the answer is taken back so that «дальше» does not count it, and the person is told why.
      const { [blockId]: _dropped, ...rest } = this.runtime.currentAnswers;
      this.runtime.setAnswers(rest);
      this.message = e.message;
      this.publish();
    }
  }

  private go(to: { to: 'next' | 'back' | 'branch' } | { to: 'screen'; screenId: string }, transition?: Parameters<typeof navigate>[4]): void {
    try {
      const nav = navigate(this.flowDoc, this.synced(), to, this.env(), transition);
      // Branches that read the key of answers are decided by the server; the local step above has checked the required questions.
      const screen = this.doc.screens.find((sc) => sc.id === this.flow.screenId);
      if (this.scoring === 'server' && this.hooks.branch && (to.to === 'next' || to.to === 'branch') && screen?.branches.some((b) => needsKey(b.if))) {
        void this.serverStep(screen.id, nav.state);
        return;
      }
      this.arrive(nav.state, nav.to);
    } catch (e) {
      if (!(e instanceof FlowError)) throw e;
      this.refused(e.message);
    }
  }

  private async serverStep(screenId: string, local: FlowState): Promise<void> {
    try {
      const { to } = await this.hooks.branch!(screenId);
      const target = to ? this.doc.screens.find((sc) => sc.id === to) : null;
      if (target) this.go({ to: 'screen', screenId: target.id });
      else this.arrive({ ...local, screenId: null, finished: true }, null);
    } catch {
      this.refused('Не удалось связаться с сервером. Проверьте сеть и попробуйте ещё раз.');
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
    if (to === null && this.scoring === 'server') {
      this.finishOnServer();
      return;
    }
    // Reaching a result screen on purpose («результат по ветке») ends the passage: the server counts it and the screen stays.
    if (to !== null && this.scoring === 'server' && !this.completedOnServer && this.doc.screens.find((sc) => sc.id === to)?.kind === 'result') {
      this.finishOnServer(to);
      return;
    }
    if (to === null) this.ended = true;
    this.armTimer();
    this.publish();
    this.hooks.state?.(this.stateSnapshot());
  }

  /** The passage was already finished before a reload: the result is asked for again (the server gives the same one). */
  finishAgain(): void {
    this.finishOnServer();
  }

  /** The place of the passage, for saving (PL-11). */
  stateSnapshot(): { screenId: string | null; history: string[]; variables: Record<string, unknown> } {
    return { screenId: this.flow.screenId, history: this.flow.history, variables: { ...this.runtime.variables } };
  }

  /** PL-15 · the passage is over here; the points and the result come from the server, and the result screen after them. */
  private finishOnServer(stayOn?: string): void {
    if (this.completedOnServer) return;
    this.completedOnServer = true;
    this.flow = { ...this.synced(), finished: true };
    if (!this.hooks.complete) {
      this.ended = true;
      this.publish();
      return;
    }
    // VR-04: the variables the creator keeps in the answers go with the end.
    this.hooks.values?.(this.doc.variables.filter((v) => v.saveToAnswers).map((v) => ({ variableId: v.id, value: this.runtime.variables[v.id] })));
    this.completing = true;
    this.publish();
    void this.hooks.complete().then(
      ({ totals, result }) => {
        this.totals = totals;
        this.completing = false;
        this.flow = { ...this.flow, result: result ? { ruleId: null, key: result.key, screenId: result.screenId } : null };
        const screenId = stayOn ?? result?.screenId;
        if (screenId && this.doc.screens.some((sc) => sc.id === screenId)) {
          this.flow = { ...this.flow, screenId, finished: false };
          this.armTimer();
        } else this.ended = true;
        this.publish();
      },
      () => {
        this.completing = false;
        this.message = 'Не удалось получить результат. Проверьте сеть — попробуем ещё раз.';
        this.publish();
      },
    );
  }

  private finish(): void {
    const state = this.synced();
    if (this.scoring === 'server') {
      this.finishOnServer();
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
        const nav = expireTimer(this.flowDoc, this.synced(), this.env());
        this.arrive(nav.state, nav.to);
      } catch (e) {
        if (!(e instanceof FlowError)) throw e;
      }
    }, Math.max(0, t.endsAt - this.now()));
  }

  /** L-04, L-05 · what a variable, an answer or «баллы», «результат»… in a text stands for now. */
  textValue = (run: Parameters<typeof runText>[0]): string | null => runText(run, { doc: this.doc, state: this.synced(), now: this.now(), ...(this.totals ? { totals: this.totals } : {}) });

  /** A word to the participant (the server did not accept an answer…). */
  say(message: string): void {
    this.message = message;
    this.publish();
  }

  /** L-03 · the server's verdict on an answer («сразу»): right or wrong and the points. */
  setVerdict(blockId: string, verdict: { correct: boolean | null; score: number }): void {
    this.runtime.setVerdict(blockId, verdict);
    this.publish();
  }

  /** The preview's own «Назад» (L-01). */
  back(): void {
    try {
      const nav = goBack(this.flowDoc, this.synced(), this.env());
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
