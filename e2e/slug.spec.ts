import { mkdirSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import { freshUser, loginAndOnboard } from './helpers/auth';
import { nextButton, seedProject } from './helpers/editor';
import { subscribeOwner } from './helpers/plan';

const SHOTS = 'e2e/__screenshots__';

test.describe('P7.1 · свой адрес ссылки', () => {
  test('PL-01 · «Старт»: поле закрыто с пояснением; на платном тарифе адрес меняется, занятый и неверный отклоняются понятным текстом', async ({ page }, info) => {
    await loginAndOnboard(page, freshUser('Автор'));
    const { id } = await seedProject(page, (d) => {
      d.screens[0]!.blocks.push(nextButton('dalshe_1'));
    });
    await page.goto(`/cabinet/projects/${id}`);
    await page.getByRole('button', { name: 'Настройки доступа' }).click();
    const field = page.getByLabel('Адрес ссылки');
    await expect(field).toBeDisabled();
    await expect(page.getByText('Свой адрес недоступен на тарифе «Старт»')).toBeVisible();
    mkdirSync(SHOTS, { recursive: true });
    await field.scrollIntoViewIfNeeded();
    await page.screenshot({ path: `${SHOTS}/slug-start-${info.project.name}.png` });

    await subscribeOwner(id, 'AUTHOR');
    await page.reload();
    await page.getByRole('button', { name: 'Настройки доступа' }).click();
    await expect(field).toBeEnabled();
    const own = `konkurs-${id.slice(0, 5).toLowerCase().replace(/[^a-z0-9]/g, 'x')}`;
    await field.fill('ab');
    await page.getByRole('button', { name: 'Сменить адрес' }).click();
    await expect(page.getByRole('status')).toContainText('не короче 3 символов');
    await field.fill('admin');
    await page.getByRole('button', { name: 'Сменить адрес' }).click();
    await expect(page.getByRole('status')).toContainText('Этот адрес занят');
    await field.fill(own);
    await page.getByRole('button', { name: 'Сменить адрес' }).click();
    await expect(page.getByRole('status')).toContainText('Адрес сохранён');
    await field.scrollIntoViewIfNeeded();
    await page.screenshot({ path: `${SHOTS}/slug-author-${info.project.name}.png` });
    await page.reload();
    await page.getByRole('button', { name: 'Настройки доступа' }).click();
    await expect(field).toHaveValue(own);
  });
  test('PL-05 · «Старт»: поиск по сборке закрыт; «Про» включает галочку — страница сборки получает index, выключает — снова noindex', async ({ page, browser }, info) => {
    await loginAndOnboard(page, freshUser('Автор'));
    const { id } = await seedProject(page, (d) => {
      d.screens[0]!.blocks.push(nextButton('dalshe_1'));
    });
    const hdr = { 'X-Blokum-CSRF': '1', 'Content-Type': 'application/json' };
    expect((await page.request.post(`/api/v1/projects/${id}/publish`, { headers: hdr })).ok()).toBe(true);
    const { slug } = (await (await page.request.get(`/api/v1/projects/${id}`)).json()) as { slug: string };
    await page.goto(`/cabinet/projects/${id}`);
    await page.getByRole('button', { name: 'Настройки доступа' }).click();
    const box = page.getByLabel('Разрешить поиск по сборке');
    await expect(box).toBeDisabled();
    await expect(page.getByText('Доступно на тарифе «Про»')).toBeVisible();
    mkdirSync(SHOTS, { recursive: true });
    await box.scrollIntoViewIfNeeded();
    await page.screenshot({ path: `${SHOTS}/indexing-start-${info.project.name}.png` });

    await subscribeOwner(id, 'PRO');
    await page.reload();
    await page.getByRole('button', { name: 'Настройки доступа' }).click();
    await expect(box).toBeEnabled();
    await box.check();
    await expect.poll(async () => ((await (await page.request.get(`/api/v1/projects/${id}/access-settings`)).json()) as { allowIndexing?: boolean }).allowIndexing).toBe(true);
    await box.scrollIntoViewIfNeeded();
    await page.screenshot({ path: `${SHOTS}/indexing-pro-${info.project.name}.png` });

    const ctx = await browser.newContext({ baseURL: info.project.use.baseURL });
    const guest = await ctx.newPage();
    await guest.goto(`/s/${slug}`);
    expect(await guest.locator('meta[name="robots"]').first().getAttribute('content')).toContain('index');
    expect(await guest.locator('meta[name="robots"]').first().getAttribute('content')).not.toContain('noindex');
    await box.uncheck();
    await expect.poll(async () => ((await (await page.request.get(`/api/v1/projects/${id}/access-settings`)).json()) as { allowIndexing?: boolean }).allowIndexing).toBe(false);
    await guest.goto(`/s/${slug}`);
    expect(await guest.locator('meta[name="robots"]').first().getAttribute('content')).toContain('noindex');
    await ctx.close();
  });
});
