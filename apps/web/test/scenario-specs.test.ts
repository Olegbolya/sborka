import { describe, expect, it } from 'vitest';
import { Action, ActionLeaf, Behavior, Condition, ConditionLeaf, SETTABLE_PROPERTIES, Trigger, Variable, createBlock, createDocument, createScreen, createVariable } from '@blokum/schema';
import { CONDITION_KINDS, newCondition } from '../components/editor/ConditionEditor';
import { ACTIONS, BEHAVIORS, PROPERTY_TITLES, TRIGGERS, VARIABLE_TYPES, type MakeContext, type PartSpec, type SField } from '../lib/editor/scenario-specs';

const kindsOf = (union: { options: ReadonlyArray<{ shape: Record<string, { value?: unknown }> }> }): string[] => union.options.map((o) => String(o.shape.kind!.value));
const shapeOf = (union: { options: ReadonlyArray<{ shape: Record<string, unknown> }> }, kind: string): string[] => {
  const option = (union.options as ReadonlyArray<{ shape: Record<string, { value?: unknown }> }>).find((o) => o.shape.kind!.value === kind)!;
  return Object.keys(option.shape).filter((k) => k !== 'kind');
};
const keysOf = (fields: SField[]): string[] => fields.flatMap((f) => ('keys' in f ? [...f.keys] : [f.key]));

function context(): MakeContext {
  const doc = createDocument({ title: 'Проверка' });
  const self = createBlock('shape', { name: 'Фигура' });
  const zone = createBlock('zone');
  const timer = createBlock('timer');
  const question = createBlock('singleChoice');
  doc.screens[0]!.blocks.push(self, zone, timer, question);
  doc.screens.push(createScreen('Второй'));
  doc.variables.push(createVariable('Очки', 'number', 0));
  return { doc, self: self.id, screenId: doc.screens[0]!.id };
}

describe('P3.8 · SC-02 · схема ⊆ интерфейс: всё, что есть в схеме сценариев, можно выбрать и настроить в редакторе', () => {
  it('SC-02 · триггеры TR-01…TR-16: список редактора равен списку схемы, поля покрывают все ключи', () => {
    expect(TRIGGERS.map((s) => s.kind).sort()).toEqual(kindsOf(Trigger as never).sort());
    for (const spec of TRIGGERS) expect(keysOf(spec.fields).sort(), spec.kind).toEqual(shapeOf(Trigger as never, spec.kind).sort());
    expect(TRIGGERS).toHaveLength(16);
  });

  it('SC-02 · условия CN-01…CN-06: редактор условий знает пять видов схемы и группу, и каждый новый вид проходит схему', () => {
    expect([...CONDITION_KINDS].filter((k) => k !== 'group').sort()).toEqual(kindsOf(ConditionLeaf as never).sort());
    expect(CONDITION_KINDS).toContain('group');
    const ctx = { variableIds: ['peremennaya'], questionIds: ['vopros_1'], blockIds: ['blok_1'] };
    for (const kind of CONDITION_KINDS) expect(() => Condition.parse(newCondition(kind, ctx)), kind).not.toThrow();
  });

  it('SC-02 · действия AC-01…AC-20: все виды схемы плюс «Если» и «Повторить», поля покрывают ключи', () => {
    const leaves = ACTIONS.filter((s) => s.kind !== 'if' && s.kind !== 'repeat');
    expect(leaves.map((s) => s.kind).sort()).toEqual(kindsOf(ActionLeaf as never).sort());
    for (const spec of leaves) expect(keysOf(spec.fields).sort(), spec.kind).toEqual(shapeOf(ActionLeaf as never, spec.kind).sort());
    expect(keysOf(ACTIONS.find((s) => s.kind === 'if')!.fields).sort()).toEqual(['else', 'if', 'then']);
    expect(keysOf(ACTIONS.find((s) => s.kind === 'repeat')!.fields).sort()).toEqual(['do', 'times', 'while']);
  });

  it('SC-02 · поведения BH-01…BH-08: все восемь, поля покрывают ключи схемы', () => {
    expect(BEHAVIORS.map((s) => s.kind).sort()).toEqual(kindsOf(Behavior as never).sort());
    for (const spec of BEHAVIORS) expect(keysOf(spec.fields).sort(), spec.kind).toEqual(shapeOf(Behavior as never, spec.kind).sort());
    expect(BEHAVIORS).toHaveLength(8);
  });

  it('VR-01 · типы переменных: число, текст, да/нет, список; начальное значение подходит к типу', () => {
    expect(VARIABLE_TYPES.map((t) => t.type)).toEqual(['number', 'text', 'bool', 'list']);
    for (const t of VARIABLE_TYPES) expect(() => Variable.parse({ id: 'peremennaya', name: 'Имя', type: t.type, initial: t.initial() }), t.type).not.toThrow();
  });

  it('AC-02 · «Изменить свойство» умеет все свойства схемы и называет каждое по-русски', () => {
    expect(Object.keys(PROPERTY_TITLES).sort()).toEqual([...SETTABLE_PROPERTIES].sort());
  });

  it('SC-02 · каждый новый элемент, который редактор кладёт в правило, проходит проверку схемы', () => {
    const ctx = context();
    const check = (list: readonly PartSpec[], schema: { parse: (v: unknown) => unknown }) => {
      for (const spec of list) expect(() => schema.parse(spec.make(ctx)), spec.kind).not.toThrow();
    };
    check(TRIGGERS, Trigger);
    check(BEHAVIORS, Behavior);
    check(ACTIONS, Action);
  });

  it('SC-02 · подписи простым русским: без программистских терминов и латиницы', () => {
    const words = (list: readonly PartSpec[]) => list.flatMap((s) => [s.title, s.hint, ...s.fields.map((f) => f.label)]);
    const text = [...words(TRIGGERS), ...words(ACTIONS), ...words(BEHAVIORS)].join(' ');
    expect(text.match(/[A-Za-z]{2,}/g)).toBeNull();
    for (const bad of ['триггер', 'callback', 'handler', 'boolean', 'null', 'undefined', 'JSON']) expect(text.toLowerCase()).not.toContain(bad.toLowerCase());
  });
});
