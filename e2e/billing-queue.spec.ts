import { expect, test } from '@playwright/test';
import { freshUser, loginAndOnboard } from './helpers/auth';
import { setSubscriptions } from './helpers/plan';

test('ADR-126 · очередь тарифов: страница оплаты показывает работающий тариф с его сроком и следующий за ним; карточки объясняют, когда начнётся покупка', async ({ page }, info) => {
  await loginAndOnboard(page, freshUser('Очередь'));
  const me = (await (await page.request.get('/api/v1/auth/me')).json()) as { id: string };
  // «Плюс» работает ещё 25 дней, «Автор» оплачен и ждёт очереди.
  await setSubscriptions(me.id, [
    ['PLUS', -5, 25],
    ['AUTHOR', 25, 55],
  ]);
  await page.goto('/cabinet/billing');
  const summary = page.getByTestId('billing-summary');
  await expect(summary).toContainText('Сейчас у вас тариф «Плюс» до');
  const queued = page.getByTestId('billing-queued');
  await expect(queued).toContainText('Затем тариф «Автор» с');
  await expect(queued).toContainText('ни один оплаченный день не пропадает');
  await expect(page.getByTestId('plan-queue-note-AUTHOR')).toContainText('Уже оплачен: начнётся');
  await expect(page.getByTestId('plan-queue-note-PRO')).toContainText('Начнётся сразу после оплаты, а оставшиеся дни «Плюс» перенесутся');
  await page.screenshot({ path: `e2e/__screenshots__/billing-queue-${info.project.name}.png`, fullPage: true });
  await page.goto('/account');
  await expect(page.getByTestId('account-plan-queued')).toContainText('Дальше: «Автор» с');
});
