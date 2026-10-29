import {
  type Action,
  type Block,
  type BlockStyle,
  type Condition,
  GESTURE_TRIGGERS,
  type ProjectDocument,
  type Rule,
  SCENARIO_LIMITS,
  type Screen,
  type Source,
  type Target,
  type Trigger,
  type ParsedValue,
  type Variable,
  isSafeHref,
  parseFrameValue,
  resolveBlockStyle,
  walkBlocks,
} from '@blokum/schema';
import { type AnswerValue, isQuestion } from '../flow/answers.js';
import { type ConditionContext, type VariableValue, compare, evaluateCondition } from '../flow/conditions.js';
import { type RandomSource, type Rng, createRng } from '../random.js';
import { type BehaviorOf, applyEdge, behaviorOf, constrainDrag, fleeTarget, followShare, type PathTrack, pathTrack, pointAt, spinWheel, startVelocity } from './behaviors.js';
import { easingFunction } from './easing.js';
import { type Box, SpatialGrid } from './grid.js';

/** Width of the artboard in units (E-01): the screen area of moving and fleeing blocks. */
const ARTBOARD_WIDTH = 390;
import { type Animatable, type BlockView, type RuntimeDebug, type RuntimeEvent, type SettableProperty, type StepResult } from './types.js';

/** What the runtime needs from a document: the public projection (PL-15) is enough. */
export type RuntimeDocument = Pick<ProjectDocument, 'screens' | 'rules' | 'variables'> & { theme?: Pick<ProjectDocument['theme'], 'tokens'> };

export interface RuntimeOptions {
  /** Seed of cosmetic randomness (spawn positions, shuffles, cosmetic chance). Same seed → same run. */
  seed: number;
  /** Randomness that affects the result (CN-05 with the flag); the player passes a server-backed one (RN-01). */
  randomSource?: RandomSource;
  /**
   * RN-01 · the sector the server drew for a wheel (its index), asked for when the wheel is spun; `undefined` — no draw is
   * available and the runtime draws by itself (the preview, tests).
   */
  drawWheel?: (blockId: string, sectorCount: number) => number | undefined;
  /** Wall-clock time of the start, ms since epoch — for B-08 timers «до даты». */
  startedAt?: number;
  /** SC-03 · the debugger of the preview listens to the rules (nothing changes in the run itself). */
  debug?: RuntimeDebug;
  /** AC-02 · checker of values of `style.*`, `textLayer` and `props.media` (`parseSettableValue` of the schema); the player has none. */
  parseValue?: ValueParser;
}

/** Checker of a value for a settable property (AC-02). */
export type ValueParser = (property: SettableProperty, value: unknown) => ParsedValue;

type ActionLeafOf<K extends Action['kind']> = Extract<Action, { kind: K }>;
type SetVariable = ActionLeafOf<'setVariable'>;

interface Instance {
  id: string;
  protoId: string;
  copy: boolean;
  block: Block;
  /** Effective style with the theme's defaults (TH-06) — the starting point of animations. */
  base: BlockStyle;
  parentId: string | null;
  children: string[];
  x: number;
  y: number;
  w: number;
  h: number;
  rotation: number;
  z: number;
  visible: boolean;
  animateVisibility: boolean;
  interactive: boolean;
  destroyed: boolean;
  dragging: boolean;
  zoneId: string | null;
  media: BlockView['media'];
  overrides: Partial<Record<SettableProperty, unknown>>;
  anim: Partial<Record<Animatable, number>>;
  vx: number;
  vy: number;
  ay: number;
  /** BH-01: where the drag started (for the axis and «вернуть на место»). */
  dragFrom: { x: number; y: number } | null;
  /** BH-02: how many times it has already run away. */
  fled: number;
  /** BH-04 «по своему контуру»: the sampled contour, its start and the distance covered. */
  track: { path: PathTrack; origin: { x: number; y: number }; distance: number; speed: number } | null;
  /** BH-08: the point the block follows (its own coordinates). */
  followTo: { x: number; y: number } | null;
  /** BH-07: the back side is shown. */
  flipped: boolean;
  /** BH-06: the wheel is spinning; the sector it stopped on. */
  spinning: boolean;
  winner: string | null;
}

interface RuleEntry {
  rule: Rule;
  order: number;
}

interface Frame {
  actions: readonly Action[];
  i: number;
  loop?: { times: number | undefined; count: number; while: Condition | undefined };
}

interface Job {
  entry: RuleEntry;
  self: string | undefined;
  stack: Frame[];
  /** Started by a gesture of the participant (TS-07). */
  gesture: boolean;
  /** Continued after «Подождать»: the gesture is over, links can no longer be opened. */
  resumed: boolean;
  depth: number;
}

interface Tween {
  inst: Instance;
  prop: Animatable;
  from: number;
  to: number;
  start: number;
  duration: number;
  ease: (t: number) => number;
}

interface Scheduled {
  at: number;
  seq: number;
  run: () => void;
}

interface TimerState {
  running: boolean;
  elapsed: number;
  duration: number;
  ended: boolean;
}

const FRAME_PROPS: Partial<Record<Animatable, 'x' | 'y' | 'w' | 'h' | 'rotation'>> = { x: 'x', y: 'y', w: 'w', h: 'h', rotation: 'rotation' };
const FRAME_SETTABLE: Partial<Record<SettableProperty, 'x' | 'y' | 'w' | 'h' | 'rotation'>> = {
  'frame.x': 'x',
  'frame.y': 'y',
  'frame.w': 'w',
  'frame.h': 'h',
  'frame.rotation': 'rotation',
};

/** Message shown in the debugger and at publishing when a rule runs away (SC-04). */
export const LOOP_WARNING = 'Похоже на бесконечный цикл';

/**
 * Checks an AC-02 value for a property path. Frame properties are checked here; every other one by the checker the host gives
 * (`RuntimeOptions.parseValue`). Without one the value is taken as it is: the player runs published documents, whose values
 * were checked at publishing (INVALID_PROPERTY_VALUE).
 */
function parseProperty(property: SettableProperty, value: unknown, parseValue: ValueParser | undefined): ParsedValue {
  return parseFrameValue(property, value) ?? (parseValue ? parseValue(property, value) : { ok: true, value });
}

/** Current numeric value of an animatable property: animation → AC-02 override → the block's style. */
function numberOf(inst: Instance, prop: Animatable): number {
  const frame = FRAME_PROPS[prop];
  if (frame) return inst[frame];
  const animated = inst.anim[prop];
  if (animated !== undefined) return animated;
  const style = inst.base;
  const effects = (inst.overrides['style.effects'] as typeof style.effects | undefined) ?? style.effects;
  const t3d = (inst.overrides['style.transform3d'] as typeof style.transform3d | undefined) ?? style.transform3d;
  const filters = (inst.overrides['style.filters'] as typeof style.filters | undefined) ?? style.filters;
  switch (prop) {
    case 'opacity':
    case 'blur':
    case 'backdropBlur':
      return effects[prop];
    case 'rotateX':
    case 'rotateY':
      return t3d[prop];
    case 'brightness':
    case 'contrast':
    case 'saturate':
    case 'grayscale':
    case 'hueRotate':
      return filters[prop];
    default:
      return 1; // scale
  }
}

type OpResult = { ok: true; value: VariableValue } | { ok: false; error: string };
const ok = (value: VariableValue): OpResult => ({ ok: true, value });
const err = (error: string): OpResult => ({ ok: false, error });

