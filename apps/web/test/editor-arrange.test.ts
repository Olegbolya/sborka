// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import { createBlock, createDocument, type ProjectDocument } from '@blokum/schema';
import { addScreen, duplicateBlocks, moveBlocksBy, flipBlocks, setFrames } from '../lib/editor/commands';
import { alignBlocks, distributeBlocks, groupBlocks, orderBlocks, selectionIsGroup, ungroupBlocks, withGroupMates } from '../lib/editor/arrange';
import { copyBlocks, pasteBlocks, readClipboard, writeClipboard } from '../lib/editor/clipboard';
import { createEditorStore } from '../lib/editor/store';
import { findBlock, stackOf } from '../lib/editor/tree';

const at = (name: string, x: number, y: number, w = 50, h = 50) => createBlock('shape', { name, frame: { x, y, w, h } });
const make = (...blocks: ReturnType<typeof at>[]) => {
  const doc = createDocument();
  doc.screens[0]!.blocks.push(...blocks);
  return createEditorStore(doc);
};
const frameOf = (s: ReturnType<typeof make>, id: string) => findBlock(s.getState().doc, id)!.siblings.find((b) => b.id === id)!.frame;
const names = (doc: ProjectDocument) => stackOf(doc.screens[0]!.blocks).map((b) => b.name);

describe('E-09 · выравнивание и распределение', () => {
  it('E-09 · несколько блоков выравниваются по краю выделения', () => {
    const [a, b, c] = [at('A', 10, 10), at('B', 100, 50, 80, 20), at('C', 40, 200, 30, 30)];
    const s = make(a, b, c);
    const ids = [a.id, b.id, c.id];
    s.getState().apply(alignBlocks(ids, 'left'), { label: 'x' });
    expect([a, b, c].map((x) => frameOf(s, x.id).x)).toEqual([10, 10, 10]);
    s.getState().apply(alignBlocks(ids, 'right'), { label: 'x' });
    expect([a, b, c].map((x) => frameOf(s, x.id).x + frameOf(s, x.id).w)).toEqual([90, 90, 90]);
    s.getState().apply(alignBlocks(ids, 'center'), { label: 'x' });
    const centers = [a, b, c].map((x) => frameOf(s, x.id).x + frameOf(s, x.id).w / 2);
    expect(new Set(centers).size).toBe(1);
    s.getState().apply(alignBlocks(ids, 'top'), { label: 'x' });
    expect([a, b, c].map((x) => frameOf(s, x.id).y)).toEqual([10, 10, 10]);
    s.getState().apply(alignBlocks(ids, 'bottom'), { label: 'x' });
    expect([a, b, c].map((x) => frameOf(s, x.id).y + frameOf(s, x.id).h)).toEqual([60, 60, 60]); // the lowest edge of the selection
    s.getState().apply(alignBlocks(ids, 'middle'), { label: 'x' });
    expect(new Set([a, b, c].map((x) => frameOf(s, x.id).y + frameOf(s, x.id).h / 2)).size).toBe(1);
  });

  it('E-09 · один блок выравнивается по артборду', () => {
    const a = at('A', 10, 10, 100, 100);
    const s = make(a);
    s.getState().apply(alignBlocks([a.id], 'center'), { label: 'x' });
    expect(frameOf(s, a.id).x).toBe(145);
    s.getState().apply(alignBlocks([a.id], 'right'), { label: 'x' });
    expect(frameOf(s, a.id).x).toBe(290);
    s.getState().apply(alignBlocks([a.id], 'middle'), { label: 'x' });
    expect(frameOf(s, a.id).y).toBe(372);
    s.getState().apply(alignBlocks([a.id], 'bottom'), { label: 'x' });
    expect(frameOf(s, a.id).y).toBe(744);
  });

  it('E-09 · блок внутри контейнера выравнивается по контейнеру, повёрнутый — по занимаемому месту', () => {
    const container = createBlock('container', { frame: { x: 50, y: 50, w: 200, h: 200 } });
    const inner = at('Внутри', 5, 5, 40, 40);
    container.children.push(inner);
    const doc = createDocument();
    doc.screens[0]!.blocks.push(container);
    const s = createEditorStore(doc);
    s.getState().apply(alignBlocks([inner.id], 'right'), { label: 'x' });
    expect(findBlock(s.getState().doc, inner.id)!.siblings[0]!.frame.x).toBe(160);
    const turned = at('Повёрнутый', 0, 0, 100, 20);
    turned.frame.rotation = 90;
    const s2 = make(turned);
    s2.getState().apply(alignBlocks([turned.id], 'left'), { label: 'x' });
    expect(frameOf(s2, turned.id).x).toBe(-40); // turned by 90° it takes x from 40 to 60: to reach the edge its frame goes left of it
  });

  it('E-09 · блоки из разных уровней не выравниваются', () => {
    const container = createBlock('container');
    const inner = at('Внутри', 5, 5);
    container.children.push(inner);
    const outer = at('Снаружи', 300, 300);
    const doc = createDocument();
    doc.screens[0]!.blocks.push(container, outer);
    const s = createEditorStore(doc);
    expect(s.getState().apply(alignBlocks([inner.id, outer.id], 'left'), { label: 'x' })).toBe(false);
    expect(s.getState().apply(alignBlocks(['нет'], 'left'), { label: 'x' })).toBe(false);
  });

  it('E-09 · распределение: равные промежутки, крайние на месте; меньше трёх — ничего', () => {
    const [a, b, c, d] = [at('A', 0, 0, 20, 20), at('B', 30, 90, 20, 40), at('C', 200, 40, 20, 20), at('D', 380 - 20, 10, 20, 20)];
    const s = make(a, b, c, d);
    expect(s.getState().apply(distributeBlocks([a.id, b.id], 'horizontal'), { label: 'x' })).toBe(false);
    s.getState().apply(distributeBlocks([a.id, b.id, c.id, d.id], 'horizontal'), { label: 'x' });
    const xs = [a, b, c, d].map((x) => frameOf(s, x.id).x);
    expect(xs[0]).toBe(0);
    expect(xs[3]).toBe(360);
    const gaps = [xs[1]! - 20 - xs[0]!, xs[2]! - 20 - xs[1]!, xs[3]! - 20 - xs[2]!];
    expect(Math.max(...gaps) - Math.min(...gaps)).toBeLessThan(0.3);
    s.getState().apply(distributeBlocks([a.id, b.id, c.id, d.id], 'vertical'), { label: 'x' });
    const ys = [a, b, c, d].sort((p, q) => frameOf(s, p.id).y - frameOf(s, q.id).y).map((x) => frameOf(s, x.id));
    const vg = ys.slice(1).map((f, i) => f.y - (ys[i]!.y + ys[i]!.h));
    expect(Math.max(...vg) - Math.min(...vg)).toBeLessThan(0.3);
  });
});

