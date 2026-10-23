import { mkdirSync } from 'node:fs';
import { expect, test } from '@playwright/test';

const SHOTS = 'e2e/__screenshots__';

test.describe('A-03, A-05, D-10 · Аккаунт', () => {
  test('D-10 · страница аккаунта открывается на русском', async ({ page }, info) => {
    await page.goto('/account');
    await expect(page.getByRole('heading', { level: 1 })).toContainText('аккаунт');

    mkdirSync(SHOTS, { recursive: true });
    await page.screenshot({ path: `${SHOTS}/account-${info.project.name}.png`, fullPage: true });
  });

  test('A-05 · кнопка удаления показывает подтверждение', async ({ page }) => {
    await page.goto('/account');
    const deleteBtn = page.getByRole('button', { name: 'Удалить аккаунт' });
    await deleteBtn.click();
    await expect(page.getByText('Вы уверены?')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Да, удалить' })).toBeVisible();
  });

  test('A-05 · кнопка «Отмена» скрывает подтверждение', async ({ page }) => {
    await page.goto('/account');
    await page.getByRole('button', { name: 'Удалить аккаунт' }).click();
    await page.getByRole('button', { name: 'Отмена' }).click();
    await expect(page.getByRole('button', { name: 'Удалить аккаунт' })).toBeVisible();
    await expect(page.getByText('Вы уверены?')).not.toBeVisible();
  });

  test('A-03 · поле email присутствует с пояснением об уведомлениях', async ({ page }) => {
    await page.goto('/account');
    await expect(page.getByLabel('Email для уведомлений')).toBeVisible();
    await expect(page.getByText(/только для уведомлений/)).toBeVisible();
  });
});