/** Value of a variable after an AC-04 operation, or an error text. */
function applyVariableOp(variable: Variable, current: VariableValue, a: SetVariable, rng: Rng, vars: Readonly<Record<string, VariableValue>>): OpResult {
  const num = (v: unknown) => (typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v.replace(',', '.')) : Number.NaN);
  switch (variable.type) {
    case 'number': {
      const cur = current as number;
      if (a.op === 'random') {
        const min = a.min ?? 0;
        const max = a.max ?? 100;
        if (max < min) return err('Неверный диапазон случайного числа');
        return ok(Number.isInteger(min) && Number.isInteger(max) ? rng.int(min, max) : min + rng.next() * (max - min));
      }
      if (a.op === 'pickRandom') return pickFrom(a, rng, vars, (x) => typeof x === 'number');
      if (!['set', 'add', 'sub', 'mul', 'div'].includes(a.op)) return err('Действие недоступно для числа');
      const v = num(a.value);
      if (!Number.isFinite(v)) return err('Для числовой переменной нужно число');
      if (a.op === 'set') return ok(v);
      if (a.op === 'add') return ok(cur + v);
      if (a.op === 'sub') return ok(cur - v);
      if (a.op === 'mul') return ok(cur * v);
      return v === 0 ? err('Деление на ноль') : ok(cur / v);
    }
    case 'text':
      if (a.op === 'set') return ok(a.value === undefined ? '' : String(a.value));
      if (a.op === 'add' || a.op === 'append') return ok((current as string) + (a.value === undefined ? '' : String(a.value)));
      if (a.op === 'pickRandom') return pickFrom(a, rng, vars, (x) => typeof x === 'string');
      return err('Действие недоступно для текста');
    case 'bool':
      if (a.op === 'toggle') return ok(!(current as boolean));
      if (a.op === 'set') return ok(a.value === true || a.value === 'true' || a.value === 'да' || a.value === 1);
      return err('Действие недоступно для «да/нет»');
    case 'list': {
      const list = current as Array<number | string>;
      if (a.op === 'set') return ok(a.value === undefined || typeof a.value === 'boolean' ? [] : [a.value]);
      if (a.op === 'append' || a.op === 'add') {
        if (a.value === undefined || typeof a.value === 'boolean') return err('В список можно добавить число или текст');
        return list.length >= 500 ? err('В списке уже 500 элементов') : ok([...list, a.value]);
      }
      if (a.op === 'remove') {
        const idx = list.findIndex((x) => compare(x, 'eq', a.value));
        return ok(idx === -1 ? list : list.filter((_, i) => i !== idx));
      }
      if (a.op === 'random' || a.op === 'pickRandom') return ok(rng.shuffle(list));
      return err('Действие недоступно для списка');
    }
  }
}

/** «Случайный элемент списка»: `value` names the list variable (by id). */
function pickFrom(a: SetVariable, rng: Rng, vars: Readonly<Record<string, VariableValue>>, fits: (x: unknown) => boolean): OpResult {
  const source = typeof a.value === 'string' ? vars[a.value] : undefined;
  if (!Array.isArray(source)) return err('Укажите переменную-список, из которой выбирать');
  const items = source.filter(fits);
  if (items.length === 0) return err('В списке нет подходящих элементов');
  return ok(rng.pick(items));
}

/**
 * Deterministic scenario machine (P1.3): no React, DOM or timers of its own. The player feeds it events
 * (`dispatch`) and time (`tick`), renders `views()` and performs the returned effects.
 */
export class Runtime {
  private readonly rng: Rng;
  private readonly random: RandomSource;
  private readonly drawWheel: RuntimeOptions['drawWheel'];
  private readonly parseValue: RuntimeOptions['parseValue'];
  private readonly startedAt: number;
  /** Time since the start of the passage, ms. */
  private time = 0;
  private screen: Screen | undefined;
  private readonly instances = new Map<string, Instance>();
  private rules: RuleEntry[] = [];
  private byTrigger = new Map<Trigger['kind'], RuleEntry[]>();
  private readonly vars: Record<string, VariableValue>;
  private readonly variableDefs: Map<string, Variable>;
  private answers: Record<string, AnswerValue> = {};
  private readonly verdicts = new Map<string, { correct: boolean | null; score: number }>();
  /** CN-04 counters and «один раз» flags live for the whole passage. */
  private readonly fireCounts = new Map<string, number>();
  private readonly firedOnce = new Set<string>();
  private readonly debug: RuntimeDebug | undefined;
  /** SC-03 · step mode: rules wait before each action; the debugger lets them go one by one. */
  private stepMode = false;
  private stepTicket = false;
  private readonly paused: Job[] = [];
  private stopped = new Set<string>();
  private tweens: Tween[] = [];
  private scheduled: Scheduled[] = [];
  private seq = 0;
  private copySeq = 0;
  private zOrder = 0;
  private timers = new Map<string, TimerState>();
  private collisions = new Map<string, Set<string>>();
  private scratched = new Set<string>();
  /** BH-05: copy spawners of the screen — running or not and when the next copy appears. */
  private spawners = new Map<string, { active: boolean; next: number }>();
  /** No more events or actions on this screen (navigation requested or the screen is being left). */
  private halted = false;
  /** «Уход с экрана» already fired. */
  private left = false;
  private copyLimitWarned = false;
  private window = { start: 0, steps: 0 };
  /** Debug counters (SC-03): actions executed in total and the most in one second. */
  readonly stats = { steps: 0, peakStepsPerSecond: 0 };
  private out: StepResult = { effects: [], changed: [], spawned: [], destroyed: [], variables: {} };
  private readonly changed = new Set<string>();

  constructor(
    private readonly doc: RuntimeDocument,
    options: RuntimeOptions,
  ) {
    this.rng = createRng(options.seed);
    this.random = options.randomSource ?? createRng((options.seed ^ 0x9e3779b9) >>> 0);
    this.drawWheel = options.drawWheel;
    this.parseValue = options.parseValue;
    this.debug = options.debug;
    this.startedAt = options.startedAt ?? 0;
    this.vars = Object.fromEntries(doc.variables.map((v) => [v.id, structuredClone(v.initial)]));
    this.variableDefs = new Map(doc.variables.map((v) => [v.id, v]));
  }

  // ── Public API ─────────────────────────────────────────────────────────────

  /** Current screen id, if any. */
  get screenId(): string | undefined {
    return this.screen?.id;
  }

  /** Current time of the passage, ms. */
  get now(): number {
    return this.time;
  }

  /** SC-03 · step mode of the debugger: with it on, each rule stops before every action; with it off, the waiting ones run on. */
  setStepMode(on: boolean): StepResult {
    this.begin();
    this.stepMode = on;
    if (!on) for (const job of this.paused.splice(0)) this.run(job);
    return this.end();
  }

  /** How many rules wait for a step. */
  get pausedRules(): number {
    return this.paused.length;
  }

  /** SC-03 · lets one action of the oldest waiting rule run; null when nothing waits. */
  stepOnce(): StepResult | null {
    const job = this.paused.shift();
    if (!job) return null;
    this.begin();
    this.stepTicket = true;
    this.run(job);
    this.stepTicket = false;
    return this.end();
  }

  /** Variables of the passage (VR-01): a copy, the runtime owns the values. */
  get variables(): Record<string, VariableValue> {
    return structuredClone(this.vars);
  }

  /**
   * SC-03: the debugger of the preview sets a variable by hand. It is a normal change: «значение» blocks redraw and
   * rules «переменная изменилась» fire. `ok` is false when the variable does not exist or the value does not fit
   * its type (number, text up to 1000 characters, yes/no, list).
   */
  setVariableValue(variableId: string, value: VariableValue): { ok: boolean; step: StepResult } {
    this.begin();
    const def = this.variableDefs.get(variableId);
    const fits =
      def !== undefined &&
      ((def.type === 'number' && typeof value === 'number' && Number.isFinite(value)) ||
        (def.type === 'text' && typeof value === 'string' && value.length <= 1000) ||
        (def.type === 'bool' && typeof value === 'boolean') ||
        (def.type === 'list' && Array.isArray(value)));
    if (!fits || compare(this.vars[variableId]!, 'eq', value)) return { ok: fits, step: this.end() };
    this.vars[variableId] = structuredClone(value);
    this.out.variables[variableId] = structuredClone(value);
    this.touchUsers(variableId);
    if (this.screen && !this.halted) {
      this.fireMatching('variableChange', (t) => (t as Extract<Trigger, { kind: 'variableChange' }>).variableId === variableId, undefined, false, 0);
    }
    return { ok: true, step: this.end() };
  }

  /** Shows a screen: builds its blocks, starts its timers and fires «показ экрана» (TR-09). */
  enterScreen(screenId: string): StepResult {
    this.begin();
    const screen = this.doc.screens.find((s) => s.id === screenId);
    if (!screen) throw new RangeError(`Экран ${screenId} не найден`);
    this.screen = screen;
    this.instances.clear();
    this.tweens = [];
    this.scheduled = [];
    this.timers.clear();
    this.collisions.clear();
    this.scratched.clear();
    this.stopped = new Set();
    this.halted = false;
    this.left = false;
    this.copyLimitWarned = false;
    this.zOrder = 0;
    for (const b of screen.blocks) this.build(b, null, b.id, false);
    this.shuffleOptions();
    this.spawners = new Map();
    for (const inst of this.instances.values()) {
      const sp = behaviorOf(inst.block, 'spawner');
      if (sp && !inst.copy) this.spawners.set(inst.id, { active: sp.autoStart, next: this.time + sp.everyMs });
    }
    this.collectRules(screen);
    for (const inst of this.instances.values()) {
      if (inst.block.type === 'timer' && !inst.copy) this.timers.set(inst.id, this.newTimer(inst.block));
    }
    for (const entry of this.byTrigger.get('timer') ?? []) {
      const t = entry.rule.when as Extract<Trigger, { kind: 'timer' }>;
      if (t.mode === 'timerEnd' || t.seconds === undefined) continue;
      const period = t.seconds * 1000;
      const start = this.time;
      if (t.mode === 'after') this.schedule(start + period, () => this.fire(entry, undefined, false, 0));
      else this.scheduleEvery(entry, start + period, period);
    }
    for (const entry of this.byTrigger.get('screen') ?? []) {
      if ((entry.rule.when as Extract<Trigger, { kind: 'screen' }>).phase === 'show') this.fire(entry, undefined, false, 0);
    }
    for (const inst of this.instances.values()) this.touch(inst);
    return this.end();
  }

