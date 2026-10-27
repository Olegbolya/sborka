import { type RichText, type TextPlaceholder } from '@blokum/schema';

/**
 * B-01 · text of a block between the document (`RichText`: paragraphs of runs with marks, variables and system values) and
 * the editor (TipTap, a tree of nodes). Only the marks the document allows pass through: bold, italic, underline,
 * strikethrough, a link; lists of two kinds; a variable, a system value or the answer to a question as one atom.
 */
export interface EditorNode {
  type: string;
  attrs?: Record<string, unknown>;
  content?: EditorNode[];
  marks?: Array<{ type: string; attrs?: Record<string, unknown> }>;
  text?: string;
}

type Run = RichText['paragraphs'][number]['runs'][number];
type Kind = RichText['paragraphs'][number]['kind'];

const MARKS = { b: 'bold', i: 'italic', u: 'underline', s: 'strike' } as const;
export type PlaceholderKind = 'v' | 'sys' | 'answer';

const runToNode = (run: Run): EditorNode | null => {
  if ('t' in run) {
    if (run.t === '') return null;
    const marks: NonNullable<EditorNode['marks']> = [];
    for (const [key, type] of Object.entries(MARKS) as Array<[keyof typeof MARKS, string]>) if (run[key]) marks.push({ type });
    if (run.href) marks.push({ type: 'link', attrs: { href: run.href } });
    return { type: 'text', text: run.t, ...(marks.length > 0 ? { marks } : {}) };
  }
  if ('v' in run) return { type: 'placeholder', attrs: { kind: 'v', ref: run.v } };
  if ('sys' in run) return { type: 'placeholder', attrs: { kind: 'sys', ref: run.sys } };
  return { type: 'placeholder', attrs: { kind: 'answer', ref: run.answer } };
};

export function toEditorDoc(text: RichText | undefined): EditorNode {
  const content: EditorNode[] = [];
  let list: EditorNode | null = null;
  for (const p of text?.paragraphs ?? []) {
    const paragraph: EditorNode = { type: 'paragraph', content: p.runs.map(runToNode).filter((n): n is EditorNode => n !== null) };
    if (p.kind === 'p') {
      list = null;
      content.push(paragraph);
      continue;
    }
    const type = p.kind === 'bullet' ? 'bulletList' : 'orderedList';
    if (!list || list.type !== type) {
      list = { type, content: [] };
      content.push(list);
    }
    list.content!.push({ type: 'listItem', content: [paragraph] });
  }
  return { type: 'doc', content: content.length > 0 ? content : [{ type: 'paragraph' }] };
}

const nodeToRun = (node: EditorNode): Run | null => {
  if (node.type === 'placeholder') {
    const ref = typeof node.attrs?.ref === 'string' ? node.attrs.ref : '';
    if (node.attrs?.kind === 'sys') return { sys: ref as TextPlaceholder };
    if (node.attrs?.kind === 'answer') return { answer: ref };
    return { v: ref };
  }
  if (node.type !== 'text' || !node.text) return null;
  const run: Extract<Run, { t: string }> = { t: node.text };
  for (const mark of node.marks ?? []) {
    const key = (Object.keys(MARKS) as Array<keyof typeof MARKS>).find((k) => MARKS[k] === mark.type);
    if (key) run[key] = true;
    else if (mark.type === 'link' && typeof mark.attrs?.href === 'string') run.href = mark.attrs.href;
  }
  return run;
};

const runsOf = (paragraph: EditorNode | undefined): Run[] => (paragraph?.content ?? []).map(nodeToRun).filter((r): r is Run => r !== null);

export function fromEditorDoc(doc: EditorNode): RichText {
  const paragraphs: RichText['paragraphs'] = [];
  for (const node of doc.content ?? []) {
    if (node.type === 'paragraph') paragraphs.push({ kind: 'p', runs: runsOf(node) });
    else if (node.type === 'bulletList' || node.type === 'orderedList') {
      const kind: Kind = node.type === 'bulletList' ? 'bullet' : 'ordered';
      for (const item of node.content ?? []) for (const paragraph of item.content ?? []) if (paragraph.type === 'paragraph') paragraphs.push({ kind, runs: runsOf(paragraph) });
    }
  }
  return { paragraphs };
}
