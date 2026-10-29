import { type DebugEvent } from '@blokum/engine';
import { type ProjectDocument, type Rule } from '@blokum/schema';
import { describeAction, describeCondition, describeTrigger, namesOf } from './rule-text';

/** SC-03 · the log of the debugger: what fired, when, and why a rule did not. A ring of the last entries. */
export const LOG_LIMIT = 300;

export interface LogEntry {
  n: number;
  event: DebugEvent;
}

export class DebugLog {
  private entries: LogEntry[] = [];
  private seq = 0;
  private readonly listeners = new Set<() => void>();

  onEvent = (event: DebugEvent): void => {
    // A new array each time: the panel re-reads it by reference.
    this.entries = [...this.entries.slice(-(LOG_LIMIT - 1)), { n: ++this.seq, event }];
    for (const fn of this.listeners) fn();
  };

  subscribe = (fn: () => void): (() => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };

  getSnapshot = (): readonly LogEntry[] => this.entries;

  clear(): void {
    this.entries = [];
    for (const fn of this.listeners) fn();
  }
}

/** Every rule of the document by id: the log names rules by what they say, not by an identifier. */
export function ruleIndex(doc: ProjectDocument): Map<string, Rule> {
  const rules = new Map<string, Rule>();
  const walk = (blocks: ProjectDocument['screens'][number]['blocks']) => {
    for (const b of blocks) {
      for (const r of b.rules) rules.set(r.id, r);
      walk(b.children);
    }
  };
  for (const r of doc.rules) rules.set(r.id, r);
  for (const s of doc.screens) {
    for (const r of s.rules) rules.set(r.id, r);
    walk(s.blocks);
  }
  return rules;
}

/** «12,3 с» — the time of the passage. */
export const formatTime = (ms: number): string => `${(ms / 1000).toFixed(1).replace('.', ',')} с`;

/** One line of the log in plain Russian. */
export function describeEntry(entry: LogEntry, doc: ProjectDocument, rules: Map<string, Rule> = ruleIndex(doc)): { time: string; text: string; kind: 'rule' | 'skip' | 'action' | 'wait' } {
  const { event } = entry;
  const names = namesOf(doc);
  const rule = rules.get(event.ruleId);
  const name = rule ? (rule.name ? `«${rule.name}»` : `«когда ${describeTrigger(rule.when, names)}»`) : 'правило удалено';
  const time = formatTime(event.at);
  if (event.type === 'rule') {
    if (event.status === 'fired') return { time, text: `Сработало правило ${name}`, kind: 'rule' };
    if (event.status === 'once') return { time, text: `Правило ${name} не сработало: оно «один раз» и уже срабатывало`, kind: 'skip' };
    return { time, text: `Правило ${name} не сработало: не выполнено «${rule?.if ? describeCondition(rule.if, names) : 'условие'}»`, kind: 'skip' };
  }
  if (event.type === 'action') {
    return { time, text: `Действие: ${describeAction(event.detail, names)}`, kind: 'action' };
  }
  return { time, text: `Правило ${name} ждёт шага: следующее действие — ${describeAction(event.detail, names)}`, kind: 'wait' };
}
