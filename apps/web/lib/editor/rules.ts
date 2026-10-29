import { type Action, type Block, type Condition, type ProjectDocument, type Rule, type Trigger, createId } from '@blokum/schema';
import { type Recipe } from './commands';
import { findBlock } from './tree';

/**
 * P3.8 · SC-01, SC-02 · changes of the rules of a block as recipes of the history. A list of actions is told by a path:
 * `[]` is the rule's own list, `[2, 'then']` the «то» of its third action, `[2, 'else', 0, 'do']` and so on.
 */
export type ListPath = ReadonlyArray<number | 'then' | 'else' | 'do'>;
export const MAX_ACTIONS = 50;
export const MAX_RULES = 50;

type Mutable<T> = { -readonly [K in keyof T]: T[K] };

/** The list of actions a path points to, or null when the path leads nowhere (the rule was changed meanwhile). */
export function listAt(rule: Pick<Rule, 'do'>, path: ListPath): Action[] | null {
  let list: Action[] = rule.do;
  for (let i = 0; i < path.length; i += 2) {
    const index = path[i];
    const branch = path[i + 1];
    if (typeof index !== 'number' || typeof branch !== 'string') return null;
    const action = list[index];
    if (!action) return null;
    if (action.kind === 'if' && (branch === 'then' || branch === 'else')) list = action[branch];
    else if (action.kind === 'repeat' && branch === 'do') list = action.do;
    else return null;
  }
  return list;
}

/** Who owns a rule (SC-01): a block, a screen or the whole assembly. */
export type RuleOwner = { kind: 'block'; blockId: string } | { kind: 'screen'; screenId: string } | { kind: 'doc' };

/** The list of rules of an owner in the document (the draft inside a recipe), or null when the owner is gone. */
export function rulesOf(doc: ProjectDocument, owner: RuleOwner): Rule[] | null {
  if (owner.kind === 'doc') return doc.rules;
  if (owner.kind === 'screen') return doc.screens.find((s) => s.id === owner.screenId)?.rules ?? null;
  const loc = findBlock(doc, owner.blockId);
  return loc?.siblings[loc.index]?.rules ?? null;
}

const withRule =
  (owner: RuleOwner, ruleId: string, change: (rule: Mutable<Rule>) => void): Recipe =>
  (doc) => {
    const rule = rulesOf(doc, owner)?.find((r) => r.id === ruleId);
    if (rule) change(rule);
  };

export const addRule =
  (owner: RuleOwner, when: Trigger, first: Action, onCreated?: (id: string) => void): Recipe =>
  (doc) => {
    const rules = rulesOf(doc, owner);
    if (!rules || rules.length >= (owner.kind === 'doc' ? 200 : MAX_RULES)) return;
    const rule: Rule = { id: createId(), enabled: true, once: false, priority: 50, when, do: [first] };
    rules.push(rule);
    onCreated?.(rule.id);
  };

export const removeRule = (owner: RuleOwner, ruleId: string): Recipe => (doc) => {
  const rules = rulesOf(doc, owner);
  const at = rules?.findIndex((r) => r.id === ruleId) ?? -1;
  if (rules && at >= 0) rules.splice(at, 1);
};

export const moveRule = (owner: RuleOwner, ruleId: string, delta: -1 | 1): Recipe => (doc) => {
  const rules = rulesOf(doc, owner);
  if (!rules) return;
  const from = rules.findIndex((r) => r.id === ruleId);
  const to = from + delta;
  if (from < 0 || to < 0 || to >= rules.length) return;
  const [moved] = rules.splice(from, 1);
  rules.splice(to, 0, moved!);
};

export const duplicateRule = (owner: RuleOwner, ruleId: string, onCreated?: (id: string) => void): Recipe => (doc) => {
  const rules = rulesOf(doc, owner);
  const index = rules?.findIndex((r) => r.id === ruleId) ?? -1;
  if (!rules || index < 0 || rules.length >= (owner.kind === 'doc' ? 200 : MAX_RULES)) return;
  const copy = JSON.parse(JSON.stringify(rules[index])) as Mutable<Rule>;
  copy.id = createId();
  if (copy.name) copy.name = `${copy.name} (копия)`;
  rules.splice(index + 1, 0, copy);
  onCreated?.(copy.id);
};

export const setRuleFields =
  (owner: RuleOwner, ruleId: string, fields: Partial<Pick<Rule, 'name' | 'enabled' | 'once' | 'priority'>>): Recipe =>
  withRule(owner, ruleId, (rule) => {
    for (const [key, value] of Object.entries(fields)) {
      if (key === 'name' && (value === undefined || value === '')) delete rule.name;
      else (rule as Record<string, unknown>)[key] = value;
    }
  });

export const setTrigger = (owner: RuleOwner, ruleId: string, when: Trigger): Recipe => withRule(owner, ruleId, (rule) => void (rule.when = when));

export const setRuleCondition = (owner: RuleOwner, ruleId: string, condition: Condition | null): Recipe =>
  withRule(owner, ruleId, (rule) => {
    if (condition) rule.if = condition;
    else delete rule.if;
  });

export const addAction = (owner: RuleOwner, ruleId: string, path: ListPath, action: Action, index?: number): Recipe =>
  withRule(owner, ruleId, (rule) => {
    const list = listAt(rule, path);
    if (!list || list.length >= MAX_ACTIONS) return;
    list.splice(index ?? list.length, 0, action);
  });

/** The last action of the rule's own list cannot go: a rule without actions is not valid (SC-01). */
export const removeAction = (owner: RuleOwner, ruleId: string, path: ListPath, index: number): Recipe =>
  withRule(owner, ruleId, (rule) => {
    const list = listAt(rule, path);
    if (!list || index < 0 || index >= list.length) return;
    if (path.length === 0 && list.length === 1) return;
    if (path.length >= 2 && path[path.length - 1] === 'do' && list.length === 1) return;
    list.splice(index, 1);
  });

export const moveAction = (owner: RuleOwner, ruleId: string, path: ListPath, from: number, to: number): Recipe =>
  withRule(owner, ruleId, (rule) => {
    const list = listAt(rule, path);
    if (!list || from === to || from < 0 || to < 0 || from >= list.length || to >= list.length) return;
    const [moved] = list.splice(from, 1);
    list.splice(to, 0, moved!);
  });

export const setAction = (owner: RuleOwner, ruleId: string, path: ListPath, index: number, action: Action): Recipe =>
  withRule(owner, ruleId, (rule) => {
    const list = listAt(rule, path);
    if (list && index >= 0 && index < list.length) list[index] = action;
  });

/** Rules of the whole document, for the general panel: block, screen and the rule. */
export function allRules(doc: ProjectDocument): Array<{ screenId: string; screenName: string; block: Block; rule: Rule }> {
  const out: Array<{ screenId: string; screenName: string; block: Block; rule: Rule }> = [];
  const walk = (screenId: string, screenName: string, blocks: readonly Block[]) => {
    for (const block of blocks) {
      for (const rule of block.rules) out.push({ screenId, screenName, block, rule });
      walk(screenId, screenName, block.children);
    }
  };
  for (const s of doc.screens) walk(s.id, s.name, s.blocks);
  return out;
}
