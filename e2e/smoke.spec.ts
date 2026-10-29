import { mkdirSync } from 'node:fs';
import { expect, test } from '@playwright/test';

const SHOTS = 'e2e/__screenshots__';

test.describe('смоук', () => {
  test('главная открывается на русском и без горизонтальной прокрутки', async ({ page }, info) => {
    const response = await page.goto('/');
    expect(response?.status()).toBe(200);
    await expect(page.locator('html')).toHaveAttribute('lang', 'ru');
    await expect(page.getByRole('heading', { level: 1 })).toContainText('Собери что угодно');
    await expect(page).toHaveTitle(/Блокум/);

    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow).toBeLessThanOrEqual(0);

    mkdirSync(SHOTS, { recursive: true });
    await page.screenshot({ path: `${SHOTS}/smoke-home-${info.project.name}.png`, fullPage: true });
  });

  test('проверка здоровья веб-процесса', async ({ request }) => {
    const res = await request.get('/healthz');
    expect(res.ok()).toBe(true);
    expect(await res.json()).toMatchObject({ status: 'ok', service: 'blokum-web' });
  });

  test('страница закрыта от индексации до запуска', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', /noindex/);
  });
});
