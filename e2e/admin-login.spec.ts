import { expect, test } from '@playwright/test';
import { loginViaEmulator, type Provider } from './helpers/auth';
import { totpCode } from './helpers/totp';

/** The numbers ADMIN_ACCOUNTS names in scripts/e2e-api.sh (AD-01); each browser project has its own, they run side by side. */
const adminId = (provider: Provider): string => {
  const mobile = test.info().project.name.startsWith('mobile');
  return provider === 'vk' ? (mobile ? '700000000003' : '700000000001') : mobile ? '700000000004' : '700000000002';
};

test.describe('A6 · вход администратора', () => {
  for (const provider of ['vk', 'yandex'] as const) {
    test(`AD-01 · ${provider === 'vk' ? 'VK ID' : 'Яндекс ID'}: без кода сессии нет; первый раз — ключ и резервные коды, потом — только код`, async ({ page }) => {
      const user = { id: adminId(provider), name: 'Администратор' };
      // Первый вход: второй шаг с настройкой приложения.
      await page.goto('/login');
      await page.getByRole('link', { name: provider === 'vk' ? 'Войти через VK ID' : 'Войти через Яндекс ID' }).click();
      await page.getByLabel('ID пользователя').fill(user.id);
      await page.getByLabel('Имя').fill(user.name);
      await page.getByRole('button', { name: /^Войти через/ }).click();
      await page.waitForURL(/\/login\/2fa/);
      // Пока код не введён, сессии нет: кабинет не открывается.
      expect((await page.request.get('/api/v1/auth/me')).status()).toBe(401);

      const secret = (await page.getByTestId('totp-secret').textContent())!.trim();
      await page.getByLabel('Код', { exact: true }).fill('000000');
      await page.getByRole('button', { name: 'Подтвердить' }).click();
      await expect(page.getByTestId('mfa-error')).toContainText('Неверный код');
      await page.getByLabel('Код', { exact: true }).fill(totpCode(secret));
      await page.getByRole('button', { name: 'Подтвердить' }).click();
      const codes = page.getByTestId('backup-codes');
      await expect(codes).toContainText('Резервные коды');
      const backup = (await codes.locator('li').allTextContents()).map((c) => c.trim());
      expect(backup).toHaveLength(8);
      await page.getByRole('button', { name: 'Я сохранил(а) коды' }).click();
      await page.waitForURL(/\/(onboarding|cabinet\/projects)/);
      const me = (await (await page.request.get('/api/v1/auth/me')).json()) as { role: string };
      expect(me.role).toBe('ADMIN');

      // Второй вход: ключ не показывают, спрашивают код.
      await page.context().clearCookies();
      await loginViaEmulatorToSecondStep(page, provider, user);
      await expect(page.getByTestId('totp-secret')).toHaveCount(0);
      await expect(page.getByRole('heading', { name: 'Код из приложения' })).toBeVisible();
      await page.getByLabel('Код', { exact: true }).fill(backup[0]!);
      await page.getByRole('button', { name: 'Подтвердить' }).click();
      await page.waitForURL(/\/(onboarding|cabinet\/projects)/);
      expect((await page.request.get('/api/v1/auth/me')).status()).toBe(200);
    });
  }

  test('AD-01 · обычный пользователь второго шага не видит', async ({ page }) => {
    await loginViaEmulator(page, { id: '123456789012', name: 'Обычный' });
    expect(page.url()).not.toContain('/login/2fa');
  });

  test('AD-01 · страница второго шага без входа через провайдера говорит, что вход устарел', async ({ page }) => {
    await page.goto('/login/2fa');
    await expect(page.getByRole('heading', { name: 'Вход устарел' })).toBeVisible();
  });
});

async function loginViaEmulatorToSecondStep(page: import('@playwright/test').Page, provider: Provider, user: { id: string; name: string }): Promise<void> {
  await page.goto('/login');
  await page.getByRole('link', { name: provider === 'vk' ? 'Войти через VK ID' : 'Войти через Яндекс ID' }).click();
  await page.getByLabel('ID пользователя').fill(user.id);
  await page.getByLabel('Имя').fill(user.name);
  await page.getByRole('button', { name: /^Войти через/ }).click();
  await page.waitForURL(/\/login\/2fa/);
}