describe('E-09 · порядок слоёв', () => {
  let s: ReturnType<typeof make>;
  let ids: string[];
  beforeEach(() => {
    const blocks = ['A', 'B', 'C', 'D'].map((n) => at(n, 0, 0));
    s = make(...blocks);
    ids = blocks.map((b) => b.id);
  });
  const order = (mode: Parameters<typeof orderBlocks>[1], ...pick: number[]) => {
    s.getState().apply(orderBlocks(pick.map((i) => ids[i]!), mode), { label: 'x' });
    return names(s.getState().doc).join('');
  };

  it('E-09 · на передний план, на задний', () => {
    expect(order('front', 0)).toBe('BCDA');
    expect(order('back', 3)).toBe('DBCA');
  });
  it('E-09 · на один шаг вперёд и назад', () => {
    expect(order('forward', 0)).toBe('BACD');
    expect(order('backward', 3)).toBe('BADC');
    expect(order('forward', 2)).toBe('BADC'); // C is already on top
    expect(order('backward', 1)).toBe('BADC'); // already at the bottom
  });
  it('E-09 · несколько блоков сохраняют взаимный порядок', () => {
    expect(order('front', 0, 1)).toBe('CDAB');
    expect(order('forward', 2)).toBe('DCAB');
  });
  it('E-09 · z переписываются подряд 0…n−1, повтор не меняет документ', () => {
    order('front', 1);
    const zs = s.getState().doc.screens[0]!.blocks.map((b) => b.z).sort();
    expect(zs).toEqual([0, 1, 2, 3]);
    expect(s.getState().apply(orderBlocks([ids[1]!], 'front'), { label: 'x' })).toBe(false);
  });
  it('E-09 · блоки разных уровней не переставляются', () => {
    expect(s.getState().apply(orderBlocks([], 'front'), { label: 'x' })).toBe(false);
  });
});

