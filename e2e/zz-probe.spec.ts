import { test } from '@playwright/test';
import { freshUser, loginAndOnboard } from './helpers/auth';
import { openEditor, seedProject, openTab } from './helpers/editor';
test('probe', async ({ page }) => {
  test.setTimeout(120000);
  await loginAndOnboard(page, freshUser('Проба'));
  const { id } = await seedProject(page, undefined, 'Проба');
  await openEditor(page, id);
  await openTab(page, 'Добавить');
  console.log('ADD', await page.getByRole('complementary', { name: 'Экраны и слои' }).ariaSnapshot());
  await page.getByRole('button', { name: /^Выбор одного варианта/ }).click();
  await openTab(page, 'Слои');
  await page.getByRole('list', { name: 'Слои' }).getByRole('button', { name: 'Вариант 1', exact: true }).click();
  await openTab(page, 'Оформление');
  const ins = page.getByRole('complementary', { name: 'Свойства' });
  console.log('SUMMARIES', JSON.stringify(await ins.locator('[data-section]').evaluateAll((els) => els.map((e) => (e as HTMLElement).dataset.section + ':' + (e.querySelector('summary')?.textContent ?? '')))));
});
