import { describe, expect, it } from 'vitest';
import { analyzeScreenGraph, createBlock, createDocument, createScreen, validateDocument } from '@blokum/schema';
import { layoutGraph } from '../lib/editor/graph';
import { newBranch, questionsOf, setBranches, setResults, setSettings } from '../lib/editor/logic';
import { createEditorStore } from '../lib/editor/store';

const docWith = (screens = 3) => {
  const doc = createDocument();
  while (doc.screens.length < screens) doc.screens.push(createScreen(`Экран ${doc.screens.length + 1}`));
  const q = createBlock('singleChoice');
  doc.screens[0]!.blocks.push(q);
  return { doc, q, store: createEditorStore(doc) };
};

describe('L-02 · ветки экрана', () => {
  it('L-02 · новая ветка берёт первый вопрос экрана и ведёт на следующий; недопустимое не записывается', () => {
    const { store, q } = docWith();
    const doc = () => store.getState().doc;
    const first = doc().screens[0]!;
    store.getState().apply(setBranches(first.id, (b) => [...b, newBranch(doc(), first)]), { label: 'x' });
    expect(doc().screens[0]!.branches[0]).toMatchObject({ if: { kind: 'answer', questionBlockId: q.id, op: 'selected' }, to: { kind: 'next' } });
    const stamp = store.getState().docVersion;
    store.getState().apply(setBranches(first.id, (b) => b.map((x) => ({ ...x, to: { kind: 'nowhere' } }))), { label: 'x' });
    expect(store.getState().docVersion).toBe(stamp);
  });

  it('L-02 · первая подходящая ветка и порядок веток: порядок в документе сохраняется', () => {
    const { store } = docWith();
    const doc = () => store.getState().doc;
    const s = doc().screens[0]!;
    store.getState().apply(setBranches(s.id, () => [newBranch(doc(), s), { ...newBranch(doc(), s), to: { kind: 'finish' } }]), { label: 'x' });
    const ids = doc().screens[0]!.branches.map((b) => b.id);
    store.getState().apply(setBranches(s.id, (b) => [b[1], b[0]]), { label: 'x' });
    expect(doc().screens[0]!.branches.map((b) => b.id)).toEqual([ids[1], ids[0]]);
  });
});

describe('L-04 · результаты и настройки', () => {
  it('L-04 · три вида результата записываются, диапазон и метка проверяются схемой', () => {
    const { store, doc: d } = docWith();
    const screenId = d.screens[1]!.id;
    store.getState().apply(
      setResults(() => [
        { kind: 'scoreRange', id: 'rezultat_1', key: 'Низкий', screenId, min: 0, max: 5 },
        { kind: 'tag', id: 'rezultat_2', key: 'Лиса', screenId, tag: 'лиса' },
        { kind: 'variable', id: 'rezultat_3', key: 'Игра', screenId, if: { kind: 'ruleCount', op: 'gte', value: 1 } },
      ]),
      { label: 'x' },
    );
    expect(store.getState().doc.results.map((r) => r.kind)).toEqual(['scoreRange', 'tag', 'variable']);
    const stamp = store.getState().docVersion;
    store.getState().apply(setResults((r) => r.map((x) => ({ ...x, key: '' }))), { label: 'x' });
    expect(store.getState().docVersion).toBe(stamp);
  });

  it('L-03 · настройки прохождения: режим обратной связи, ничья, возврат', () => {
    const { store } = docWith();
    store.getState().apply(setSettings((s) => ({ ...s, feedbackMode: 'instant', tieBreak: 'random', allowBack: false })), { label: 'x' });
    expect(store.getState().doc.settings).toMatchObject({ feedbackMode: 'instant', tieBreak: 'random', allowBack: false });
    store.getState().apply(setSettings((s) => ({ ...s, feedbackMode: 'sometimes' })), { label: 'x' });
    expect(store.getState().doc.settings.feedbackMode).toBe('instant');
  });

  it('L-05 · список вопросов для подстановок и условий включает варианты с их текстом', () => {
    const { doc, q } = docWith();
    const list = questionsOf(doc);
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ id: q.id, screen: 'Экран 1' });
    expect(list[0]!.options.map((o) => o.label)).toEqual(['Вариант 1', 'Вариант 2']);
  });
});

describe('L-02, L-08 · схема переходов', () => {
  const linked = () => {
    const doc = createDocument();
    for (let i = 0; i < 4; i++) doc.screens.push(createScreen(`Экран ${i + 2}`));
    return doc;
  };

  it('L-02 · анализ: экран без входящих переходов недостижим, круг с выходом — в круге, без выхода — ошибка', () => {
    const doc = linked(); // 5 экранов, на каждом ничего нет; последний — конец сборки
    const [a, b, c, d, e] = doc.screens as [typeof doc.screens[0], typeof doc.screens[0], typeof doc.screens[0], typeof doc.screens[0], typeof doc.screens[0]];
    a.timer = { seconds: 5, onExpire: { kind: 'screen', screenId: c.id } };
    c.timer = { seconds: 5, onExpire: { kind: 'screen', screenId: d.id } };
    d.timer = { seconds: 5, onExpire: { kind: 'screen', screenId: c.id } };
    const g = analyzeScreenGraph(doc);
    expect([...g.unreachable].sort()).toEqual([b.id, e.id].sort());
    expect([...g.inLoop].sort()).toEqual([c.id, d.id].sort());
    expect(g.endlessLoops).toHaveLength(1);
    const issues = validateDocument(doc).map((i) => i.code);
    expect(issues).toContain('ENDLESS_LOOP');
    expect(issues).toContain('UNREACHABLE_SCREEN');
  });

  it('L-02 · раскладка: колонки по числу шагов от первого экрана, недостижимые — в последней колонке', () => {
    const l = layoutGraph(['a', 'b', 'c', 'd'], [['a', 'b'], ['b', 'c']], 'a');
    expect([...l.nodes].map(([id, n]) => `${id}:${n.col}`)).toEqual(['a:0', 'b:1', 'c:2', 'd:3']);
    const same = layoutGraph(['a', 'b', 'c'], [['a', 'b'], ['a', 'c']], 'a');
    expect(same.nodes.get('b')!.col).toBe(same.nodes.get('c')!.col);
    expect(same.nodes.get('b')!.y).not.toBe(same.nodes.get('c')!.y);
  });
});
