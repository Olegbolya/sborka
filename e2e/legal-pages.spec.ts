import { expect, test } from '@playwright/test';

test.describe('P8.1 · опубликованные документы', () => {
  for (const scheme of ['light', 'dark'] as const) {
    test(`P8.1 · оферта, контакты и политика открываются с текстом, разделами и без пометки «Черновик» (${scheme === 'dark' ? 'тёмная' : 'светлая'} тема)`, async ({ page }, info) => {
      await page.emulateMedia({ colorScheme: scheme });
      await page.goto('/legal/contacts');
      await expect(page.getByRole('heading', { level: 1, name: 'Контакты и реквизиты' })).toBeVisible();
      await expect(page.getByTestId('legal-doc')).toContainText('Иванов Олег Андреевич');
      await expect(page.getByTestId('legal-doc')).toContainText('166014711920');
      await page.goto('/legal/offer');
      await expect(page.getByRole('heading', { level: 2, name: '8. Отказ от услуги и возврат денег' })).toBeVisible();
      await expect(page.getByText(/Черновик/)).toHaveCount(0);
      await expect(page.getByTestId('legal-doc')).not.toContainText('##');
      await page.screenshot({ path: `e2e/__screenshots__/legal-offer-${scheme}-${info.project.name}.png` });
      await page.goto('/legal/privacy');
      await expect(page.getByRole('table')).toBeVisible();
      await page.screenshot({ path: `e2e/__screenshots__/legal-privacy-${scheme}-${info.project.name}.png` });
    });
  }
});
