import { describe, expect, it } from 'vitest';
import { type DebugEvent, createRuntime } from '../src/index.js';
import { act, b, buildDoc, ev, is, num, on, rule } from './runtime-helpers.js';

const K = b('shape', 'knopka');
const S = num('schet01');

function start(rules: ReturnType<typeof rule>[]) {
  const events: DebugEvent[] = [];
  const rt = createRuntime(buildDoc({ blocks: [K], vars: [S], rules }), { seed: 1, debug: { onEvent: (e) => events.push(e) } });
  rt.enterScreen('ekran1');
  events.length = 0;
  return { rt, events };
}

describe('P3.8 · SC-03 · отладчик в движке: журнал правил и пошаговый режим', () => {
  it('SC-03 · журнал: правило сработало, его «Если» не выполнилось, «один раз» уже отработало', () => {
    const fires = rule(on.tap('knopka'), [act.add('schet01')]);
    const guarded = rule(on.tap('knopka'), [act.add('schet01', 10)], { if: is.v('schet01', 'gte', 100) });
    const once = rule(on.tap('knopka'), [act.add('schet01', 100)], { once: true });
    const { rt, events } = start([fires, guarded, once]);
    rt.dispatch(ev.tap('knopka'));
    rt.dispatch(ev.tap('knopka'));
    const rules = events.filter((e) => e.type === 'rule').map((e) => `${e.ruleId === fires.id ? 'A' : e.ruleId === guarded.id ? 'B' : 'C'}:${(e as { status: string }).status}`);
    expect(rules).toEqual(['A:fired', 'B:condition', 'C:fired', 'A:fired', 'B:fired', 'C:once']);
    expect(events.filter((e) => e.type === 'action').map((e) => (e as { action: string }).action)).toEqual(['setVariable', 'setVariable', 'setVariable', 'setVariable']);
    expect(events.every((e) => e.type !== 'rule' || e.self === 'knopka')).toBe(true);
  });

  it('SC-03 · пошаговый режим: правило ждёт перед каждым действием и идёт по одному действию за шаг', () => {
    const r = rule(on.tap('knopka'), [act.add('schet01'), act.add('schet01', 10), act.add('schet01', 100)]);
    const { rt, events } = start([r]);
    expect(rt.setStepMode(true).effects).toEqual([]);
    rt.dispatch(ev.tap('knopka'));
    expect(rt.variables.schet01).toBe(0);
    expect(rt.pausedRules).toBe(1);
    expect(events.at(-1)).toMatchObject({ type: 'paused', ruleId: r.id, next: 'setVariable', self: 'knopka' });
    rt.stepOnce();
    expect(rt.variables.schet01).toBe(1);
    expect(rt.pausedRules).toBe(1);
    rt.stepOnce();
    expect(rt.variables.schet01).toBe(11);
    rt.stepOnce();
    expect(rt.variables.schet01).toBe(111);
    expect(rt.pausedRules).toBe(0);
    expect(rt.stepOnce()).toBeNull();
  });

  it('SC-03 · выключить пошаговый режим — ждущие правила дорабатывают до конца', () => {
    const r = rule(on.tap('knopka'), [act.add('schet01'), act.add('schet01', 10)]);
    const { rt } = start([r]);
    rt.setStepMode(true);
    rt.dispatch(ev.tap('knopka'));
    rt.stepOnce();
    expect(rt.variables.schet01).toBe(1);
    rt.setStepMode(false);
    expect(rt.variables.schet01).toBe(11);
    expect(rt.pausedRules).toBe(0);
    rt.dispatch(ev.tap('knopka'));
    expect(rt.variables.schet01).toBe(22);
  });

  it('SC-03 · «Если» и «Повторить» тоже шаги; ветка выбирается в момент шага', () => {
    const r = rule(on.tap('knopka'), [act.if(is.v('schet01', 'eq', 0), [act.add('schet01', 5)], [act.add('schet01', 50)]), act.repeat(2, [act.add('schet01')])]);
    const { rt, events } = start([r]);
    rt.setStepMode(true);
    rt.dispatch(ev.tap('knopka'));
    for (let i = 0; i < 5; i++) rt.stepOnce();
    expect(rt.variables.schet01).toBe(7);
    expect(events.filter((e) => e.type === 'action').map((e) => (e as { action: string }).action)).toEqual(['if', 'setVariable', 'repeat', 'setVariable', 'setVariable']);
  });

  it('SC-03 · без отладчика ход выполнения тот же: события не меняют результат', () => {
    const r = rule(on.tap('knopka'), [act.add('schet01'), act.add('schet01', 10)]);
    const plain = createRuntime(buildDoc({ blocks: [K], vars: [S], rules: [r] }), { seed: 1 });
    plain.enterScreen('ekran1');
    plain.dispatch(ev.tap('knopka'));
    const { rt } = start([r]);
    rt.dispatch(ev.tap('knopka'));
    expect(rt.variables).toEqual(plain.variables);
  });
});
