import { devices, expect, test } from '@playwright/test';
import { freshUser, loginAndOnboard } from './helpers/auth';
import { openEditor, seedProject, textBlock } from './helpers/editor';

test.skip(({ viewport }) => (viewport?.width ?? 0) < 1000, 'предпросмотр в редакторе на компьютере сравнивается с настоящим телефоном');

test('E-02 · PL-16 · предпросмотр «Телефон 390×844» выглядит как сборка на телефоне того же размера: те же пропорции и то же растяжение низкого экрана', async ({ page, browser }, info) => {
  await loginAndOnboard(page, freshUser('Пропорции'));
  const { id } = await seedProject(page, (d) => {
    (d.screens[0] as { height?: number }).height = 700;
    d.screens[0]!.blocks.push(textBlock('verh_tekst', 'Сверху', 20, 20, 350, 48), textBlock('niz_tekst', 'Внизу', 20, 620, 350, 48));
  });
  expect((await page.request.post(`/api/v1/projects/${id}/publish`, { data: {}, headers: { origin: new URL(page.url()).origin } })).ok()).toBe(true);
  const { slug } = (await (await page.request.get(`/api/v1/projects/${id}`)).json()) as { slug: string };

  await openEditor(page, id);
  await page.getByRole('button', { name: 'Предпросмотр' }).click();
  const frame = page.locator('[data-preview="true"][data-frame="phone"]');
  await expect(frame.locator('[data-block-id="niz_tekst"]')).toBeVisible();
  const inPreview = await frame.evaluate((f) => {
    const inner = (f.firstElementChild as HTMLElement).getBoundingClientRect();
    const b = f.querySelector('[data-block-id="niz_tekst"]')!.getBoundingClientRect();
    return { top: (b.top - inner.top) / inner.height, width: b.width / inner.width, aspect: inner.height / inner.width };
  });
  await page.screenshot({ path: `e2e/__screenshots__/preview-phone-${info.project.name}.png` });

  const phone = await browser.newContext({ ...devices['Desktop Chrome'], viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, baseURL: info.project.use.baseURL!, locale: 'ru-RU' });
  const p = await phone.newPage();
  await p.goto(`/s/${slug}`);
  await expect(p.locator('.bk-player-screen[data-live="true"] [data-block-id="niz_tekst"]')).toBeVisible();
  const onPhone = await p.evaluate(() => {
    const b = document.querySelector('.bk-player-screen [data-block-id="niz_tekst"]')!.getBoundingClientRect();
    return { top: b.top / window.innerHeight, width: b.width / window.innerWidth, aspect: window.innerHeight / window.innerWidth };
  });
  await phone.close();
  // Рамка — телефон 390×844, а не обрезанный по высоте прямоугольник; низкий экран (700) растянут до окна так же, как на телефоне.
  expect(inPreview.aspect).toBeCloseTo(onPhone.aspect, 2);
  expect(Math.abs(inPreview.top - onPhone.top)).toBeLessThan(0.01);
  expect(Math.abs(inPreview.width - onPhone.width)).toBeLessThan(0.01);
});
