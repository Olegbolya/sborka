import { mkdirSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import { freshUser, loginAndOnboard } from './helpers/auth';

/* D-01 · у всех страниц кабинета одна шапка в виде лендинга; D-09 · в аккаунте виден тариф и остаток дней. */
const SHOTS = 'e2e/__screenshots__';

test.describe('D-01 · шапка кабинета', () => {
  test('D-01 · шапка с разделами на сборках, темах, тарифе и аккаунте; текущий раздел отмечен; переходы работают', async ({ page }, info) => {
    await loginAndOnboard(page, freshUser('Шапка кабинета'));
    mkdirSync(SHOTS, { recursive: true });
    const pages: Array<[string, string]> = [
      ['/cabinet/projects', 'cabinet-nav-projects'],
      ['/app/themes', 'cabinet-nav-themes'],
      ['/cabinet/billing', 'cabinet-nav-billing'],
      ['/account', 'cabinet-nav-account'],
    ];
    for (const [path, current] of pages) {
      await page.goto(path);
      const header = page.getByTestId('cabinet-header');
      await expect(header).toBeVisible();
      await expect(header.getByRole('link', { name: 'Блоккер — на главную' })).toHaveAttribute('href', '/');
      for (const id of ['cabinet-nav-projects', 'cabinet-nav-themes', 'cabinet-nav-billing', 'cabinet-nav-account']) {
        // На телефоне разделы не прячутся (на лендинге — прячутся): из кабинета всегда есть куда перейти.
        await expect(page.getByTestId(id)).toBeVisible();
        if (id === current) await expect(page.getByTestId(id)).toHaveAttribute('aria-current', 'page');
        else await expect(page.getByTestId(id)).not.toHaveAttribute('aria-current', 'page');
      }
      await page.screenshot({ path: `${SHOTS}/cabinet-header-${path.split('/').pop()}-${info.project.name}.png`, clip: { x: 0, y: 0, width: page.viewportSize()!.width, height: 160 } });
    }
    await page.getByTestId('cabinet-nav-themes').click();
    await expect(page).toHaveURL(/\/app\/themes/);
    await page.getByTestId('cabinet-nav-account').click();
    await expect(page).toHaveURL(/\/account/);
  });

  test('D-09 · в аккаунте написан тариф: «Старт» без срока, пробный «Автор» — сколько дней осталось', async ({ page }, info) => {
    await loginAndOnboard(page, freshUser('Тариф в аккаунте'));
    await page.goto('/account');
    await expect(page.getByTestId('account-plan-title')).toHaveText('«Старт»');
    await expect(page.getByTestId('account-plan')).toContainText('бесплатный, без срока');
    const started = await page.request.post('/api/v1/billing/trial', { headers: { origin: new URL(page.url()).origin }, data: { planCode: 'AUTHOR' } });
    expect(started.status()).toBe(200);
    await page.reload();
    await expect(page.getByTestId('account-plan-title')).toHaveText('«Автор»');
    await expect(page.getByTestId('account-plan-days')).toHaveText('осталось 3 дня');
    await expect(page.getByTestId('account-plan')).toContainText('пробный период');
    await page.screenshot({ path: `${SHOTS}/account-plan-${info.project.name}.png`, fullPage: false });
  });
});