describe('E-09 · группы', () => {
  it('E-09 · группировка, выбор всей группы, разгруппировка', () => {
    const [a, b, c] = [at('A', 0, 0), at('B', 60, 0), at('C', 120, 0)];
    const s = make(a, b, c);
    let gid = '';
    s.getState().apply(groupBlocks([a.id, b.id], (g) => (gid = g)), { label: 'x' });
    expect(gid).not.toBe('');
    expect(withGroupMates(s.getState().doc, [a.id]).sort()).toEqual([a.id, b.id].sort());
    expect(withGroupMates(s.getState().doc, [c.id])).toEqual([c.id]);
    expect(selectionIsGroup(s.getState().doc, [a.id, b.id])).toBe(true);
    expect(selectionIsGroup(s.getState().doc, [a.id, c.id])).toBe(false);
    expect(selectionIsGroup(s.getState().doc, [a.id])).toBe(false);
    s.getState().apply(ungroupBlocks([a.id]), { label: 'x' });
    expect(withGroupMates(s.getState().doc, [a.id])).toEqual([a.id]);
    expect(s.getState().apply(groupBlocks([a.id], () => undefined), { label: 'x' })).toBe(false); // one block is not a group
  });

  it('E-09 · копия группы остаётся группой, но уже своей', () => {
    const [a, b] = [at('A', 0, 0), at('B', 60, 0)];
    const s = make(a, b);
    s.getState().apply(groupBlocks([a.id, b.id]), { label: 'x' });
    let created: string[] = [];
    s.getState().apply(duplicateBlocks([a.id, b.id], (ids) => (created = ids)), { label: 'x' });
    const [ca, cb] = created.map((id) => findBlock(s.getState().doc, id)!.siblings.find((x) => x.id === id)!);
    expect(ca!.groupId).toBeDefined();
    expect(ca!.groupId).toBe(cb!.groupId);
    expect(ca!.groupId).not.toBe(a.groupId);
  });
});

describe('E-05/E-07 · задание рамок и сдвиг', () => {
  it('E-05 · setFrames ставит рамку целиком и безопасен при повторе', () => {
    const a = at('A', 10, 10);
    const s = make(a);
    const target = new Map([[a.id, { x: 33, y: 44, w: 55, h: 66, rotation: 12 }]]);
    expect(s.getState().apply(setFrames(target), { label: 'x' })).toBe(true);
    expect(frameOf(s, a.id)).toMatchObject({ x: 33, y: 44, w: 55, h: 66, rotation: 12 });
    expect(s.getState().apply(setFrames(target), { label: 'x' })).toBe(false);
    expect(s.getState().apply(setFrames(new Map([['нет', { x: 1, y: 1, w: 1, h: 1, rotation: 0 }]])), { label: 'x' })).toBe(false);
  });
  it('E-07 · сдвиг стрелками и отражение', () => {
    const a = at('A', 10, 10);
    const s = make(a);
    s.getState().apply(moveBlocksBy([a.id], 1, -1), { label: 'x' });
    s.getState().apply(moveBlocksBy([a.id], 10, 10), { label: 'x' });
    expect(frameOf(s, a.id)).toMatchObject({ x: 21, y: 19 });
    s.getState().apply(flipBlocks([a.id], 'x'), { label: 'x' });
    s.getState().apply(flipBlocks([a.id], 'y'), { label: 'x' });
    expect(frameOf(s, a.id)).toMatchObject({ flipX: true, flipY: true });
    s.getState().apply(flipBlocks([a.id], 'x'), { label: 'x' });
    expect(frameOf(s, a.id).flipX).toBe(false);
  });
});

