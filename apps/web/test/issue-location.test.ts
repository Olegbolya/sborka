import { describe, expect, it } from 'vitest';
import { ProjectDocument, createBlock, createDocument, validateDocument } from '@blokum/schema';
import { locateIssue } from '../lib/editor/issue-location';

function broken() {
  const doc = createDocument({ title: 'Ошибки' });
  const button = createBlock('button', { name: 'Кнопка' });
  const rule = { id: 'pravilo_blok', enabled: true, once: false, priority: 50, when: { kind: 'tap' as const, source: { kind: 'block' as const, blockId: button.id } }, do: [{ kind: 'visibility' as const, targets: [{ kind: 'block' as const, blockId: 'udalyonnyj_blok' }], mode: 'hide' as const, animate: true }] };
  button.rules.push(rule);
  doc.screens[0]!.blocks.push(button);
  doc.screens[0]!.rules.push({ id: 'pravilo_ekran', enabled: true, once: false, priority: 50, when: { kind: 'screen', phase: 'show' }, do: [{ kind: 'setVariable', variableId: 'udalyonnaya', op: 'add', value: 1 }] });
  doc.rules.push({ id: 'pravilo_sborka', enabled: true, once: false, priority: 50, when: { kind: 'screen', phase: 'show' }, do: [{ kind: 'openLink', url: 'https://example.org/' }] });
  return { doc: ProjectDocument.parse(doc), button };
}

describe('P3.8 · SC-07 · ошибка проверки называет место и ведёт к нему', () => {
  it('SC-07 · удалённый блок в правиле блока: место — экран, блок и номер правила; ведёт на вкладку «Сценарии» с этим правилом', () => {
    const { doc, button } = broken();
    const issue = validateDocument(doc).find((i) => i.code === 'MISSING_BLOCK')!;
    expect(locateIssue(doc, issue)).toEqual({ kind: 'block-rule', screenId: doc.screens[0]!.id, blockId: button.id, ruleId: 'pravilo_blok', tab: 'scenarios', where: 'Экран «Экран 1» · блок «Кнопка» · правило 2' });
  });

  it('SC-07 · удалённая переменная в правиле экрана: ведёт в панель правил экрана', () => {
    const { doc } = broken();
    const issue = validateDocument(doc).find((i) => i.code === 'MISSING_VARIABLE')!;
    expect(locateIssue(doc, issue)).toEqual({ kind: 'screen-rule', screenId: doc.screens[0]!.id, ruleId: 'pravilo_ekran', where: 'Экран «Экран 1» · правило 1' });
  });

  it('TS-07 · ссылка не по жесту в правиле сборки: ведёт в панель правил сборки', () => {
    const { doc } = broken();
    const issue = validateDocument(doc).find((i) => i.code === 'LINK_WITHOUT_GESTURE')!;
    expect(locateIssue(doc, issue)).toEqual({ kind: 'doc-rule', ruleId: 'pravilo_sborka', where: 'Правила сборки · правило 1' });
  });

  it('SC-07 · проблемы вне правил: результат, ветка, экран без выхода', () => {
    const doc = createDocument({ title: 'Экраны' });
    expect(locateIssue(doc, { code: 'MISSING_SCREEN', severity: 'error', path: ['results', 0], message: 'x' })).toEqual({ kind: 'result', where: 'Результаты' });
    expect(locateIssue(doc, { code: 'MISSING_SCREEN', severity: 'error', path: ['screens', 0, 'branches', 0], message: 'x' })).toMatchObject({ kind: 'branch', screenId: doc.screens[0]!.id });
    expect(locateIssue(doc, { code: 'NO_EXIT', severity: 'error', path: ['screens', 0], message: 'x' })).toEqual({ kind: 'screen', screenId: doc.screens[0]!.id, where: 'Экран «Экран 1»' });
    expect(locateIssue(doc, { code: 'ENDLESS_LOOP', severity: 'error', path: ['screens'], message: 'x' }).kind).toBe('screens');
  });

  it('SC-07 · блок, не правило: поведение — вкладка «Сценарии», текст — «Содержимое»', () => {
    const { doc, button } = broken();
    const at = (part: string) => locateIssue(doc, { code: 'MISSING_BLOCK', severity: 'error', path: ['screens', 0, 'block', button.id, part], message: 'x' });
    expect(at('behaviors')).toMatchObject({ kind: 'block', tab: 'scenarios' });
    expect(at('textLayer')).toMatchObject({ kind: 'block', tab: 'content' });
    expect(at('visibleIf')).toMatchObject({ kind: 'block', tab: 'look' });
  });
});
