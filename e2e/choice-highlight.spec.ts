import { mkdirSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import { createBlock } from '../packages/schema/dist/index.js';
import { freshUser, loginAndOnboard } from './helpers/auth';
import { player } from './helpers/build';
import { openEditor, seedProject } from './helpers/editor';

test.describe('B-11 · несколько вопросов на одном экране', () => {
  test('B-11 · выбранный ответ загорается и остаётся выбранным, пока отвечают на другой вопрос того же экрана', async ({ page }, info) => {
    await loginAndOnboard(page, freshUser('Автор опроса'));
    const q1 = createBlock('singleChoice', { name: 'Первый вопрос', frame: { x: 32, y: 60, w: 326, h: 128 } });
    const q2 = createBlock('singleChoice', { name: 'Второй вопрос', frame: { x: 32, y: 260, w: 326, h: 128 } });
    const { id } = await seedProject(page, (doc) => {
      (doc.screens[0]!.blocks as unknown[]).push(q1, q2);
    });
    await openEditor(page, id);
    const g = await player(page);
    const radios1 = g.blk(q1.id).getByRole('radio');
    const radios2 = g.blk(q2.id).getByRole('radio');
    await radios1.nth(1).click();
    await radios2.nth(0).click();
    // Both answers stay: the screen does not go on, each question keeps its own choice lit.
    await expect(radios1.nth(1)).toHaveAttribute('aria-checked', 'true');
    await expect(radios1.nth(1)).toHaveAttribute('data-state', 'selected');
    await expect(radios2.nth(0)).toHaveAttribute('data-state', 'selected');
    await expect(radios1.nth(0)).not.toHaveAttribute('data-state', 'selected');
    // Lit in the theme's main colour without any own «Выбрано» style.
    const tint = await radios1.nth(1).locator('[style*="0.18)"]').count();
    expect(tint).toBeGreaterThan(0);
    expect(await radios1.nth(0).locator('[style*="0.18)"]').count()).toBe(0);
    // Changing the first answer moves its light, the second question keeps its own.
    await radios1.nth(0).click();
    await expect(radios1.nth(0)).toHaveAttribute('data-state', 'selected');
    await expect(radios1.nth(1)).not.toHaveAttribute('data-state', 'selected');
    await expect(radios2.nth(0)).toHaveAttribute('data-state', 'selected');
    mkdirSync('test-results/screens', { recursive: true });
    await g.dialog.screenshot({ path: `test-results/screens/choice-highlight-${info.project.name}.png` });
  });
});
