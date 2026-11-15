import { expect, test } from '@playwright/test';
import { freshUser, loginAndOnboard } from './helpers/auth';

test.describe('D-09 · «Тариф и оплата»: расход лимитов', () => {
  for (const scheme of ['light', 'dark'] as const) {
    test(`D-09 · у нового создателя видны прохождения месяца и место под файлы (${scheme === 'dark' ? 'тёмная' : 'светлая'} тема)`, async ({ page }, info) => {
      await page.emulateMedia({ colorScheme: scheme });
      await loginAndOnboard(page, freshUser('Расход'));
      await page.goto('/cabinet/billing');
      const usage = page.getByTestId('billing-usage');
      await expect(page.getByRole('heading', { name: 'Расход лимитов' })).toBeVisible();
      await expect(usage).toContainText(/Прохождения в этом месяце: 0 из \d+/);
      await expect(usage).toContainText(/Место под файлы: 0 МБ из \d+ МБ/);
      await expect(page.getByTestId('billing-passes')).toHaveCount(0);
      await page.screenshot({ path: `e2e/__screenshots__/billing-usage-${scheme}-${info.project.name}.png`, fullPage: true });
    });
  }
});
