import { expect, test } from '@playwright/test';
import { freshUser, loginAndOnboard } from './helpers/auth';
import { seedProject } from './helpers/editor';

test.describe('P7.5 · дополнительные покупки', () => {
  test('P7.5 · на «Старте» доступна покупка «Старта», остальные объясняют причину; покупка сборки требует выбрать сборку', async ({ page }) => {
    await loginAndOnboard(page, freshUser('Допродажи'));
    const { id } = await seedProject(page);
    await page.goto('/cabinet/billing');
    const shop = page.getByTestId('addon-shop');
    await expect(shop.getByRole('heading', { name: 'Дополнительные покупки' })).toBeVisible();
    await expect(shop.getByTestId('addon-FREE_EXTRAS')).toContainText('99 ₽');
    await expect(shop.getByTestId('addon-buy-FREE_EXTRAS')).toHaveText('Купить за 99 ₽');
    await expect(shop.getByTestId('addon-reason-STORAGE_10GB')).toContainText('платной подписки');
    await expect(shop.getByTestId('addon-reason-COMPLETIONS_1000')).toContainText('платной подписки');
    await expect(shop.getByTestId('addon-reason-PASS_EXTEND_30')).toHaveText('Выберите сборку выше.');
    await shop.getByTestId('addon-project').selectOption(id);
    await expect(shop.getByTestId('addon-reason-PASS_EXTEND_30')).toContainText('нет пропуска «Праздник»');
    // Платёжный сервис в e2e не подключён: человек видит понятное сообщение.
    await shop.getByTestId('addon-buy-FREE_EXTRAS').click();
    await expect(shop.getByRole('alert')).toContainText('Оплата пока не подключена');
  });
});
