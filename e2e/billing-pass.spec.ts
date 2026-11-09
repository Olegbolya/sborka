import { expect, test } from '@playwright/test';
import { freshUser, loginAndOnboard } from './helpers/auth';
import { nextButton, openEditor, seedProject } from './helpers/editor';

test.describe('P7.1 · «Праздник» для одной сборки', () => {
  test('P7.1 · публикация упирается в лимит «Старта» → окно с причиной и кнопкой «Включить за 79 ₽»', async ({ page }) => {
    await loginAndOnboard(page, freshUser('Пропуск'));
    // На «Старте» в сборке может быть до 10 экранов — делаем 11.
    const { id } = await seedProject(page, (d) => {
      d.screens[0]!.blocks.push(nextButton('knopka_0'));
      for (let i = 1; i <= 10; i++) d.screens.push({ id: `ekran_${i}`, name: `Экран ${i + 1}`, blocks: [nextButton(`knopka_${i}`)] });
      (d.meta as Record<string, unknown>).description = 'Проверка предложения «Праздник»';
    });
    await openEditor(page, id);
    await page.getByRole('button', { name: 'Опубликовать', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Для публикации нужен тариф' });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByTestId('pass-reasons')).toContainText('до 10 экранов, сейчас 11');
    await expect(dialog.getByTestId('pass-terms')).toContainText('до 30 экранов');
    await expect(dialog.getByTestId('pass-terms')).toContainText('до 500 прохождений');
    await expect(dialog.getByTestId('pass-pay')).toHaveText('Включить за 79 ₽');
    // Платёжный сервис в e2e не подключён: человек видит понятное сообщение, а не пустой экран.
    await dialog.getByTestId('pass-pay').click();
    await expect(dialog.getByRole('alert')).toContainText('Оплата пока не подключена');
    await dialog.getByTestId('pass-close').click();
    await expect(dialog).toBeHidden();
    await expect(page.getByTestId('project-status')).toHaveText('Черновик');
  });

  test('P7.1 · в настройках сборки в кабинете есть предложение «Праздник»', async ({ page }) => {
    await loginAndOnboard(page, freshUser('Пропуск'));
    const { id } = await seedProject(page);
    await page.goto(`/cabinet/projects/${id}`);
    await page.getByRole('button', { name: 'Настройки' }).click();
    await expect(page.getByTestId('pass-offer').getByTestId('pass-pay')).toHaveText('Включить за 79 ₽');
  });
});
