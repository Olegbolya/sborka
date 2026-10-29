import { expect, test, type Page } from '@playwright/test';
import { freshUser, loginAndOnboard } from './helpers/auth';
import { hit, openEditor, seedProject, serverDraft, textBlock } from './helpers/editor';

/* P3.8 · SC-02: the rules of a block are made in the interface, without code. */
type Rule = { when: Record<string, unknown>; do: Array<Record<string, unknown>>; if?: Record<string, unknown> };
const rulesOf = async (page: Page, id: string, blockId: string): Promise<Rule[]> => {
  const doc = (await serverDraft(page, id)).doc as unknown as { screens: Array<{ blocks: Array<{ id: string; rules: Rule[] }> }> };
  return doc.screens[0]!.blocks.find((b) => b.id === blockId)!.rules;
};

test.describe('P3.8 · конструктор правил', () => {
  test('SC-02 · правило «Нажали → скрыть блок» собирается в интерфейсе; блок выбирается кликом по холсту', async ({ page }, info) => {
    await loginAndOnboard(page, freshUser('Сценарист'));
    const { id } = await seedProject(page, (d) => {
      d.screens[0]!.blocks.push(
        { id: 'knopka_a', type: 'button', name: 'Кнопка', frame: { x: 95, y: 300, w: 200, h: 56 }, textLayer: { paragraphs: [{ kind: 'p', runs: [{ t: 'Жми' }] }] } },
        textBlock('korobka_1', 'Коробка', 20, 60, 160, 48),
      );
    });
    await openEditor(page, id);
    await hit(page, 'Кнопка').click();
    await page.getByRole('tab', { name: 'Сценарии' }).click();
    await page.getByLabel('Добавить правило: когда').selectOption({ label: 'Нажали' });
    const rule = page.locator('[data-rule]').first();
    await expect(rule).toContainText('Когда нажали на «Кнопка»');
    await rule.getByRole('button', { name: 'Действие 1: Подождать', exact: true }).click();
    await rule.getByLabel('Действие 1: что сделать').selectOption({ label: 'Показать или скрыть' });
    await rule.getByLabel('Что сделать', { exact: true }).selectOption({ label: 'скрыть' });
    // The target is chosen by a tap on the canvas.
    await rule.getByRole('button', { name: /Какие блоки, 1: блок: указать на холсте|Какие блоки, 1.*указать на холсте/ }).click();
    await expect(page.getByTestId('picker-hint')).toBeVisible();
    await hit(page, 'Коробка').click();
    await expect(page.getByTestId('picker-hint')).toHaveCount(0);
    await expect.poll(async () => (await rulesOf(page, id, 'knopka_a'))[0]?.do[0]).toMatchObject({ kind: 'visibility', mode: 'hide', targets: [{ kind: 'block', blockId: 'korobka_1' }] });
    expect((await rulesOf(page, id, 'knopka_a'))[0]!.when).toMatchObject({ kind: 'tap', source: { kind: 'block', blockId: 'knopka_a' } });
    await page.screenshot({ path: `e2e/__screenshots__/scenario-editor-${info.project.name}.png` });
    // The selection did not jump to the block that was tapped for the answer.
    await expect(page.getByTestId('scenario-counts')).toHaveText('Правил: 1. Поведений: 0.');
  });
});
