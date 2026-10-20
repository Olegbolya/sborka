import { type BlockInput, ProjectDocument, type RuleInput, type Variable, textOf } from '@blokum/schema';
import { type BlockView, type Runtime, type RuntimeEffect, type RuntimeEvent, type StepResult, type VariableValue, createRuntime } from '../src/index.js';

type ActionInput = RuleInput['do'][number];
type TriggerInput = RuleInput['when'];
type ConditionInput = NonNullable<RuleInput['if']>;

let ruleSeq = 0;
/** A rule with an auto id; `extra` sets name, once, priority, enabled, if. */
export const rule = (when: TriggerInput, actions: ActionInput[], extra: Partial<Omit<RuleInput, 'when' | 'do'>> = {}): RuleInput => ({
  id: `pravilo${String(++ruleSeq).padStart(4, '0')}`,
  when,
  do: actions,
  ...extra,
});

/** A block with a fixed id (≥ 6 characters), 50×50 at the origin unless `extra` says otherwise. */
export const b = (type: BlockInput['type'], id: string, extra: Partial<BlockInput> = {}): BlockInput =>
  ({ id, type, name: id, frame: { x: 0, y: 0, w: 50, h: 50 }, props: {}, ...extra }) as BlockInput;

/** A single-choice question «vopros» with options «otvet1»/«otvet2» drawn by blocks «variant1»/«variant2». */
export const question = (id = 'vopros', multi = false): BlockInput =>
  b(multi ? 'multiChoice' : 'singleChoice', id, {
    frame: { x: 0, y: 200, w: 300, h: 200 },
    props: { options: [1, 2].map((n) => ({ id: `${id}_otvet${n}`, blockId: `${id}_variant${n}` })) },
    children: [1, 2].map((n) => b('shape', `${id}_variant${n}`, { frame: { x: 0, y: n * 60, w: 300, h: 50 }, textLayer: textOf(`Вариант ${n}`) })),
  });

export const num = (id: string, initial = 0, saveToAnswers = false): Variable => ({ id, name: id, type: 'number', initial, saveToAnswers });
export const txt = (id: string, initial = ''): Variable => ({ id, name: id, type: 'text', initial, saveToAnswers: false });
export const bool = (id: string, initial = false): Variable => ({ id, name: id, type: 'bool', initial, saveToAnswers: false });
export const list = (id: string, initial: Array<number | string> = []): Variable => ({ id, name: id, type: 'list', initial, saveToAnswers: false });

const block = (blockId: string) => ({ kind: 'block' as const, blockId });
const copies = (blockId: string) => ({ kind: 'copiesOf' as const, blockId });

/** Triggers (TR-01…TR-16). */
export const on = {
  tap: (id: string): TriggerInput => ({ kind: 'tap', source: block(id) }),
  tapCopy: (id: string): TriggerInput => ({ kind: 'tap', source: copies(id) }),
  tapGroup: (groupId: string): TriggerInput => ({ kind: 'tap', source: { kind: 'group', groupId } }),
  doubleTap: (id: string): TriggerInput => ({ kind: 'doubleTap', source: block(id) }),
  longPress: (id: string, ms = 600): TriggerInput => ({ kind: 'longPress', source: block(id), ms }),
  hover: (id: string, phase: 'enter' | 'leave' = 'enter'): TriggerInput => ({ kind: 'hover', source: block(id), phase }),
  drag: (id: string, phase: 'start' | 'end' = 'start'): TriggerInput => ({ kind: 'drag', source: block(id), phase }),
  drop: (id: string, target: string): TriggerInput => ({ kind: 'drop', source: block(id), target: block(target) }),
  dropCopy: (id: string, target: string): TriggerInput => ({ kind: 'drop', source: copies(id), target: block(target) }),
  collide: (id: string, target: string, phase: 'start' | 'end' = 'start'): TriggerInput => ({ kind: 'collide', source: block(id), target: block(target), phase }),
  collideCopies: (id: string, target: string, phase: 'start' | 'end' = 'start'): TriggerInput => ({ kind: 'collide', source: copies(id), target: block(target), phase }),
  swipe: (direction: 'left' | 'right' | 'up' | 'down', id?: string): TriggerInput => ({ kind: 'swipe', direction, ...(id ? { on: block(id) } : {}) }),
  show: (): TriggerInput => ({ kind: 'screen', phase: 'show' }),
  leave: (): TriggerInput => ({ kind: 'screen', phase: 'leave' }),
  after: (seconds: number): TriggerInput => ({ kind: 'timer', mode: 'after', seconds }),
  every: (seconds: number): TriggerInput => ({ kind: 'timer', mode: 'every', seconds }),
  timerEnd: (timerBlockId: string): TriggerInput => ({ kind: 'timer', mode: 'timerEnd', timerBlockId }),
  change: (variableId: string): TriggerInput => ({ kind: 'variableChange', variableId }),
  answer: (questionBlockId = 'vopros'): TriggerInput => ({ kind: 'answer', questionBlockId }),
  mediaEnd: (id: string): TriggerInput => ({ kind: 'mediaEnd', source: block(id) }),
  scratched: (id: string, percent = 60): TriggerInput => ({ kind: 'scratched', source: block(id), percent }),
  motion: (motion: 'shake' | 'tiltLeft' | 'tiltRight' | 'tiltForward' | 'tiltBack'): TriggerInput => ({ kind: 'deviceMotion', motion }),
  key: (key: string): TriggerInput => ({ kind: 'key', key }),
};

