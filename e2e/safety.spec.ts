import { expect, test } from '@playwright/test';
import { adminLogin, freshUser, loginAndOnboard } from './helpers/auth';

/** The administrator of this browser project for the dictionaries (scripts/e2e-api.sh). */
const safetyAdminId = (info: { project: { name: string } }): string => (info.project.name.startsWith('mobile') ? '700000000036' : '700000000035');

test.describe('P9.1 · словари проверки', () => {
  test('TS-04 · администратор добавляет стоп-слово с весом и запрещённый сайт, меняет вес, выключает и удаляет', async ({ page }, info) => {
    await adminLogin(page, { id: safetyAdminId(info), name: 'Администратор словарей' });
    await page.goto('/admin/safety');
    await expect(page.getByRole('heading', { name: 'Словари проверки' })).toBeVisible();
    const word = `тестслов${Math.floor(Math.random() * 90000 + 10000)}`;
    const add = page.getByTestId('safety-add');
    await add.getByTestId('safety-term').fill(word);
    await add.getByTestId('safety-submit').click();
    const row = page.getByTestId(`term-${word}`);
    await expect(row).toContainText('случай для модератора');
    await row.getByLabel(`Вес слова ${word}`).fill('95');
    await row.getByRole('button', { name: 'Сохранить' }).click();
    await expect(row).toContainText('останавливает публикацию');
    await row.getByRole('button', { name: 'Выключить' }).click();
    await expect(row).toContainText('Выключено');
    // сайт из стоп-листа
    await add.getByTestId('safety-kind').selectOption('DOMAIN');
    const site = `plohoi-${Math.floor(Math.random() * 90000 + 10000)}.example`;
    await add.getByTestId('safety-term').fill(`https://www.${site}/page`);
    await add.getByTestId('safety-submit').click();
    await expect(page.getByTestId(`term-${site}`)).toBeVisible();
    await page.getByTestId(`term-${site}`).getByRole('button', { name: 'Удалить' }).click();
    await expect(page.getByTestId(`term-${site}`)).toHaveCount(0);
    await row.getByRole('button', { name: 'Удалить' }).click();
    await expect(row).toHaveCount(0);
  });

  test('TS-04 · обычный пользователь не видит словари', async ({ page }) => {
    await loginAndOnboard(page, freshUser('Не админ'));
    expect((await page.request.get('/api/v1/admin/safety-terms')).status()).toBe(403);
  });
});
