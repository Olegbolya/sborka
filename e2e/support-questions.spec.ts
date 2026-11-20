import { expect, test } from '@playwright/test';
import { adminLogin, freshUser, loginAndOnboard } from './helpers/auth';

/** The administrator of this browser project for the questions page (scripts/e2e-api.sh). */
const supportAdminId = (info: { project: { name: string } }): string => (info.project.name.startsWith('mobile') ? '700000000046' : '700000000045');

test('AD-13 · вопрос со страницы «Помощь» приходит в админку, ответ — человеку в кабинет и под форму', async ({ page, browser }, info) => {
  // Не вошедший видит приглашение войти вместо формы.
  await page.goto('/help#ask');
  await expect(page.getByTestId('ask-question')).toContainText('Чтобы задать вопрос, войдите');
  await loginAndOnboard(page, freshUser('Вопрос'));
  await page.goto('/help#ask');
  const form = page.getByTestId('ask-question');
  await expect(form.getByTestId('ask-send')).toBeDisabled();
  const question = `Как поставить видео на фон экрана? ${String(Date.now())}`;
  await form.getByLabel('Ваш вопрос').fill(question);
  await form.getByTestId('ask-send').click();
  await expect(form.getByTestId('ask-sent')).toBeVisible();
  await expect(form.getByTestId('ask-mine')).toContainText(question);
  await expect(form.getByTestId('ask-mine')).toContainText('ждёт ответа');
  await page.screenshot({ path: `e2e/__screenshots__/help-ask-${info.project.name}.png`, fullPage: true });

  const ctx = await browser.newContext({ baseURL: info.project.use.baseURL!, locale: 'ru-RU' });
  const admin = await ctx.newPage();
  await adminLogin(admin, { id: supportAdminId(info), name: 'Администратор поддержки' });
  await admin.goto('/admin');
  await expect(admin.getByTestId('questions-count')).not.toHaveText('0');
  await admin.goto('/admin/support');
  const card = admin.getByTestId('support-question').filter({ hasText: question });
  await expect(card).toBeVisible();
  await card.getByTestId('support-answer').fill('Откройте экран, в свойствах «Фон» нажмите «Фото или видео».');
  await card.getByTestId('support-send').click();
  await expect(admin.getByRole('status')).toContainText('Ответ отправлен');
  await admin.screenshot({ path: `e2e/__screenshots__/admin-support-${info.project.name}.png`, fullPage: true });
  await ctx.close();

  await page.reload();
  await expect(page.getByTestId('ask-mine')).toContainText('есть ответ');
  await expect(page.getByTestId('ask-mine')).toContainText('Откройте экран, в свойствах «Фон»');
});
