import { mkdirSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import { freshUser, loginAndOnboard, loginViaEmulator } from './helpers/auth';

const SHOTS = 'e2e/__screenshots__';

test.describe('A-02 · Онбординг: согласия сохраняются на сервере', () => {
  test('A-02 · кнопка «Продолжить» недоступна без обязательных чекбоксов', async ({ page }, info) => {
    await loginViaEmulator(page, freshUser('Олег'));

    const btn = page.getByRole('button', { name: 'Продолжить' });
    await expect(btn).toBeDisabled();

    await page.getByLabel('Принимаю').check();
    await expect(btn).toBeDisabled();

    await page.getByLabel(/обработку персональных данных/).check();
    await expect(btn).toBeDisabled();

    await page.getByLabel(/18 лет/).check();
    await expect(btn).toBeEnabled();

    mkdirSync(SHOTS, { recursive: true });
    await page.screenshot({ path: `${SHOTS}/onboarding-enabled-${info.project.name}.png`, fullPage: true });

    // Taking back a required consent locks the button again.
    await page.getByLabel(/обработку персональных данных/).uncheck();
    await expect(btn).toBeDisabled();
  });

  test('A-02 · необязательное согласие на рекламу само по себе кнопку не открывает', async ({ page }) => {
    await loginViaEmulator(page, freshUser('Мария'));
    const btn = page.getByRole('button', { name: 'Продолжить' });
    await page.getByLabel(/рекламных сообщений/).check();
    await expect(btn).toBeDisabled();
  });

  test('A-02 · «Продолжить» сохраняет согласия: повторный вход онбординг не показывает', async ({ page, context }) => {
    const user = freshUser('Павел');
    await loginViaEmulator(page, user);
    await page.getByLabel('Принимаю').check();
    await page.getByLabel(/обработку персональных данных/).check();
    await page.getByLabel(/18 лет/).check();
    await page.getByRole('button', { name: 'Продолжить' }).click();
    await expect(page).toHaveURL(/\/cabinet\/projects/);

    // Server side: nothing is pending any more.
    const st = await page.request.get('/api/v1/auth/onboarding');
    expect((await st.json()).completed).toBe(true);

    // Sign in again as the same person in a clean browser: straight to the cabinet.
    await context.clearCookies();
    await loginViaEmulator(page, user);
    await expect(page).toHaveURL(/\/cabinet\/projects/);
  });

  test('A-02 · согласие на рекламу записывается отдельно и видно в истории согласий', async ({ page }) => {
    await loginViaEmulator(page, freshUser('Нина'));
    await page.getByLabel('Принимаю').check();
    await page.getByLabel(/обработку персональных данных/).check();
    await page.getByLabel(/18 лет/).check();
    await page.getByLabel(/рекламных сообщений/).check();
    await page.getByRole('button', { name: 'Продолжить' }).click();
    await expect(page).toHaveURL(/\/cabinet\/projects/);

    const consents = (await (await page.request.get('/api/v1/auth/account/consents')).json()) as Array<{ kind: string; documentType: string | null }>;
    expect(consents.map((c) => c.documentType).sort()).toEqual(['MARKETING', 'PD_CONSENT_USER', 'TOS']);
    expect(consents.some((c) => c.kind === 'marketing_consent')).toBe(true);
  });

  test('A-02 · без согласий бэкенд тоже не пускает дальше (кнопку не обойти запросом)', async ({ page }) => {
    await loginViaEmulator(page, freshUser('Игорь'));
    const res = await page.request.post('/api/v1/auth/onboarding/consent', {
      data: { documentIds: [], ageConfirmed: false },
      headers: { origin: new URL(page.url()).origin },
    });
    expect(res.status()).toBe(400);
    const st = await page.request.get('/api/v1/auth/onboarding');
    expect((await st.json()).completed).toBe(false);
  });

  test('A-02 · страница онбординга на русском, ссылки на документы работают', async ({ page }) => {
    await loginViaEmulator(page, freshUser('Лидия'));
    await expect(page.getByRole('heading', { level: 1 })).toContainText('Перед началом');
    const [doc] = await Promise.all([
      page.context().waitForEvent('page'),
      page.getByRole('link', { name: 'Пользовательское соглашение' }).click(),
    ]);
    await doc.waitForLoadState();
    await expect(doc).toHaveURL(/\/legal\/terms$/);
    await expect(doc.getByRole('heading', { level: 1 })).toBeVisible();
  });
});

test('A-02 · после согласий кабинет доступен', async ({ page }) => {
  await loginAndOnboard(page, freshUser('Роман'));
  await expect(page).toHaveURL(/\/cabinet\/projects/);
});
