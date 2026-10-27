import { type Block, type BranchRule, type Condition, type ProjectDocument, type Screen, ResultRule, Screen as ScreenSchema, Settings, createId, plainText, walkBlocks } from '@blokum/schema';
import { z } from '@blokum/schema';
import { type Recipe } from './commands';

/** L-02…L-04 · changes of the logic of the whole document: branches of a screen, result rules, settings of the passage. */

const screenOf = (doc: ProjectDocument, id: string): Screen | undefined => doc.screens.find((s) => s.id === id);
const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

/** L-02 · the branches of a screen; `change` gets a copy, the result must pass the schema or nothing changes. */
export const setBranches =
  (screenId: string, change: (branches: BranchRule[]) => unknown): Recipe =>
  (doc) => {
    const screen = screenOf(doc, screenId);
    if (!screen) return;
    const next = ScreenSchema.shape.branches.safeParse(change(clone(screen.branches)));
    if (next.success) screen.branches = next.data;
  };

const ResultList = z.array(ResultRule).max(100);

/** L-04 · result rules, in the order the creator set them (the first that fits wins). */
export const setResults =
  (change: (results: ProjectDocument['results']) => unknown): Recipe =>
  (doc) => {
    const next = ResultList.safeParse(change(clone(doc.results)));
    if (next.success) doc.results = next.data;
  };

/** L-03, L-04, L-01 · settings of the passage: feedback, tie-break, back button, progress, audience. */
export const setSettings =
  (change: (settings: ProjectDocument['settings']) => unknown): Recipe =>
  (doc) => {
    const next = Settings.safeParse(change(clone(doc.settings)));
    if (next.success) doc.settings = next.data;
  };

/** A condition that makes sense for a new branch: the first question of the screen, else the first variable. */
export function defaultCondition(doc: ProjectDocument, screen: Screen): Condition {
  for (const b of walkBlocks(screen.blocks)) {
    if (b.type === 'singleChoice' || b.type === 'multiChoice') return { kind: 'answer', questionBlockId: b.id, op: 'selected', ...(b.props.options[0] ? { optionId: b.props.options[0].id } : {}) };
    if (b.type === 'scale' || b.type === 'textInput' || b.type === 'swipe') return { kind: 'answer', questionBlockId: b.id, op: 'empty' };
  }
  const v = doc.variables[0];
  return { kind: 'variable', variableId: v?.id ?? 'variable_unset', op: 'gte', value: 1 };
}

export const newBranch = (doc: ProjectDocument, screen: Screen): BranchRule => ({ id: createId(), if: defaultCondition(doc, screen), to: { kind: 'next' } });

/** Screens that can have a result rule point at them: any screen; those of kind «результат» come first. */
export const resultScreens = (doc: ProjectDocument): Screen[] => [...doc.screens].sort((a, b) => Number(b.kind === 'result') - Number(a.kind === 'result'));

/** Question blocks of the whole document (conditions, texts and results refer to them), with their screen. */
export function questionsOf(doc: ProjectDocument): Array<{ id: string; name: string; type: string; screen: string; options: Array<{ id: string; label: string }> }> {
  const out: ReturnType<typeof questionsOf> = [];
  for (const s of doc.screens)
    for (const b of walkBlocks(s.blocks)) {
      if (!['singleChoice', 'multiChoice', 'textInput', 'scale', 'swipe', 'ranking', 'date', 'contacts'].includes(b.type)) continue;
      const options = b.type === 'singleChoice' || b.type === 'multiChoice' ? b.props.options.map((o, i) => ({ id: o.id, label: labelOf(b, o.blockId) || `Вариант ${i + 1}` })) : [];
      out.push({ id: b.id, name: b.name, type: b.type, screen: s.name, options });
    }
  return out;
}

const labelOf = (q: Block, blockId: string): string => {
  const text = q.children.find((x) => x.id === blockId)?.textLayer;
  return text ? plainText(text).trim() : '';
};

/** Blocks of the document that a condition about block state can point at. */
export function blocksOf(doc: ProjectDocument): Array<{ id: string; name: string; screen: string; type: string }> {
  return doc.screens.flatMap((s) => [...walkBlocks(s.blocks)].map((b) => ({ id: b.id, name: b.name, screen: s.name, type: b.type })));
}
