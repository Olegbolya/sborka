import { mkdirSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import { freshUser, loginAndOnboard, loginViaEmulator } from './helpers/auth';

/* A-06 · «Способы входа» в аккаунте: привязать Яндекс ID к аккаунту ВК; если у Яндекс ID уже свой аккаунт — объединить (ADR-117). */
const SHOTS = 'e2e/__screenshots__';

test.describe('A-06 · способы входа', () => {
  test('A-06 · у Яндекс ID свой аккаунт со сборкой: привязка из аккаунта ВК предлагает объединить, после — сборка здесь, вход через Яндекс — сюда же', async ({ page }, info) => {
    mkdirSync(SHOTS, { recursive: true });
    const yandex = freshUser('Яндекс');
    await loginAndOnboard(page, yandex, 'yandex');
    const origin = new URL(page.url()).origin;
    const title = `Сборка из Яндекса ${yandex.id.slice(-4)}`;
    expect((await page.request.post('/api/v1/projects', { data: { title }, headers: { origin } })).ok()).toBe(true);
    await page.context().clearCookies();

    const vk = freshUser('ВК');
    await loginAndOnboard(page, vk, 'vk');
    await page.goto('/account');
    const methods = page.getByTestId('login-methods');
    await expect(methods.getByTestId('login-method-vk')).toBeVisible();
    await methods.getByTestId('link-yandex').click();
    await expect(page.getByRole('heading', { name: /Dev-эмулятор: Яндекс ID/ })).toBeVisible();
    await page.getByLabel('ID пользователя').fill(yandex.id);
    await page.getByLabel('Имя').fill(yandex.name);
    await page.getByRole('button', { name: 'Войти через Яндекс ID' }).click();

    const offer = page.getByTestId('merge-offer');
    await expect(offer).toContainText(`«${yandex.name}»`);
    await expect(offer).toContainText('в нём 1 сборка');
    await expect(page).toHaveURL(/\/account$/);
    await page.screenshot({ path: `${SHOTS}/login-methods-merge-${info.project.name}.png`, fullPage: true });
    await offer.getByTestId('merge-confirm').click();
    await expect(methods.getByRole('status')).toContainText('Аккаунты объединены');
    await expect(methods.getByTestId('login-method-yandex')).toBeVisible();
    await page.screenshot({ path: `${SHOTS}/login-methods-merged-${info.project.name}.png`, fullPage: true });

    await page.getByTestId('cabinet-nav-projects').click();
    await expect(page.getByText(title, { exact: true })).toBeVisible();

    // Вход через Яндекс ID теперь ведёт в этот же аккаунт; согласия в нём уже приняты, страница согласий сама переводит в кабинет.
    await page.context().clearCookies();
    await loginViaEmulator(page, yandex, 'yandex');
    await page.waitForURL(/\/cabinet\/projects/);
    await expect(page.getByText(title, { exact: true })).toBeVisible();
    await page.goto('/account');
    await expect(page.getByTestId('login-method-vk')).toBeVisible();
    await expect(page.getByTestId('login-method-yandex')).toBeVisible();
  });

  test('A-06 · свободный Яндекс ID привязывается сразу, лишний способ входа отвязывается', async ({ page }) => {
    await loginAndOnboard(page, freshUser('Привязка'), 'vk');
    await page.goto('/account');
    const methods = page.getByTestId('login-methods');
    await methods.getByTestId('link-yandex').click();
    const free = freshUser('Свободный');
    await page.getByLabel('ID пользователя').fill(free.id);
    await page.getByLabel('Имя').fill(free.name);
    await page.getByRole('button', { name: 'Войти через Яндекс ID' }).click();
    await expect(methods.getByRole('status')).toHaveText('Яндекс ID привязан: теперь входить можно и через него.');
    await expect(methods.getByTestId('link-yandex')).toHaveCount(0);
    await methods.getByTestId('login-method-yandex').getByRole('button', { name: 'Отвязать' }).click();
    await expect(methods.getByRole('status')).toHaveText('Яндекс ID отвязан.');
    await expect(methods.getByTestId('login-method-yandex')).toHaveCount(0);
    await expect(methods.getByTestId('login-method-vk').getByRole('button', { name: 'Отвязать' })).toHaveCount(0);
  });
});
