import { type ProjectDocument, type ValidationIssue } from '@blokum/schema';

/** SC-07 · where an issue of the check is, in words and in ids: what the editor needs to take the person there. */
export interface IssueLocation {
  kind: 'block-rule' | 'block' | 'screen-rule' | 'screen' | 'doc-rule' | 'branch' | 'result' | 'screens';
  screenId?: string;
  blockId?: string;
  ruleId?: string;
  /** Which tab of the inspector shows the thing (blocks only). */
  tab?: 'look' | 'content' | 'scenarios';
  /** «Экран «Первый» · блок «Кнопка» · правило 2». */
  where: string;
}

export function locateIssue(doc: ProjectDocument, issue: ValidationIssue): IssueLocation {
  const [head, index, kind, id, part, ruleIndex] = issue.path;
  if (head === 'rules' && typeof index === 'number') {
    const rule = doc.rules[index];
    return { kind: 'doc-rule', ...(rule ? { ruleId: rule.id } : {}), where: `Правила сборки · правило ${index + 1}` };
  }
  if (head === 'results') return { kind: 'result', where: 'Результаты' };
  if (head === 'screens' && typeof index === 'number') {
    const screen = doc.screens[index];
    if (!screen) return { kind: 'screens', where: 'Экраны' };
    const base = `Экран «${screen.name}»`;
    if (kind === 'rules' && typeof id === 'number') {
      const rule = screen.rules[id];
      return { kind: 'screen-rule', screenId: screen.id, ...(rule ? { ruleId: rule.id } : {}), where: `${base} · правило ${id + 1}` };
    }
    if (kind === 'branches') return { kind: 'branch', screenId: screen.id, where: `${base} · ветвление` };
    if (kind === 'block' && typeof id === 'string') {
      const block = findBlock(screen.blocks, id);
      const name = block ? `блок «${block.name}»` : 'блок удалён';
      if (part === 'rules' && typeof ruleIndex === 'number') {
        const rule = block?.rules[ruleIndex];
        return { kind: 'block-rule', screenId: screen.id, blockId: id, ...(rule ? { ruleId: rule.id } : {}), tab: 'scenarios', where: `${base} · ${name} · правило ${ruleIndex + 1}` };
      }
      return { kind: 'block', screenId: screen.id, blockId: id, tab: part === 'behaviors' ? 'scenarios' : part === 'visibleIf' ? 'look' : 'content', where: `${base} · ${name}` };
    }
    return { kind: 'screen', screenId: screen.id, where: base };
  }
  return { kind: 'screens', where: 'Экраны' };
}

function findBlock(blocks: ProjectDocument['screens'][number]['blocks'], id: string): ProjectDocument['screens'][number]['blocks'][number] | undefined {
  for (const b of blocks) {
    if (b.id === id) return b;
    const inner = findBlock(b.children, id);
    if (inner) return inner;
  }
  return undefined;
}
