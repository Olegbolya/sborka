import { describe, expect, it } from 'vitest';
import { createBlock, createDocument } from '@blokum/schema';
import { addScreen, deleteScreen, duplicateBlocks, duplicateScreen, moveScreen, patchBlocks, removeBlocks, renameScreen, setFrame, setScreenHeight, setTitle } from '../lib/editor/commands';
import { HISTORY_LIMIT, MERGE_WINDOW_MS, createEditorStore, selectedBlocks } from '../lib/editor/store';
import { cloneWithNewIds, drawOrder, findBlock, absoluteOrigin } from '../lib/editor/tree';

const fresh = () => {
  const doc = createDocument({ title: 'Тест' });
  return createEditorStore(doc);
};
const addText = (s: ReturnType<typeof fresh>, name = 'Текст') => {
  const block = createBlock('text', { name });
  s.getState().apply((d) => void d.screens[0]!.blocks.push(block), { label: 'Добавить блок' });
  return block;
};

describe('E-11 · история изменений', () => {
  it('E-11 · отмена и повтор возвращают документ точно', () => {
    const s = fresh();
    const before = s.getState().doc;
    const b = addText(s);
    expect(s.getState().doc.screens[0]!.blocks).toHaveLength(1);
    expect(s.getState().undo()).toBe(true);
    expect(s.getState().doc).toEqual(before);
    expect(s.getState().redo()).toBe(true);
    expect(s.getState().doc.screens[0]!.blocks[0]!.id).toBe(b.id);
  });

  it('E-11 · не меньше 100 шагов отмены: 150 правок откатываются до исходного документа', () => {
    const s = fresh();
    const b = addText(s);
    const original = structuredClone(s.getState().doc);
    for (let i = 1; i <= 150; i++) s.getState().apply(setFrame([b.id], { x: i }), { label: 'Сдвиг' });
    expect(s.getState().past.length).toBeGreaterThanOrEqual(100);
    let undone = 0;
    while (s.getState().undo()) undone++;
    expect(undone).toBe(151 > HISTORY_LIMIT ? HISTORY_LIMIT : 151);
    // 150 moves + the add are all inside the limit: back to the empty document.
    expect(s.getState().doc.screens[0]!.blocks).toHaveLength(0);
    expect(original.screens[0]!.blocks).toHaveLength(1);
  });

  it('E-11 · ровно 100 шагов подряд откатываются и повторяются без потерь', () => {
    const s = fresh();
    const b = addText(s);
    const start = s.getState().doc;
    for (let i = 1; i <= 100; i++) s.getState().apply(setFrame([b.id], { x: i, y: i * 2 }), { label: 'Сдвиг' });
    const end = s.getState().doc;
    for (let i = 0; i < 100; i++) expect(s.getState().undo()).toBe(true);
    expect(s.getState().doc).toEqual(start);
    for (let i = 0; i < 100; i++) expect(s.getState().redo()).toBe(true);
    expect(s.getState().doc).toEqual(end);
  });

  it('E-11 · история ограничена HISTORY_LIMIT, самые старые шаги забываются', () => {
    const s = fresh();
    const b = addText(s);
    for (let i = 1; i <= HISTORY_LIMIT + 20; i++) s.getState().apply(setFrame([b.id], { x: i }), { label: 'Сдвиг' });
    expect(s.getState().past).toHaveLength(HISTORY_LIMIT);
  });

  it('E-11 · перетаскивание (жест) — один шаг отмены, сколько бы ни было промежуточных движений', () => {
    const s = fresh();
    const b = addText(s);
    const stepsBefore = s.getState().past.length;
    const startFrame = { ...s.getState().doc.screens[0]!.blocks[0]!.frame };
    s.getState().beginGesture('Перетащить');
    for (let i = 1; i <= 60; i++) s.getState().apply(setFrame([b.id], { x: startFrame.x + i, y: startFrame.y + i }), { label: 'x' });
    expect(s.getState().canUndo()).toBe(false); // mid-gesture the history does not move
    s.getState().endGesture();
    expect(s.getState().past).toHaveLength(stepsBefore + 1);
    expect(s.getState().doc.screens[0]!.blocks[0]!.frame.x).toBe(startFrame.x + 60);
    s.getState().undo();
    expect(s.getState().doc.screens[0]!.blocks[0]!.frame).toEqual(startFrame);
    s.getState().redo();
    expect(s.getState().doc.screens[0]!.blocks[0]!.frame.y).toBe(startFrame.y + 60);
  });

  it('E-11 · жест без изменений не оставляет шага; повторный beginGesture не сбрасывает жест', () => {
    const s = fresh();
    s.getState().beginGesture('Пусто');
    s.getState().beginGesture('Ещё');
    s.getState().endGesture();
    s.getState().endGesture();
    expect(s.getState().past).toHaveLength(0);
  });

  it('E-11 · быстрые правки с одним ключом (ввод в поле) сливаются, медленные — нет', () => {
    const s = fresh();
    const t0 = 1_000_000;
    for (let i = 0; i < 5; i++) s.getState().apply(setTitle(`Имя ${i}`), { label: 'Название', mergeKey: 'title', now: t0 + i * 100 });
    expect(s.getState().past).toHaveLength(1);
    s.getState().apply(setTitle('Позже'), { label: 'Название', mergeKey: 'title', now: t0 + 400 + MERGE_WINDOW_MS + 1 });
    expect(s.getState().past).toHaveLength(2);
    s.getState().apply(setTitle('Другое'), { label: 'Название', mergeKey: 'other', now: t0 + 400 + MERGE_WINDOW_MS + 2 });
    expect(s.getState().past).toHaveLength(3);
    s.getState().undo();
    expect(s.getState().doc.meta.title).toBe('Позже');
    s.getState().undo();
    expect(s.getState().doc.meta.title).toBe('Имя 4');
    s.getState().undo();
    expect(s.getState().doc.meta.title).toBe('Тест');
  });

  it('E-11 · новая правка после отмены стирает «повтор»; пустая правка шага не создаёт', () => {
    const s = fresh();
    addText(s);
    s.getState().undo();
    expect(s.getState().canRedo()).toBe(true);
    expect(s.getState().apply(() => undefined, { label: 'Ничего' })).toBe(false);
    expect(s.getState().canRedo()).toBe(true);
    addText(s, 'Другой');
    expect(s.getState().canRedo()).toBe(false);
    expect(s.getState().redo()).toBe(false);
  });

  it('E-11 · отмена и повтор невозможны без истории', () => {
    const s = fresh();
    expect(s.getState().undo()).toBe(false);
    expect(s.getState().redo()).toBe(false);
  });

  it('E-11 · replaceDocument заменяет документ и забывает историю', () => {
    const s = fresh();
    addText(s);
    const other = createDocument({ title: 'Другая' });
    s.getState().replaceDocument(other);
    expect(s.getState().doc.meta.title).toBe('Другая');
    expect(s.getState().canUndo()).toBe(false);
    expect(s.getState().selection.screenId).toBe(other.screens[0]!.id);
  });

  it('E-11 · docVersion растёт при правке, отмене и повторе (автосохранение следит за ним)', () => {
    const s = fresh();
    const v0 = s.getState().docVersion;
    addText(s);
    s.getState().undo();
    s.getState().redo();
    expect(s.getState().docVersion).toBe(v0 + 3);
  });
});

