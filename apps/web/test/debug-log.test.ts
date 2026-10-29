import { describe, expect, it } from 'vitest';
import { createBlock, createDocument, createVariable } from '@blokum/schema';
import { DebugLog, LOG_LIMIT, describeEntry, formatTime, ruleIndex } from '../lib/editor/debug-log';

function setup() {
  const doc = createDocument({ title: 'Отладка' });
  const button = createBlock('button', { name: 'Кнопка', rules: [] });
  const score = createVariable('Очки', 'number', 0);
  doc.variables.push(score);
  const rule = { id: 'pravilo_1', name: 'Плюс очко', enabled: true, once: false, priority: 50, when: { kind: 'tap' as const, source: { kind: 'block' as const, blockId: button.id } }, if: { kind: 'variable' as const, variableId: score.id, op: 'lt' as const, value: 3 }, do: [{ kind: 'setVariable' as const, variableId: score.id, op: 'add' as const, value: 1 }] };
  button.rules.push(rule);
  doc.screens[0]!.blocks.push(button);
  return { doc, button, rule };
}

describe('P3.8 · SC-03 · журнал отладчика простым русским', () => {
  it('SC-03 · строки журнала: сработало, не сработало по условию, ждёт шага, действие; время с запятой', () => {
    const { doc, button, rule } = setup();
    const line = (event: Parameters<DebugLog['onEvent']>[0]) => describeEntry({ n: 1, event }, doc);
    expect(line({ type: 'rule', ruleId: rule.id, status: 'fired', at: 1250, self: button.id })).toEqual({ time: '1,3 с', text: 'Сработало правило «Плюс очко»', kind: 'rule' });
    expect(line({ type: 'rule', ruleId: rule.id, status: 'condition', at: 0 }).text).toBe('Правило «Плюс очко» не сработало: не выполнено ««Очки» < 3»');
    expect(line({ type: 'rule', ruleId: rule.id, status: 'once', at: 0 })).toMatchObject({ kind: 'skip' });
    expect(line({ type: 'action', ruleId: rule.id, action: 'setVariable', detail: rule.do[0]!, at: 0 }).text).toBe('Действие: прибавить «Очки» (1)');
    expect(line({ type: 'paused', ruleId: rule.id, next: 'setVariable', detail: rule.do[0]!, at: 0 })).toMatchObject({ kind: 'wait', text: 'Правило «Плюс очко» ждёт шага: следующее действие — прибавить «Очки» (1)' });
    expect(formatTime(0)).toBe('0,0 с');
  });

  it('SC-03 · правило без названия называется по своему «когда»; удалённое — «правило удалено»', () => {
    const { doc, button, rule } = setup();
    delete (rule as { name?: string }).name;
    expect(describeEntry({ n: 1, event: { type: 'rule', ruleId: rule.id, status: 'fired', at: 0 } }, doc).text).toBe('Сработало правило «когда нажали на «Кнопка»»');
    expect(describeEntry({ n: 2, event: { type: 'rule', ruleId: 'net_takogo', status: 'fired', at: 0, self: button.id } }, doc).text).toBe('Сработало правило правило удалено');
    expect(ruleIndex(doc).get(rule.id)).toBe(rule);
  });

  it('SC-03 · в журнале помнятся последние записи; очистка и подписка работают', () => {
    const log = new DebugLog();
    let notified = 0;
    log.subscribe(() => (notified += 1));
    for (let i = 0; i < LOG_LIMIT + 20; i++) log.onEvent({ type: 'rule', ruleId: 'r', status: 'fired', at: i });
    expect(log.getSnapshot()).toHaveLength(LOG_LIMIT);
    expect(log.getSnapshot()[0]!.n).toBe(21);
    expect(notified).toBe(LOG_LIMIT + 20);
    const before = log.getSnapshot();
    log.clear();
    expect(log.getSnapshot()).toEqual([]);
    expect(before).toHaveLength(LOG_LIMIT);
  });
});