  /**
   * The host refused the navigation a rule asked for (a required question is not answered, there is no way back):
   * the screen was frozen by `goTo`/`finish` and now goes on, so the participant can answer and press «дальше» again.
   */
  resume(): void {
    if (this.screen && !this.left) this.halted = false;
  }

  /** The screen is about to be left: fires «уход с экрана» (TR-09) and ignores everything until the next screen. */
  leaveScreen(): StepResult {
    this.begin();
    if (this.screen && !this.left) {
      this.left = true;
      this.halted = false;
      for (const entry of this.byTrigger.get('screen') ?? []) {
        if ((entry.rule.when as Extract<Trigger, { kind: 'screen' }>).phase === 'leave') this.fire(entry, undefined, false, 0);
      }
      // Navigation requested by «уход с экрана» is ignored: the screen is already being left.
      this.out.effects = this.out.effects.filter((e) => e.type !== 'navigate' && e.type !== 'finish');
    }
    this.halted = true;
    return this.end();
  }

  /** Answers of the passage so far (the player draws them: chosen options, typed text, scale value). */
  get currentAnswers(): Readonly<Record<string, AnswerValue>> {
    return this.answers;
  }

  /** Answers already given in the passage (restored after a reload); they do not fire TR-12. */
  setAnswers(answers: Readonly<Record<string, AnswerValue>>): void {
    this.answers = { ...answers };
  }

  /** Verdict of the server for a question (L-03): lets «правильно / неверно / баллы» work in the browser. */
  setVerdict(questionBlockId: string, verdict: { correct: boolean | null; score: number }): void {
    this.verdicts.set(questionBlockId, verdict);
  }

  /** Motion used by behaviors (BH-04, BH-05): velocity in units per second and gravity. */
  setMotion(id: string, motion: { vx: number; vy: number; ay?: number }): void {
    const inst = this.live(id);
    if (!inst) return;
    inst.vx = motion.vx;
    inst.vy = motion.vy;
    inst.ay = motion.ay ?? 0;
  }

  /** Remaining time of a B-08 timer, ms. */
  /** Milliseconds left on a timer block (B-08); undefined when the screen has no such timer. */
  timerRemaining(blockId: string): number | undefined {
    const t = this.timers.get(blockId);
    return t ? Math.max(0, t.duration - t.elapsed) : undefined;
  }

  view(id: string): BlockView | undefined {
    const inst = this.instances.get(id);
    return inst && !inst.destroyed ? this.toView(inst) : undefined;
  }

  /** Everything the renderer draws, in paint order. */
  views(): BlockView[] {
    return [...this.instances.values()].filter((i) => !i.destroyed).sort((a, b) => a.z - b.z).map((i) => this.toView(i));
  }

  dispatch(event: RuntimeEvent): StepResult {
    this.begin();
    if (!this.screen || this.halted) return this.end();
    switch (event.type) {
      case 'tap':
      case 'doubleTap':
        this.gesture(event.blockId, (inst) => {
          if (event.type === 'tap') {
            const wheel = behaviorOf(inst.block, 'wheel');
            if (wheel) this.spin(inst, wheel);
            const flip = behaviorOf(inst.block, 'flip');
            if (flip?.on === 'tap') this.flip(inst, flip);
          }
          this.fireMatching(event.type, (t) => this.matches(inst, (t as { source: Source }).source), inst.id, true);
        });
        break;
      case 'longPress':
        this.gesture(event.blockId, (inst) =>
          this.fireMatching('longPress', (t) => this.matches(inst, (t as Extract<Trigger, { kind: 'longPress' }>).source) && event.ms >= (t as Extract<Trigger, { kind: 'longPress' }>).ms, inst.id, true),
        );
        break;
      case 'hover':
        this.gesture(event.blockId, (inst) =>
          this.fireMatching('hover', (t) => this.matches(inst, (t as Extract<Trigger, { kind: 'hover' }>).source) && (t as Extract<Trigger, { kind: 'hover' }>).phase === event.phase, inst.id, true),
        );
        break;
      case 'dragStart':
        this.gesture(event.blockId, (inst) => {
          inst.dragging = true;
          inst.zoneId = null;
          inst.dragFrom = { x: inst.x, y: inst.y };
          this.cancelTween(inst, 'x');
          this.cancelTween(inst, 'y');
          this.touch(inst);
          this.fireDrag(inst, 'start');
        });
        break;
      case 'dragMove':
        this.gesture(event.blockId, (inst) => {
          if (!inst.dragging) return;
          const drag = behaviorOf(inst.block, 'drag');
          const to = drag ? constrainDrag(drag, inst.dragFrom ?? inst, event, inst) : event;
          inst.x = to.x;
          inst.y = to.y;
          this.touch(inst);
        });
        break;
      case 'dragEnd':
        this.gesture(event.blockId, (inst) => this.dragEnd(inst, event.x, event.y));
        break;
      case 'swipe':
        this.swipe(event.direction, event.blockId);
        break;
      case 'answer': {
        this.setAnswer(event.questionBlockId, event.answer, 0, true);
        // B-11 «перейти сразу после выбора»: the participant's choice moves on by the screen's branches.
        const q = this.live(event.questionBlockId);
        if (q?.block.type === 'singleChoice' && q.block.props.autoAdvance && event.answer?.kind === 'choice' && event.answer.optionIds.length > 0) {
          this.out.effects.push({ type: 'navigate', to: 'branch' });
        }
        break;
      }
      case 'mediaEnd': {
        const inst = this.live(event.blockId);
        if (!inst) break;
        inst.media = 'stopped';
        this.touch(inst);
        this.fireMatching('mediaEnd', (t) => this.matches(inst, (t as Extract<Trigger, { kind: 'mediaEnd' }>).source), inst.id, false);
        // B-04 «дальше после окончания»: the end of the video moves on by the screen's branches.
        if (inst.block.type === 'video' && inst.block.props.nextOnEnd && !inst.copy) this.out.effects.push({ type: 'navigate', to: 'branch' });
        break;
      }
      case 'scratched': {
        const inst = this.live(event.blockId);
        if (!inst) break;
        for (const entry of this.byTrigger.get('scratched') ?? []) {
          const t = entry.rule.when as Extract<Trigger, { kind: 'scratched' }>;
          const key = `${entry.rule.id}|${inst.id}`;
          if (!this.matches(inst, t.source) || event.percent < t.percent || this.scratched.has(key)) continue;
          this.scratched.add(key);
          this.fire(entry, inst.id, false, 0);
        }
        break;
      }
      case 'deviceMotion':
        this.fireMatching('deviceMotion', (t) => (t as Extract<Trigger, { kind: 'deviceMotion' }>).motion === event.motion, undefined, false);
        break;
      case 'key':
        this.fireMatching('key', (t) => (t as Extract<Trigger, { kind: 'key' }>).key.toLowerCase() === event.key.toLowerCase(), undefined, true);
        break;
      case 'pointer':
        this.pointer(event.x, event.y);
        break;
    }
    return this.end();
  }

  /** Advances time: scheduled actions and timers, smooth changes, motion, collisions (TR-07). */
  tick(dtMs: number): StepResult {
    this.begin();
    const target = this.time + Math.max(0, dtMs);
    if (!this.screen || this.halted) {
      this.time = target;
      return this.end();
    }
    let guard = 0;
    for (;;) {
      const next = this.scheduled[0];
      if (!next || next.at > target || this.halted) break;
      this.scheduled.shift();
      this.time = Math.max(this.time, next.at);
      next.run();
      if (++guard > 10000) break;
    }
    const dt = target - this.time;
    this.time = target;
    if (this.halted) return this.end();
    this.advanceTimers(dt);
    this.advanceSpawners();
    this.advanceTweens();
    this.advanceMotion(dt);
    this.advanceFollow(dt);
    this.detectCollisions();
    return this.end();
  }

  // ── Building ──────────────────────────────────────────────────────────────

