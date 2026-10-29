import { expect, test, type Page } from '@playwright/test';
import { freshUser, loginAndOnboard } from './helpers/auth';
import { openEditor, seedProject } from './helpers/editor';

/* P10.5 · уроки внутри редактора: пошаговые подсказки сами замечают сделанное; работают при пустых библиотеке и темах. */
const addBlock = async (page: Page, type: string) => {
  await page.getByRole('tab', { name: 'Добавить' }).click();
  await page.locator(`[data-add-type="${type}"]`).click();
};
const openLesson = async (page: Page, id: string) => {
  const panel = page.getByTestId('lesson-panel');
  if (!(await panel.isVisible())) await page.getByRole('button', { name: 'Уроки', exact: true }).click();
  await panel.locator(`[data-lesson-id="${id}"]`).click();
  return panel;
};

test.describe('P10.5 · уроки в редакторе', () => {
  test('урок «Убегающая кнопка»: шаги отмечаются сами по ходу работы, нужное место подсвечено, панель сворачивается', async ({ page }) => {
    test.setTimeout(120_000);
    await loginAndOnboard(page, freshUser('Ученик'));
    const { id } = await seedProject(page);
    await openEditor(page, id);
    await page.getByRole('button', { name: 'Уроки', exact: true }).click();
    const panel = page.getByTestId('lesson-panel');
    await expect(panel.getByRole('list', { name: 'Список уроков' }).getByRole('listitem')).toHaveCount(5);

    await openLesson(page, 'rg-01');
    await expect(panel.getByTestId('lesson-progress')).toHaveText('Шаг 1 из 6');
    await page.getByRole('tab', { name: 'Добавить' }).click();
    await expect(page.locator('[data-add-type="button"]')).toHaveAttribute('data-lesson-glow', '');

    await addBlock(page, 'text');
    await addBlock(page, 'button');
    await expect(panel.getByTestId('lesson-progress')).toHaveText('Шаг 1 из 6');
    await addBlock(page, 'button');
    await expect(panel.getByTestId('lesson-progress')).toHaveText('Шаг 2 из 6');
    await expect(panel.locator('li[data-done="true"]')).toHaveCount(1);

    // The step is undone together with the work: undo takes the tick away.
    await page.getByRole('button', { name: 'Отменить', exact: true }).click();
    await expect(panel.getByTestId('lesson-progress')).toHaveText('Шаг 1 из 6');

    await panel.getByRole('button', { name: 'Свернуть' }).click();
    await expect(panel.getByRole('list', { name: 'Шаги урока' })).toBeHidden();
    await panel.getByRole('button', { name: 'Развернуть' }).click();
    await panel.getByRole('button', { name: 'Все уроки' }).click();
    await expect(panel.getByRole('list', { name: 'Список уроков' })).toBeVisible();
    await page.getByRole('button', { name: 'Закрыть уроки' }).click();
    await expect(panel).toBeHidden();
  });

  test('уроки «Своя тема» и «Мем-переход» работают при пустых библиотеке и темах; шаги без проверки подтверждаются «Готово»', async ({ page }) => {
    test.setTimeout(120_000);
    await loginAndOnboard(page, freshUser('Ученик'));
    const { id } = await seedProject(page);
    await openEditor(page, id);

    let panel = await openLesson(page, 'theme');
    await expect(panel.getByTestId('lesson-progress')).toHaveText('Шаг 1 из 3');
    await expect(page.locator('[data-lesson="theme"]')).toHaveAttribute('data-lesson-glow', '');
    await panel.getByRole('button', { name: 'Готово' }).click();
    await expect(panel.getByTestId('lesson-progress')).toHaveText('Шаг 2 из 3');
    await expect(panel.getByRole('button', { name: 'Готово' })).toHaveCount(0);

    await panel.getByRole('button', { name: 'Все уроки' }).click();
    panel = await openLesson(page, 'meme');
    await expect(panel.getByTestId('lesson-progress')).toHaveText('Шаг 1 из 5');
  });
});
