import { type Block, type ProjectDocument, createId } from '@blokum/schema';
import { type Recipe } from './commands';
import { boundsOf } from './geometry';
import { findBlock, stackOf } from './tree';

export type AlignMode = 'left' | 'center' | 'right' | 'top' | 'middle' | 'bottom';
export type DistributeAxis = 'horizontal' | 'vertical';
export type OrderMode = 'front' | 'forward' | 'backward' | 'back';

const ARTBOARD_W = 390;

/** The ids of a selection plus everything grouped with them (E-09): picking one member of a group picks the group. */
export function withGroupMates(doc: ProjectDocument, ids: readonly string[]): string[] {
  const out = new Set(ids);
  for (const id of ids) {
    const loc = findBlock(doc, id);
    const gid = loc?.siblings[loc.index]!.groupId;
    if (!loc || !gid) continue;
    for (const sib of loc.siblings) if (sib.groupId === gid) out.add(sib.id);
  }
  return [...out];
}

interface Located {
  block: Block;
  siblings: Block[];
  /** Size of what the block sits in: the artboard or its container. */
  room: { w: number; h: number };
}

/** Blocks of a selection that share one parent (what align and distribute work on); empty when they do not. */
function sameParent(doc: ProjectDocument, ids: readonly string[]): Located[] {
  const found = ids.map((id) => findBlock(doc, id)).filter((l): l is NonNullable<typeof l> => l !== null);
  if (found.length === 0 || found.some((l) => l.siblings !== found[0]!.siblings)) return [];
  const room = found[0]!.parent ? { w: found[0]!.parent.frame.w, h: found[0]!.parent.frame.h } : { w: ARTBOARD_W, h: found[0]!.screen.height };
  return found.map((l) => ({ block: l.siblings[l.index]!, siblings: l.siblings, room }));
}

/**
 * E-09 · align to the edge or centre of the selection (several blocks) or of the screen / container (one block).
 */
export const alignBlocks =
  (ids: readonly string[], mode: AlignMode): Recipe =>
  (doc) => {
    const items = sameParent(doc, ids);
    if (items.length === 0) return;
    const boxes = items.map((i) => boundsOf(i.block.frame));
    const area =
      items.length === 1
        ? { x: 0, y: 0, w: items[0]!.room.w, h: items[0]!.room.h }
        : { x: Math.min(...boxes.map((b) => b.x)), y: Math.min(...boxes.map((b) => b.y)), w: 0, h: 0 };
    if (items.length > 1) {
      area.w = Math.max(...boxes.map((b) => b.x + b.w)) - area.x;
      area.h = Math.max(...boxes.map((b) => b.y + b.h)) - area.y;
    }
    items.forEach((item, i) => {
      const box = boxes[i]!;
      const f = item.block.frame;
      if (mode === 'left') f.x += area.x - box.x;
      if (mode === 'center') f.x += area.x + area.w / 2 - (box.x + box.w / 2);
      if (mode === 'right') f.x += area.x + area.w - (box.x + box.w);
      if (mode === 'top') f.y += area.y - box.y;
      if (mode === 'middle') f.y += area.y + area.h / 2 - (box.y + box.h / 2);
      if (mode === 'bottom') f.y += area.y + area.h - (box.y + box.h);
      f.x = Math.round(f.x * 10) / 10;
      f.y = Math.round(f.y * 10) / 10;
    });
  };

/** E-09 · equal gaps between three or more blocks; the outer ones stay. */
export const distributeBlocks =
  (ids: readonly string[], axis: DistributeAxis): Recipe =>
  (doc) => {
    const items = sameParent(doc, ids);
    if (items.length < 3) return;
    const horizontal = axis === 'horizontal';
    const entries = items.map((i) => ({ block: i.block, box: boundsOf(i.block.frame) })).sort((a, b) => (horizontal ? a.box.x - b.box.x : a.box.y - b.box.y));
    const size = (e: (typeof entries)[number]) => (horizontal ? e.box.w : e.box.h);
    const start = horizontal ? entries[0]!.box.x : entries[0]!.box.y;
    const last = entries[entries.length - 1]!;
    const end = (horizontal ? last.box.x : last.box.y) + size(last);
    const gap = (end - start - entries.reduce((n, e) => n + size(e), 0)) / (entries.length - 1);
    let cursor = start;
    for (const e of entries) {
      const at = horizontal ? e.box.x : e.box.y;
      const shift = Math.round((cursor - at) * 10) / 10;
      if (horizontal) e.block.frame.x = Math.round((e.block.frame.x + shift) * 10) / 10;
      else e.block.frame.y = Math.round((e.block.frame.y + shift) * 10) / 10;
      cursor += size(e) + gap;
    }
  };

/** E-09 · layer order among the blocks of one level: to the front, one step up, one step down, to the back. */
export const orderBlocks =
  (ids: readonly string[], mode: OrderMode): Recipe =>
  (doc) => {
    const items = sameParent(doc, ids);
    if (items.length === 0) return;
    const siblings = items[0]!.siblings;
    const chosen = new Set(items.map((i) => i.block.id));
    const stack = stackOf(siblings);
    let next = stack.slice();
    if (mode === 'front') next = [...stack.filter((b) => !chosen.has(b.id)), ...stack.filter((b) => chosen.has(b.id))];
    if (mode === 'back') next = [...stack.filter((b) => chosen.has(b.id)), ...stack.filter((b) => !chosen.has(b.id))];
    if (mode === 'forward') {
      for (let i = next.length - 2; i >= 0; i--) {
        if (chosen.has(next[i]!.id) && !chosen.has(next[i + 1]!.id)) [next[i], next[i + 1]] = [next[i + 1]!, next[i]!];
      }
    }
    if (mode === 'backward') {
      for (let i = 1; i < next.length; i++) {
        if (chosen.has(next[i]!.id) && !chosen.has(next[i - 1]!.id)) [next[i], next[i - 1]] = [next[i - 1]!, next[i]!];
      }
    }
    next.forEach((b, z) => {
      if (b.z !== z) b.z = z;
    });
  };

/** E-09 · blocks of one level become a group: they are picked, moved and copied together. */
export const groupBlocks =
  (ids: readonly string[], onCreated?: (groupId: string) => void): Recipe =>
  (doc) => {
    const items = sameParent(doc, ids);
    if (items.length < 2) return;
    const groupId = createId();
    for (const i of items) i.block.groupId = groupId;
    onCreated?.(groupId);
  };

export const ungroupBlocks =
  (ids: readonly string[]): Recipe =>
  (doc) => {
    for (const id of withGroupMates(doc, ids)) {
      const loc = findBlock(doc, id);
      if (loc) delete loc.siblings[loc.index]!.groupId;
    }
  };

/** Is the whole selection one group (so «разгруппировать» makes sense)? */
export function selectionIsGroup(doc: ProjectDocument, ids: readonly string[]): boolean {
  const blocks = ids.map((id) => findBlock(doc, id)).filter((l): l is NonNullable<typeof l> => l !== null).map((l) => l.siblings[l.index]!);
  return blocks.length > 1 && blocks.every((b) => b.groupId !== undefined && b.groupId === blocks[0]!.groupId);
}
