import { describe, expect, it } from 'vitest';
import { type Rule, ProjectDocument, createBlock, createDocument, createVariable } from '@blokum/schema';
import { createEditorStore } from '../lib/editor/store';
import { addAction, addRule, duplicateRule, listAt, moveAction, moveRule, removeAction, removeRule, setAction, setRuleCondition, setRuleFields, setTrigger, type RuleOwner } from '../lib/editor/rules';
import { describeAction, describeCondition, describeTrigger, namesOf } from '../lib/editor/rule-text';

function setup() {
  const doc = createDocument({ title: 'Правила' });
  const button = createBlock('button', { name: 'Кнопка', rules: [] });
  const box = createBlock('shape', { name: 'Коробка' });
  doc.screens[0]!.blocks.push(button, box);
  doc.variables.push(createVariable('Очки', 'number', 0));
  const store = createEditorStore(doc);
  const owner: RuleOwner = { kind: 'block', blockId: button.id };
  const st = () => store.getState();
  const rules = () => st().doc.screens[0]!.blocks[0]!.rules;
  return { store, st, owner, button, box, rules, variable: doc.variables[0]! };
}

describe('P3.8 · SC-01/SC-02 · правки правил блока', () => {
  it('SC-02 · правило создаётся с первым действием, правится по частям и отменяется шагами истории', () => {
    const { st, owner, button, box, rules } = setup();
    let id = '';
    st().apply(addRule(owner, { kind: 'tap', source: { kind: 'block', blockId: button.id } }, { kind: 'visibility', targets: [{ kind: 'block', blockId: box.id }], mode: 'hide', animate: true }, (made) => (id = made)), { label: 'Новое правило' });
    expect(rules()).toHaveLength(1);
    expect(rules()[0]!.id).toBe(id);
    expect(() => ProjectDocument.parse(st().doc)).not.toThrow();
    st().apply(setRuleFields(owner, id, { name: 'Спрятать коробку', once: true }), { label: 'Параметры' });
    expect(rules()[0]).toMatchObject({ name: 'Спрятать коробку', once: true });
    st().apply(setRuleFields(owner, id, { name: '' }), { label: 'Параметры' });
    expect(rules()[0]!.name).toBeUndefined();
    st().apply(setTrigger(owner, id, { kind: 'doubleTap', source: { kind: 'block', blockId: button.id } }), { label: 'Когда' });
    expect(rules()[0]!.when.kind).toBe('doubleTap');
    expect(st().undo()).toBe(true);
    expect(rules()[0]!.when.kind).toBe('tap');
  });

  it('SC-01 · условие правила ставится и снимается', () => {
    const { st, owner, button, box, rules, variable } = setup();
    let id = '';
    st().apply(addRule(owner, { kind: 'tap', source: { kind: 'block', blockId: button.id } }, { kind: 'destroy', target: { kind: 'block', blockId: box.id } }, (m) => (id = m)), { label: 'Новое правило' });
    st().apply(setRuleCondition(owner, id, { kind: 'variable', variableId: variable.id, op: 'gte', value: 3 }), { label: 'Если' });
    expect(rules()[0]!.if).toMatchObject({ kind: 'variable', op: 'gte' });
    st().apply(setRuleCondition(owner, id, null), { label: 'Если' });
    expect(rules()[0]!.if).toBeUndefined();
  });

  it('SC-02 · действия: добавить, переставить, заменить, удалить; последнее действие правила не удаляется', () => {
    const { st, owner, button, box, rules } = setup();
    let id = '';
    st().apply(addRule(owner, { kind: 'tap', source: { kind: 'block', blockId: button.id } }, { kind: 'wait', ms: 100 }, (m) => (id = m)), { label: 'Новое правило' });
    st().apply(addAction(owner, id, [], { kind: 'wait', ms: 200 }), { label: 'Действие' });
    st().apply(addAction(owner, id, [], { kind: 'destroy', target: { kind: 'block', blockId: box.id } }, 0), { label: 'Действие' });
    expect(rules()[0]!.do.map((a) => a.kind)).toEqual(['destroy', 'wait', 'wait']);
    st().apply(moveAction(owner, id, [], 0, 2), { label: 'Порядок' });
    expect(rules()[0]!.do.map((a) => a.kind)).toEqual(['wait', 'wait', 'destroy']);
    st().apply(setAction(owner, id, [], 0, { kind: 'wait', ms: 999 }), { label: 'Действие' });
    expect(rules()[0]!.do[0]).toEqual({ kind: 'wait', ms: 999 });
    st().apply(removeAction(owner, id, [], 0), { label: 'Удалить' });
    st().apply(removeAction(owner, id, [], 0), { label: 'Удалить' });
    st().apply(removeAction(owner, id, [], 0), { label: 'Удалить' });
    expect(rules()[0]!.do).toHaveLength(1);
  });

  it('AC-12 · вложенные «Если/Иначе» и «Повторить»: действия добавляются по пути и не теряются', () => {
    const { st, owner, button, rules } = setup();
    let id = '';
    st().apply(addRule(owner, { kind: 'tap', source: { kind: 'block', blockId: button.id } }, { kind: 'if', if: { kind: 'chance', percent: 50, affectsResult: false }, then: [], else: [] }, (m) => (id = m)), { label: 'Новое правило' });
    st().apply(addAction(owner, id, [0, 'then'], { kind: 'repeat', times: 2, do: [{ kind: 'wait', ms: 10 }] }), { label: 'Действие' });
    st().apply(addAction(owner, id, [0, 'then', 0, 'do'], { kind: 'wait', ms: 20 }), { label: 'Действие' });
    st().apply(addAction(owner, id, [0, 'else'], { kind: 'finish' }), { label: 'Действие' });
    const rule = rules()[0] as Rule;
    expect(listAt(rule, [0, 'then', 0, 'do'])!.map((a) => a.kind)).toEqual(['wait', 'wait']);
    expect(listAt(rule, [0, 'else'])!.map((a) => a.kind)).toEqual(['finish']);
    expect(listAt(rule, [5, 'then'])).toBeNull();
    expect(listAt(rule, [0, 'do'])).toBeNull();
    // The only action of a repeat stays, the «else» branch may be emptied.
    st().apply(removeAction(owner, id, [0, 'then', 0, 'do'], 0), { label: 'Удалить' });
    st().apply(removeAction(owner, id, [0, 'then', 0, 'do'], 0), { label: 'Удалить' });
    expect(listAt(rules()[0] as Rule, [0, 'then', 0, 'do'])).toHaveLength(1);
    st().apply(removeAction(owner, id, [0, 'else'], 0), { label: 'Удалить' });
    expect(listAt(rules()[0] as Rule, [0, 'else'])).toEqual([]);
    expect(() => ProjectDocument.parse(st().doc)).not.toThrow();
  });

  it('SC-01 · правила экрана и сборки: те же операции, у каждого владельца свой список; порядок, копия, удаление', () => {
    const { st, button } = setup();
    const screenOwner: RuleOwner = { kind: 'screen', screenId: st().doc.screens[0]!.id };
    const docOwner: RuleOwner = { kind: 'doc' };
    const when = { kind: 'screen', phase: 'show' } as const;
    let a = '';
    let b = '';
    st().apply(addRule(screenOwner, when, { kind: 'wait', ms: 1 }, (m) => (a = m)), { label: 'Правило экрана' });
    st().apply(addRule(screenOwner, when, { kind: 'wait', ms: 2 }, (m) => (b = m)), { label: 'Правило экрана' });
    st().apply(addRule(docOwner, { kind: 'key', key: 'Enter' }, { kind: 'finish' }), { label: 'Правило сборки' });
    expect(st().doc.screens[0]!.rules).toHaveLength(2);
    expect(st().doc.rules).toHaveLength(1);
    st().apply(moveRule(screenOwner, b, -1), { label: 'Порядок' });
    expect(st().doc.screens[0]!.rules.map((r) => r.id)).toEqual([b, a]);
    let copy = '';
    st().apply(duplicateRule(screenOwner, a, (m) => (copy = m)), { label: 'Копия' });
    expect(st().doc.screens[0]!.rules.map((r) => r.id)).toEqual([b, a, copy]);
    expect(new Set(st().doc.screens[0]!.rules.map((r) => r.id)).size).toBe(3);
    st().apply(removeRule(screenOwner, b), { label: 'Удалить' });
    expect(st().doc.screens[0]!.rules.map((r) => r.id)).toEqual([a, copy]);
    st().apply(removeRule({ kind: 'block', blockId: 'net_takogo' }, a), { label: 'Удалить' });
    expect(button.rules).toEqual([]);
  });
});

