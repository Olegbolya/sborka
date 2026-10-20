import { z } from './locale.js';
import { Easing, Id, MediaRef, Point, Rect, VariableName, int, num } from './primitives.js';
import { ANIMATABLE } from './style.js';
import { MediaOverlay, Transition } from './transitions.js';

// Scenarios: rules «Когда → Если → Сделать», behaviors and variables (01-PRODUCT-SPEC.md §7).
// There are no built-in games: every mechanic is assembled from these parts.

// ── Sources and targets ───────────────────────────────────────────────────────
/** What a trigger listens to: a block, any copy spawned from a block (BH-05, AC-09) or a group. */
export const Source = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('block'), blockId: Id }),
  z.strictObject({ kind: z.literal('copiesOf'), blockId: Id }),
  z.strictObject({ kind: z.literal('group'), groupId: Id }),
]);
export type Source = z.infer<typeof Source>;

/** What an action changes: a block, the block (or copy) that fired the rule, or all copies of a block. */
export const Target = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('block'), blockId: Id }),
  z.strictObject({ kind: z.literal('self') }),
  z.strictObject({ kind: z.literal('copiesOf'), blockId: Id }),
]);
export type Target = z.infer<typeof Target>;

// ── TR-01…TR-16 Triggers ──────────────────────────────────────────────────────
export const Trigger = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('tap'), source: Source }), // TR-01
  z.strictObject({ kind: z.literal('doubleTap'), source: Source }), // TR-02
  z.strictObject({ kind: z.literal('longPress'), source: Source, ms: int(300, 3000).default(600) }), // TR-03
  z.strictObject({ kind: z.literal('hover'), source: Source, phase: z.enum(['enter', 'leave']).default('enter') }), // TR-04
  z.strictObject({ kind: z.literal('drag'), source: Source, phase: z.enum(['start', 'end']).default('start') }), // TR-05
  z.strictObject({ kind: z.literal('drop'), source: Source, target: Source }), // TR-06
  z.strictObject({ kind: z.literal('collide'), source: Source, target: Source, phase: z.enum(['start', 'end']).default('start') }), // TR-07
  z.strictObject({
    kind: z.literal('swipe'),
    direction: z.enum(['left', 'right', 'up', 'down']),
    on: z.union([z.literal('screen'), Source]).default('screen'),
  }), // TR-08
  z.strictObject({ kind: z.literal('screen'), phase: z.enum(['show', 'leave']).default('show') }), // TR-09
  z.strictObject({
    kind: z.literal('timer'),
    mode: z.enum(['after', 'every', 'timerEnd']),
    seconds: num(0.05, 3600).optional(),
    timerBlockId: Id.optional(),
  }), // TR-10
  z.strictObject({ kind: z.literal('variableChange'), variableId: Id }), // TR-11 (with «Если» = «условие стало истинным»)
  z.strictObject({ kind: z.literal('answer'), questionBlockId: Id }), // TR-12
  z.strictObject({ kind: z.literal('mediaEnd'), source: Source }), // TR-13
  z.strictObject({ kind: z.literal('scratched'), source: Source, percent: int(1, 100).default(60) }), // TR-14
  z.strictObject({
    kind: z.literal('deviceMotion'),
    motion: z.enum(['shake', 'tiltLeft', 'tiltRight', 'tiltForward', 'tiltBack']),
  }), // TR-15
  z.strictObject({ kind: z.literal('key'), key: z.string().min(1).max(20) }), // TR-16
]);
export type Trigger = z.infer<typeof Trigger>;
export type TriggerKind = Trigger['kind'];

/** Triggers caused by a gesture of the participant: only they may open links or copy text (TS-07). */
export const GESTURE_TRIGGERS: readonly TriggerKind[] = ['tap', 'doubleTap', 'longPress', 'hover', 'drag', 'drop', 'swipe', 'key'];

// ── CN-01…CN-06 Conditions ────────────────────────────────────────────────────
export const COMPARE_OPS = ['eq', 'ne', 'gt', 'lt', 'gte', 'lte', 'contains', 'empty'] as const;
const Scalar = z.union([z.number(), z.string().max(1000), z.boolean()]);

