import { describe, expect, it } from 'vitest';
import { Action, ActionLeaf, Behavior, Condition, ConditionLeaf, SETTABLE_PROPERTIES, SYSTEM_VARIABLES, Trigger, Variable, createBlock, createDocument, createScreen, createVariable } from '@blokum/schema';
import { CONDITION_KINDS, newCondition } from '../components/editor/ConditionEditor';
import { SYSTEM_TITLES } from '../lib/editor/variables';
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

describe('P3.8 · TR-10 · таймер: поля подстраиваются под вид', () => {
  it('TR-10 · «когда закончился таймер» получает таймер и теряет секунды; «через» и «каждые» — наоборот', () => {
    const ctx = context();
    const spec = TRIGGERS.find((t) => t.kind === 'timer')!;
    const end = spec.normalize!({ kind: 'timer', mode: 'timerEnd', seconds: 3 }, ctx);
    expect(end).toMatchObject({ mode: 'timerEnd' });
    expect(end.seconds).toBeUndefined();
    expect(typeof end.timerBlockId).toBe('string');
    expect(() => Trigger.parse(end)).not.toThrow();
    const every = spec.normalize!({ kind: 'timer', mode: 'every', timerBlockId: 'taimer' }, ctx);
    expect(every).toMatchObject({ mode: 'every', seconds: 3 });
    expect(every.timerBlockId).toBeUndefined();
    expect(() => Trigger.parse(every)).not.toThrow();
  });
});

/** Каждое требование P3.8 — строка редактора, которую можно выбрать (имя вида в схеме). */
const EDITOR_PARTS: Record<string, [list: 'TR' | 'CN' | 'AC' | 'BH', kind: string]> = {
  'TR-01': ['TR', 'tap'], 'TR-02': ['TR', 'doubleTap'], 'TR-03': ['TR', 'longPress'], 'TR-04': ['TR', 'hover'], 'TR-05': ['TR', 'drag'], 'TR-06': ['TR', 'drop'],
  'TR-07': ['TR', 'collide'], 'TR-08': ['TR', 'swipe'], 'TR-09': ['TR', 'screen'], 'TR-10': ['TR', 'timer'], 'TR-11': ['TR', 'variableChange'], 'TR-12': ['TR', 'answer'],
  'TR-13': ['TR', 'mediaEnd'], 'TR-14': ['TR', 'scratched'], 'TR-15': ['TR', 'deviceMotion'], 'TR-16': ['TR', 'key'],
  'CN-01': ['CN', 'variable'], 'CN-02': ['CN', 'answer'], 'CN-03': ['CN', 'blockState'], 'CN-04': ['CN', 'ruleCount'], 'CN-05': ['CN', 'chance'], 'CN-06': ['CN', 'group'],
  'AC-01': ['AC', 'visibility'], 'AC-02': ['AC', 'setProperty'], 'AC-03': ['AC', 'move'], 'AC-04': ['AC', 'setVariable'], 'AC-05': ['AC', 'goTo'], 'AC-06': ['AC', 'media'],
  'AC-07': ['AC', 'effect'], 'AC-08': ['AC', 'mediaOverlay'], 'AC-09': ['AC', 'spawn'], 'AC-10': ['AC', 'destroy'], 'AC-11': ['AC', 'wait'], 'AC-12': ['AC', 'repeat'],
  'AC-13': ['AC', 'timer'], 'AC-14': ['AC', 'record'], 'AC-15': ['AC', 'finish'], 'AC-16': ['AC', 'openLink'], 'AC-17': ['AC', 'copyText'], 'AC-18': ['AC', 'interaction'],
  'AC-19': ['AC', 'answer'], 'AC-20': ['AC', 'shuffle'],
  'BH-01': ['BH', 'drag'], 'BH-02': ['BH', 'flee'], 'BH-03': ['BH', 'scratch'], 'BH-04': ['BH', 'move'], 'BH-05': ['BH', 'spawner'], 'BH-06': ['BH', 'wheel'], 'BH-07': ['BH', 'flip'], 'BH-08': ['BH', 'follow'],
};

describe('P3.8 · SC-02 · каждое требование сценариев — выбираемая строка редактора', () => {
  it.each(Object.entries(EDITOR_PARTS))('%s · есть в редакторе, подписано по-русски, новый элемент проходит схему', (id, [list, kind]) => {
    const ctx = context();
    if (list === 'CN') {
      expect(CONDITION_KINDS).toContain(kind);
      return;
    }
    const specs = { TR: TRIGGERS, AC: ACTIONS, BH: BEHAVIORS }[list];
    const spec = specs.find((s) => s.kind === kind);
    expect(spec, id).toBeDefined();
    expect(spec!.title).toMatch(/[А-Яа-яЁё]/);
    const schema = { TR: Trigger, AC: Action, BH: Behavior }[list];
    expect(() => schema.parse(spec!.make(ctx))).not.toThrow();
  });

  it('VR-03 · встроенные переменные описаны в панели, по каждой из схемы', () => {
    expect(Object.keys(SYSTEM_TITLES).sort()).toEqual([...SYSTEM_VARIABLES].sort());
    for (const title of Object.values(SYSTEM_TITLES)) expect(title).toMatch(/[А-Яа-яЁё]/);
  });
});
