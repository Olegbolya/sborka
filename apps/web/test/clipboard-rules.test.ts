import { describe, expect, it } from 'vitest';
import { ProjectDocument, createBlock, createDocument, createVariable } from '@blokum/schema';
import { copyBlocks, freeName, pasteBlocks, planPaste, variableRefs } from '../lib/editor/clipboard';
import { createEditorStore } from '../lib/editor/store';

/** A source assembly: a button whose rule adds to «Очки»; a text that shows it. */
function source() {
  const doc = createDocument({ title: 'Источник' });
  const score = createVariable('Очки', 'number', 0);
  doc.variables.push(score);
  const target = createBlock('shape', { name: 'Мишень' });
  const button = createBlock('button', {
    name: 'Жми',
    rules: [{ id: 'pravilo_1', enabled: true, once: false, priority: 50, when: { kind: 'tap', source: { kind: 'block', blockId: 'zamena' } }, if: { kind: 'variable', variableId: score.id, op: 'lt', value: 10 }, do: [{ kind: 'setVariable', variableId: score.id, op: 'add', value: 1 }, { kind: 'visibility', targets: [{ kind: 'block', blockId: target.id }], mode: 'hide', animate: true }] }],
  });
  button.rules[0]!.when = { kind: 'tap', source: { kind: 'block', blockId: button.id } };
  const value = createBlock('value', { name: 'Счёт', props: { variableId: score.id, format: 'number' } });
  doc.screens[0]!.blocks.push(button, target, value);
  return { doc, score, button, target, value };
}

const emptyTarget = () => {
  const doc = createDocument({ title: 'Приёмник' });
  return createEditorStore(doc);
};

describe('P3.8 · SC-06 · блоки копируются вместе с правилами и переменными', () => {
  it('SC-06 · копия несёт правила блока и описание нужных переменных, лишние переменные не берутся', () => {
    const { doc, button, score } = source();
    doc.variables.push(createVariable('Лишняя', 'text', ''));
    const payload = copyBlocks(doc, [button.id])!;
    expect(payload.version).toBe(2);
    expect(payload.blocks[0]!.rules).toHaveLength(1);
    expect(payload.variables!.map((v) => v.name)).toEqual(['Очки']);
    expect([...variableRefs(payload.blocks)]).toEqual([score.id]);
  });

  it('SC-06 · в другую сборку: недостающая переменная создаётся, правила работают с ней, ссылки на копии блоков перенесены', () => {
    const { doc, button, value } = source();
    const payload = copyBlocks(doc, [button.id, value.id])!;
    const store = emptyTarget();
    const screenId = store.getState().doc.screens[0]!.id;
    expect(planPaste(store.getState().doc, payload)).toMatchObject({ create: [{ name: 'Очки' }], conflicts: [] });
    let created: string[] = [];
    store.getState().apply(pasteBlocks(payload, screenId, 12, (ids) => (created = ids)), { label: 'Вставить' });
    const pasted = store.getState().doc;
    expect(pasted.variables.map((v) => v.name)).toEqual(['Очки']);
    const [newButton, newValue] = pasted.screens[0]!.blocks;
    expect(created).toEqual([newButton!.id, newValue!.id]);
    expect(newButton!.id).not.toBe(button.id);
    const rule = newButton!.rules[0]!;
    expect(rule.id).not.toBe('pravilo_1');
    expect(rule.when).toMatchObject({ kind: 'tap', source: { kind: 'block', blockId: newButton!.id } });
    expect(JSON.stringify(rule)).toContain(pasted.variables[0]!.id);
    expect(newValue!.type === 'value' && newValue!.props.variableId).toBe(pasted.variables[0]!.id);
    expect(() => ProjectDocument.parse(pasted)).not.toThrow();
  });

  it('SC-06 · в ту же сборку: переменная не дублируется', () => {
    const { doc, button } = source();
    const store = createEditorStore(doc);
    const payload = copyBlocks(store.getState().doc, [button.id])!;
    expect(planPaste(store.getState().doc, payload)).toEqual({ create: [], conflicts: [] });
    store.getState().apply(pasteBlocks(payload, doc.screens[0]!.id, 12), { label: 'Вставить' });
    expect(store.getState().doc.variables).toHaveLength(1);
    expect(store.getState().doc.screens[0]!.blocks).toHaveLength(4);
  });

  it('SC-06 · имя занято другой переменной: «связать» направляет правила на существующую', () => {
    const { doc, button } = source();
    const payload = copyBlocks(doc, [button.id])!;
    const store = emptyTarget();
    const existing = createVariable('Очки', 'number', 100);
    store.getState().apply((d) => void d.variables.push(existing), { label: 'Переменная' });
    const plan = planPaste(store.getState().doc, payload);
    expect(plan.conflicts).toHaveLength(1);
    expect(plan.conflicts[0]!.existing.id).toBe(existing.id);
    store.getState().apply(pasteBlocks(payload, store.getState().doc.screens[0]!.id, 12, undefined, { [payload.variables![0]!.id]: 'link' }), { label: 'Вставить' });
    const next = store.getState().doc;
    expect(next.variables).toHaveLength(1);
    expect(JSON.stringify(next.screens[0]!.blocks[0]!.rules)).toContain(existing.id);
    expect(JSON.stringify(next.screens[0]!.blocks[0]!.rules)).not.toContain(payload.variables![0]!.id);
  });

  it('SC-06 · имя занято: «создать под другим именем» делает новую переменную, правила работают с ней', () => {
    const { doc, button } = source();
    const payload = copyBlocks(doc, [button.id])!;
    const store = emptyTarget();
    const existing = createVariable('Очки', 'number', 100);
    store.getState().apply((d) => void d.variables.push(existing), { label: 'Переменная' });
    store.getState().apply(pasteBlocks(payload, store.getState().doc.screens[0]!.id, 12, undefined, { [payload.variables![0]!.id]: 'rename' }), { label: 'Вставить' });
    const next = store.getState().doc;
    expect(next.variables.map((v) => v.name)).toEqual(['Очки', 'Очки_копия']);
    const fresh = next.variables[1]!;
    expect(fresh.id).not.toBe(existing.id);
    expect(JSON.stringify(next.screens[0]!.blocks[0]!.rules)).toContain(fresh.id);
    expect(() => ProjectDocument.parse(next)).not.toThrow();
  });

  it('SC-06 · другой тип при том же имени: связать нельзя, переменная создаётся заново', () => {
    const { doc, button } = source();
    const payload = copyBlocks(doc, [button.id])!;
    const store = emptyTarget();
    store.getState().apply((d) => void d.variables.push(createVariable('Очки', 'text', '')), { label: 'Переменная' });
    store.getState().apply(pasteBlocks(payload, store.getState().doc.screens[0]!.id, 12, undefined, { [payload.variables![0]!.id]: 'link' }), { label: 'Вставить' });
    expect(store.getState().doc.variables.map((v) => v.type)).toEqual(['text', 'number']);
  });

  it('SC-06 · свободное имя для копии не повторяется', () => {
    const doc = createDocument({ title: 'Имена' });
    for (const n of ['Очки', 'Очки_копия']) doc.variables.push(createVariable(n, 'number', 0));
    expect(freeName(doc, 'Очки')).toBe('Очки_копия_2');
  });
});