  private build(b: Block, parentId: string | null, id: string, copy: boolean, at?: { x: number; y: number }): Instance {
    const inst: Instance = {
      id,
      protoId: b.id,
      copy,
      block: b,
      base: resolveBlockStyle(b, this.doc.theme?.tokens),
      parentId,
      children: [],
      x: at?.x ?? b.frame.x,
      y: at?.y ?? b.frame.y,
      w: b.frame.w,
      h: b.frame.h,
      rotation: b.frame.rotation,
      z: b.z * 100000 + this.zOrder++,
      visible: copy ? true : !b.initiallyHidden,
      animateVisibility: false,
      interactive: true,
      destroyed: false,
      dragging: false,
      zoneId: null,
      media: b.type === 'video' || b.type === 'audio' || b.type === 'gif' || b.type === 'animation' ? 'stopped' : null,
      overrides: {},
      anim: {},
      vx: 0,
      vy: 0,
      ay: 0,
      dragFrom: null,
      fled: 0,
      track: null,
      followTo: null,
      flipped: false,
      spinning: false,
      winner: null,
    };
    // BH-04: a moving block starts with its velocity (copies get their own random spread).
    const move = behaviorOf(b, 'move');
    if (move) {
      if (move.path) inst.track = { path: pathTrack(move.path), origin: { x: inst.x, y: inst.y }, distance: 0, speed: move.speed };
      else Object.assign(inst, startVelocity(move, this.rng), { ay: move.gravity });
    }
    this.instances.set(id, inst);
    for (const child of b.children) {
      const childId = copy ? `${child.id}~${this.copySeq}` : child.id;
      inst.children.push(this.build(child, id, childId, copy).id);
    }
    return inst;
  }

  private collectRules(screen: Screen): void {
    let order = 0;
    const entries: RuleEntry[] = [];
    for (const rule of this.doc.rules) entries.push({ rule, order: order++ });
    for (const rule of screen.rules) entries.push({ rule, order: order++ });
    for (const b of walkBlocks(screen.blocks)) for (const rule of b.rules) entries.push({ rule, order: order++ });
    this.rules = entries.filter((e) => e.rule.enabled).sort((a, b) => b.rule.priority - a.rule.priority || a.order - b.order);
    this.byTrigger = new Map();
    for (const e of this.rules) {
      const list = this.byTrigger.get(e.rule.when.kind);
      if (list) list.push(e);
      else this.byTrigger.set(e.rule.when.kind, [e]);
    }
  }

  private newTimer(b: Block): TimerState {
    const props = b.type === 'timer' ? b.props : undefined;
    let duration = (props?.seconds ?? 60) * 1000;
    if (props?.mode === 'until' && props.until) duration = Math.max(0, Date.parse(props.until) - (this.startedAt + this.time));
    return { running: props?.autoStart ?? true, elapsed: 0, duration, ended: false };
  }

  // ── Step bookkeeping ──────────────────────────────────────────────────────

  private begin(): void {
    this.out = { effects: [], changed: [], spawned: [], destroyed: [], variables: {} };
    this.changed.clear();
  }

  private end(): StepResult {
    this.out.changed = [...this.changed];
    return this.out;
  }

  /** Does the block show the variable: a «значение» or «прогресс» block, or a text with the variable in it (L-05)? */
  private usesVariable(block: Block, variableId: string): boolean {
    if ((block.type === 'value' || block.type === 'progress') && block.props.variableId === variableId) return true;
    return block.textLayer?.paragraphs.some((p) => p.runs.some((r) => 'v' in r && r.v === variableId)) ?? false;
  }

  /** Blocks that show a variable are drawn again when it changes. */
  private touchUsers(variableId: string): void {
    for (const inst of this.instances.values()) if (this.usesVariable(inst.block, variableId)) this.touch(inst);
  }

  private touch(inst: Instance): void {
    this.changed.add(inst.id);
  }

  private warn(ruleId: string, message: string): void {
    this.out.effects.push({ type: 'warning', ruleId, message });
  }

  private schedule(at: number, run: () => void): void {
    const item = { at, seq: this.seq++, run };
    let i = this.scheduled.length;
    while (i > 0 && (this.scheduled[i - 1]!.at > at || (this.scheduled[i - 1]!.at === at && this.scheduled[i - 1]!.seq > item.seq))) i--;
    this.scheduled.splice(i, 0, item);
  }

  private scheduleEvery(entry: RuleEntry, at: number, period: number): void {
    this.schedule(at, () => {
      this.fire(entry, undefined, false, 0);
      if (!this.halted && !this.stopped.has(entry.rule.id)) this.scheduleEvery(entry, at + period, period);
    });
  }

  /** SC-04: one step of the action budget; false when the rule must stop. */
  private consume(): boolean {
    const second = Math.floor(this.time / 1000) * 1000;
    if (second !== this.window.start) this.window = { start: second, steps: 0 };
    this.window.steps += 1;
    if (this.window.steps > SCENARIO_LIMITS.stepsPerSecond) return false;
    this.stats.steps += 1;
    this.stats.peakStepsPerSecond = Math.max(this.stats.peakStepsPerSecond, this.window.steps);
    return true;
  }

  private stopRule(rule: Rule, reason: string): void {
    this.stopped.add(rule.id);
    this.warn(rule.id, `${LOOP_WARNING}: правило «${rule.name ?? 'без имени'}» остановлено (${reason})`);
  }

  // ── Matching and firing ───────────────────────────────────────────────────

  private live(id: string): Instance | undefined {
    const inst = this.instances.get(id);
    return inst && !inst.destroyed ? inst : undefined;
  }

  /** A gesture reaches only a visible, interactive block (AC-18). */
  private gesture(id: string, run: (inst: Instance) => void): void {
    const inst = this.live(id);
    if (!inst || !inst.interactive || !this.isShown(inst)) return;
    run(inst);
  }

  private isShown(inst: Instance): boolean {
    for (let cur: Instance | undefined = inst; cur; cur = cur.parentId ? this.instances.get(cur.parentId) : undefined) {
      if (!cur.visible || cur.destroyed) return false;
    }
    return true;
  }

  private matches(inst: Instance, source: Source): boolean {
    if (source.kind === 'block') return inst.id === source.blockId;
    if (source.kind === 'copiesOf') return inst.copy && inst.protoId === source.blockId;
    return inst.block.groupId === source.groupId;
  }

  private fireMatching(kind: Trigger['kind'], test: (t: Trigger) => boolean, self: string | undefined, gesture: boolean, depth = 0): void {
    for (const entry of this.byTrigger.get(kind) ?? []) {
      if (this.halted) return;
      if (test(entry.rule.when)) this.fire(entry, self, gesture, depth);
    }
  }

  private fire(entry: RuleEntry, self: string | undefined, gesture: boolean, depth: number): void {
    const { rule } = entry;
    if (this.halted || this.stopped.has(rule.id)) return;
    if (rule.once && this.firedOnce.has(rule.id)) {
      this.debug?.onEvent({ type: 'rule', ruleId: rule.id, status: 'once', at: this.time, ...(self ? { self } : {}) });
      return;
    }
    if (depth > SCENARIO_LIMITS.nestingDepth) {
      this.stopRule(rule, `правила вызывают друг друга больше ${SCENARIO_LIMITS.nestingDepth} раз подряд`);
      return;
    }
    const count = (this.fireCounts.get(rule.id) ?? 0) + 1;
    this.fireCounts.set(rule.id, count);
    if (rule.if && !this.evaluate(rule.if, count)) {
      this.debug?.onEvent({ type: 'rule', ruleId: rule.id, status: 'condition', at: this.time, ...(self ? { self } : {}) });
      return;
    }
    this.debug?.onEvent({ type: 'rule', ruleId: rule.id, status: 'fired', at: this.time, ...(self ? { self } : {}) });
    if (rule.once) this.firedOnce.add(rule.id);
    this.run({ entry, self, stack: [{ actions: rule.do, i: 0 }], gesture: gesture && GESTURE_TRIGGERS.includes(rule.when.kind), resumed: false, depth });
  }

  private conditionContext(ruleCount: number): ConditionContext {
    return {
      doc: this.doc,
      answers: this.answers,
      variables: this.vars,
      rng: this.rng,
      random: this.random,
      ruleCount,
      blockState: (c) => this.blockState(c),
    };
  }

  private evaluate(c: Condition, ruleCount: number): boolean {
    if (c.kind === 'group') {
      if (c.op === 'and') return c.items.every((i) => this.evaluate(i, ruleCount));
      if (c.op === 'or') return c.items.some((i) => this.evaluate(i, ruleCount));
      return !c.items.some((i) => this.evaluate(i, ruleCount));
    }
    if (c.kind === 'answer' && ['correct', 'wrong', 'scoreGte', 'scoreLte'].includes(c.op)) {
      const verdict = this.verdicts.get(c.questionBlockId);
      if (verdict) {
        if (c.op === 'scoreGte' || c.op === 'scoreLte') return compare(verdict.score, c.op === 'scoreGte' ? 'gte' : 'lte', c.value);
        return verdict.correct !== null && verdict.correct === (c.op === 'correct');
      }
    }
    return evaluateCondition(c, this.conditionContext(ruleCount));
  }

