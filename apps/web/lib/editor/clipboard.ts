import { type Block, DOCUMENT_LIMITS } from '@blokum/schema';
import { type Recipe } from './commands';
import { cloneWithNewIds, findBlock } from './tree';
import { absoluteFrames } from './geometry';
import { type ProjectDocument } from '@blokum/schema';

/** What «Копировать» puts aside: the blocks with everything inside them, including their rules (E-08, SC-06). */
export interface ClipboardPayload {
  kind: 'blokum-blocks';
  version: 1;
  blocks: Block[];
}

const KEY = 'blokum.clipboard';
let memory: string | null = null;

/** Copies blocks; `null` when nothing was selected. */
export function copyBlocks(doc: ProjectDocument, ids: readonly string[]): ClipboardPayload | null {
  const frames = absoluteFrames(doc.screens.flatMap((s) => s.blocks));
  const top = new Set(ids);
  const blocks: Block[] = [];
  for (const id of ids) {
    const loc = findBlock(doc, id);
    if (!loc) continue;
    // A block whose container is copied too comes with the container.
    let skip = false;
    for (let p = loc.parent; p; p = findBlock(doc, p.id)?.parent ?? null) if (top.has(p.id)) skip = true;
    if (skip) continue;
    const copy = structuredClone(loc.siblings[loc.index]!);
    // Inside the clipboard blocks sit where they are on the artboard, so they can go to any screen or container.
    const abs = frames.get(id);
    if (abs) {
      copy.frame.x = abs.x;
      copy.frame.y = abs.y;
    }
    blocks.push(copy);
  }
  return blocks.length > 0 ? { kind: 'blokum-blocks', version: 1, blocks } : null;
}

/** Puts the payload where other tabs and other projects of the same browser can read it. */
export function writeClipboard(payload: ClipboardPayload): void {
  const text = JSON.stringify(payload);
  memory = text;
  try {
    localStorage.setItem(KEY, text);
  } catch {
    // Private mode: the same tab still has it in memory.
  }
}

export function readClipboard(): ClipboardPayload | null {
  let text: string | null = memory;
  try {
    text = localStorage.getItem(KEY) ?? text;
  } catch {
    // keep memory
  }
  if (!text) return null;
  try {
    const p = JSON.parse(text) as ClipboardPayload;
    return p.kind === 'blokum-blocks' && p.version === 1 && Array.isArray(p.blocks) && p.blocks.length > 0 ? p : null;
  } catch {
    return null;
  }
}

/**
 * E-08 · pastes onto a screen as new blocks on top (new identifiers, rules and options follow the copies). They keep
 * the place they were copied from; when blocks are already there they move by `offset`. `onCreated` gets the new ids.
 */
export const pasteBlocks =
  (payload: ClipboardPayload, screenId: string, offset: number, onCreated?: (ids: string[]) => void): Recipe =>
  (doc) => {
    const screen = doc.screens.find((s) => s.id === screenId);
    if (!screen) return;
    const room = DOCUMENT_LIMITS.blocksPerScreen - countBlocks(screen.blocks);
    const copies = cloneWithNewIds(payload.blocks).slice(0, Math.max(0, room));
    if (copies.length === 0) return;
    const taken = screen.blocks.map((b) => `${b.frame.x},${b.frame.y},${b.frame.w},${b.frame.h}`);
    let shift = 0;
    while (copies.some((c) => taken.includes(`${c.frame.x + shift},${c.frame.y + shift},${c.frame.w},${c.frame.h}`))) shift += offset;
    const top = Math.max(-1, ...screen.blocks.map((b) => b.z)) + 1;
    copies.forEach((c, i) => {
      c.frame.x += shift;
      c.frame.y += shift;
      c.z = top + i;
      screen.blocks.push(c);
    });
    onCreated?.(copies.map((c) => c.id));
  };

function countBlocks(blocks: readonly Block[]): number {
  return blocks.reduce((n, b) => n + 1 + countBlocks(b.children), 0);
}
