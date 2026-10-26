import { mkdirSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import { freshUser, loginViaEmulator } from './helpers/auth';

const SHOTS = 'e2e/__screenshots__';

test.describe('A-01 · Вход через VK ID и Яндекс ID (эмулятор, ADR-034)', () => {
  test('A-01 · страница входа: две кнопки на русском, пароля нет', async ({ page }, info) => {
    await page.goto('/login');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Вход в Блокум');
    await expect(page.getByRole('link', { name: 'Войти через VK ID' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Войти через Яндекс ID' })).toBeVisible();
    await expect(page.locator('input[type="password"]')).toHaveCount(0);

    mkdirSync(SHOTS, { recursive: true });
    await page.screenshot({ path: `${SHOTS}/login-${info.project.name}.png`, fullPage: true });
  });

  test('A-01 · вход через VK ID: эмулятор → сайт, новый пользователь попадает на согласия', async ({ page }) => {
    const user = freshUser('Вера');
    await loginViaEmulator(page, user, 'vk');
    await expect(page).toHaveURL(/\/onboarding$/);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Перед началом');

    // The session is real: the API knows who signed in.
    const me = await page.request.get('/api/v1/auth/me');
    expect(me.ok()).toBe(true);
    expect((await me.json()).displayName).toBe(user.name);
  });

  test('A-01 · вход через Яндекс ID', async ({ page }) => {
    const user = freshUser('Яна');
    await loginViaEmulator(page, user, 'yandex');
    await expect(page).toHaveURL(/\/onboarding$/);
    const me = await page.request.get('/api/v1/auth/me');
    expect((await me.json()).displayName).toBe(user.name);
  });

  test('A-01 · разные пользователи эмулятора — разные учётные записи', async ({ browser }) => {
    const a = await browser.newContext();
    const b = await browser.newContext();
    const pa = await a.newPage();
    const pb = await b.newPage();
    await loginViaEmulator(pa, freshUser('Анна'));
    await loginViaEmulator(pb, freshUser('Борис'));
    const idA = (await (await pa.request.get('/api/v1/auth/me')).json()).id;
    const idB = (await (await pb.request.get('/api/v1/auth/me')).json()).id;
    expect(idA).not.toBe(idB);
    await a.close();
    await b.close();
  });

  test('A-01 · отменённый вход: страница входа с понятной ошибкой', async ({ page }) => {
    await page.goto('/api/v1/auth/oauth/vk/callback?error=access_denied');
    await expect(page).toHaveURL(/\/login\?error=oauth$/);
    await expect(page.locator('main [role="alert"]')).toContainText('Не получилось войти');
  });

  test('A-01 · без входа закрытые страницы ведут на страницу входа', async ({ page }) => {
    await page.goto('/account');
    await expect(page).toHaveURL(/\/login$/);
    await page.goto('/onboarding');
    await expect(page).toHaveURL(/\/login$/);
  });

  test('A-01 · уже вошедший со страницы входа уходит дальше', async ({ page }) => {
    await loginViaEmulator(page, freshUser('Ольга'));
    await page.goto('/login');
    await expect(page).toHaveURL(/\/onboarding$/);
  });
});
