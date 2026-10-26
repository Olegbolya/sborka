import { mkdirSync } from 'node:fs';
import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import { freshUser, loginAndOnboard, loginViaEmulator } from './helpers/auth';

const SHOTS = 'e2e/__screenshots__';

test.describe('A-03, A-04, A-05, D-10 · Аккаунт работает через API', () => {
  test('D-10 · страница аккаунта показывает данные из API', async ({ page }, info) => {
    const user = freshUser('Зоя');
    await loginAndOnboard(page, user);
    await page.goto('/account');
    await expect(page.getByRole('heading', { level: 1 })).toContainText('аккаунт');
    await expect(page.getByLabel('Отображаемое имя')).toHaveValue(user.name);
    await expect(page.getByRole('list', { name: 'Активные сеансы' }).getByRole('listitem')).toHaveCount(1);
    const history = page.getByRole('list', { name: 'История согласий' });
    await expect(history.getByRole('listitem')).toHaveCount(2);
    await expect(history).toContainText('Пользовательское соглашение');
    await expect(history).toContainText('Согласие на обработку персональных данных');

    mkdirSync(SHOTS, { recursive: true });
    await page.screenshot({ path: `${SHOTS}/account-${info.project.name}.png`, fullPage: true });
  });

  test('D-10 · имя сохраняется на сервере и переживает перезагрузку', async ({ page }) => {
    await loginAndOnboard(page, freshUser('Тимур'));
    await page.goto('/account');
    await page.getByLabel('Отображаемое имя').fill('Тимур Новый');
    await page.getByRole('button', { name: 'Сохранить' }).click();
    await expect(page.getByRole('status')).toHaveText('Имя сохранено.');
    await page.reload();
    await expect(page.getByLabel('Отображаемое имя')).toHaveValue('Тимур Новый');
  });

  test('D-10 · пустое имя сервер отклоняет, ошибка видна по-русски', async ({ page }) => {
    await loginAndOnboard(page, freshUser('Глеб'));
    await page.goto('/account');
    await page.getByLabel('Отображаемое имя').fill('   ');
    await page.getByRole('button', { name: 'Сохранить' }).click();
    await expect(page.locator('main [role="alert"]')).toBeVisible();
    await expect(page.locator('main [role="alert"]')).not.toContainText(/error|bad request/i);
  });

  test('A-03 · поле email: письмо подтверждения запрашивается через API', async ({ page }) => {
    await loginAndOnboard(page, freshUser('Эмма'));
    await page.goto('/account');
    await expect(page.getByText(/только для уведомлений/)).toBeVisible();
    await page.getByLabel('Email для уведомлений').fill('emma@example.ru');
    await page.getByRole('button', { name: 'Подтвердить' }).click();
    await expect(page.getByRole('status')).toContainText('Письмо со ссылкой отправлено');
  });

  test('A-03 · неверный адрес почты отклоняется', async ({ page }) => {
    await loginAndOnboard(page, freshUser('Ева'));
    await page.goto('/account');
    await page.getByLabel('Email для уведомлений').fill('не-адрес');
    await page.getByRole('button', { name: 'Подтвердить' }).click();
    await expect(page.locator('main [role="alert"]')).toBeVisible();
  });

  test('A-04 · «Завершить» закрывает чужой сеанс, «Выйти везде» — все', async ({ page, browser }) => {
    const user = freshUser('Лев');
    await loginAndOnboard(page, user);

    // A second device signs in as the same person.
    const other = await browser.newContext();
    const otherPage = await other.newPage();
    await loginViaEmulator(otherPage, user);
    await expect(otherPage).toHaveURL(/\/cabinet\/projects/);

    await page.goto('/account');
    const sessions = page.getByRole('list', { name: 'Активные сеансы' }).getByRole('listitem');
    await expect(sessions).toHaveCount(2);
    await expect(sessions.filter({ hasText: 'этот сеанс' })).toHaveCount(1);

    // End the other device's session from here.
    await sessions.filter({ hasNotText: 'этот сеанс' }).getByRole('button', { name: 'Завершить' }).click();
    await expect(page.getByRole('status')).toHaveText('Сеанс завершён.');
    await expect(sessions).toHaveCount(1);
    expect((await otherPage.request.get('/api/v1/auth/me')).status()).toBe(401);

    // «Выйти везде» ends this one too and sends to the login page.
    await page.getByRole('button', { name: 'Выйти везде' }).click();
    await expect(page).toHaveURL(/\/login$/);
    expect((await page.request.get('/api/v1/auth/me')).status()).toBe(401);
    await page.goto('/account');
    await expect(page).toHaveURL(/\/login$/);
    await other.close();
  });

  test('A-04 · «Выйти» завершает только этот сеанс', async ({ page }) => {
    await loginAndOnboard(page, freshUser('Фёкла'));
    await page.goto('/account');
    await page.getByRole('button', { name: 'Выйти', exact: true }).click();
    await expect(page).toHaveURL(/\/login$/);
    expect((await page.request.get('/api/v1/auth/me')).status()).toBe(401);
  });

  test('D-10 · отзыв согласия на рекламу', async ({ page }) => {
    const user = freshUser('Пётр');
    await loginViaEmulator(page, user);
    await page.getByLabel('Принимаю').check();
    await page.getByLabel(/обработку персональных данных/).check();
    await page.getByLabel(/18 лет/).check();
    await page.getByLabel(/рекламных сообщений/).check();
    await page.getByRole('button', { name: 'Продолжить' }).click();
    await page.waitForURL(/\/cabinet\/projects/);

    await page.goto('/account');
    await page.getByRole('button', { name: 'Отозвать согласие на рекламу' }).click();
    await expect(page.getByRole('status')).toContainText('отозвано');
    await expect(page.getByRole('button', { name: 'Отозвать согласие на рекламу' })).toHaveCount(0);
    await expect(page.getByRole('list', { name: 'История согласий' })).toContainText('отозвано');
  });

  test('D-10 · «Выгрузить данные» скачивает файл JSON с профилем', async ({ page }) => {
    const user = freshUser('Дарья');
    await loginAndOnboard(page, user);
    await page.goto('/account');
    const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Выгрузить данные' }).click()]);
    expect(download.suggestedFilename()).toMatch(/\.json$/);
    const path = await download.path();
    const data = JSON.parse(readFileSync(path, 'utf8')) as { profile: { displayName: string }; consentHistory: unknown[] };
    expect(data.profile.displayName).toBe(user.name);
    expect(data.consentHistory.length).toBeGreaterThan(0);
  });

  test('A-05 · кнопка «Отмена» скрывает подтверждение, аккаунт остаётся', async ({ page }) => {
    await loginAndOnboard(page, freshUser('Кира'));
    await page.goto('/account');
    await page.getByRole('button', { name: 'Удалить аккаунт' }).click();
    await expect(page.getByText('Вы уверены?')).toBeVisible();
    await page.getByRole('button', { name: 'Отмена' }).click();
    await expect(page.getByText('Вы уверены?')).toHaveCount(0);
    expect((await (await page.request.get('/api/v1/auth/account')).json()).status).toBe('ACTIVE');
  });

  test('A-05 · удаление аккаунта и восстановление в течение 30 дней', async ({ page }) => {
    await loginAndOnboard(page, freshUser('Савва'));
    await page.goto('/account');
    await page.getByRole('button', { name: 'Удалить аккаунт' }).click();
    await page.getByRole('button', { name: 'Да, удалить' }).click();
    await expect(page.getByRole('status')).toHaveText('Аккаунт удалён.');
    await expect(page.getByText('Аккаунт удалён', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Удалить аккаунт' })).toHaveCount(0);
    expect((await (await page.request.get('/api/v1/auth/account')).json()).status).toBe('DELETED');

    await page.getByRole('button', { name: 'Восстановить аккаунт' }).click();
    await expect(page.getByRole('status')).toHaveText('Аккаунт восстановлен.');
    await expect(page.getByRole('button', { name: 'Удалить аккаунт' })).toBeVisible();
    expect((await (await page.request.get('/api/v1/auth/account')).json()).status).toBe('ACTIVE');
  });
});