  private blockState(c: Extract<Condition, { kind: 'blockState' }>): boolean {
    if (c.state === 'copiesCount') {
      const n = [...this.instances.values()].filter((i) => i.copy && !i.destroyed && i.protoId === c.blockId && !this.isCopyChild(i)).length;
      return c.op !== undefined && c.value !== undefined && compare(n, c.op, c.value);
    }
    const inst = this.live(c.blockId);
    switch (c.state) {
      case 'visible':
        return inst !== undefined && this.isShown(inst);
      case 'hidden':
        return inst === undefined || !this.isShown(inst);
      case 'selected':
        return inst !== undefined && this.isSelected(inst);
      case 'onZone':
        return inst !== undefined && (c.zoneId ? inst.zoneId === c.zoneId : inst.zoneId !== null);
      case 'dragging':
        return inst?.dragging ?? false;
    }
  }

  private isCopyChild(inst: Instance): boolean {
    return inst.parentId !== null && (this.instances.get(inst.parentId)?.copy ?? false);
  }

  /**
   * B-11/B-12 «перемешивать»: options keep their own design, only their places on the canvas are swapped
   * (cosmetic randomness from the seed — the same participant sees the same order after a reload).
   */
  private shuffleOptions(): void {
    for (const q of this.instances.values()) {
      if ((q.block.type !== 'singleChoice' && q.block.type !== 'multiChoice') || !q.block.props.shuffle || q.copy) continue;
      const optionBlocks = new Set(q.block.props.options.map((o) => o.blockId));
      const items = q.children.map((id) => this.instances.get(id)).filter((i): i is Instance => i !== undefined && optionBlocks.has(i.protoId));
      const places = this.rng.shuffle(items.map((i) => ({ x: i.x, y: i.y })));
      items.forEach((inst, k) => {
        inst.x = places[k]!.x;
        inst.y = places[k]!.y;
      });
    }
  }

  /** An option block is selected when its option is in the answer (B-11, B-12). */
  private isSelected(inst: Instance): boolean {
    const parent = inst.parentId ? this.instances.get(inst.parentId) : undefined;
    // BH-06: the sector the wheel stopped on is «выбран» (CN-03), so rules and states can use it.
    if (parent?.winner && parent.winner === inst.protoId) return true;
    if (!parent || (parent.block.type !== 'singleChoice' && parent.block.type !== 'multiChoice')) return false;
    const option = parent.block.props.options.find((o) => o.blockId === inst.protoId);
    const answer = this.answers[parent.protoId];
    return option !== undefined && answer?.kind === 'choice' && answer.optionIds.includes(option.id);
  }

  // ── Interpreter ───────────────────────────────────────────────────────────

  private run(job: Job): void {
    while (job.stack.length > 0) {
      if (this.halted || this.stopped.has(job.entry.rule.id)) return;
      const frame = job.stack[job.stack.length - 1]!;
      if (frame.i >= frame.actions.length) {
        if (frame.loop) {
          frame.loop.count += 1;
          if (this.loopContinues(frame.loop, job)) {
            frame.i = 0;
            continue;
          }
        }
        job.stack.pop();
        continue;
      }
      if (this.stepMode) {
        if (this.stepTicket) this.stepTicket = false;
        else {
          this.paused.push(job);
          this.debug?.onEvent({ type: 'paused', ruleId: job.entry.rule.id, next: frame.actions[frame.i]!.kind, detail: frame.actions[frame.i]!, at: this.time, ...(job.self ? { self: job.self } : {}) });
          return;
        }
      }
      const action = frame.actions[frame.i++]!;
      this.debug?.onEvent({ type: 'action', ruleId: job.entry.rule.id, action: action.kind, detail: action, at: this.time, ...(job.self ? { self: job.self } : {}) });
      if (!this.consume()) {
        this.stopRule(job.entry.rule, `больше ${SCENARIO_LIMITS.stepsPerSecond} действий за секунду`);
        return;
      }
      if (action.kind === 'if') {
        const branch = this.evaluate(action.if, this.fireCounts.get(job.entry.rule.id) ?? 0) ? action.then : action.else;
        if (branch.length) job.stack.push({ actions: branch, i: 0 });
        continue;
      }
      if (action.kind === 'repeat') {
        const loop = { times: action.times, count: 1, while: action.while };
        if (this.loopContinues(loop, job)) job.stack.push({ actions: action.do, i: 0, loop });
        continue;
      }
      if (action.kind === 'wait') {
        job.resumed = true;
        this.schedule(this.time + action.ms, () => this.run(job));
        return;
      }
      if (!this.apply(action, job)) return;
    }
  }

  private loopContinues(loop: NonNullable<Frame['loop']>, job: Job): boolean {
    if (loop.times !== undefined && loop.count > loop.times) return false;
    return loop.while === undefined || this.evaluate(loop.while, this.fireCounts.get(job.entry.rule.id) ?? 0);
  }

  /** Instances an action target points to. */
  private targets(t: Target, job: Job): Instance[] {
    if (t.kind === 'self') {
      const inst = job.self ? this.live(job.self) : undefined;
      return inst ? [inst] : [];
    }
    if (t.kind === 'block') {
      const inst = this.live(t.blockId);
      return inst ? [inst] : [];
    }
    return [...this.instances.values()].filter((i) => i.copy && !i.destroyed && i.protoId === t.blockId && !this.isCopyChild(i));
  }

