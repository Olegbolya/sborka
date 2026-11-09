import { expect, test } from '@playwright/test';
import { adminLogin, freshUser, loginAndOnboard } from './helpers/auth';
import { seedProject } from './helpers/editor';

/** The number of the administrator of this browser project for the promo codes (scripts/e2e-api.sh). */
const promoAdminId = (info: { project: { name: string } }): string => (info.project.name.startsWith('mobile') ? '700000000032' : '700000000031');

test.describe('P7.5 · промокоды', () => {
  test('AD-05 · администратор создаёт промокод на страницу «Промокоды», покупатель вводит его у «Праздника» и видит цену; неверный код объясняется', async ({ browser }, info) => {
    const code = `E2E${Math.floor(Math.random() * 900000 + 100000)}`;
    // Администратор создаёт код: 30 % на пропуск «Праздник».
    const adminCtx = await browser.newContext();
    const admin = await adminCtx.newPage();
    await adminLogin(admin, { id: promoAdminId(info), name: 'Администратор промокодов' });
    await admin.goto('/admin/promo');
    await admin.getByTestId('promo-new-code').fill(code);
    await admin.getByTestId('promo-new-kind').selectOption('PERCENT');
    await admin.getByTestId('promo-new-value').fill('30');
    await admin.getByTestId('promo-create-submit').click();
    const row = admin.getByTestId(`promo-${code}`);
    await expect(row).toContainText('−30 %');
    await expect(row).toContainText('использовано 0');
    // Лимит и выключение правятся на странице.
    await row.getByRole('textbox').fill('5');
    await row.getByRole('button', { name: 'Сохранить лимит' }).click();
    await expect(row).toContainText('использовано 0 из 5');
    await adminCtx.close();

    // Покупатель вводит код в настройках сборки.
    const buyerCtx = await browser.newContext();
    const page = await buyerCtx.newPage();
    await loginAndOnboard(page, freshUser('Покупатель'));
    const { id } = await seedProject(page);
    await page.goto(`/cabinet/projects/${id}`);
    await page.getByRole('button', { name: 'Настройки' }).click();
    const offer = page.getByTestId('pass-offer');
    await expect(offer.getByTestId('pass-pay')).toHaveText('Включить за 79 ₽');
    await offer.getByTestId('promo-input').fill('NETTAKOGO');
    await offer.getByTestId('promo-apply').click();
    await expect(offer.getByTestId('promo-error')).toHaveText('Такого промокода нет.');
    await offer.getByTestId('promo-input').fill(code.toLowerCase());
    await offer.getByTestId('promo-apply').click();
    await expect(offer.getByTestId('promo-result')).toContainText('к оплате 55,30 ₽ вместо 79 ₽');
    await expect(offer.getByTestId('pass-pay')).toHaveText('Включить за 55,30 ₽');
    await offer.getByTestId('promo-clear').click();
    await expect(offer.getByTestId('pass-pay')).toHaveText('Включить за 79 ₽');
    // На странице «Тариф и оплата» код проверяется сам по себе.
    await page.goto('/cabinet/billing');
    const bar = page.getByLabel('Промокод').first();
    await expect(bar).toBeVisible();
    await page.getByTestId('promo-input').first().fill('NETTAKOGO');
    await page.getByTestId('promo-apply').first().click();
    await expect(page.getByTestId('promo-error').first()).toHaveText('Такого промокода нет.');
    await page.getByTestId('promo-input').first().fill(code);
    await page.getByTestId('promo-apply').first().click();
    await expect(page.getByTestId('promo-info')).toContainText('скидка 30 %');
    await buyerCtx.close();
  });

  test('P7.5 · обычный пользователь не видит админку промокодов', async ({ page }) => {
    await loginAndOnboard(page, freshUser('Не админ'));
    expect((await page.request.get('/api/v1/admin/promo-codes')).status()).toBe(403);
  });
});