const ConditionLeaf = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('variable'), variableId: Id, op: z.enum(COMPARE_OPS), value: Scalar.optional() }), // CN-01
  z.strictObject({
    kind: z.literal('answer'),
    questionBlockId: Id,
    op: z.enum(['selected', 'notSelected', 'eq', 'contains', 'empty', 'scoreGte', 'scoreLte', 'correct', 'wrong']),
    optionId: Id.optional(),
    value: Scalar.optional(),
  }), // CN-02
  z.strictObject({
    kind: z.literal('blockState'),
    blockId: Id,
    state: z.enum(['visible', 'hidden', 'selected', 'onZone', 'dragging', 'copiesCount']),
    zoneId: Id.optional(),
    op: z.enum(COMPARE_OPS).optional(),
    value: z.number().optional(),
  }), // CN-03
  z.strictObject({ kind: z.literal('ruleCount'), op: z.enum(['eq', 'ne', 'gt', 'lt', 'gte', 'lte']), value: int(0, 100000) }), // CN-04
  z.strictObject({ kind: z.literal('chance'), percent: num(0, 100), affectsResult: z.boolean().default(false) }), // CN-05
]);

export type Condition =
  | z.infer<typeof ConditionLeaf>
  | { kind: 'group'; op: 'and' | 'or' | 'not'; items: Condition[] };
type ConditionInput = z.input<typeof ConditionLeaf> | { kind: 'group'; op: 'and' | 'or' | 'not'; items: ConditionInput[] };

/** CN-06: groups И / ИЛИ / НЕ, nested to any depth (validated up to 8 levels). */
export const Condition: z.ZodType<Condition, ConditionInput> = z.lazy(() =>
  z.union([
    ConditionLeaf,
    z.strictObject({ kind: z.literal('group'), op: z.enum(['and', 'or', 'not']), items: z.array(Condition).min(1).max(30) }),
  ]),
);

// ── AC-01…AC-20 Actions ───────────────────────────────────────────────────────
/** Block properties that AC-02 can change; values are validated by the runtime against the style schema. */
export const SETTABLE_PROPERTIES = [
  'frame.x',
  'frame.y',
  'frame.w',
  'frame.h',
  'frame.rotation',
  'frame.flipX',
  'frame.flipY',
  'style.shape',
  'style.radius',
  'style.fills',
  'style.stroke',
  'style.shadows',
  'style.glow',
  'style.effects',
  'style.filters',
  'style.padding',
  'style.text',
  'style.media',
  'style.transform3d',
  'style.mask',
  'style.layout',
  'textLayer',
  'props.media',
] as const;

const Destination = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('point'), point: Point }),
  z.strictObject({ kind: z.literal('block'), blockId: Id }),
  z.strictObject({ kind: z.literal('randomIn'), area: Rect }),
  z.strictObject({ kind: z.literal('by'), dx: num(-10000, 10000), dy: num(-10000, 10000) }),
]);

