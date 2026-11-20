import { expect, test } from '@playwright/test';
import { adminLogin, freshUser, loginAndOnboard } from './helpers/auth';

/** The administrator of this browser project for the questions page (scripts/e2e-api.sh). */
const supportAdminId = (info: { project: { name: string } }): string => (info.project.name.startsWith('mobile') ? '700000000046' : '700000000045');

test('AD-13 · вопрос со страницы «Помощь» открывается отдельной перепиской: поддержка отвечает из админки, человек пишет дальше', async ({ page, browser }, info) => {
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
  // Вопрос сразу открывается своей перепиской.
  await expect(page).toHaveURL(/\/help\/questions\//);
  const chat = page.getByTestId('question-chat');
  await expect(chat).toContainText('ждёт ответа поддержки');
  await expect(chat.getByTestId('chat-messages')).toContainText(question);
  const chatUrl = page.url();

  const ctx = await browser.newContext({ baseURL: info.project.use.baseURL!, locale: 'ru-RU' });
  const admin = await ctx.newPage();
  await adminLogin(admin, { id: supportAdminId(info), name: 'Администратор поддержки' });
  await admin.goto('/admin');
  await expect(admin.getByTestId('questions-count')).not.toHaveText('0');
  await admin.goto('/admin/support');
  const card = admin.getByTestId('support-question').filter({ hasText: question });
  await expect(card.getByTestId('chat-messages')).toContainText(question);
  await card.getByTestId('support-answer').fill('Откройте экран, в свойствах «Фон» нажмите «Фото или видео».');
  await card.getByTestId('support-send').click();
  await expect(admin.getByRole('status')).toContainText('Ответ отправлен');

  // Человек видит ответ в переписке и пишет дальше — вопрос снова ждёт поддержку.
  await page.goto(chatUrl);
  await expect(chat).toContainText('поддержка ответила');
  await expect(chat.locator('[data-author="SUPPORT"]')).toContainText('Откройте экран');
  await chat.getByLabel('Сообщение').fill('Спасибо, получилось! А можно ещё звук?');
  await chat.getByTestId('chat-send').click();
  await expect(chat.locator('[data-author="USER"]').last()).toContainText('А можно ещё звук?');
  await expect(chat).toContainText('ждёт ответа поддержки');
  await page.screenshot({ path: `e2e/__screenshots__/help-chat-${info.project.name}.png`, fullPage: true });

  // В списке на «Помощи» — отдельная строка со ссылкой на переписку.
  await page.goto('/help#ask');
  await expect(page.getByTestId('ask-open').filter({ hasText: question })).toContainText('сообщений: 3');

  await admin.goto('/admin/support');
  const again = admin.getByTestId('support-question').filter({ hasText: question });
  await expect(again.locator('[data-author]')).toHaveCount(3);
  await admin.screenshot({ path: `e2e/__screenshots__/admin-support-${info.project.name}.png`, fullPage: true });
  await ctx.close();
});
