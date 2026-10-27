import { type Block, type ProjectDocument, type Screen, createId } from '@blokum/schema';

export interface BlockLocation {
  screen: Screen;
  /** The array the block sits in: the screen's blocks or a container's children. */
  siblings: Block[];
  index: number;
  parent: Block | null;
}

/** Finds a block anywhere in the document (screens → containers → children). */
export function findBlock(doc: ProjectDocument, blockId: string): BlockLocation | null {
  for (const screen of doc.screens) {
    const hit = search(screen.blocks, blockId, null);
    if (hit) return { screen, ...hit };
  }
  return null;
}

function search(list: Block[], id: string, parent: Block | null): Omit<BlockLocation, 'screen'> | null {
  for (let i = 0; i < list.length; i++) {
    const b = list[i]!;
    if (b.id === id) return { siblings: list, index: i, parent };
    const inner = search(b.children, id, b);
    if (inner) return inner;
  }
  return null;
}

/** Position of a block on the artboard: its own frame plus the frames of the containers around it. */
export function absoluteOrigin(doc: ProjectDocument, blockId: string): { x: number; y: number } | null {
  for (const screen of doc.screens) {
    const o = originIn(screen.blocks, blockId, 0, 0);
    if (o) return o;
  }
  return null;
}

function originIn(list: readonly Block[], id: string, ox: number, oy: number): { x: number; y: number } | null {
  for (const b of list) {
    if (b.id === id) return { x: ox + b.frame.x, y: oy + b.frame.y };
    const inner = originIn(b.children, id, ox + b.frame.x, oy + b.frame.y);
    if (inner) return inner;
  }
  return null;
}

/** Every `id` found in a value: the node's own, its blocks, options, rules, branches… */
function collectIds(value: unknown, into: Set<string>): void {
  if (Array.isArray(value)) {
    for (const v of value) collectIds(v, into);
  } else if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) {
      if ((k === 'id' || k === 'groupId') && typeof v === 'string') into.add(v);
      else collectIds(v, into);
    }
  }
}

function remap(value: unknown, map: Map<string, string>): unknown {
  if (typeof value === 'string') return map.get(value) ?? value;
  if (Array.isArray(value)) return value.map((v) => remap(v, map));
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, remap(v, map)]));
  return value;
}

/**
 * A copy of a screen or a block with fresh identifiers. Everything inside that pointed at an old identifier
 * (a rule that listens to a button of the same screen, an option of a question) points at the copy now.
 */
export function cloneWithNewIds<T>(node: T): T {
  const ids = new Set<string>();
  collectIds(node, ids);
  const map = new Map([...ids].map((id) => [id, createId()]));
  return remap(node, map) as T;
}

/** Blocks in drawing order: parents before their children, siblings by `z` (stable for equal `z`). */
export function drawOrder(blocks: readonly Block[]): Block[] {
  const out: Block[] = [];
  for (const b of [...blocks].sort((a, c) => a.z - c.z)) {
    out.push(b);
    out.push(...drawOrder(b.children));
  }
  return out;
}

/** Blocks of one level from the bottom layer to the top one: by `z`, equal `z` keep the order of the list. */
export function stackOf<T extends { z: number }>(blocks: readonly T[]): T[] {
  return blocks.map((b, i) => ({ b, i })).sort((a, c) => a.b.z - c.b.z || a.i - c.i).map((x) => x.b);
}
