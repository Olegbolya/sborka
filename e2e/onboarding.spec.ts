import { mkdirSync } from 'node:fs';
import { expect, test } from '@playwright/test';

const SHOTS = 'e2e/__screenshots__';

test.describe('A-02 · Онбординг', () => {
  test('A-02 · кнопка «Продолжить» недоступна без обязательных чекбоксов', async ({ page }, info) => {
    await page.goto('/onboarding');

    const btn = page.getByRole('button', { name: 'Продолжить' });
    await expect(btn).toBeDisabled();

    // Check only TOS — still disabled.
    await page.getByLabel('Принимаю').check();
    await expect(btn).toBeDisabled();

    // Check TOS + PD — still disabled (age not confirmed).
    await page.getByLabel(/обработку персональных данных/).check();
    await expect(btn).toBeDisabled();

    // Check age — now enabled.
    await page.getByLabel(/18 лет/).check();
    await expect(btn).toBeEnabled();

    mkdirSync(SHOTS, { recursive: true });
    await page.screenshot({ path: `${SHOTS}/onboarding-enabled-${info.project.name}.png`, fullPage: true });
  });

  test('A-02 · кнопка остаётся недоступной при снятии обязательного чекбокса', async ({ page }) => {
    await page.goto('/onboarding');

    const btn = page.getByRole('button', { name: 'Продолжить' });

    await page.getByLabel('Принимаю').check();
    await page.getByLabel(/обработку персональных данных/).check();
    await page.getByLabel(/18 лет/).check();
    await expect(btn).toBeEnabled();

    // Uncheck PD — disabled again.
    await page.getByLabel(/обработку персональных данных/).uncheck();
    await expect(btn).toBeDisabled();
  });

  test('A-02 · необязательный маркетинговый чекбокс не влияет на кнопку', async ({ page }) => {
    await page.goto('/onboarding');

    const btn = page.getByRole('button', { name: 'Продолжить' });

    // Check only marketing — still disabled.
    await page.getByLabel(/рекламных сообщений/).check();
    await expect(btn).toBeDisabled();

    // Add required checkboxes — enabled.
    await page.getByLabel('Принимаю').check();
    await page.getByLabel(/обработку персональных данных/).check();
    await page.getByLabel(/18 лет/).check();
    await expect(btn).toBeEnabled();
  });

  test('A-02 · страница онбординга доступна на русском', async ({ page }) => {
    await page.goto('/onboarding');
    await expect(page.getByRole('heading', { level: 1 })).toContainText('Перед началом');
  });
});