describe('E-13 · команды экранов и блоков', () => {
  it('E-13 · добавить, переименовать, переместить, удалить экран; последний не удаляется', () => {
    const s = fresh();
    const first = s.getState().doc.screens[0]!.id;
    let created = '';
    s.getState().apply(addScreen(first, (x) => (created = x.id)), { label: 'Экран' });
    expect(s.getState().doc.screens.map((x) => x.id)).toEqual([first, created]);
    s.getState().apply(renameScreen(created, '  Итог  '), { label: 'Имя' });
    expect(s.getState().doc.screens[1]!.name).toBe('Итог');
    s.getState().apply(renameScreen(created, '   '), { label: 'Имя' });
    expect(s.getState().doc.screens[1]!.name).toBe('Итог');
    s.getState().apply(moveScreen(created, 0), { label: 'Порядок' });
    expect(s.getState().doc.screens[0]!.id).toBe(created);
    s.getState().apply(deleteScreen(created), { label: 'Удалить' });
    expect(s.getState().doc.screens.map((x) => x.id)).toEqual([first]);
    expect(s.getState().apply(deleteScreen(first), { label: 'Удалить' })).toBe(false);
    expect(s.getState().doc.screens).toHaveLength(1);
  });

  it('E-13 · лимит экранов (50) соблюдается', () => {
    const s = fresh();
    for (let i = 0; i < 60; i++) s.getState().apply(addScreen(null), { label: 'Экран' });
    expect(s.getState().doc.screens).toHaveLength(50);
    expect(s.getState().apply(duplicateScreen(s.getState().doc.screens[0]!.id), { label: 'Копия' })).toBe(false);
  });

  it('E-13 · копия экрана: новые идентификаторы, правила копии ссылаются на блоки копии', () => {
    const s = fresh();
    const button = createBlock('button');
    s.getState().apply((d) => void d.screens[0]!.blocks.push(button), { label: 'Кнопка' });
    const rule = s.getState().doc.screens[0]!.blocks[0]!.rules[0]!;
    expect(JSON.stringify(rule)).toContain(button.id);
    let copyId = '';
    s.getState().apply(duplicateScreen(s.getState().doc.screens[0]!.id, (c) => (copyId = c.id)), { label: 'Копия' });
    const copy = s.getState().doc.screens[1]!;
    expect(copy.id).toBe(copyId);
    expect(copy.name).toMatch(/\(копия\)$/);
    const copied = copy.blocks[0]!;
    expect(copied.id).not.toBe(button.id);
    expect(JSON.stringify(copied.rules)).toContain(copied.id);
    expect(JSON.stringify(copied.rules)).not.toContain(button.id);
    // The original is untouched.
    expect(JSON.stringify(s.getState().doc.screens[0]!.blocks[0]!.rules)).toContain(button.id);
  });

  it('E-13 · высота экрана ограничена 400…5000', () => {
    const s = fresh();
    const id = s.getState().doc.screens[0]!.id;
    s.getState().apply(setScreenHeight(id, 100), { label: 'Высота' });
    expect(s.getState().doc.screens[0]!.height).toBe(400);
    s.getState().apply(setScreenHeight(id, 99999), { label: 'Высота' });
    expect(s.getState().doc.screens[0]!.height).toBe(5000);
    expect(s.getState().apply(setScreenHeight(id, Number.NaN), { label: 'Высота' })).toBe(false);
  });

  it('E-13 · удаление блока с вложенными; удаление экрана убирает выделение', () => {
    const s = fresh();
    const choice = createBlock('singleChoice');
    s.getState().apply((d) => void d.screens[0]!.blocks.push(choice), { label: 'Вопрос' });
    const child = choice.children[0]!.id;
    s.getState().select(s.getState().doc.screens[0]!.id, [child]);
    expect(selectedBlocks(s.getState()).map((b) => b.id)).toEqual([child]);
    s.getState().apply(removeBlocks([child]), { label: 'Удалить' });
    expect(findBlock(s.getState().doc, child)).toBeNull();
    expect(s.getState().selection.blockIds).toEqual([]);
    s.getState().undo();
    expect(findBlock(s.getState().doc, child)).not.toBeNull();
  });

  it('E-13 · копия блока: на 12 единиц ниже и правее, сверху, с новыми идентификаторами', () => {
    const s = fresh();
    const b = addText(s);
    let created: string[] = [];
    s.getState().apply(duplicateBlocks([b.id, 'нет-такого'], (ids) => (created = ids)), { label: 'Копия' });
    expect(created).toHaveLength(1);
    const copy = findBlock(s.getState().doc, created[0]!)!.siblings[1]!;
    expect(copy.frame.x).toBe(b.frame.x + 12);
    expect(copy.frame.y).toBe(b.frame.y + 12);
    expect(copy.id).not.toBe(b.id);
    expect(copy.z).toBeGreaterThan(b.z);
  });

  it('E-15 · patchBlocks и setFrame меняют несколько блоков за один шаг; мусор в числах игнорируется', () => {
    const s = fresh();
    const a = addText(s, 'A');
    const b = addText(s, 'B');
    const steps = s.getState().past.length;
    s.getState().apply(setFrame([a.id, b.id], { x: 10.04, w: Number.NaN, h: 55.55 }), { label: 'Рамка' });
    expect(s.getState().past).toHaveLength(steps + 1);
    for (const id of [a.id, b.id]) {
      const f = findBlock(s.getState().doc, id)!.siblings.find((x) => x.id === id)!.frame;
      expect(f.x).toBe(10);
      expect(f.h).toBe(55.6);
      expect(f.w).toBe(createBlock('text').frame.w);
    }
    s.getState().apply(patchBlocks([a.id, 'нет'], (x) => void (x.name = 'Новое')), { label: 'Имя' });
    expect(findBlock(s.getState().doc, a.id)!.siblings.find((x) => x.id === a.id)!.name).toBe('Новое');
  });

  it('E-13 · select отбрасывает несуществующие блоки и блоки чужого экрана', () => {
    const s = fresh();
    const b = addText(s);
    let second = '';
    s.getState().apply(addScreen(null, (x) => (second = x.id)), { label: 'Экран' });
    s.getState().select(second, [b.id]);
    expect(s.getState().selection).toEqual({ screenId: second, blockIds: [] });
    s.getState().select('нет-экрана', ['нет']);
    expect(s.getState().selection.screenId).toBe(s.getState().doc.screens[0]!.id);
    s.getState().selectScreen(second);
    expect(s.getState().selection.screenId).toBe(second);
  });
});