describe('E-08 · буфер обмена', () => {
  it('E-08 · копия с правилами вставляется на другой экран с новыми идентификаторами', () => {
    const button = createBlock('button', { name: 'Кнопка', frame: { x: 50, y: 60, w: 200, h: 56 } });
    const s = make(button);
    let second = '';
    s.getState().apply(addScreen(null, (x) => (second = x.id)), { label: 'x' });
    const payload = copyBlocks(s.getState().doc, [button.id])!;
    expect(payload.blocks).toHaveLength(1);
    let created: string[] = [];
    s.getState().apply(pasteBlocks(payload, second, 12, (ids) => (created = ids)), { label: 'x' });
    const pasted = s.getState().doc.screens[1]!.blocks[0]!;
    expect(pasted.id).toBe(created[0]);
    expect(pasted.id).not.toBe(button.id);
    expect(pasted.frame).toMatchObject({ x: 50, y: 60 }); // the same place on another screen
    expect(pasted.rules).toHaveLength(1);
    expect(JSON.stringify(pasted.rules)).toContain(pasted.id);
    expect(JSON.stringify(pasted.rules)).not.toContain(button.id);
  });

  it('E-08 · на тот же экран блок встаёт со сдвигом, повторная вставка — ещё дальше', () => {
    const a = at('A', 50, 60);
    const s = make(a);
    const payload = copyBlocks(s.getState().doc, [a.id])!;
    const screenId = s.getState().doc.screens[0]!.id;
    s.getState().apply(pasteBlocks(payload, screenId, 12), { label: 'x' });
    s.getState().apply(pasteBlocks(payload, screenId, 12), { label: 'x' });
    expect(s.getState().doc.screens[0]!.blocks.map((b) => [b.frame.x, b.frame.y])).toEqual([[50, 60], [62, 72], [74, 84]]);
    expect(stackOf(s.getState().doc.screens[0]!.blocks).at(-1)!.frame.x).toBe(74);
  });

  it('E-08 · вложенный блок копируется с места на артборде; контейнер — вместе с содержимым, без повторов', () => {
    const container = createBlock('container', { frame: { x: 100, y: 100, w: 200, h: 200 } });
    const inner = at('Внутри', 10, 20);
    container.children.push(inner);
    const s = make(container);
    const alone = copyBlocks(s.getState().doc, [inner.id])!;
    expect(alone.blocks[0]!.frame).toMatchObject({ x: 110, y: 120 });
    const both = copyBlocks(s.getState().doc, [container.id, inner.id])!;
    expect(both.blocks).toHaveLength(1);
    expect(both.blocks[0]!.children).toHaveLength(1);
    expect(copyBlocks(s.getState().doc, ['нет'])).toBeNull();
  });

  it('E-08 · буфер переживает «другую сборку»: пишется в хранилище браузера и читается заново', () => {
    const a = at('A', 5, 5);
    const s = make(a);
    writeClipboard(copyBlocks(s.getState().doc, [a.id])!);
    const read = readClipboard();
    expect(read?.blocks[0]?.name).toBe('A');
    const other = createEditorStore(createDocument());
    other.getState().apply(pasteBlocks(read!, other.getState().doc.screens[0]!.id, 12), { label: 'x' });
    expect(other.getState().doc.screens[0]!.blocks[0]!.name).toBe('A');
  });

  it('E-08 · испорченный или чужой буфер не принимается', () => {
    localStorage.setItem('blokum.clipboard', '{не json');
    expect(readClipboard()).toBeNull();
    localStorage.setItem('blokum.clipboard', JSON.stringify({ kind: 'другое' }));
    expect(readClipboard()).toBeNull();
    localStorage.setItem('blokum.clipboard', JSON.stringify({ kind: 'blokum-blocks', version: 1, blocks: [] }));
    expect(readClipboard()).toBeNull();
    localStorage.removeItem('blokum.clipboard');
  });

  it('E-08 · лимит 100 блоков на экране соблюдается при вставке', () => {
    const many = Array.from({ length: 99 }, (_, i) => at(`B${i}`, i, i));
    const s = make(...many);
    const payload = copyBlocks(s.getState().doc, many.slice(0, 5).map((b) => b.id))!;
    s.getState().apply(pasteBlocks(payload, s.getState().doc.screens[0]!.id, 12), { label: 'x' });
    expect(s.getState().doc.screens[0]!.blocks).toHaveLength(100);
    expect(s.getState().apply(pasteBlocks(payload, s.getState().doc.screens[0]!.id, 12), { label: 'x' })).toBe(false);
    expect(s.getState().apply(pasteBlocks(payload, 'нет-экрана', 12), { label: 'x' })).toBe(false);
  });
});
