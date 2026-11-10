import { expect, test } from '@playwright/test';
import { totpCode } from './helpers/totp';

/** The administrator that scripts/e2e-api.sh makes at the start of the API (AD-01). */
const LOGIN = 'e2e-admin';
const PASSWORD = 'Проверочный-пароль-2026';

test.describe('AD-01 · вход администратора по логину и паролю', () => {
  test('AD-01 · страница входа: неверный пароль — одно и то же сообщение, не раскрывающее логин', async ({ page }, info) => {
    await page.goto('/login/admin');
    await expect(page.getByRole('heading', { name: 'Вход в админку' })).toBeVisible();
    await page.getByLabel('Логин').fill('кто-то-чужой');
    await page.getByLabel('Пароль').fill('Неверный-пароль-123');
    await page.getByRole('button', { name: 'Войти' }).click();
    await expect(page.getByTestId('login-error')).toHaveText('Неверный логин или пароль.');
    await page.getByLabel('Логин').fill(LOGIN);
    await page.getByLabel('Пароль').fill('Неверный-пароль-124');
    await page.getByRole('button', { name: 'Войти' }).click();
    await expect(page.getByTestId('login-error')).toHaveText('Неверный логин или пароль.');
    expect((await page.request.get('/api/v1/auth/me')).status()).toBe(401);
    await page.screenshot({ path: `e2e/__screenshots__/admin-login-${info.project.name}.png` });
  });

  // The administrator is one for both browser projects and the authenticator is set up once (the first project that gets here): the
  // next project meets the question for the code and checks that the password alone gives no session.
  test('AD-01 · пароль, затем код из приложения: сессия администратора, админка открыта, пароль меняется', async ({ page }, info) => {
    await page.goto('/login/admin');
    await page.getByLabel('Логин').fill(LOGIN);
    await page.getByLabel('Пароль').fill(PASSWORD);
    await page.getByRole('button', { name: 'Войти' }).click();
    await page.waitForURL(/\/login\/2fa/);
    expect((await page.request.get('/api/v1/auth/me')).status()).toBe(401);
    const secretBox = page.getByTestId('totp-secret');
    await expect(secretBox.or(page.getByRole('heading', { name: 'Код из приложения' }))).toBeVisible();
    if ((await secretBox.count()) === 0) {
      await page.getByLabel('Код', { exact: true }).fill('000000');
      await page.getByRole('button', { name: 'Подтвердить' }).click();
      await expect(page.getByTestId('mfa-error')).toContainText('Неверный код');
      expect((await page.request.get('/api/v1/auth/me')).status()).toBe(401);
      return;
    }
    const secret = (await secretBox.textContent())!.trim();
    await page.getByLabel('Код', { exact: true }).fill(totpCode(secret));
    await page.getByRole('button', { name: 'Подтвердить' }).click();
    await page.getByRole('button', { name: 'Я сохранил(а) коды' }).click();
    await page.waitForURL(/\/(onboarding|cabinet\/projects)/);
    expect(((await (await page.request.get('/api/v1/auth/me')).json()) as { role: string }).role).toBe('ADMIN');

    await page.goto('/admin/security');
    await page.getByLabel('Текущий пароль').fill(PASSWORD);
    await page.getByLabel('Новый пароль', { exact: true }).fill('Совсем-новый-пароль-2027');
    await page.getByLabel('Новый пароль ещё раз').fill('Совсем-новый-пароль-2027');
    await page.getByTestId('password-submit').click();
    await expect(page.getByRole('status')).toContainText('Пароль изменён');
    await page.screenshot({ path: `e2e/__screenshots__/admin-password-${info.project.name}.png` });
    // Back to the first password so the run can be repeated.
    await page.getByLabel('Текущий пароль').fill('Совсем-новый-пароль-2027');
    await page.getByLabel('Новый пароль', { exact: true }).fill(PASSWORD);
    await page.getByLabel('Новый пароль ещё раз').fill(PASSWORD);
    await page.getByTestId('password-submit').click();
    await expect(page.getByRole('status')).toContainText('Пароль изменён');
  });
});