  /** Executes one action; false stops the current chain (navigation leaves the screen). */
  private apply(a: Exclude<Action, { kind: 'if' | 'repeat' | 'wait' }>, job: Job): boolean {
    const rule = job.entry.rule;
    switch (a.kind) {
      case 'visibility':
        for (const t of a.targets) {
          for (const inst of this.targets(t, job)) {
            inst.visible = a.mode === 'show' ? true : a.mode === 'hide' ? false : !inst.visible;
            inst.animateVisibility = a.animate;
            this.touch(inst);
          }
        }
        return true;
      case 'setProperty': {
        const parsed = parseProperty(a.property, a.value, this.parseValue);
        if (!parsed.ok) {
          this.warn(rule.id, `Недопустимое значение свойства ${a.property}`);
          return true;
        }
        for (const inst of this.targets(a.target, job)) {
          const frameKey = FRAME_SETTABLE[a.property];
          if (frameKey && a.durationMs > 0) this.tween(inst, frameKey, parsed.value as number, a.durationMs, a.easing);
          else if (frameKey) {
            this.cancelTween(inst, frameKey);
            inst[frameKey] = parsed.value as number;
          } else {
            // New objects instead of changes in place: the renderer recomputes a style only when they change.
            inst.overrides = { ...inst.overrides, [a.property]: parsed.value };
            const reset: Partial<Record<string, readonly Animatable[]>> = {
              'style.effects': ['opacity', 'blur', 'backdropBlur'],
              'style.filters': ['brightness', 'contrast', 'saturate', 'grayscale', 'hueRotate'],
              'style.transform3d': ['rotateX', 'rotateY'],
            };
            const drop = reset[a.property];
            if (drop?.some((p) => p in inst.anim)) inst.anim = Object.fromEntries(Object.entries(inst.anim).filter(([k]) => !drop.includes(k as Animatable)));
          }
          this.touch(inst);
        }
        return true;
      }
      case 'animateProperty':
        for (const inst of this.targets(a.target, job)) this.tween(inst, a.property, a.to, a.durationMs, a.easing);
        return true;
      case 'move':
        for (const inst of this.targets(a.target, job)) {
          const to = this.destination(inst, a.to);
          if (!to) continue;
          this.tween(inst, 'x', to.x, a.durationMs, a.easing);
          this.tween(inst, 'y', to.y, a.durationMs, a.easing);
        }
        return true;
      case 'setVariable':
        this.setVariable(a, job);
        return true;
      case 'goTo':
        this.out.effects.push({
          type: 'navigate',
          to: a.to,
          ...(a.to === 'screen' && a.screenId ? { screenId: a.screenId } : {}),
          ...(a.transition ? { transition: a.transition } : {}),
        });
        this.halted = true;
        return false;
      case 'finish':
        this.out.effects.push(a.resultKey ? { type: 'finish', resultKey: a.resultKey } : { type: 'finish' });
        this.halted = true;
        return false;
      case 'media':
        for (const inst of this.targets(a.target, job)) {
          // «Проиграть / пауза» also drive behaviors: start or stop a spawner, flip a card, spin a wheel.
          const spawner = this.spawners.get(inst.id);
          const sp = behaviorOf(inst.block, 'spawner');
          if (spawner && sp) {
            spawner.active = a.command === 'play' || a.command === 'restart';
            if (a.command === 'restart' || a.command === 'play') spawner.next = this.time + sp.everyMs;
          }
          const flip = behaviorOf(inst.block, 'flip');
          if (flip && (a.command === 'play' || a.command === 'restart')) this.flip(inst, flip);
          const wheel = behaviorOf(inst.block, 'wheel');
          if (wheel && (a.command === 'play' || a.command === 'restart')) this.spin(inst, wheel);
          inst.media = a.command === 'pause' ? 'paused' : a.command === 'stop' ? 'stopped' : 'playing';
          this.touch(inst);
          this.out.effects.push({ type: 'media', blockId: inst.id, command: a.command });
        }
        return true;
      case 'playSound':
        this.out.effects.push({ type: 'playSound', media: a.media });
        return true;
      case 'effect': {
        const at = a.at ? this.targets(a.at, job)[0] : undefined;
        const box = at ? this.absBox(at) : undefined;
        this.out.effects.push({ type: 'effect', effect: a.effect, intensity: a.intensity, ...(box ? { at: { x: box.x + box.w / 2, y: box.y + box.h / 2 } } : {}) });
        return true;
      }
      case 'mediaOverlay':
        this.out.effects.push({ type: 'mediaOverlay', overlay: a.overlay });
        return true;
      case 'spawn':
        this.spawn(a, job);
        return true;
      case 'destroy':
        for (const inst of this.targets(a.target, job)) this.destroy(inst);
        return true;
      case 'timer': {
        const t = this.timers.get(a.timerBlockId);
        if (!t) return true;
        if (a.command === 'start') t.running = true;
        if (a.command === 'stop') t.running = false;
        if (a.command === 'reset') Object.assign(t, { elapsed: 0, ended: false });
        const inst = this.live(a.timerBlockId);
        if (inst) this.touch(inst);
        return true;
      }
      case 'record': {
        const value = 'variableId' in a.value ? this.vars[a.value.variableId] : a.value.text;
        if (value === undefined) this.warn(rule.id, 'Записать в ответы: переменная удалена');
        else this.out.effects.push({ type: 'record', label: a.label, value: structuredClone(value) });
        return true;
      }
      case 'openLink':
      case 'copyText': {
        if (!job.gesture || job.resumed) {
          this.warn(rule.id, a.kind === 'openLink' ? 'Ссылку можно открыть только сразу по действию участника' : 'Скопировать текст можно только сразу по действию участника');
          return true;
        }
        if (a.kind === 'copyText') {
          this.out.effects.push({ type: 'copyText', text: a.text });
          return true;
        }
        if (!isSafeHref(a.url)) this.warn(rule.id, 'Недопустимая ссылка: можно только https://, http://, mailto: и tel:');
        else this.out.effects.push({ type: 'openLink', url: a.url });
        return true;
      }
      case 'interaction':
        for (const inst of this.targets(a.target, job)) {
          inst.interactive = a.enabled;
          if (!a.enabled) inst.dragging = false;
          this.touch(inst);
        }
        return true;
      case 'answer':
        this.answerAction(a, job);
        return true;
      case 'shuffle': {
        const items = a.blockIds.map((id) => this.live(id)).filter((i): i is Instance => i !== undefined);
        const places = this.rng.shuffle(items.map((i) => ({ x: i.x, y: i.y })));
        items.forEach((inst, k) => {
          this.cancelTween(inst, 'x');
          this.cancelTween(inst, 'y');
          inst.x = places[k]!.x;
          inst.y = places[k]!.y;
          this.touch(inst);
        });
        return true;
      }
    }
  }

  private setVariable(a: SetVariable, job: Job): void {
    const def = this.variableDefs.get(a.variableId);
    if (!def) {
      this.warn(job.entry.rule.id, 'Изменить переменную: переменная удалена');
      return;
    }
    const current = this.vars[a.variableId]!;
    const result = applyVariableOp(def, current, a, this.rng, this.vars);
    if (!result.ok) {
      this.warn(job.entry.rule.id, `Переменная «${def.name}»: ${result.error}`);
      return;
    }
    const next = result.value;
    if (typeof next === 'string' && next.length > 1000) {
      this.warn(job.entry.rule.id, `Переменная «${def.name}»: текст длиннее 1000 символов`);
      return;
    }
    if (compare(current, 'eq', next)) return;
    this.vars[a.variableId] = next;
    this.out.variables[a.variableId] = structuredClone(next);
    for (const inst of this.instances.values()) {
      if (this.usesVariable(inst.block, a.variableId)) this.touch(inst);
    }
    this.fireMatching('variableChange', (t) => (t as Extract<Trigger, { kind: 'variableChange' }>).variableId === a.variableId, job.self, false, job.depth + 1);
  }

  private answerAction(a: ActionLeafOf<'answer'>, job: Job): void {
    const q = this.live(a.questionBlockId);
    if (!q || !isQuestion(q.block)) {
      this.warn(job.entry.rule.id, 'Выбрать вариант: вопрос не найден на экране');
      return;
    }
    if (a.command === 'reset') {
      this.setAnswer(a.questionBlockId, null, job.depth + 1, true);
      return;
    }
    const block = q.block;
    if ((block.type !== 'singleChoice' && block.type !== 'multiChoice') || !a.optionId || !block.props.options.some((o) => o.id === a.optionId)) {
      this.warn(job.entry.rule.id, 'Выбрать вариант: вариант не найден');
      return;
    }
    const prev = this.answers[a.questionBlockId];
    const ids = prev?.kind === 'choice' ? prev.optionIds : [];
    const optionIds = block.type === 'singleChoice' ? [a.optionId] : ids.includes(a.optionId) ? ids : [...ids, a.optionId];
    this.setAnswer(a.questionBlockId, { kind: 'choice', optionIds }, job.depth + 1, true);
  }

  /** Stores an answer, refreshes option selection and fires TR-12. */
  private setAnswer(questionBlockId: string, answer: AnswerValue | null, depth: number, notify: boolean): void {
    if (answer) this.answers[questionBlockId] = answer;
    else delete this.answers[questionBlockId];
    const q = this.instances.get(questionBlockId);
    if (q) {
      this.touch(q);
      for (const id of q.children) this.changed.add(id);
    }
    // L-05: texts that show this answer are drawn again.
    for (const inst of this.instances.values()) {
      if (inst.block.textLayer?.paragraphs.some((p) => p.runs.some((r) => 'answer' in r && r.answer === questionBlockId))) this.touch(inst);
    }
    if (notify && depth > 0) this.out.effects.push({ type: 'answer', questionBlockId, answer });
    this.fireMatching('answer', (t) => (t as Extract<Trigger, { kind: 'answer' }>).questionBlockId === questionBlockId, questionBlockId, false, depth);
  }

  // ── Spatial actions ───────────────────────────────────────────────────────

  private absBox(inst: Instance): Box {
    let x = inst.x;
    let y = inst.y;
    for (let p = inst.parentId ? this.instances.get(inst.parentId) : undefined; p; p = p.parentId ? this.instances.get(p.parentId) : undefined) {
      x += p.x;
      y += p.y;
    }
    return { x, y, w: inst.w, h: inst.h };
  }

  /** Top-left position (relative to the parent) for AC-03 and AC-09 destinations. */
  private destination(inst: Instance, to: ActionLeafOf<'move'>['to'], base?: Instance): { x: number; y: number } | undefined {
    const parent = inst.parentId ? this.instances.get(inst.parentId) : undefined;
    const origin = parent ? this.absBox(parent) : { x: 0, y: 0 };
    switch (to.kind) {
      case 'point':
        return { x: to.point.x - origin.x, y: to.point.y - origin.y };
      case 'by': {
        const from = base ?? inst;
        return { x: from.x + to.dx, y: from.y + to.dy };
      }
      case 'block': {
        const other = this.live(to.blockId);
        if (!other) return undefined;
        const b = this.absBox(other);
        return { x: b.x + b.w / 2 - inst.w / 2 - origin.x, y: b.y + b.h / 2 - inst.h / 2 - origin.y };
      }
      case 'randomIn': {
        const spanX = Math.max(0, to.area.w - inst.w);
        const spanY = Math.max(0, to.area.h - inst.h);
        return { x: to.area.x + this.rng.next() * spanX - origin.x, y: to.area.y + this.rng.next() * spanY - origin.y };
      }
    }
  }

