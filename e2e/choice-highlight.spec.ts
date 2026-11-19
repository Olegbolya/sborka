import { mkdirSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import { createBlock } from '../packages/schema/dist/index.js';
import { freshUser, loginAndOnboard } from './helpers/auth';
import { player } from './helpers/build';
import { openEditor, openTab, seedProject, serverDraft } from './helpers/editor';

test.describe('B-11 · несколько вопросов на одном экране', () => {
  test('B-11 · ADR-119: подсветка выбранного ответа включается у вопроса галочкой, цвет — свой; без галочки вид не меняется', async ({ page }, info) => {
    await loginAndOnboard(page, freshUser('Автор опроса'));
    const q1 = createBlock('singleChoice', { name: 'Первый вопрос', frame: { x: 32, y: 60, w: 326, h: 128 } });
    const q2 = createBlock('singleChoice', { name: 'Второй вопрос', frame: { x: 32, y: 260, w: 326, h: 128 } });
    const { id } = await seedProject(page, (doc) => {
      (doc.screens[0]!.blocks as unknown[]).push(q1, q2);
    });
    await openEditor(page, id);

    // The switch is at the top of the question's properties, off by default; on — a colour to choose.
    await openTab(page, 'Слои');
    await page.getByRole('list', { name: 'Слои' }).getByRole('button', { name: 'Первый вопрос', exact: true }).click();
    await openTab(page, 'Содержимое');
    const highlight = page.getByLabel('Подсвечивать выбранный ответ');
    await expect(highlight).not.toBeChecked();
    await highlight.check();
    await page.getByLabel('Цвет подсветки: источник').selectOption('hex');
    await page.getByLabel('Цвет подсветки: HEX').fill('#2E7D32');
    await expect
      .poll(async () => JSON.stringify(((await serverDraft(page, id)).doc.screens[0]!.blocks as Array<{ id: string; props: unknown }>).find((b) => b.id === q1.id)!.props))
      .toContain('"highlight":{"color":{"hex":"#2E7D32"}}');
    mkdirSync('test-results/screens', { recursive: true });
    await page.screenshot({ path: `test-results/screens/choice-highlight-editor-${info.project.name}.png` });

    const g = await player(page);
    const radios1 = g.blk(q1.id).getByRole('radio');
    const radios2 = g.blk(q2.id).getByRole('radio');
    await radios1.nth(1).click();
    await radios2.nth(0).click();
    // Both answers stay on the screen: each question keeps its own choice.
    await expect(radios1.nth(1)).toHaveAttribute('aria-checked', 'true');
    await expect(radios2.nth(0)).toHaveAttribute('aria-checked', 'true');
    // The first question lights its choice in the chosen green; the second one (switch off) does not change its look.
    expect(await radios1.nth(1).locator('[style*="46, 125, 50"]').count()).toBeGreaterThan(0);
    expect(await radios1.nth(0).locator('[style*="46, 125, 50"]').count()).toBe(0);
    expect(await radios2.nth(0).locator('[style*="0.18)"]').count()).toBe(0);
    // Another option of the first question moves the light; the second question keeps its answer.
    await radios1.nth(0).click();
    expect(await radios1.nth(0).locator('[style*="46, 125, 50"]').count()).toBeGreaterThan(0);
    expect(await radios1.nth(1).locator('[style*="46, 125, 50"]').count()).toBe(0);
    await expect(radios2.nth(0)).toHaveAttribute('aria-checked', 'true');
    await g.dialog.screenshot({ path: `test-results/screens/choice-highlight-${info.project.name}.png` });
  });
});
