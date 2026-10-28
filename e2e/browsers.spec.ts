import { expect, test, type Browser, type Page } from '@playwright/test';
import { freshUser, loginAndOnboard } from './helpers/auth';
import { nextButton, seedProject, textBlock } from './helpers/editor';

/*
 * P5.5 · PL-20: эталонный сквозной проход участника без кабинета идёт в каждом браузере проекта Playwright (Chromium, Firefox,
 * WebKit): сборка с вопросом, переменной, переходом и текстом открывается по ссылке, проходится, ответы доходят до сервера.
 */
const origin = (page: Page) => new URL(page.url()).origin;
const post = (page: Page, url: string, data: unknown = {}) => page.request.post(`/api/v1${url}`, { data, headers: { origin: origin(page) } });

const visitor = async (browser: Browser, baseURL: string) => {
  const ctx = await browser.newContext({ baseURL, locale: 'ru-RU' });
  return { ctx, page: await ctx.newPage() };
};

test('PL-20: участник открывает ссылку, играет с очками и переходами, вводит имя и доходит до конца — в этом браузере без ошибок', async ({ page, browser, browserName }, info) => {
  await loginAndOnboard(page, freshUser('Автор'));
  const { id } = await seedProject(page, (d) => {
    d.variables.push({ id: 'ochki_var', name: 'очки', type: 'number', initial: 0, saveToAnswers: true });
    d.screens[0]!.blocks.push(
      { ...textBlock('schet_1', 'Очки', 20, 20, 300, 40), textLayer: { paragraphs: [{ kind: 'p', runs: [{ t: 'Очки: ' }, { v: 'ochki_var' }] }] } },
      { ...nextButton('plyus_1', 'Плюс', 80), rules: [{ id: 'plyus_pravilo', when: { kind: 'tap', source: { kind: 'block', blockId: 'plyus_1' } }, do: [{ kind: 'setVariable', variableId: 'ochki_var', op: 'add', value: 1 }] }] },
      { id: 'imya_pole', type: 'textInput', name: 'Имя', frame: { x: 20, y: 160, w: 300, h: 60 }, props: {} },
      nextButton('dalshe_1', 'Дальше', 300),
    );
    d.screens.push({ id: 'ekran_dva', name: 'Второй', blocks: [textBlock('vtoroj_t', 'Спасибо за игру', 20, 60, 300, 60)] });
  });
  expect((await post(page, `/projects/${id}/publish`)).ok()).toBe(true);
  const { slug } = (await (await page.request.get(`/api/v1/projects/${id}`)).json()) as { slug: string };

  const v = await visitor(browser, info.project.use.baseURL!);
  const errors: string[] = [];
  v.page.on('pageerror', (e) => errors.push(e.message));
  await v.page.goto(`/s/${slug}`);
  await expect(v.page.locator('.bk-player-screen[data-live="true"]')).toBeVisible();
  const field = v.page.getByRole('textbox', { name: 'Имя' });
  // Страница сделана на сервере: введённое до того, как React взял поле под контроль, пропало бы — ждём.
  await expect.poll(() => field.evaluate((el) => Object.keys(el).some((k) => k.startsWith('__reactProps')))).toBe(true);
  await v.page.getByRole('button', { name: 'Плюс' }).click();
  await v.page.getByRole('button', { name: 'Плюс' }).click();
  await expect(v.page.getByText('Очки: 2')).toBeVisible();
  await field.fill('Анна');
  await expect(field).toHaveValue('Анна');
  await v.page.getByRole('button', { name: 'Дальше' }).click();
  await expect(v.page.getByText('Спасибо за игру')).toBeVisible();
  expect(errors, `ошибки страницы в ${browserName}`).toEqual([]);

  const list = (await (await page.request.get(`/api/v1/projects/${id}/responses`)).json()) as { items: Array<{ id: string }> };
  expect(list.items).toHaveLength(1);
  const detail = (await (await page.request.get(`/api/v1/projects/${id}/responses/${list.items[0]!.id}`)).json()) as { answers: Array<{ blockId: string | null; variableId: string | null; value: unknown }> };
  const byKey = Object.fromEntries(detail.answers.map((a) => [a.blockId ?? a.variableId, a.value]));
  expect(byKey['imya_pole']).toMatchObject({ value: 'Анна' });
  await v.ctx.close();
});