/** Conditions (CN-01…CN-06). */
export const is = {
  v: (variableId: string, op: 'eq' | 'ne' | 'gt' | 'lt' | 'gte' | 'lte' | 'contains' | 'empty', value?: number | string | boolean): ConditionInput => ({
    kind: 'variable',
    variableId,
    op,
    ...(value !== undefined ? { value } : {}),
  }),
  selected: (n: 1 | 2, q = 'vopros'): ConditionInput => ({ kind: 'answer', questionBlockId: q, op: 'selected', optionId: `${q}_otvet${n}` }),
  answer: (op: 'eq' | 'contains' | 'empty' | 'scoreGte' | 'scoreLte' | 'correct' | 'wrong' | 'notSelected', value?: number | string, q = 'vopros'): ConditionInput => ({
    kind: 'answer',
    questionBlockId: q,
    op,
    ...(value !== undefined ? { value } : {}),
  }),
  state: (blockId: string, state: 'visible' | 'hidden' | 'selected' | 'onZone' | 'dragging', zoneId?: string): ConditionInput => ({
    kind: 'blockState',
    blockId,
    state,
    ...(zoneId ? { zoneId } : {}),
  }),
  copies: (blockId: string, op: 'eq' | 'gte' | 'lt', value: number): ConditionInput => ({ kind: 'blockState', blockId, state: 'copiesCount', op, value }),
  count: (op: 'eq' | 'gte' | 'lt', value: number): ConditionInput => ({ kind: 'ruleCount', op, value }),
  chance: (percent: number, affectsResult = false): ConditionInput => ({ kind: 'chance', percent, affectsResult }),
  and: (...items: ConditionInput[]): ConditionInput => ({ kind: 'group', op: 'and', items }),
  or: (...items: ConditionInput[]): ConditionInput => ({ kind: 'group', op: 'or', items }),
  not: (...items: ConditionInput[]): ConditionInput => ({ kind: 'group', op: 'not', items }),
};

const target = (id: string) => (id === 'self' ? { kind: 'self' as const } : id.startsWith('*') ? copies(id.slice(1)) : block(id));