const ActionLeaf = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('visibility'), targets: z.array(Target).min(1).max(50), mode: z.enum(['show', 'hide', 'toggle']), animate: z.boolean().default(true) }), // AC-01
  z.strictObject({
    kind: z.literal('setProperty'),
    target: Target,
    property: z.enum(SETTABLE_PROPERTIES),
    value: z.unknown(),
    durationMs: int(0, 30000).default(0),
    easing: Easing.optional(),
  }), // AC-02
  z.strictObject({
    kind: z.literal('animateProperty'),
    target: Target,
    property: z.enum(ANIMATABLE),
    to: num(-10000, 10000),
    durationMs: int(0, 30000).default(300),
    easing: Easing.optional(),
  }), // AC-02 (smooth numeric change)
  z.strictObject({ kind: z.literal('move'), target: Target, to: Destination, durationMs: int(0, 30000).default(300), easing: Easing.optional() }), // AC-03
  z.strictObject({
    kind: z.literal('setVariable'),
    variableId: Id,
    op: z.enum(['set', 'add', 'sub', 'mul', 'div', 'random', 'pickRandom', 'append', 'remove', 'toggle']),
    value: Scalar.optional(),
    min: z.number().optional(),
    max: z.number().optional(),
  }), // AC-04
  z.strictObject({
    kind: z.literal('goTo'),
    to: z.enum(['next', 'back', 'screen', 'branch']),
    screenId: Id.optional(),
    transition: Transition.optional(),
  }), // AC-05
  z.strictObject({ kind: z.literal('media'), target: Target, command: z.enum(['play', 'pause', 'stop', 'restart']) }), // AC-06
  z.strictObject({
    kind: z.literal('effect'),
    effect: z.enum(['confetti', 'burst', 'shake', 'flash', 'vibrate']),
    intensity: num(0.1, 3).default(1),
    at: Target.optional(),
  }), // AC-07
  z.strictObject({ kind: z.literal('mediaOverlay'), overlay: MediaOverlay }), // AC-08
  z.strictObject({
    kind: z.literal('spawn'),
    prototypeId: Id,
    at: Destination,
    max: int(1, 200).default(50),
  }), // AC-09
  z.strictObject({ kind: z.literal('destroy'), target: Target }), // AC-10
  z.strictObject({ kind: z.literal('wait'), ms: int(0, 60000) }), // AC-11
  z.strictObject({ kind: z.literal('timer'), timerBlockId: Id, command: z.enum(['start', 'stop', 'reset']) }), // AC-13
  z.strictObject({
    kind: z.literal('record'),
    label: z.string().min(1).max(60),
    value: z.union([z.strictObject({ variableId: Id }), z.strictObject({ text: z.string().max(500) })]),
  }), // AC-14
  z.strictObject({ kind: z.literal('finish'), resultKey: z.string().max(60).optional() }), // AC-15
  z.strictObject({ kind: z.literal('openLink'), url: z.string().max(2000) }), // AC-16
  z.strictObject({ kind: z.literal('copyText'), text: z.string().max(2000) }), // AC-17
  z.strictObject({ kind: z.literal('interaction'), target: Target, enabled: z.boolean() }), // AC-18
  z.strictObject({ kind: z.literal('answer'), questionBlockId: Id, command: z.enum(['select', 'reset']), optionId: Id.optional() }), // AC-19
  z.strictObject({ kind: z.literal('shuffle'), blockIds: z.array(Id).min(2).max(100) }), // AC-20
  z.strictObject({ kind: z.literal('playSound'), media: MediaRef }), // AC-06 for sounds without a block
]);

export type ActionLeaf = z.infer<typeof ActionLeaf>;
export type Action =
  | ActionLeaf
  | { kind: 'if'; if: Condition; then: Action[]; else: Action[] }
  | { kind: 'repeat'; times?: number | undefined; while?: Condition | undefined; do: Action[] };
type ActionInput =
  | z.input<typeof ActionLeaf>
  | { kind: 'if'; if: ConditionInput; then: ActionInput[]; else?: ActionInput[] }
  | { kind: 'repeat'; times?: number; while?: ConditionInput; do: ActionInput[] };

/** Actions, plus control flow: «Если/Иначе» (CN-06) and «Повторить» (AC-12, guarded by SC-04). */
export const Action: z.ZodType<Action, ActionInput> = z.lazy(() =>
  z.union([
    ActionLeaf,
    z.strictObject({ kind: z.literal('if'), if: Condition, then: z.array(Action).max(50), else: z.array(Action).max(50).default([]) }),
    z
      .strictObject({ kind: z.literal('repeat'), times: int(1, 10000).optional(), while: Condition.optional(), do: z.array(Action).min(1).max(50) })
      .refine((r) => r.times !== undefined || r.while !== undefined, 'Укажите число повторов или условие'),
  ]),
);
export type ActionKind = Action['kind'];

