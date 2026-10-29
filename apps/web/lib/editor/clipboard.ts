import { type Block, DOCUMENT_LIMITS, type Variable, createId } from '@blokum/schema';
import { type Recipe } from './commands';
import { cloneWithNewIds, findBlock } from './tree';
import { absoluteFrames } from './geometry';
import { type ProjectDocument } from '@blokum/schema';

/** What «Копировать» puts aside: the blocks with everything inside them, including their rules (E-08, SC-06). */
export interface ClipboardPayload {
  kind: 'blokum-blocks';
  version: 1 | 2;
  blocks: Block[];
  /** SC-06 · the variables the copied rules and blocks use, so another assembly can get them (version 2). */
  variables?: Variable[];
}

/** Identifiers of the variables a piece of the document refers to: `variableId` of rules, conditions, blocks and `v` of text runs. */
export function variableRefs(value: unknown, into: Set<string> = new Set()): Set<string> {
  if (Array.isArray(value)) {
    for (const item of value) variableRefs(item, into);
  } else if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) {
      if ((k === 'variableId' || k === 'v') && typeof v === 'string') into.add(v);
      else variableRefs(v, into);
    }
  }
  return into;
}

/** The same piece with variable references changed by `map` (what was not mapped stays). */
function renameRefs<T>(value: T, map: ReadonlyMap<string, string>): T {
  if (Array.isArray(value)) return (value as unknown[]).map((x) => renameRefs(x, map)) as T;
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([k, v]: [string, unknown]) => [k, (k === 'variableId' || k === 'v') && typeof v === 'string' ? (map.get(v) ?? v) : renameRefs(v, map)])) as T;
  }
  return value;
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
  if (blocks.length === 0) return null;
  const used = variableRefs(blocks);
  const variables = doc.variables.filter((v) => used.has(v.id)).map((v) => structuredClone(v));
  return { kind: 'blokum-blocks', version: 2, blocks, variables };
}

/** What a paste into this assembly needs (SC-06): variables to create, and those whose names are taken by another variable. */
export interface PastePlan {
  create: Variable[];
  conflicts: Array<{ variable: Variable; existing: Variable }>;
}
export type PasteChoice = 'link' | 'rename';

export function planPaste(doc: ProjectDocument, payload: ClipboardPayload): PastePlan {
  const plan: PastePlan = { create: [], conflicts: [] };
  for (const variable of payload.variables ?? []) {
    if (doc.variables.some((v) => v.id === variable.id)) continue;
    const existing = doc.variables.find((v) => v.name === variable.name);
    if (existing) plan.conflicts.push({ variable, existing });
    else plan.create.push(variable);
  }
  return plan;
}

/** A name that is free: «Очки_копия», «Очки_копия_2»… (the name of a variable has letters, digits and «_» only). */
export function freeName(doc: ProjectDocument, name: string): string {
  const taken = new Set(doc.variables.map((v) => v.name));
  for (let n = 1; ; n += 1) {
    const candidate = (n === 1 ? `${name}_копия` : `${name}_копия_${n}`).slice(0, 40);
    if (!taken.has(candidate)) return candidate;
  }
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

/** ASVS V8.2.3: what the person copied in the editor does not stay in the browser after they sign out. */
export function clearClipboard(): void {
  memory = null;
  try {
    localStorage.removeItem(KEY);
  } catch {
    // Nothing was kept.
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
    return p.kind === 'blokum-blocks' && (p.version === 1 || p.version === 2) && Array.isArray(p.blocks) && p.blocks.length > 0 ? p : null;
  } catch {
    return null;
  }
}

/**
 * E-08 · pastes onto a screen as new blocks on top (new identifiers, rules and options follow the copies). They keep
 * the place they were copied from; when blocks are already there they move by `offset`. `onCreated` gets the new ids.
 */
export const pasteBlocks =
  (payload: ClipboardPayload, screenId: string, offset: number, onCreated?: (ids: string[]) => void, choices: Readonly<Record<string, PasteChoice>> = {}): Recipe =>
  (doc) => {
    const screen = doc.screens.find((s) => s.id === screenId);
    if (!screen) return;
    const room = DOCUMENT_LIMITS.blocksPerScreen - countBlocks(screen.blocks);
    let copies = cloneWithNewIds(payload.blocks).slice(0, Math.max(0, room));
    if (copies.length === 0) return;
    // SC-06: variables the copy needs come with it; one whose name is taken is linked to the existing one or made again under a new name.
    const plan = planPaste(doc, payload);
    const map = new Map<string, string>();
    if (doc.variables.length + plan.create.length + plan.conflicts.length > DOCUMENT_LIMITS.variables) return;
    for (const v of plan.create) doc.variables.push(structuredClone(v));
    for (const { variable, existing } of plan.conflicts) {
      if ((choices[variable.id] ?? 'link') === 'link' && existing.type === variable.type) {
        map.set(variable.id, existing.id);
      } else {
        const made: Variable = { ...structuredClone(variable), id: createId(), name: freeName(doc, variable.name) };
        doc.variables.push(made);
        map.set(variable.id, made.id);
      }
    }
    if (map.size > 0) copies = renameRefs(copies, map);
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