describe('E-13 · дерево блоков', () => {
  it('абсолютное положение вложенного блока — сумма рамок контейнеров; порядок отрисовки по z', () => {
    const doc = createDocument();
    const container = createBlock('container', { frame: { x: 10, y: 20, w: 300, h: 300 } });
    const inner = createBlock('text', { frame: { x: 5, y: 7, w: 50, h: 20 } });
    container.children.push(inner);
    const low = createBlock('text', { z: 0 });
    const high = createBlock('text', { z: 5 });
    doc.screens[0]!.blocks.push(high, container, low);
    expect(absoluteOrigin(doc, inner.id)).toEqual({ x: 15, y: 27 });
    expect(absoluteOrigin(doc, 'нет')).toBeNull();
    expect(drawOrder(doc.screens[0]!.blocks).map((b) => b.id)).toEqual([container.id, inner.id, low.id, high.id]);
  });

  it('cloneWithNewIds не оставляет ни одного старого идентификатора', () => {
    const choice = createBlock('singleChoice');
    const copy = cloneWithNewIds(choice);
    const old = JSON.stringify(choice).match(/"id":"([^"]+)"/g)!.map((m) => m.slice(6, -1));
    const text = JSON.stringify(copy);
    for (const id of old) expect(text).not.toContain(id);
    expect(copy.props).toHaveProperty('options');
    // options still point at the copied children
    const optionBlockIds = (copy.props as { options: Array<{ blockId: string }> }).options.map((o) => o.blockId);
    expect(optionBlockIds).toEqual(copy.children.map((c) => c.id));
  });
});
