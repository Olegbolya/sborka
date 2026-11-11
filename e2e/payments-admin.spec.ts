import { expect, test } from '@playwright/test';
import { adminLogin, freshUser, loginAndOnboard } from './helpers/auth';

/** The administrator of this browser project for the payments page (scripts/e2e-api.sh). */
const payAdminId = (info: { project: { name: string } }): string => (info.project.name.startsWith('mobile') ? '700000000034' : '700000000033');

/** The second administrator of the page «Пользователи»: the first one has already set up the authenticator app in the first test. */
const userAdminId = (info: { project: { name: string } }): string => (info.project.name.startsWith('mobile') ? '700000000038' : '700000000037');

test.describe('P7.7 · админка платежей', () => {
  test('AD-12 · администратор видит доход с 1 января по физлицам и юрлицам, меняет годовой лимит; ручное начисление требует причину', async ({ page }, info) => {
    await adminLogin(page, { id: payAdminId(info), name: 'Администратор платежей' });
    await page.goto('/admin/payments');
    const income = page.getByTestId('income');
    await expect(income).toContainText('Доход самозанятого с 1 января');
    await expect(income).toContainText('Физические лица');
    await expect(income).toContainText('Юрлица и ИП');
    await expect(income.getByRole('progressbar')).toBeVisible();
    await income.getByTestId('income-limit').fill('3000000');
    await income.getByRole('button', { name: 'Сохранить лимит' }).click();
    await expect(page.getByRole('status')).toHaveText('Лимит сохранён');
    await expect(income).toContainText('из 3 000 000 ₽');
    await income.getByTestId('income-limit').fill('2400000');
    await income.getByRole('button', { name: 'Сохранить лимит' }).click();
    await expect(income).toContainText('из 2 400 000 ₽');
    // Ручное начисление: без причины кнопка закрыта.
    const form = page.getByTestId('grant-form');
    await form.getByTestId('grant-user').fill('00000000-0000-0000-0000-000000000000');
    await expect(form.getByTestId('grant-submit')).toBeDisabled();
    await form.getByTestId('grant-reason').fill('Проверка');
    await form.getByTestId('grant-submit').click();
    await expect(form.getByRole('alert')).toContainText('Пользователь не найден');
    await expect(page.getByRole('heading', { name: 'Заказы' })).toBeVisible();
  });

  test('AD-05 · тариф выдаётся и продлевается на странице пользователя: найти человека, открыть, выдать «Про»', async ({ page, browser }, info) => {
    const person = freshUser('Получатель тарифа');
    const personContext = await browser.newContext();
    await loginAndOnboard(await personContext.newPage(), person);
    await personContext.close();
    await adminLogin(page, { id: userAdminId(info), name: 'Администратор пользователей' });
    await page.goto('/admin/users');
    await page.getByLabel(/Имя, почта, телефон/).fill(person.id);
    await page.getByRole('button', { name: 'Найти' }).click();
    await page.getByTestId('user-row').getByRole('link', { name: person.name }).click();
    await expect(page.getByTestId('user-plan')).toContainText('Бесплатный');
    const form = page.getByTestId('grant-form');
    await expect(form.getByTestId('grant-user')).toHaveCount(0);
    await expect(form.getByRole('heading', { name: 'Выдать или продлить тариф' })).toBeVisible();
    await form.locator('select').nth(1).selectOption('PRO');
    await form.getByTestId('grant-reason').fill('Проверка выдачи');
    await form.getByTestId('grant-submit').click();
    await expect(page.getByTestId('user-plan')).toContainText('«Про»');
    await page.getByTestId('grant-form').scrollIntoViewIfNeeded();
    await page.screenshot({ path: `e2e/__screenshots__/admin-user-grant-${info.project.name}.png` });
    await form.getByTestId('grant-reason').fill('Проверка продления');
    await form.getByTestId('grant-submit').click();
    await expect(page.getByRole('status')).toHaveText('Начислено');
  });

  test('AD-05 · обычный пользователь не видит админку платежей', async ({ page }) => {
    await loginAndOnboard(page, freshUser('Не админ'));
    expect((await page.request.get('/api/v1/admin/payments/income')).status()).toBe(403);
  });
});
