import { expect, test } from '@playwright/test';
import { freshUser, loginAndOnboard } from './helpers/auth';

/* Шапка публичных страниц: гостю — «Войти», вошедшему — «Кабинет» (раньше на «Тариф и оплата» вошедшему писало «Войти»). */
test.describe('шапка публичных страниц', () => {
  test('P7.6 · гостю в шапке «Войти», вошедшему — «Кабинет» на тарифах (страница оплаты — в шапке кабинета, D-01)', async ({ page }, info) => {
    await page.goto('/tariffs');
    const header = page.locator('header.lp-header');
    await expect(header.getByRole('link', { name: 'Войти' })).toHaveAttribute('href', '/login');
    await expect(header.getByRole('link', { name: 'Кабинет' })).toHaveCount(0);

    await loginAndOnboard(page, freshUser('Шапка'));
    await page.goto('/tariffs');
    await expect(header.getByRole('link', { name: 'Кабинет' })).toHaveAttribute('href', '/cabinet/projects');
    await expect(header.getByRole('link', { name: 'Войти' })).toHaveCount(0);
    await page.screenshot({ path: `e2e/__screenshots__/site-header-${info.project.name}.png`, clip: { x: 0, y: 0, width: page.viewportSize()!.width, height: 120 } });
  });
});