/** Actions (AC-01…AC-20). Target «self» — the source of the trigger, «*id» — all copies of a block. */
export const act = {
  show: (...ids: string[]): ActionInput => ({ kind: 'visibility', targets: ids.map(target), mode: 'show' }),
  hide: (...ids: string[]): ActionInput => ({ kind: 'visibility', targets: ids.map(target), mode: 'hide' }),
  toggle: (...ids: string[]): ActionInput => ({ kind: 'visibility', targets: ids.map(target), mode: 'toggle', animate: false }),
  prop: (id: string, property: string, value: unknown, durationMs = 0): ActionInput => ({ kind: 'setProperty', target: target(id), property, value, durationMs }) as ActionInput,
  animate: (id: string, property: string, to: number, durationMs = 1000): ActionInput =>
    ({ kind: 'animateProperty', target: target(id), property, to, durationMs, easing: { kind: 'preset', name: 'linear' } }) as ActionInput,
  moveTo: (id: string, x: number, y: number, durationMs = 0): ActionInput => ({ kind: 'move', target: target(id), to: { kind: 'point', point: { x, y } }, durationMs, easing: { kind: 'preset', name: 'linear' } }),
  moveBy: (id: string, dx: number, dy: number, durationMs = 0): ActionInput => ({ kind: 'move', target: target(id), to: { kind: 'by', dx, dy }, durationMs }),
  moveToBlock: (id: string, other: string): ActionInput => ({ kind: 'move', target: target(id), to: { kind: 'block', blockId: other }, durationMs: 0 }),
  moveRandom: (id: string, area: { x: number; y: number; w: number; h: number }): ActionInput => ({ kind: 'move', target: target(id), to: { kind: 'randomIn', area }, durationMs: 0 }),
  set: (variableId: string, value?: number | string | boolean): ActionInput => ({ kind: 'setVariable', variableId, op: 'set', ...(value !== undefined ? { value } : {}) }),
  op: (variableId: string, op: 'add' | 'sub' | 'mul' | 'div' | 'append' | 'remove' | 'toggle' | 'pickRandom' | 'random', value?: number | string, range?: [number, number]): ActionInput => ({
    kind: 'setVariable',
    variableId,
    op,
    ...(value !== undefined ? { value } : {}),
    ...(range ? { min: range[0], max: range[1] } : {}),
  }),
  add: (variableId: string, value = 1): ActionInput => ({ kind: 'setVariable', variableId, op: 'add', value }),
  goNext: (): ActionInput => ({ kind: 'goTo', to: 'next' }),
  goScreen: (screenId: string): ActionInput => ({ kind: 'goTo', to: 'screen', screenId }),
  goBack: (): ActionInput => ({ kind: 'goTo', to: 'back' }),
  media: (id: string, command: 'play' | 'pause' | 'stop' | 'restart'): ActionInput => ({ kind: 'media', target: target(id), command }),
  sound: (): ActionInput => ({ kind: 'playSound', media: { source: 'media', id: 'zvukfail01' } }),
  effect: (effect: 'confetti' | 'burst' | 'shake' | 'flash' | 'vibrate', at?: string): ActionInput => ({ kind: 'effect', effect, ...(at ? { at: target(at) } : {}) }),
  meme: (caption: string): ActionInput => ({ kind: 'mediaOverlay', overlay: { media: { source: 'media', id: 'memfile001' }, caption: { text: caption } } }),
  spawn: (prototypeId: string, at: { kind: 'point'; point: { x: number; y: number } } | { kind: 'by'; dx: number; dy: number } | { kind: 'randomIn'; area: { x: number; y: number; w: number; h: number } } | { kind: 'block'; blockId: string }, max = 50): ActionInput => ({
    kind: 'spawn',
    prototypeId,
    at,
    max,
  }),
  destroy: (id: string): ActionInput => ({ kind: 'destroy', target: target(id) }),
  wait: (ms: number): ActionInput => ({ kind: 'wait', ms }),
  repeat: (times: number | undefined, actions: ActionInput[], whileCond?: ConditionInput): ActionInput => ({
    kind: 'repeat',
    ...(times !== undefined ? { times } : {}),
    ...(whileCond ? { while: whileCond } : {}),
    do: actions,
  }),
  if: (cond: ConditionInput, then: ActionInput[], otherwise: ActionInput[] = []): ActionInput => ({ kind: 'if', if: cond, then, else: otherwise }),
  timer: (timerBlockId: string, command: 'start' | 'stop' | 'reset'): ActionInput => ({ kind: 'timer', timerBlockId, command }),
  recordVar: (label: string, variableId: string): ActionInput => ({ kind: 'record', label, value: { variableId } }),
  recordText: (label: string, text: string): ActionInput => ({ kind: 'record', label, value: { text } }),
  finish: (resultKey?: string): ActionInput => ({ kind: 'finish', ...(resultKey ? { resultKey } : {}) }),
  link: (url = 'https://example.org/'): ActionInput => ({ kind: 'openLink', url }),
  copy: (text = 'ПРОМОКОД'): ActionInput => ({ kind: 'copyText', text }),
  interaction: (id: string, enabled: boolean): ActionInput => ({ kind: 'interaction', target: target(id), enabled }),
  select: (n: 1 | 2, q = 'vopros'): ActionInput => ({ kind: 'answer', questionBlockId: q, command: 'select', optionId: `${q}_otvet${n}` }),
  resetAnswer: (q = 'vopros'): ActionInput => ({ kind: 'answer', questionBlockId: q, command: 'reset' }),
  shuffle: (...blockIds: string[]): ActionInput => ({ kind: 'shuffle', blockIds }),
};

