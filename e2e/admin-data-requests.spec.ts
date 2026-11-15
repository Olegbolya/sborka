import { mkdirSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import { adminIds, adminLogin } from './helpers/auth';

/* P8.5 · карточка запроса о данных в админке: поиск человека по контакту. Совпадения проверяет API-тест, здесь — интерфейс. */
test.describe('P8.5 · запросы о данных в админке', () => {
  test('P8.5 · кнопка поиска показывает, что по контакту никого не найдено', async ({ page }, info) => {
    const ids = adminIds(info);
    const contact = `nikto-${Date.now()}@example.ru`;
    await adminLogin(page, { id: ids.a, name: 'Администратор А' });
    const sent = await page.request.post('/api/v1/legal/requests/data', {
      data: { kind: 'ACCESS', contact, details: 'Какие данные обо мне у вас хранятся', consent: true },
      headers: { origin: new URL(page.url()).origin },
    });
    expect(sent.status()).toBe(201);
    await page.goto('/admin/legal');
    const card = page.getByTestId('data-request').filter({ hasText: contact });
    await card.getByRole('button', { name: 'Найти человека по контакту' }).click();
    await expect(card).toContainText('По этому контакту никого не найдено');
    mkdirSync('e2e/__screenshots__', { recursive: true });
    await card.scrollIntoViewIfNeeded();
    await page.screenshot({ path: `e2e/__screenshots__/admin-data-request-${info.project.name}.png` });
  });
});
