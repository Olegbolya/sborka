import { mkdirSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import { freshUser, loginAndOnboard } from './helpers/auth';
import { nextButton, openEditor, seedProject, textBlock } from './helpers/editor';

const SHOTS = 'e2e/__screenshots__';

test.beforeEach(async ({ page }) => {
  await loginAndOnboard(page, freshUser('Автор'));
});

const seedTwoScreens = (page: import('@playwright/test').Page) =>
  seedProject(page, (d) => {
    d.screens[0]!.blocks.push(textBlock('privet_1', 'Привет, это первый экран', 20, 60, 300, 60), nextButton('knopka_1', 'Дальше', 200));
    d.screens.push({ id: 'ekran_vtoroj', name: 'Второй', blocks: [textBlock('final_1', 'Это второй экран', 20, 60, 300, 60), nextButton('knopka_2', 'Закончить', 200)] });
    d.variables.push({ id: 'peremennaya_ochki', name: 'Очки', type: 'number', initial: 5, saveToAnswers: false });
  });

test.describe('E-20 · предпросмотр', () => {
  test('E-20 · рамка телефона: прохождение до конца по кнопкам, затем «Начать заново»', async ({ page }, info) => {
    const { id } = await seedTwoScreens(page);
    await openEditor(page, id);
    await page.getByRole('button', { name: 'Предпросмотр' }).click();
    const dialog = page.getByRole('dialog', { name: 'Предпросмотр' });
    const frame = dialog.locator('[data-preview="true"]');
    await expect(frame).toHaveAttribute('data-frame', 'phone');
    await expect(frame.locator('.bk-player-screen[data-live="true"]')).toBeVisible();
    await expect(frame.getByText('Привет, это первый экран')).toBeVisible();
    await expect(dialog.getByTestId('preview-badge')).toContainText('никуда не отправляются');

    mkdirSync(SHOTS, { recursive: true });
    await page.screenshot({ path: `${SHOTS}/preview-${info.project.name}.png` });

    await frame.getByRole('button', { name: 'Дальше' }).click();
    await expect(frame.getByText('Это второй экран')).toBeVisible();
    await expect(dialog.getByRole('button', { name: 'Назад' })).toBeEnabled();
    await dialog.getByRole('button', { name: 'Назад' }).click();
    await expect(frame.getByText('Привет, это первый экран')).toBeVisible();
    await frame.getByRole('button', { name: 'Дальше' }).click();
    await frame.getByRole('button', { name: 'Закончить' }).click();
    await expect(dialog.getByTestId('preview-end')).toHaveText(/Прохождение завершено/);

    await dialog.getByRole('button', { name: 'Начать заново' }).click();
    await expect(frame.getByText('Привет, это первый экран')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toHaveCount(0);
  });

  test('E-20 · рамка компьютера: колонка 480 px, тот же прогон', async ({ page }) => {
    const { id } = await seedTwoScreens(page);
    await openEditor(page, id);
    await page.getByRole('button', { name: 'Предпросмотр' }).click();
    const dialog = page.getByRole('dialog', { name: 'Предпросмотр' });
    await dialog.getByRole('button', { name: 'Компьютер' }).click();
    const frame = dialog.locator('[data-preview="true"]');
    await expect(frame).toHaveAttribute('data-frame', 'desktop');
    await expect(frame.getByText('Привет, это первый экран')).toBeVisible();
    const column = await frame.locator('.bk-artboard').boundingBox();
    expect(Math.round(column!.width)).toBe(480);
    await frame.getByRole('button', { name: 'Дальше' }).click();
    await expect(frame.getByText('Это второй экран')).toBeVisible();
  });

  test('E-20 · предпросмотр показывает правки, которые ещё не ушли на сервер', async ({ page }) => {
    const { id } = await seedTwoScreens(page);
    await openEditor(page, id);
    await page.getByRole('tab', { name: 'Слои' }).click();
    await page.getByRole('list', { name: 'Слои' }).getByRole('button', { name: 'Привет, это первый экран', exact: true }).click();
    await page.keyboard.press('Delete');
    await page.getByRole('button', { name: 'Предпросмотр' }).click();
    const frame = page.getByRole('dialog', { name: 'Предпросмотр' }).locator('[data-preview="true"]');
    await expect(frame.getByRole('button', { name: 'Дальше' })).toBeVisible();
    await expect(frame.getByText('Привет, это первый экран')).toHaveCount(0);
  });

  test('SC-03 · отладчик: переменные правятся вручную; «Перезапустить экран» оставляет значения', async ({ page }) => {
    const { id } = await seedTwoScreens(page);
    await openEditor(page, id);
    await page.getByRole('button', { name: 'Предпросмотр' }).click();
    const dialog = page.getByRole('dialog', { name: 'Предпросмотр' });
    const field = dialog.getByLabel('Переменная «Очки»');
    await expect(field).toHaveValue('5');
    await field.fill('42');
    await expect(field).toHaveValue('42');
    await dialog.getByRole('button', { name: 'Перезапустить экран' }).click();
    await expect(dialog.locator('[data-preview="true"]').getByText('Привет, это первый экран')).toBeVisible();
    await expect(field).toHaveValue('42');
  });

  test('E-20 · прохождение в предпросмотре не создаёт ни прохождений, ни ответов', async ({ page }) => {
    const { id } = await seedTwoScreens(page);
    await openEditor(page, id);
    await page.getByRole('button', { name: 'Предпросмотр' }).click();
    const frame = page.getByRole('dialog', { name: 'Предпросмотр' }).locator('[data-preview="true"]');
    await frame.getByRole('button', { name: 'Дальше' }).click();
    await frame.getByRole('button', { name: 'Закончить' }).click();
    await expect(page.getByTestId('preview-end')).toBeVisible();
    const project = (await (await page.request.get(`/api/v1/projects/${id}`)).json()) as { starts: number; completions: number };
    expect(project).toMatchObject({ starts: 0, completions: 0 });
    const responses = (await (await page.request.get(`/api/v1/projects/${id}/responses`)).json()) as { items: unknown[] };
    expect(responses.items).toHaveLength(0);
  });

  test('E-20 · обязательный вопрос: «дальше» не пускает, сообщение по-русски', async ({ page }) => {
    const { id } = await seedProject(page, (d) => {
      d.screens[0]!.blocks.push(
        {
          id: 'vopros_1',
          type: 'singleChoice',
          name: 'Вопрос',
          frame: { x: 20, y: 40, w: 300, h: 140 },
          props: { required: true, options: [{ id: 'otvet_1', blockId: 'varian_1' }, { id: 'otvet_2', blockId: 'varian_2' }] },
          children: [
            { ...textBlock('varian_1', 'Первый ответ', 0, 0, 300, 50), type: 'shape' },
            { ...textBlock('varian_2', 'Второй ответ', 0, 70, 300, 50), type: 'shape' },
          ],
        },
        nextButton('knopka_1', 'Дальше', 300),
      );
      d.screens.push({ id: 'ekran_vtoroj', name: 'Второй', blocks: [textBlock('final_1', 'Это второй экран', 20, 60, 300, 60)] });
    });
    await openEditor(page, id);
    await page.getByRole('button', { name: 'Предпросмотр' }).click();
    const dialog = page.getByRole('dialog', { name: 'Предпросмотр' });
    const frame = dialog.locator('[data-preview="true"]');
    await frame.getByRole('button', { name: 'Дальше' }).click();
    await expect(dialog.getByRole('alert')).toContainText(/[а-яё]/i);
    await expect(frame.getByText('Это второй экран')).toHaveCount(0);
    await frame.getByText('Первый ответ').click();
    await frame.getByRole('button', { name: 'Дальше' }).click();
    await expect(frame.getByText('Это второй экран')).toBeVisible();
  });
});
