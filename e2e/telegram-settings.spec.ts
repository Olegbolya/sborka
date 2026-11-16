import { mkdirSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import { freshUser, loginAndOnboard } from './helpers/auth';

/*
 * D-07 · блок «Уведомления в Телеграме» в настройках аккаунта. В среде проверки бота владельца нет (токен задаётся только на сервере),
 * поэтому видно честное «бот ещё не подключён»; привязка чата и сообщения проверены API-тестом `apps/api/test/telegram.test.ts`.
 */
const SHOTS = 'e2e/__screenshots__';

test.describe('D-07 · Телеграм в настройках', () => {
  test('D-07 · бот не подключён — об этом сказано по-русски, кнопки привязки нет', async ({ page }, info) => {
    await loginAndOnboard(page, freshUser('Автор'));
    await page.goto('/account');
    await expect(page.getByText('Уведомления в Телеграме')).toBeVisible();
    await expect(page.getByTestId('telegram-off')).toContainText('Бот для Телеграма ещё не подключён');
    await expect(page.getByTestId('telegram-connect')).toHaveCount(0);
    mkdirSync(SHOTS, { recursive: true });
    await page.getByTestId('telegram-settings').scrollIntoViewIfNeeded();
    await page.screenshot({ path: `${SHOTS}/telegram-settings-${info.project.name}.png` });
  });

  test('D-07 · сервер отвечает про привязку: бот не подключён → 503 с русским текстом', async ({ page }) => {
    await loginAndOnboard(page, freshUser('Автор'));
    const origin = new URL(page.url()).origin;
    const res = await page.request.post('/api/v1/account/telegram/link', { data: {}, headers: { origin } });
    expect(res.status()).toBe(503);
    expect(((await res.json()) as { error: { message: string } }).error.message).toBe('Бот для Телеграма ещё не подключён.');
  });
});
