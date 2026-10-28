import { expect, test } from '@playwright/test';
import { freshUser, loginAndOnboard } from './helpers/auth';
import { nextButton, openEditor, saveStatus, seedProject, textBlock } from './helpers/editor';

/**
 * A6 · the whole way of the product in one test: a creator signs in, builds, publishes, a participant passes it without
 * signing in, the creator sees the answer in the cabinet and downloads it. The draft with two screens and the button is
 * made through the API (the editor's own tests build such things by hand); the question is added in the editor.
 */
test('PL-03, PL-11, PL-12, D-04, D-06 · войти → собрать → опубликовать → пройти → ответ в кабинете → выгрузка', async ({ page, browser }, info) => {
  await loginAndOnboard(page, freshUser('Создатель'));

  // Сборка: черновик с двумя экранами и кнопкой; вопрос добавляется в редакторе.
  const { id } = await seedProject(page, (d) => {
    d.screens[0]!.blocks.push(textBlock('privet_1', 'Привет! Как вас зовут?', 20, 20, 300, 60), nextButton('dalshe_1', 'Дальше', 560));
    d.screens.push({ id: 'ekran_dva', name: 'Спасибо', blocks: [textBlock('spasibo_1', 'Спасибо за ответ', 20, 60, 300, 60)] } as never);
  });
  await openEditor(page, id);
  await page.getByRole('tab', { name: 'Добавить' }).click();
  await page.locator('[data-add-type="textInput"]').click();
  await expect(saveStatus(page)).toHaveText('Сохранено');
  await page.getByRole('button', { name: 'Опубликовать' }).click();
  await expect(page.getByTestId('project-status')).toHaveText(/Опубликована/);

  const { slug } = (await (await page.request.get(`/api/v1/projects/${id}`)).json()) as { slug: string };

  // Участник: без входа, по ссылке.
  const ctx = await browser.newContext({ baseURL: info.project.use.baseURL!, locale: 'ru-RU' });
  const p = await ctx.newPage();
  await p.goto(`/s/${slug}`);
  await expect(p.locator('.bk-player-screen[data-live="true"]')).toBeVisible();
  await p.locator('input').first().fill('Анна Петрова');
  await p.getByRole('button', { name: 'Дальше' }).click();
  await expect(p.getByText('Спасибо за ответ')).toBeVisible();
  await ctx.close();

  // Создатель: ответ в кабинете.
  await page.goto(`/cabinet/projects/${id}`);
  await expect(page.getByRole('button', { name: /Ответы \(/ })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Карточка' })).toBeVisible({ timeout: 15_000 });
  await page.getByRole('button', { name: 'Карточка' }).click();
  await expect(page.getByText('Анна Петрова')).toBeVisible();

  // Выгрузка: файл с ответом.
  await page.getByRole('button', { name: 'Экспорт' }).click();
  const csv = await page.request.get(`/api/v1/projects/${id}/responses/export.csv`);
  expect(csv.status()).toBe(200);
  expect(await csv.text()).toContain('Анна Петрова');
  const xlsx = await page.request.get(`/api/v1/projects/${id}/responses/export.xlsx`);
  expect(xlsx.status()).toBe(200);
  expect((await xlsx.body()).subarray(0, 2).toString()).toBe('PK');
});