  private spawn(a: ActionLeafOf<'spawn'>, job: Job): void {
    const proto = this.instances.get(a.prototypeId);
    if (!proto || proto.copy) {
      this.warn(job.entry.rule.id, 'Создать копию: образец не найден на экране');
      return;
    }
    const roots = [...this.instances.values()].filter((i) => i.copy && !i.destroyed && !this.isCopyChild(i));
    if (roots.length >= SCENARIO_LIMITS.maxCopies) {
      if (!this.copyLimitWarned) this.warn(job.entry.rule.id, `На экране уже ${SCENARIO_LIMITS.maxCopies} копий — новые не создаются`);
      this.copyLimitWarned = true;
      return;
    }
    if (roots.filter((i) => i.protoId === a.prototypeId).length >= a.max) return;
    const box = this.absBox(proto);
    const probe = { ...proto, parentId: null, x: box.x, y: box.y } as Instance;
    const at = this.destination(probe, a.at, probe) ?? { x: box.x, y: box.y };
    this.makeCopy(proto, at);
  }

  /** A copy of a block at a place of the screen (AC-09, BH-05): it keeps the prototype's changes and behaviors. */
  private makeCopy(proto: Instance, at: { x: number; y: number }): void {
    this.copySeq += 1;
    const inst = this.build(proto.block, null, `${proto.id}~${this.copySeq}`, true, at);
    inst.w = proto.w;
    inst.h = proto.h;
    inst.rotation = proto.rotation;
    inst.overrides = structuredClone(proto.overrides);
    inst.anim = { ...proto.anim };
    const mark = (i: Instance) => {
      this.out.spawned.push(i.id);
      this.touch(i);
      i.children.forEach((c) => mark(this.instances.get(c)!));
    };
    mark(inst);
  }

  private destroy(inst: Instance): void {
    if (inst.destroyed) return;
    inst.destroyed = true;
    inst.dragging = false;
    this.tweens = this.tweens.filter((t) => t.inst !== inst);
    this.out.destroyed.push(inst.id);
    this.touch(inst);
    for (const c of inst.children) {
      const child = this.instances.get(c);
      if (child) this.destroy(child);
    }
    if (inst.copy) this.instances.delete(inst.id);
  }

  // ── Gestures ──────────────────────────────────────────────────────────────

  private fireDrag(inst: Instance, phase: 'start' | 'end'): void {
    this.fireMatching(
      'drag',
      (t) => this.matches(inst, (t as Extract<Trigger, { kind: 'drag' }>).source) && (t as Extract<Trigger, { kind: 'drag' }>).phase === phase,
      inst.id,
      true,
    );
  }

  private dragEnd(inst: Instance, x?: number, y?: number): void {
    if (!inst.dragging) return;
    if (x !== undefined && y !== undefined) {
      const drag = behaviorOf(inst.block, 'drag');
      const pos = drag ? constrainDrag(drag, inst.dragFrom ?? inst, { x, y }, inst) : { x, y };
      inst.x = pos.x;
      inst.y = pos.y;
    }
    inst.dragging = false;
    this.touch(inst);
    const box = this.absBox(inst);
    const cx = box.x + box.w / 2;
    const cy = box.y + box.h / 2;
    const under = [...this.instances.values()]
      .filter((o) => o !== inst && !o.destroyed && this.isShown(o) && !this.isAncestor(inst, o) && !this.isAncestor(o, inst))
      .filter((o) => {
        const b = this.absBox(o);
        return cx >= b.x && cx <= b.x + b.w && cy >= b.y && cy <= b.y + b.h;
      })
      .sort((a, b) => b.z - a.z);
    const drag = behaviorOf(inst.block, 'drag');
    // BH-01: only the listed zones attract the block; «одна копия на зоне» — a taken zone does not count.
    const zone = under.find(
      (o) =>
        o.block.type === 'zone' &&
        (!drag || drag.snapToZones.length === 0 || drag.snapToZones.includes(o.protoId)) &&
        !(drag?.onePerZone && [...this.instances.values()].some((other) => other !== inst && !other.destroyed && other.zoneId === o.id)),
    );
    inst.zoneId = zone ? zone.id : null;
    if (drag && zone && drag.snapToZones.length > 0) {
      const zb = this.absBox(zone);
      const parent = inst.parentId ? this.absBox(this.instances.get(inst.parentId)!) : { x: 0, y: 0 };
      this.tween(inst, 'x', zb.x + zb.w / 2 - inst.w / 2 - parent.x, 180, { kind: 'preset', name: 'easeOut' });
      this.tween(inst, 'y', zb.y + zb.h / 2 - inst.h / 2 - parent.y, 180, { kind: 'preset', name: 'easeOut' });
    } else if (drag && !zone && drag.returnIfMissed && inst.dragFrom) {
      this.tween(inst, 'x', inst.dragFrom.x, 250, { kind: 'preset', name: 'easeOut' });
      this.tween(inst, 'y', inst.dragFrom.y, 250, { kind: 'preset', name: 'easeOut' });
    }
    this.fireDrag(inst, 'end');
    for (const target of under) {
      this.fireMatching(
        'drop',
        (t) => this.matches(inst, (t as Extract<Trigger, { kind: 'drop' }>).source) && this.matches(target, (t as Extract<Trigger, { kind: 'drop' }>).target),
        inst.id,
        true,
      );
    }
  }

  private isAncestor(a: Instance, b: Instance): boolean {
    for (let p = b.parentId ? this.instances.get(b.parentId) : undefined; p; p = p.parentId ? this.instances.get(p.parentId) : undefined) {
      if (p === a) return true;
    }
    return false;
  }

  private swipe(direction: 'left' | 'right' | 'up' | 'down', blockId?: string): void {
    const inst = blockId ? this.live(blockId) : undefined;
    if (inst && (!inst.interactive || !this.isShown(inst))) return;
    this.fireMatching(
      'swipe',
      (t) => {
        const s = t as Extract<Trigger, { kind: 'swipe' }>;
        if (s.direction !== direction) return false;
        return s.on === 'screen' || (inst !== undefined && this.matches(inst, s.on));
      },
      inst?.id,
      true,
    );
  }

  // ── Time ──────────────────────────────────────────────────────────────────

  private tween(inst: Instance, prop: Animatable, to: number, duration: number, easing: Parameters<typeof easingFunction>[0]): void {
    this.cancelTween(inst, prop);
    if (duration <= 0) {
      this.setNumber(inst, prop, to);
      return;
    }
    this.tweens.push({ inst, prop, from: numberOf(inst, prop), to, start: this.time, duration, ease: easingFunction(easing, duration) });
  }

  private cancelTween(inst: Instance, prop: Animatable): void {
    this.tweens = this.tweens.filter((t) => !(t.inst === inst && t.prop === prop));
  }

  private setNumber(inst: Instance, prop: Animatable, value: number): void {
    const frame = FRAME_PROPS[prop];
    if (frame) inst[frame] = value;
    else if (inst.anim[prop] !== value) inst.anim = { ...inst.anim, [prop]: value };
    this.touch(inst);
  }

  private advanceTweens(): void {
    if (this.tweens.length === 0) return;
    const keep: Tween[] = [];
    for (const t of this.tweens) {
      const p = Math.min(1, (this.time - t.start) / t.duration);
      this.setNumber(t.inst, t.prop, p >= 1 ? t.to : t.from + (t.to - t.from) * t.ease(p));
      if (p < 1) keep.push(t);
    }
    this.tweens = keep;
  }

  /** Area a block moves in, in its own coordinates: the screen, or the parent block for a nested one. */
  private moveArea(inst: Instance): Box {
    const parent = inst.parentId ? this.instances.get(inst.parentId) : undefined;
    return parent ? { x: 0, y: 0, w: parent.w, h: parent.h } : { x: 0, y: 0, w: ARTBOARD_WIDTH, h: this.screen?.height ?? 844 };
  }

  private advanceMotion(dtMs: number): void {
    if (dtMs <= 0) return;
    const s = dtMs / 1000;
    for (const inst of this.instances.values()) {
      if (inst.destroyed || inst.dragging || !this.isShown(inst)) continue;
      if (inst.track) {
        // BH-04 «по своему контуру»: a constant speed along the contour, round and round.
        inst.track.distance += inst.track.speed * s;
        const p = pointAt(inst.track.path, inst.track.distance);
        inst.x = inst.track.origin.x + p.x;
        inst.y = inst.track.origin.y + p.y;
        this.touch(inst);
        continue;
      }
      if (inst.vx === 0 && inst.vy === 0 && inst.ay === 0) continue;
      inst.vy += inst.ay * s;
      inst.x += inst.vx * s;
      inst.y += inst.vy * s;
      const move = behaviorOf(inst.block, 'move');
      if (move) {
        const edge = applyEdge(move.edge, inst, inst, this.moveArea(inst));
        if (edge === 'destroy') {
          this.destroy(inst);
          continue;
        }
        Object.assign(inst, edge);
      }
      this.touch(inst);
    }
  }

