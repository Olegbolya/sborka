import {
  type Action,
  type Block,
  BlockStyle,
  type Condition,
  GESTURE_TRIGGERS,
  MediaRef,
  type ProjectDocument,
  RichText,
  type Rule,
  SCENARIO_LIMITS,
  SafeHref,
  type Screen,
  type Source,
  type Target,
  type Trigger,
  type Variable,
  resolveBlockStyle,
  walkBlocks,
} from '@blokum/schema';
import { type AnswerValue, isQuestion } from '../flow/answers.js';
import { type ConditionContext, type VariableValue, compare, evaluateCondition } from '../flow/conditions.js';
import { type RandomSource, type Rng, createRng } from '../random.js';
import { easingFunction } from './easing.js';
import { type Box, SpatialGrid } from './grid.js';
import { type Animatable, type BlockView, type RuntimeEvent, type SettableProperty, type StepResult } from './types.js';

/** What the runtime needs from a document: the public projection (PL-15) is enough. */
export type RuntimeDocument = Pick<ProjectDocument, 'screens' | 'rules' | 'variables'> & { theme?: Pick<ProjectDocument['theme'], 'tokens'> };

export interface RuntimeOptions {
  /** Seed of cosmetic randomness (spawn positions, shuffles, cosmetic chance). Same seed → same run. */
  seed: number;
  /** Randomness that affects the result (CN-05 with the flag); the player passes a server-backed one (RN-01). */
  randomSource?: RandomSource;
  /** Wall-clock time of the start, ms since epoch — for B-08 timers «до даты». */
  startedAt?: number;
}

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

/** Validates an AC-02 value for a property path; returns the parsed value or null. */
function parseProperty(property: SettableProperty, value: unknown): { ok: true; value: unknown } | { ok: false } {
  if (FRAME_SETTABLE[property]) {
    if (typeof value !== 'number' || !Number.isFinite(value)) return { ok: false };
    if ((property === 'frame.w' || property === 'frame.h') && value < 0) return { ok: false };
    return { ok: true, value };
  }
  if (property === 'frame.flipX' || property === 'frame.flipY') return typeof value === 'boolean' ? { ok: true, value } : { ok: false };
  if (property === 'textLayer') {
    const r = RichText.safeParse(value);
    return r.success ? { ok: true, value: r.data } : { ok: false };
  }
  if (property === 'props.media') {
    if (value === null) return { ok: true, value: null };
    const r = MediaRef.safeParse(value);
    return r.success ? { ok: true, value: r.data } : { ok: false };
  }
  const key = property.slice('style.'.length) as keyof typeof BlockStyle.shape;
  const r = BlockStyle.shape[key].safeParse(value);
  return r.success ? { ok: true, value: r.data } : { ok: false };
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
  private stopped = new Set<string>();
  private tweens: Tween[] = [];
  private scheduled: Scheduled[] = [];
  private seq = 0;
  private copySeq = 0;
  private zOrder = 0;
  private timers = new Map<string, TimerState>();
  private collisions = new Map<string, Set<string>>();
  private scratched = new Set<string>();
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

  /** Variables of the passage (VR-01): a copy, the runtime owns the values. */
  get variables(): Record<string, VariableValue> {
    return structuredClone(this.vars);
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
        this.gesture(event.blockId, (inst) => this.fireMatching(event.type, (t) => this.matches(inst, (t as { source: Source }).source), inst.id, true));
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
          this.touch(inst);
          this.fireDrag(inst, 'start');
        });
        break;
      case 'dragMove':
        this.gesture(event.blockId, (inst) => {
          if (!inst.dragging) return;
          inst.x = event.x;
          inst.y = event.y;
          this.touch(inst);
        });
        break;
      case 'dragEnd':
        this.gesture(event.blockId, (inst) => this.dragEnd(inst, event.x, event.y));
        break;
      case 'swipe':
        this.swipe(event.direction, event.blockId);
        break;
      case 'answer':
        this.setAnswer(event.questionBlockId, event.answer, 0, true);
        break;
      case 'mediaEnd': {
        const inst = this.live(event.blockId);
        if (!inst) break;
        inst.media = 'stopped';
        this.touch(inst);
        this.fireMatching('mediaEnd', (t) => this.matches(inst, (t as Extract<Trigger, { kind: 'mediaEnd' }>).source), inst.id, false);
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
    this.advanceTweens();
    this.advanceMotion(dt);
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
    };
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
    if (this.halted || this.stopped.has(rule.id) || (rule.once && this.firedOnce.has(rule.id))) return;
    if (depth > SCENARIO_LIMITS.nestingDepth) {
      this.stopRule(rule, `правила вызывают друг друга больше ${SCENARIO_LIMITS.nestingDepth} раз подряд`);
      return;
    }
    const count = (this.fireCounts.get(rule.id) ?? 0) + 1;
    this.fireCounts.set(rule.id, count);
    if (rule.if && !this.evaluate(rule.if, count)) return;
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

  /** An option block is selected when its option is in the answer (B-11, B-12). */
  private isSelected(inst: Instance): boolean {
    const parent = inst.parentId ? this.instances.get(inst.parentId) : undefined;
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
      const action = frame.actions[frame.i++]!;
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
        const parsed = parseProperty(a.property, a.value);
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
            inst.overrides[a.property] = parsed.value;
            if (a.property === 'style.effects') ['opacity', 'blur', 'backdropBlur'].forEach((p) => delete inst.anim[p as Animatable]);
            if (a.property === 'style.filters') ['brightness', 'contrast', 'saturate', 'grayscale', 'hueRotate'].forEach((p) => delete inst.anim[p as Animatable]);
            if (a.property === 'style.transform3d') ['rotateX', 'rotateY'].forEach((p) => delete inst.anim[p as Animatable]);
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
        if (!SafeHref.safeParse(a.url).success) this.warn(rule.id, 'Недопустимая ссылка: можно только https://, http://, mailto: и tel:');
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
      if (inst.block.type === 'value' && inst.block.props.variableId === a.variableId) this.touch(inst);
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
    this.copySeq += 1;
    const box = this.absBox(proto);
    const probe = { ...proto, parentId: null, x: box.x, y: box.y } as Instance;
    const at = this.destination(probe, a.at, probe) ?? { x: box.x, y: box.y };
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
      inst.x = x;
      inst.y = y;
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
    const zone = under.find((o) => o.block.type === 'zone');
    inst.zoneId = zone ? zone.id : null;
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
    else inst.anim[prop] = value;
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

  private advanceMotion(dtMs: number): void {
    if (dtMs <= 0) return;
    const s = dtMs / 1000;
    for (const inst of this.instances.values()) {
      if (inst.destroyed || inst.dragging || (inst.vx === 0 && inst.vy === 0 && inst.ay === 0)) continue;
      inst.vy += inst.ay * s;
      inst.x += inst.vx * s;
      inst.y += inst.vy * s;
      this.touch(inst);
    }
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