export type Step = RuntimeEvent | { tick: number } | { enter: string } | { leave: true } | ((rt: Runtime) => void);

export const ev = {
  tap: (blockId: string): RuntimeEvent => ({ type: 'tap', blockId }),
  doubleTap: (blockId: string): RuntimeEvent => ({ type: 'doubleTap', blockId }),
  longPress: (blockId: string, ms: number): RuntimeEvent => ({ type: 'longPress', blockId, ms }),
  hover: (blockId: string, phase: 'enter' | 'leave' = 'enter'): RuntimeEvent => ({ type: 'hover', blockId, phase }),
  dragStart: (blockId: string): RuntimeEvent => ({ type: 'dragStart', blockId }),
  dragMove: (blockId: string, x: number, y: number): RuntimeEvent => ({ type: 'dragMove', blockId, x, y }),
  dragEnd: (blockId: string, x?: number, y?: number): RuntimeEvent => ({ type: 'dragEnd', blockId, ...(x !== undefined && y !== undefined ? { x, y } : {}) }),
  swipe: (direction: 'left' | 'right' | 'up' | 'down', blockId?: string): RuntimeEvent => ({ type: 'swipe', direction, ...(blockId ? { blockId } : {}) }),
  answer: (n: 1 | 2 | null, q = 'vopros'): RuntimeEvent => ({ type: 'answer', questionBlockId: q, answer: n === null ? null : { kind: 'choice', optionIds: [`${q}_otvet${n}`] } }),
  mediaEnd: (blockId: string): RuntimeEvent => ({ type: 'mediaEnd', blockId }),
  scratched: (blockId: string, percent: number): RuntimeEvent => ({ type: 'scratched', blockId, percent }),
  motion: (motion: 'shake' | 'tiltLeft' | 'tiltRight' | 'tiltForward' | 'tiltBack'): RuntimeEvent => ({ type: 'deviceMotion', motion }),
  key: (key: string): RuntimeEvent => ({ type: 'key', key }),
};
export const tick = (ms: number): Step => ({ tick: ms });

export interface World {
  blocks?: BlockInput[];
  rules?: RuleInput[];
  vars?: Variable[];
  /** Rules of the whole document (all screens). */
  docRules?: RuleInput[];
  /** Blocks and rules of the second screen «ekran2». */
  screen2?: { blocks?: BlockInput[]; rules?: RuleInput[] };
  seed?: number;
  random?: number;
}

export interface Outcome {
  rt: Runtime;
  effects: RuntimeEffect[];
  warnings: string[];
  steps: StepResult[];
  v: (id: string) => VariableValue | undefined;
  view: (id: string) => BlockView | undefined;
  of: <T extends RuntimeEffect['type']>(type: T) => Array<Extract<RuntimeEffect, { type: T }>>;
}

export function buildDoc(w: World): ProjectDocument {
  return ProjectDocument.parse({
    schemaVersion: 1,
    variables: w.vars ?? [],
    rules: w.docRules ?? [],
    screens: [
      { id: 'ekran1', name: 'Экран 1', blocks: w.blocks ?? [], rules: w.rules ?? [] },
      { id: 'ekran2', name: 'Экран 2', blocks: w.screen2?.blocks ?? [], rules: w.screen2?.rules ?? [] },
    ],
  });
}

/** Builds the document, enters the first screen and plays the steps. */
export function play(w: World, steps: Step[] = []): Outcome {
  const doc = buildDoc(w);
  const rt = createRuntime(doc, { seed: w.seed ?? 1, ...(w.random !== undefined ? { randomSource: { next: () => w.random! } } : {}) });
  const results: StepResult[] = [rt.enterScreen('ekran1')];
  for (const s of steps) {
    if (typeof s === 'function') s(rt);
    else if ('tick' in s) results.push(rt.tick(s.tick));
    else if ('enter' in s) results.push(rt.enterScreen(s.enter));
    else if ('leave' in s) results.push(rt.leaveScreen());
    else results.push(rt.dispatch(s));
  }
  const effects = results.flatMap((r) => r.effects);
  return {
    rt,
    effects,
    warnings: effects.flatMap((e) => (e.type === 'warning' ? [e.message] : [])),
    steps: results,
    v: (id) => rt.variables[id],
    view: (id) => rt.view(id),
    of: (type) => effects.filter((e) => e.type === type) as never,
  };
}
