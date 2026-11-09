import { expect, test } from '@playwright/test';
import { freshUser, loginAndOnboard } from './helpers/auth';
import { openEditor, seedProject } from './helpers/editor';

test.describe('E-15 · числовые поля: границы не мешают набирать', () => {
  test('E-15 · «Высота экрана» (400–5000): число набирается спокойно, вне границ пишется «Минимум»/«Максимум», на выходе из поля ставится граница', async ({ page }) => {
    await loginAndOnboard(page, freshUser('Числа'));
    const { id } = await seedProject(page);
    await openEditor(page, id);
    const field = page.getByLabel('Высота экрана', { exact: true });
    const hint = page.getByTestId('num-hint');

    // Набор числа с нуля: первая цифра меньше минимума, но поле её не заменяет.
    await field.fill('');
    await field.pressSequentially('583');
    await expect(field).toHaveValue('583');
    await expect(hint).toHaveCount(0);

    // Меньше минимума: подсказка, число не трогают, пока поле в руках.
    await field.fill('');
    await field.pressSequentially('100');
    await expect(field).toHaveValue('100');
    await expect(hint).toHaveText('Минимум 400');
    await field.press('Enter');
    await expect(field).toHaveValue('400');
    await expect(hint).toHaveText('Минимум 400: поставили 400');

    // Больше максимума.
    await field.fill('');
    await field.pressSequentially('9000');
    await expect(hint).toHaveText('Максимум 5000');
    await field.blur();
    await expect(field).toHaveValue('5000');

    // Допустимое число доходит до сборки (автосохранение).
    await field.fill('');
    await field.pressSequentially('700');
    await field.blur();
    await expect(page.getByTestId('save-status')).toHaveText('Сохранено');
    await expect(field).toHaveValue('700');
    await expect(hint).toHaveCount(0);
  });
});
