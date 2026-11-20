import { mkdirSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { freshUser, loginAndOnboard } from './helpers/auth';
import { nextButton, seedProject, textBlock } from './helpers/editor';

test.beforeEach(async ({ page }) => {
  await loginAndOnboard(page, freshUser('Автор'));
});

const origin = (page: Page) => new URL(page.url()).origin;
const transition = (kind: string, durationMs: number) => ({ kind, direction: 'left', durationMs, delayMs: 0, easing: { kind: 'preset', name: 'linear' }, blur: 0, scale: 1 });

test('T-01 · T-30 · у участника экраны сменяются выбранным переходом; «Мгновенно» — сразу', async ({ page, browser }, info) => {
  const { id } = await seedProject(page, (d) => {
    d.screens[0]!.blocks.push(textBlock('tekst_odin', 'Первый экран'), nextButton('dalshe_odin'));
    d.screens.push(
      { id: 'ekran_dva', name: 'Второй', blocks: [textBlock('tekst_dva', 'Второй экран'), nextButton('dalshe_dva')], transitionIn: transition('slide', 1500) } as never,
      { id: 'ekran_tri', name: 'Третий', blocks: [textBlock('tekst_tri', 'Третий экран')], transitionIn: transition('none', 400) } as never,
    );
  });
  expect((await page.request.post(`/api/v1/projects/${id}/publish`, { data: {}, headers: { origin: origin(page) } })).ok()).toBe(true);
  const { slug } = (await (await page.request.get(`/api/v1/projects/${id}`)).json()) as { slug: string };
  const ctx = await browser.newContext({ baseURL: info.project.use.baseURL!, locale: 'ru-RU' });
  const p = await ctx.newPage();
  await p.goto(`/s/${slug}`);
  await expect(p.locator('.bk-player-screen[data-live="true"]')).toBeVisible();

  await p.getByRole('button', { name: 'Дальше', exact: true }).click();
  // Сдвиг идёт 1,5 с: уходящий экран ещё виден рядом с приходящим, и приходящий уже живой.
  await expect(p.locator('.bk-screen-in[data-transition="slide"]')).toBeVisible();
  await expect(p.locator('.bk-screen-out')).toBeVisible();
  await expect(p.locator('.bk-screen-out')).toContainText('Первый экран');
  mkdirSync('e2e/__screenshots__', { recursive: true });
  await p.screenshot({ path: `e2e/__screenshots__/screen-transition-${info.project.name}.png` });
  await expect(p.locator('.bk-screen-out')).toHaveCount(0, { timeout: 5_000 });
  await expect(p.locator('.bk-player-screen[data-live="true"]')).toContainText('Второй экран');

  await p.getByRole('button', { name: 'Дальше', exact: true }).click();
  await expect(p.locator('.bk-player-screen[data-live="true"]')).toContainText('Третий экран');
  await expect(p.locator('.bk-screen-in')).toHaveAttribute('data-transition', 'none');
  await expect(p.locator('.bk-screen-out')).toHaveCount(0);
  await ctx.close();
});
