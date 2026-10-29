import { describe, expect, it } from 'vitest';
import { type Behavior, ProjectDocument, createBlock, createDocument } from '@blokum/schema';
import { createEditorStore } from '../lib/editor/store';
import { addBehavior, removeBehavior, setBehavior } from '../lib/editor/rules';
import { addVariableOf, listToText, nameProblem, removeVariable, renameVariable, setVariableInitial, setVariableSave, setVariableType, textToList, variableUsage } from '../lib/editor/variables';
import { BEHAVIORS } from '../lib/editor/scenario-specs';

const setup = () => {
  const doc = createDocument({ title: 'Переменные' });
  const block = createBlock('shape', { name: 'Фигура' });
  doc.screens[0]!.blocks.push(block);
  const store = createEditorStore(doc);
  return { store, st: () => store.getState(), block };
};

describe('P3.8 · VR-01…VR-04 · переменные сборки', () => {
  it('VR-01 · добавить переменную каждого типа; имя проверяется и не повторяется', () => {
    const { st } = setup();
    for (const [name, type] of [['Очки', 'number'], ['Имя', 'text'], ['Готово', 'bool'], ['Корзина', 'list']] as const) st().apply(addVariableOf(name, type), { label: 'Новая переменная' });
    expect(st().doc.variables.map((v) => [v.name, v.type, v.initial])).toEqual([['Очки', 'number', 0], ['Имя', 'text', ''], ['Готово', 'bool', false], ['Корзина', 'list', []]]);
    st().apply(addVariableOf('Очки', 'number'), { label: 'Дубль' });
    st().apply(addVariableOf('1плохо', 'number'), { label: 'Плохое имя' });
    st().apply(addVariableOf('с пробелом', 'number'), { label: 'Плохое имя' });
    expect(st().doc.variables).toHaveLength(4);
    expect(nameProblem(st().doc, 'Очки')).toContain('уже есть');
    expect(nameProblem(st().doc, '1плохо')).toContain('Имя');
    expect(nameProblem(st().doc, 'Очки', st().doc.variables[0]!.id)).toBeNull();
    expect(() => ProjectDocument.parse(st().doc)).not.toThrow();
  });

  it('VR-02 · переименование, смена типа (значение по умолчанию нового типа), начальное значение только своего типа', () => {
    const { st } = setup();
    let id = '';
    st().apply(addVariableOf('Счёт', 'number', (m) => (id = m)), { label: 'Новая переменная' });
    st().apply(renameVariable(id, 'Баллы_игры'), { label: 'Имя' });
    expect(st().doc.variables[0]!.name).toBe('Баллы_игры');
    st().apply(renameVariable(id, 'плохое имя'), { label: 'Имя' });
    expect(st().doc.variables[0]!.name).toBe('Баллы_игры');
    st().apply(setVariableInitial(id, 7), { label: 'Начальное' });
    expect(st().doc.variables[0]!.initial).toBe(7);
    st().apply(setVariableInitial(id, 'семь'), { label: 'Начальное' });
    expect(st().doc.variables[0]!.initial).toBe(7);
    st().apply(setVariableType(id, 'text'), { label: 'Тип' });
    expect(st().doc.variables[0]).toMatchObject({ type: 'text', initial: '' });
    st().apply(setVariableType(id, 'list'), { label: 'Тип' });
    st().apply(setVariableInitial(id, textToList('1, два, 3')), { label: 'Начальное' });
    expect(st().doc.variables[0]!.initial).toEqual([1, 'два', 3]);
    expect(listToText([1, 'два', 3])).toBe('1, два, 3');
    expect(() => ProjectDocument.parse(st().doc)).not.toThrow();
  });

  it('VR-04 · отметка «записывать в ответы» ставится и снимается', () => {
    const { st } = setup();
    let id = '';
    st().apply(addVariableOf('Выбор', 'text', (m) => (id = m)), { label: 'Новая переменная' });
    st().apply(setVariableSave(id, true), { label: 'В ответы' });
    expect(st().doc.variables[0]!.saveToAnswers).toBe(true);
    st().apply(setVariableSave(id, false), { label: 'В ответы' });
    expect(st().doc.variables[0]!.saveToAnswers).toBe(false);
  });

  it('VR-01 · удаление переменной и счёт мест, где она используется (правила, условия, тексты, блок «Значение»)', () => {
    const { st, block } = setup();
    let id = '';
    st().apply(addVariableOf('Очки', 'number', (m) => (id = m)), { label: 'Новая переменная' });
    expect(variableUsage(st().doc, id)).toBe(0);
    const value = createBlock('value', { props: { variableId: id, format: 'number' } });
    const rule = { id: 'pravilo_1', enabled: true, once: false, priority: 50, when: { kind: 'variableChange' as const, variableId: id }, if: { kind: 'variable' as const, variableId: id, op: 'gte' as const, value: 3 }, do: [{ kind: 'setVariable' as const, variableId: id, op: 'add' as const, value: 1 }] };
    st().apply((doc) => void doc.screens[0]!.blocks.push(value), { label: 'Значение' });
    st().apply((doc) => void doc.screens[0]!.blocks.find((b) => b.id === block.id)!.rules.push(rule), { label: 'Правило' });
    expect(variableUsage(st().doc, id)).toBe(4);
    st().apply(removeVariable(id), { label: 'Удалить' });
    expect(st().doc.variables).toHaveLength(0);
  });
});

describe('P3.8 · BH-01…BH-08 · поведения блока', () => {
  it('BH-01 · каждое из восьми поведений добавляется, правится и убирается; повторное тоже вид не добавляется', () => {
    const { st, block } = setup();
    const ctx = { doc: st().doc, self: block.id, screenId: st().doc.screens[0]!.id };
    for (const spec of BEHAVIORS) st().apply(addBehavior(block.id, spec.make(ctx) as unknown as Behavior), { label: spec.title });
    const blockNow = () => st().doc.screens[0]!.blocks[0]!;
    expect(blockNow().behaviors.map((b) => b.kind).sort()).toEqual(BEHAVIORS.map((b) => b.kind).sort());
    st().apply(addBehavior(block.id, BEHAVIORS[1]!.make(ctx) as unknown as Behavior), { label: 'Ещё раз' });
    expect(blockNow().behaviors).toHaveLength(8);
    const at = blockNow().behaviors.findIndex((b) => b.kind === 'flee');
    st().apply(setBehavior(block.id, at, { kind: 'flee', distance: 200, speed: 2, times: 3 }), { label: 'Убегает' });
    expect(blockNow().behaviors[at]).toMatchObject({ kind: 'flee', distance: 200, times: 3 });
    st().apply(removeBehavior(block.id, at), { label: 'Убрать' });
    expect(blockNow().behaviors.some((b) => b.kind === 'flee')).toBe(false);
    expect(() => ProjectDocument.parse(st().doc)).not.toThrow();
  });
});
