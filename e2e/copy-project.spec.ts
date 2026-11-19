import { mkdirSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import { freshUser, loginAndOnboard, loginViaEmulator } from './helpers/auth';
import { nextButton, seedProject, textBlock } from './helpers/editor';
import { subscribeOwner } from './helpers/plan';

test.describe('ADR-120 · «Скопировать себе»', () => {
  test('ADR-120 · автор на «Авторе» включает копирование в настройках сборки, человек без аккаунта жмёт «Скопировать себе», входит и получает копию в редакторе', async ({ page, browser }, info) => {
    test.setTimeout(120_000);
    await loginAndOnboard(page, freshUser('Автор ролика'));
    const { id } = await seedProject(
      page,
      (d) => {
        d.screens[0]!.blocks.push(textBlock('zagolovok_1', 'Угадай мелодию за три ноты', 20, 40, 330, 60), nextButton('dalshe_1', 'Дальше', 200));
        d.screens.push({ id: 'ekran_dva', name: 'Итог', blocks: [textBlock('itog_t', 'Ты угадал!', 20, 60, 300, 60)] });
      },
      'Угадай мелодию',
    );
    const origin = new URL(page.url()).origin;
    expect((await page.request.post(`/api/v1/projects/${id}/publish`, { headers: { origin } })).ok()).toBe(true);
    const { slug } = (await (await page.request.get(`/api/v1/projects/${id}`)).json()) as { slug: string };

    // On «Старт» the switch is locked; on «Автор» it opens; it is off until the author turns it on.
    await page.goto(`/cabinet/projects/${id}?tab=settings`);
    const card = page.getByTestId('copy-card');
    await expect(card.getByLabel('Разрешить копировать сборку')).toBeDisabled();
    await expect(card).toContainText('Доступно на тарифах «Автор», «Плюс» и «Про».');
    await subscribeOwner(id, 'AUTHOR');
    await page.reload();
    const box = page.getByTestId('copy-card').getByLabel('Разрешить копировать сборку');
    await expect(box).toBeEnabled();
    await expect(box).not.toBeChecked();
    mkdirSync('test-results/screens', { recursive: true });
    await page.screenshot({ path: `test-results/screens/copy-setting-${info.project.name}.png`, fullPage: false });
    await box.check();
    await expect.poll(async () => ((await (await page.request.get(`/api/v1/projects/${id}/access-settings`)).json()) as { allowCopy?: boolean }).allowCopy).toBe(true);

    // A person without an account opens the published project.
    const ctx = await browser.newContext({ baseURL: info.project.use.baseURL, locale: 'ru-RU', viewport: page.viewportSize() ?? undefined, isMobile: info.project.name.includes('mobile'), hasTouch: info.project.name.includes('mobile') });
    const guest = await ctx.newPage();
    await guest.goto(`/s/${slug}`);
    await expect(guest.getByText('Угадай мелодию за три ноты')).toBeVisible();
    const copy = guest.getByTestId('play-copy');
    await expect(copy).toHaveText('Скопировать себе');
    await guest.screenshot({ path: `test-results/screens/copy-player-${info.project.name}.png` });
    const [tab] = await Promise.all([ctx.waitForEvent('page'), copy.click()]);
    await tab.waitForURL(/\/login/);
    const copier = freshUser('Зритель ролика');
    await loginViaEmulator(tab, copier);
    if (tab.url().includes('/onboarding')) {
      await tab.getByLabel('Принимаю').check();
      await tab.getByLabel(/обработку персональных данных/).check();
      await tab.getByLabel(/18 лет/).check();
      await tab.getByRole('button', { name: 'Продолжить' }).click();
    }
    // Back to the copy page after the sign-in, then straight into the editor with the copy.
    await tab.waitForURL(/\/app\/projects\/[^/]+\/edit/, { timeout: 30_000 });
    const copyId = tab.url().split('/').at(-2)!;
    expect(copyId).not.toBe(id);
    const made = (await (await tab.request.get(`/api/v1/projects/${copyId}`)).json()) as { title: string; status: string; document: { screens: Array<{ name: string }> } };
    expect(made).toMatchObject({ title: 'Угадай мелодию', status: 'DRAFT' });
    expect(made.document.screens.map((s) => s.name)).toEqual([expect.any(String), 'Итог']);
    await expect(tab.getByTestId('stage')).toContainText('Угадай мелодию за три ноты');
    await ctx.close();
  });
});