// ── SC-01 Rule ────────────────────────────────────────────────────────────────
export const Rule = z.strictObject({
  id: Id,
  name: z.string().max(80).optional(),
  enabled: z.boolean().default(true),
  once: z.boolean().default(false),
  priority: int(0, 100).default(50),
  when: Trigger,
  if: Condition.optional(),
  do: z.array(Action).min(1).max(50),
});
export type Rule = z.infer<typeof Rule>;
export type RuleInput = z.input<typeof Rule>;

/** SC-04: runtime limits of the scenario engine. */
export const SCENARIO_LIMITS = { stepsPerSecond: 1000, nestingDepth: 20, maxCopies: 200, conditionDepth: 8 } as const;

// ── BH-01…BH-08 Behaviors ─────────────────────────────────────────────────────
export const Behavior = z.discriminatedUnion('kind', [
  z.strictObject({
    kind: z.literal('drag'),
    axis: z.enum(['both', 'x', 'y']).default('both'),
    bounds: Rect.optional(),
    snapToZones: z.array(Id).max(50).default([]),
    returnIfMissed: z.boolean().default(true),
    onePerZone: z.boolean().default(false),
  }), // BH-01
  z.strictObject({
    kind: z.literal('flee'),
    distance: num(10, 500).default(80),
    speed: num(0.1, 10).default(1),
    times: int(1, 100).default(5),
    area: Rect.optional(),
  }), // BH-02
  z.strictObject({ kind: z.literal('scratch'), brush: num(5, 200).default(40), threshold: int(1, 100).default(60) }), // BH-03
  z.strictObject({
    kind: z.literal('move'),
    angle: num(0, 360).default(90),
    speed: num(0, 2000).default(120),
    spread: num(0, 180).default(0),
    gravity: num(-2000, 2000).default(0),
    edge: z.enum(['bounce', 'destroy', 'wrap', 'stop']).default('destroy'),
    path: z.string().max(20000).optional(),
  }), // BH-04
  z.strictObject({
    kind: z.literal('spawner'),
    prototypeId: Id,
    everyMs: int(50, 60000).default(800),
    area: Rect,
    max: int(1, 200).default(30),
    autoStart: z.boolean().default(true),
  }), // BH-05
  z.strictObject({
    kind: z.literal('wheel'),
    sectors: z.array(z.strictObject({ blockId: Id, weight: num(0, 1000).default(1) })).min(2).max(24),
    spinMs: int(1000, 15000).default(4000),
  }), // BH-06 (outcome is drawn on the server, RN-01)
  z.strictObject({
    kind: z.literal('flip'),
    frontId: Id,
    backId: Id,
    on: z.enum(['tap', 'action']).default('tap'),
    durationMs: int(100, 3000).default(500),
  }), // BH-07
  z.strictObject({ kind: z.literal('follow'), lagMs: int(0, 2000).default(80), bounds: Rect.optional() }), // BH-08
]);
export type Behavior = z.infer<typeof Behavior>;

// ── VR-01…VR-04 Variables ─────────────────────────────────────────────────────
export const Variable = z
  .strictObject({
    id: Id,
    name: VariableName,
    type: z.enum(['number', 'text', 'bool', 'list']),
    initial: z.union([z.number(), z.string().max(1000), z.boolean(), z.array(z.union([z.number(), z.string().max(200)])).max(500)]),
    saveToAnswers: z.boolean().default(false), // VR-04
  })
  .refine(
    (v) =>
      (v.type === 'number' && typeof v.initial === 'number') ||
      (v.type === 'text' && typeof v.initial === 'string') ||
      (v.type === 'bool' && typeof v.initial === 'boolean') ||
      (v.type === 'list' && Array.isArray(v.initial)),
    { message: 'Начальное значение не подходит к типу переменной', path: ['initial'] },
  );
export type Variable = z.infer<typeof Variable>;

/** VR-03: read-only system variables available in texts and conditions. */
export const SYSTEM_VARIABLES = ['время_прохождения', 'время_на_экране', 'номер_экрана', 'баллы', 'имя_участника'] as const;
