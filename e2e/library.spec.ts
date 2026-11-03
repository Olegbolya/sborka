import { expect, test } from '@playwright/test';
import { freshUser, loginAndOnboard } from './helpers/auth';
import { openEditor, seedProject, openTab } from './helpers/editor';

test.beforeEach(async ({ page }) => {
  await loginAndOnboard(page, freshUser('Автор'));
});

test.describe('LB-03 · вкладка Библиотека — пустое состояние', () => {
  test('LB-03 · вкладка «Библиотека» отображает пустое состояние', async ({ page }) => {
    const { id } = await seedProject(page);
    await openEditor(page, id);

    await openTab(page, 'Библиотека');
    const panel = page.getByTestId('library-panel');
    await expect(panel).toBeVisible();
    await expect(panel).toContainText('Библиотека пополняется');
    await expect(panel.getByRole('link', { name: 'Загрузить своё' })).toBeVisible();
  });
});