describe('P3.8 · SC-02 · правило простым русским', () => {
  it('SC-02 · «Когда → Сделать» читается как предложение с именами блоков, переменных и экранов', () => {
    const { st, button, box, variable } = setup();
    const n = namesOf(st().doc);
    expect(describeTrigger({ kind: 'tap', source: { kind: 'block', blockId: button.id } }, n)).toBe('нажали на «Кнопка»');
    expect(describeTrigger({ kind: 'timer', mode: 'every', seconds: 2 }, n)).toBe('каждые 2 с');
    expect(describeTrigger({ kind: 'drop', source: { kind: 'block', blockId: box.id }, target: { kind: 'copiesOf', blockId: button.id } }, n)).toBe('«Коробка» положили на копии «Кнопка»');
    expect(describeAction({ kind: 'setVariable', variableId: variable.id, op: 'add', value: 1 }, n)).toBe('прибавить «Очки» (1)');
    expect(describeAction({ kind: 'visibility', targets: [{ kind: 'block', blockId: box.id }, { kind: 'self' }], mode: 'hide', animate: true }, n)).toBe('скрыть «Коробка», этот блок');
    expect(describeAction({ kind: 'goTo', to: 'screen', screenId: st().doc.screens[0]!.id }, n)).toBe('перейти на экран «Экран 1»');
    expect(describeCondition({ kind: 'group', op: 'and', items: [{ kind: 'variable', variableId: variable.id, op: 'gte', value: 5 }, { kind: 'chance', percent: 30, affectsResult: false }] }, n)).toBe('(«Очки» ≥ 5 и случайно, 30%)');
  });

  it('SC-07 · удалённые блок и переменная названы прямо, а не пустотой', () => {
    const { st } = setup();
    const n = namesOf(st().doc);
    expect(describeTrigger({ kind: 'tap', source: { kind: 'block', blockId: 'udalyon' } }, n)).toBe('нажали на «блок удалён»');
    expect(describeAction({ kind: 'setVariable', variableId: 'udalyon', op: 'set', value: 0 }, n)).toContain('«переменная удалена»');
  });
});