  /** BH-05: copies appear on schedule while the spawner runs and is visible; the limit counts living copies. */
  private advanceSpawners(): void {
    for (const [id, sp] of this.spawners) {
      const inst = this.instances.get(id);
      const b = inst ? behaviorOf(inst.block, 'spawner') : undefined;
      if (!inst || !b || !sp.active || !this.isShown(inst)) continue;
      let guard = 0;
      while (sp.next <= this.time && guard++ < 50) {
        sp.next += b.everyMs;
        const proto = this.instances.get(b.prototypeId);
        if (!proto || proto.copy) break;
        const roots = [...this.instances.values()].filter((i) => i.copy && !i.destroyed && !this.isCopyChild(i));
        if (roots.length >= SCENARIO_LIMITS.maxCopies || roots.filter((i) => i.protoId === proto.id).length >= b.max) continue;
        const at = { x: b.area.x + this.rng.next() * Math.max(0, b.area.w - proto.w), y: b.area.y + this.rng.next() * Math.max(0, b.area.h - proto.h) };
        this.makeCopy(proto, at);
      }
    }
  }

  /** BH-02 and BH-08: the finger or cursor moved. */
  private pointer(x: number, y: number): void {
    for (const inst of [...this.instances.values()]) {
      if (inst.destroyed || !this.isShown(inst) || inst.dragging) continue;
      const parent = inst.parentId ? this.absBox(this.instances.get(inst.parentId)!) : { x: 0, y: 0 };
      const follow = behaviorOf(inst.block, 'follow');
      if (follow) {
        const area = follow.bounds ?? { x: 0, y: 0, w: ARTBOARD_WIDTH, h: this.screen?.height ?? 844 };
        const ax = Math.min(Math.max(x - inst.w / 2, area.x), area.x + area.w - inst.w);
        const ay = Math.min(Math.max(y - inst.h / 2, area.y), area.y + area.h - inst.h);
        inst.followTo = { x: ax - parent.x, y: ay - parent.y };
      }
      const flee = behaviorOf(inst.block, 'flee');
      if (!flee || inst.fled >= flee.times || this.tweens.some((t) => t.inst === inst && (t.prop === 'x' || t.prop === 'y'))) continue;
      const box = this.absBox(inst);
      if (Math.hypot(box.x + box.w / 2 - x, box.y + box.h / 2 - y) >= flee.distance) continue;
      const area = flee.area ?? { x: 0, y: 0, w: ARTBOARD_WIDTH, h: this.screen?.height ?? 844 };
      const to = fleeTarget(box, { x, y }, flee.distance, area, this.rng);
      inst.fled += 1;
      const ms = Math.round(260 / flee.speed);
      this.tween(inst, 'x', to.x - parent.x, ms, { kind: 'preset', name: 'easeOut' });
      this.tween(inst, 'y', to.y - parent.y, ms, { kind: 'preset', name: 'easeOut' });
    }
  }

  private advanceFollow(dtMs: number): void {
    if (dtMs <= 0) return;
    for (const inst of this.instances.values()) {
      if (!inst.followTo || inst.destroyed || inst.dragging) continue;
      const follow = behaviorOf(inst.block, 'follow');
      if (!follow) continue;
      const k = followShare(follow.lagMs, dtMs);
      const nx = inst.x + (inst.followTo.x - inst.x) * k;
      const ny = inst.y + (inst.followTo.y - inst.y) * k;
      if (Math.abs(nx - inst.x) < 0.01 && Math.abs(ny - inst.y) < 0.01) continue;
      inst.x = Math.abs(inst.followTo.x - nx) < 0.05 ? inst.followTo.x : nx;
      inst.y = Math.abs(inst.followTo.y - ny) < 0.05 ? inst.followTo.y : ny;
      this.touch(inst);
    }
  }

  /** BH-06: the server draws the sector (RandomSource), the wheel turns to it and «анимация закончилась» fires. */
  private spin(inst: Instance, wheel: BehaviorOf<'wheel'>): void {
    if (inst.spinning) return;
    const { index, rotation } = spinWheel(wheel, inst.rotation, this.random, this.drawWheel?.(inst.id, wheel.sectors.length));
    inst.spinning = true;
    inst.winner = null;
    for (const c of inst.children) this.changed.add(c);
    this.tween(inst, 'rotation', rotation, wheel.spinMs, { kind: 'bezier', x1: 0.12, y1: 0.6, x2: 0.2, y2: 1 });
    const sector = wheel.sectors[index]!.blockId;
    this.schedule(this.time + wheel.spinMs, () => {
      if (inst.destroyed) return;
      inst.spinning = false;
      inst.winner = sector;
      this.touch(inst);
      for (const c of inst.children) this.changed.add(c);
      this.out.effects.push({ type: 'wheel', blockId: inst.id, sectorBlockId: sector });
      this.fireMatching('mediaEnd', (t) => this.matches(inst, (t as Extract<Trigger, { kind: 'mediaEnd' }>).source), inst.id, false);
    });
  }

  /** BH-07: the card turns over (rotateY 0° ↔ 180°); its front and back are nested blocks. */
  private flip(inst: Instance, flip: BehaviorOf<'flip'>): void {
    inst.flipped = !inst.flipped;
    this.tween(inst, 'rotateY', inst.flipped ? 180 : 0, flip.durationMs, { kind: 'preset', name: 'easeInOut' });
    this.touch(inst);
  }

  private advanceTimers(dtMs: number): void {
    for (const [id, t] of this.timers) {
      if (!t.running || t.ended) continue;
      t.elapsed += dtMs;
      const inst = this.instances.get(id);
      if (inst) this.touch(inst);
      if (t.elapsed < t.duration) continue;
      t.elapsed = t.duration;
      t.ended = true;
      t.running = false;
      this.fireMatching('timer', (tr) => (tr as Extract<Trigger, { kind: 'timer' }>).mode === 'timerEnd' && (tr as Extract<Trigger, { kind: 'timer' }>).timerBlockId === id, id, false);
    }
  }

  /** TR-07: start and end of overlaps, via a spatial grid over the targets of each collision rule. */
  private detectCollisions(): void {
    const entries = this.byTrigger.get('collide');
    if (!entries?.length) return;
    const alive = [...this.instances.values()].filter((i) => !i.destroyed && this.isShown(i));
    const boxes = new Map(alive.map((i) => [i, this.absBox(i)]));
    for (const entry of entries) {
      if (this.halted) return;
      const t = entry.rule.when as Extract<Trigger, { kind: 'collide' }>;
      const sources = alive.filter((i) => this.matches(i, t.source));
      const grid = new SpatialGrid<{ box: Box; inst: Instance }>();
      for (const i of alive) if (this.matches(i, t.target)) grid.insert({ box: boxes.get(i)!, inst: i });
      const now = new Set<string>();
      const pairs: Array<[Instance, string]> = [];
      for (const a of sources) {
        for (const hit of grid.query(boxes.get(a)!)) {
          if (hit.inst === a || this.isAncestor(a, hit.inst) || this.isAncestor(hit.inst, a)) continue;
          const key = `${a.id}|${hit.inst.id}`;
          now.add(key);
          pairs.push([a, key]);
        }
      }
      const before = this.collisions.get(entry.rule.id) ?? new Set<string>();
      this.collisions.set(entry.rule.id, now);
      if (t.phase === 'start') {
        for (const [a, key] of pairs) if (!before.has(key)) this.fire(entry, a.id, false, 0);
      } else {
        for (const key of before) {
          if (now.has(key)) continue;
          const selfId = key.slice(0, key.indexOf('|'));
          this.fire(entry, this.live(selfId) ? selfId : undefined, false, 0);
        }
      }
    }
  }

  private toView(i: Instance): BlockView {
    return {
      id: i.id,
      protoId: i.protoId,
      copy: i.copy,
      parentId: i.parentId,
      visible: i.visible,
      animateVisibility: i.animateVisibility,
      interactive: i.interactive,
      dragging: i.dragging,
      zoneId: i.zoneId,
      selected: this.isSelected(i),
      x: i.x,
      y: i.y,
      w: i.w,
      h: i.h,
      rotation: i.rotation,
      z: i.z,
      overrides: i.overrides,
      anim: i.anim,
      media: i.media,
      flipped: i.flipped,
    };
  }
}

/** A runtime for a passage (P1.3). The document is usually the public projection. */
export function createRuntime(doc: RuntimeDocument, options: RuntimeOptions): Runtime {
  return new Runtime(doc, options);
}

/** VR-04: variables marked «сохранять в ответы» with their final values. */
export function variablesToRecord(doc: Pick<ProjectDocument, 'variables'>, values: Readonly<Record<string, VariableValue>>): Array<{ label: string; value: VariableValue }> {
  return doc.variables.filter((v) => v.saveToAnswers).map((v) => ({ label: v.name, value: structuredClone(values[v.id] ?? v.initial) }));
}
