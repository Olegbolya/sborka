import { type RuleInput } from '@blokum/schema';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { SCENARIO_LIMITS } from '@blokum/schema';
import { type RuntimeEvent } from '../src/index.js';
import { type World, act, b, is, num, on, play, rule, tick } from './runtime-helpers.js';

type ActionInput = RuleInput['do'][number];

const blockIds = ['blokaaa', 'blokbbb', 'blokccc'] as const;
const vars = ['peremx1', 'peremy1'] as const;

const arbTrigger = fc.oneof(
  fc.constantFrom(...blockIds).map((id) => on.tap(id)),
  fc.constantFrom(...blockIds).map((id) => on.tapCopy(id)),
  fc.constant(on.show()),
  fc.integer({ min: 1, max: 20 }).map((n) => on.every(n / 10)),
  fc.integer({ min: 1, max: 20 }).map((n) => on.after(n / 10)),
  fc.constantFrom(...vars).map((v) => on.change(v)),
  fc.tuple(fc.constantFrom(...blockIds), fc.constantFrom(...blockIds)).map(([a, c]) => on.collide(a, c)),
  fc.tuple(fc.constantFrom(...blockIds), fc.constantFrom(...blockIds)).map(([a, c]) => on.collideCopies(a, c, 'end')),
);

const arbCondition = fc.oneof(
  fc.tuple(fc.constantFrom(...vars), fc.constantFrom<'gt' | 'lt' | 'gte' | 'eq'>('gt', 'lt', 'gte', 'eq'), fc.integer({ min: -5, max: 50 })).map(([v, op, n]) => is.v(v, op, n)),
  fc.integer({ min: 0, max: 100 }).map((p) => is.chance(p)),
  fc.constantFrom(...blockIds).map((id) => is.state(id, 'visible')),
  fc.integer({ min: 0, max: 5 }).map((n) => is.count('gte', n)),
);

const arbLeaf: fc.Arbitrary<ActionInput> = fc.oneof(
  fc.tuple(fc.constantFrom(...vars), fc.integer({ min: -3, max: 3 })).map(([v, n]) => act.add(v, n)),
  fc.constantFrom(...vars).map((v) => act.op(v, 'mul', 2)),
  fc.constantFrom(...blockIds).map((id) => act.toggle(id)),
  fc.constantFrom(...blockIds).map((id) => act.spawn(id, { kind: 'randomIn', area: { x: 0, y: 0, w: 390, h: 800 } }, 30)),
  fc.constant(act.destroy('self')),
  fc.constantFrom(...blockIds).map((id) => act.moveRandom(id, { x: 0, y: 0, w: 390, h: 800 })),
  fc.tuple(fc.constantFrom(...blockIds), fc.integer({ min: 0, max: 1000 })).map(([id, ms]) => act.moveTo(id, 100, 400, ms)),
  fc.integer({ min: 0, max: 800 }).map((ms) => act.wait(ms)),
  fc.constant(act.effect('confetti')),
);

const arbAction: fc.Arbitrary<ActionInput> = fc.oneof(
  { weight: 4, arbitrary: arbLeaf },
  { weight: 1, arbitrary: fc.tuple(arbCondition, fc.array(arbLeaf, { minLength: 1, maxLength: 3 }), fc.array(arbLeaf, { maxLength: 2 })).map(([c, t, e]) => act.if(c, t, e)) },
  { weight: 1, arbitrary: fc.tuple(fc.integer({ min: 1, max: 3000 }), fc.array(arbLeaf, { minLength: 1, maxLength: 3 })).map(([n, d]) => act.repeat(n, d)) },
  { weight: 1, arbitrary: fc.tuple(arbCondition, fc.array(arbLeaf, { minLength: 1, maxLength: 2 })).map(([c, d]) => act.repeat(undefined, d, c)) },
);

const arbRule = fc
  .tuple(arbTrigger, fc.array(arbAction, { minLength: 1, maxLength: 4 }), fc.option(arbCondition, { nil: undefined }), fc.boolean())
  .map(([when, actions, cond, once]) => rule(when, actions, { once, ...(cond ? { if: cond } : {}) }));

const arbEvent: fc.Arbitrary<RuntimeEvent | { tick: number }> = fc.oneof(
  fc.constantFrom(...blockIds).map((id): RuntimeEvent => ({ type: 'tap', blockId: id })),
  fc.tuple(fc.constantFrom(...blockIds), fc.integer({ min: 1, max: 5 })).map(([id, n]): RuntimeEvent => ({ type: 'tap', blockId: `${id}~${n}` })),
  fc.integer({ min: 1, max: 1500 }).map((ms) => tick(ms) as { tick: number }),
);

const world = (rules: RuleInput[], seed: number): World => ({
  seed,
  vars: [num('peremx1'), num('peremy1')],
  blocks: blockIds.map((id, i) => b('shape', id, { frame: { x: i * 100, y: i * 150, w: 80, h: 80 } })),
  rules,
});

describe('SC-04 · свойства движка на случайных наборах правил', () => {
  it('SC-04: tick не зависает и не превышает лимит шагов; одинаковый seed — одинаковый результат', () => {
    fc.assert(
      fc.property(fc.array(arbRule, { minLength: 1, maxLength: 8 }), fc.array(arbEvent, { maxLength: 25 }), fc.integer({ min: 0, max: 2 ** 31 - 1 }), (rules, events, seed) => {
        const started = performance.now();
        const a = play(world(rules, seed), events);
        expect(performance.now() - started).toBeLessThan(2000);
        expect(a.rt.stats.peakStepsPerSecond).toBeLessThanOrEqual(SCENARIO_LIMITS.stepsPerSecond);
        expect(a.rt.views().filter((v) => v.copy).length).toBeLessThanOrEqual(SCENARIO_LIMITS.maxCopies);
        const b2 = play(world(rules, seed), events);
        expect(JSON.stringify([b2.rt.views(), b2.rt.variables, b2.effects])).toBe(JSON.stringify([a.rt.views(), a.rt.variables, a.effects]));
      }),
      { numRuns: 300 },
    );
  }, 300_000);
});
