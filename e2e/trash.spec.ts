import { mkdirSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import { freshUser, loginAndOnboard } from './helpers/auth';

/*
 * D-01 · удалённую сборку можно вернуть из раздела «Удалённые сборки»; со страницы «Аккаунт» есть путь назад.
 */
const SHOTS = 'e2e/__screenshots__';

test.describe('D-01 · удалённые сборки', () => {
  test('D-01 · удалить сборку → она в «Удалённых сборках» → «Восстановить» возвращает её в список; со страницы аккаунта — «К моим сборкам»', async ({ page }, info) => {
    await loginAndOnboard(page, freshUser('Автор'));
    const origin = new URL(page.url()).origin;
    const title = `Для корзины ${Date.now().toString(36)}`;
    expect((await page.request.post('/api/v1/projects', { data: { title }, headers: { origin } })).ok()).toBe(true);

    await page.goto('/cabinet/projects');
    page.once('dialog', (d) => void d.accept());
    await page.locator('div', { hasText: title }).getByRole('button', { name: 'Удалить' }).last().click();
    await expect(page.getByTestId('trash')).toBeVisible();
    await expect(page.getByTestId('trash-item')).toContainText(title);
    mkdirSync(SHOTS, { recursive: true });
    await page.screenshot({ path: `${SHOTS}/trash-${info.project.name}.png`, fullPage: true });

    await page.getByTestId('trash-restore').click();
    await expect(page.getByTestId('trash')).toHaveCount(0);
    await expect(page.getByText(title, { exact: true })).toBeVisible();

    await page.goto('/account');
    await page.getByTestId('account-back').click();
    await expect(page).toHaveURL(/\/cabinet\/projects/);
  });
});
