import { mkdirSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { freshUser, loginAndOnboard } from './helpers/auth';
import { seedProject, textBlock } from './helpers/editor';
import { startSite } from './helpers/site-server';

/*
 * P10.7 · 05-LEGAL.md §2.2: Яндекс Метрика — только после согласия в баннере, только на главной, в справке и в кабинете;
 * на страницах плеера её нет никогда. Сеть перехватывается: любой запрос к mc.yandex.ru записывается.
 */
let site: { origin: string; stop: () => void };
const hits: string[] = [];

test.beforeAll(async () => {
  site = await startSite(9, { YANDEX_METRIKA_ID: '12345678' });
});
test.afterAll(() => site?.stop());

async function watch(page: Page) {
  hits.length = 0;
  await page.route(/^https:\/\/mc\.yandex\.(ru|com)\//, (route) => {
    hits.push(route.request().url());
    return route.fulfill({ status: 200, contentType: 'application/javascript', body: '' });
  });
}

test.describe('P10.7 · 05-LEGAL §2.2 · D8 · cookie-баннер и Метрика', () => {
  test('P10.7 · до согласия запросов к mc.yandex.ru нет; отказ запоминается и запросов по-прежнему нет', async ({ page }, info) => {
    await watch(page);
    await page.goto(`${site.origin}/`);
    await expect(page.getByTestId('cookie-banner')).toBeVisible();
    mkdirSync('e2e/__screenshots__', { recursive: true });
    await page.screenshot({ path: `e2e/__screenshots__/cookie-banner-${info.project.name}.png` });
    await page.waitForTimeout(1500);
    expect(hits).toEqual([]);
    // Two buttons of the same size: to refuse is as easy as to agree.
    const agree = await page.getByRole('button', { name: 'Согласен' }).boundingBox();
    const refuse = await page.getByRole('button', { name: 'Отказаться' }).boundingBox();
    expect(Math.abs(agree!.height - refuse!.height)).toBeLessThan(2);
    await page.getByRole('button', { name: 'Отказаться' }).click();
    await expect(page.getByTestId('cookie-banner')).toHaveCount(0);
    await page.goto(`${site.origin}/tariffs`);
    await page.waitForTimeout(1000);
    await expect(page.getByTestId('cookie-banner')).toHaveCount(0);
    expect(hits).toEqual([]);
  });

  test('P10.7 · после согласия счётчик загружается; отзыв согласия через «Настройки cookie» убирает его', async ({ page }) => {
    await watch(page);
    await page.goto(`${site.origin}/`);
    await page.getByRole('button', { name: 'Согласен' }).click();
    await expect.poll(() => hits.some((u) => u.includes('/metrika/tag.js'))).toBe(true);
    await page.goto(`${site.origin}/help`);
    await expect(page.getByTestId('cookie-banner')).toHaveCount(0);
    await page.getByRole('button', { name: 'Настройки cookie' }).click();
    await page.getByRole('button', { name: 'Отказаться' }).click();
    await page.waitForLoadState('load');
    hits.length = 0;
    await page.goto(`${site.origin}/help`);
    await page.waitForTimeout(1000);
    expect(hits).toEqual([]);
  });

  test('P10.7 · на страницах плеера Метрики нет никогда, даже при данном согласии, и политика страницы не пускает к её серверам', async ({ page }) => {
    test.setTimeout(120_000);
    await loginAndOnboard(page, freshUser('Автор'));
    const { id } = await seedProject(page, (d) => {
      d.screens[0]!.blocks.push(textBlock('zagolovok_1', 'Привет', 20, 40, 300, 60));
    });
    const origin = new URL(page.url()).origin;
    expect((await page.request.post(`/api/v1/projects/${id}/publish`, { data: {}, headers: { origin } })).ok()).toBe(true);
    const { slug } = (await (await page.request.get(`/api/v1/projects/${id}`)).json()) as { slug: string };

    await watch(page);
    await page.addInitScript(() => localStorage.setItem('bk:cookie-consent', JSON.stringify({ v: 1, analytics: 'granted' })));
    const player = await page.goto(`${site.origin}/s/${slug}`);
    expect(player?.headers()['content-security-policy']).not.toContain('mc.yandex.ru');
    await expect(page.getByTestId('cookie-banner')).toHaveCount(0);
    await page.waitForTimeout(1500);
    expect(hits).toEqual([]);
    // The same consent on the landing page does start the counter, and the landing page's policy lets its host in.
    const home = await page.goto(`${site.origin}/`);
    expect(home?.headers()['content-security-policy']).toContain('mc.yandex.ru');
    await expect.poll(() => hits.some((u) => u.includes('/metrika/tag.js'))).toBe(true);
  });

  test('P10.7 · без номера счётчика в настройках баннера нет и Метрика не подключается', async ({ page }) => {
    await watch(page);
    const res = await page.goto('/');
    expect(res?.headers()['content-security-policy']).not.toContain('mc.yandex.ru');
    await page.waitForTimeout(800);
    await expect(page.getByTestId('cookie-banner')).toHaveCount(0);
    expect(hits).toEqual([]);
  });
});
