import { mkdirSync } from 'node:fs';
import { expect, test, type Browser, type Page } from '@playwright/test';
import { freshUser, loginAndOnboard } from './helpers/auth';
import { nextButton, seedProject, textBlock } from './helpers/editor';

test.beforeEach(async ({ page }) => {
  await loginAndOnboard(page, freshUser('Автор'));
});

const origin = (page: Page) => new URL(page.url()).origin;
const post = (page: Page, url: string, data: unknown = {}) => page.request.post(`/api/v1${url}`, { data, headers: { origin: origin(page) } });
const patch = (page: Page, url: string, data: unknown) => page.request.patch(`/api/v1${url}`, { data, headers: { origin: origin(page) } });

const question = (id: string, texts: string[]) => ({
  id,
  type: 'singleChoice',
  name: 'Вопрос',
  frame: { x: 20, y: 120, w: 300, h: 60 * texts.length },
  props: { options: texts.map((_t, i) => ({ id: `${id}_o${i + 1}`, blockId: `${id}_v${i + 1}`, correct: i === 0, score: i === 0 ? 7 : 0, resultTags: i === 0 ? ['секретная_метка'] : [] })) },
  children: texts.map((t, i) => ({ ...textBlock(`${id}_v${i + 1}`, t, 0, i * 60, 300, 50), type: 'shape' })),
});

/** A published project with a question that has a key; the participant is a browser with no cookies at all. */
async function published(page: Page, shape: (d: { screens: Array<{ id: string; name: string; blocks: unknown[] }>; meta: Record<string, unknown> }) => void = () => undefined) {
  const { id } = await seedProject(page, (d) => {
    d.screens[0]!.blocks.push(textBlock('privet_1', 'Привет, участник', 20, 40, 300, 60), question('vopros_1', ['Да, верно', 'Нет, неверно']), nextButton('knopka_1', 'Дальше', 330));
    d.screens.push({ id: 'ekran_dva', name: 'Второй', blocks: [textBlock('vtoroj_t', 'Это второй экран', 20, 60, 300, 60), nextButton('knopka_2', 'Закончить', 200)] });
    (d.meta as Record<string, unknown>).description = 'Короткая викторина для проверки';
    shape(d as never);
  });
  expect((await post(page, `/projects/${id}/publish`)).ok()).toBe(true);
  const { slug } = (await (await page.request.get(`/api/v1/projects/${id}`)).json()) as { slug: string };
  return { id, slug };
}

const participant = async (browser: Browser, baseURL: string) => {
  const ctx = await browser.newContext({ baseURL, locale: 'ru-RU' });
  return { ctx, page: await ctx.newPage() };
};

test.describe('P5.1 · плеер: адреса, первый экран на сервере, превью', () => {
  test('PL-03 · первый экран приходит с сервера готовой разметкой, дальше — без перезагрузки; без входа в аккаунт', async ({ page, browser }, info) => {
    const { slug } = await published(page);
    const base = info.project.use.baseURL!;
    const html = await (await page.request.get(`${base}/s/${slug}`, { headers: { cookie: '' } })).text();
    expect(html).toContain('Привет, участник');
    expect(html).toContain('Да, верно');

    const { ctx, page: p } = await participant(browser, base);
    await p.goto(`/s/${slug}`);
    await expect(p.locator('.bk-player-screen[data-live="true"]')).toBeVisible();
    await expect(p.getByText('Привет, участник')).toBeVisible();
    mkdirSync('e2e/__screenshots__', { recursive: true });
    await p.screenshot({ path: `e2e/__screenshots__/play-${info.project.name}.png` });
    let reloaded = false;
    p.on('framenavigated', () => (reloaded = true));
    reloaded = false;
    await p.getByText('Да, верно', { exact: true }).click();
    await p.getByRole('button', { name: 'Дальше' }).click();
    await expect(p.getByText('Это второй экран')).toBeVisible();
    await expect(p.getByRole('button', { name: '← Назад' })).toBeVisible();
    await p.getByRole('button', { name: 'Закончить' }).click();
    await expect(p.getByTestId('play-end')).toBeVisible();
    expect(reloaded).toBe(false);
    await ctx.close();
  });

  test('PL-15 · ни в разметке, ни в ответах API нет ключа ответов, баллов и меток', async ({ page, browser }, info) => {
    const { slug } = await published(page);
    const base = info.project.use.baseURL!;
    const { ctx, page: p } = await participant(browser, base);
    const bodies: string[] = [];
    p.on('response', async (r) => {
      if (r.url().includes('/api/')) bodies.push(await r.text().catch(() => ''));
    });
    const response = await p.goto(`/s/${slug}`);
    const html = await response!.text();
    await expect(p.locator('.bk-player-screen[data-live="true"]')).toBeVisible();
    const direct = await (await p.request.get(`${base}/api/v1/play/${slug}`)).text();
    for (const text of [html, direct, ...bodies]) {
      for (const secret of ['"correct"', '"score"', 'resultTags', 'секретная_метка']) expect(text).not.toContain(secret);
    }
    expect(direct).toContain('"state":"ok"');
    await ctx.close();
  });

  test('PL-04, PL-05 · мета-теги превью для мессенджеров и запрет индексации по умолчанию', async ({ page, browser }, info) => {
    const { slug } = await published(page);
    const { ctx, page: p } = await participant(browser, info.project.use.baseURL!);
    await p.goto(`/s/${slug}`);
    const meta = (sel: string) => p.locator(sel).first().getAttribute('content');
    expect(await meta('meta[property="og:title"]')).toBe('Сборка для проверки');
    expect(await meta('meta[property="og:description"]')).toBe('Короткая викторина для проверки');
    expect(await meta('meta[property="og:type"]')).toBe('website');
    expect(await meta('meta[property="og:url"]')).toBe(`${info.project.use.baseURL}/s/${slug}`);
    expect(await meta('meta[name="description"]')).toBe('Короткая викторина для проверки');
    expect(await meta('meta[name="robots"]')).toContain('noindex');
    expect(await p.title()).toBe('Сборка для проверки');
    await ctx.close();
  });

  test('PL-04 · своя картинка превью: og:image — абсолютный адрес файла, который раздаётся без входа', async ({ page, browser }, info) => {
    const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
    const up = await page.request.post('/api/v1/media', { headers: { origin: origin(page) }, multipart: { file: { name: 'a.png', mimeType: 'image/png', buffer: PNG } } });
    const media = (await up.json()) as { id: string };
    const { slug } = await published(page, (d) => void (d.meta.ogImage = { source: 'media', id: media.id }));
    const base = info.project.use.baseURL!;
    const { ctx, page: p } = await participant(browser, base);
    await p.goto(`/s/${slug}`);
    const image = await p.locator('meta[property="og:image"]').first().getAttribute('content');
    expect(image).toBe(`${base}/api/v1/play/${slug}/media/${media.id}`);
    const file = await p.request.get(image!);
    expect(file.status()).toBe(200);
    expect(file.headers()['content-type']).toBe('image/png');
    await ctx.close();
  });

  test('PL-01 · неопубликованное и несуществующее — «Недоступно» с кодом 404', async ({ page, browser }, info) => {
    const draft = await seedProject(page);
    const slug = ((await (await page.request.get(`/api/v1/projects/${draft.id}`)).json()) as { slug: string }).slug;
    const { ctx, page: p } = await participant(browser, info.project.use.baseURL!);
    for (const path of [`/s/${slug}`, '/s/netakogo', '/q/netakogo']) {
      const res = await p.goto(path);
      expect(res!.status(), path).toBe(404);
      await expect(p.getByTestId('play-unavailable')).toContainText('Недоступно');
      expect(await p.locator('meta[name="robots"]').first().getAttribute('content')).toContain('noindex');
    }
    await ctx.close();
  });

  test('§10.3 · расписание: до начала «Откроется …», после конца — текст создателя, в оформлении темы', async ({ page, browser }, info) => {
    const { id, slug } = await published(page);
    const { ctx, page: p } = await participant(browser, info.project.use.baseURL!);
    await patch(page, `/projects/${id}/access-settings`, { scheduledOpenAt: new Date(Date.now() + 86_400_000).toISOString() });
    await p.goto(`/s/${slug}`);
    await expect(p.getByTestId('play-state')).toContainText('Откроется');
    expect(await p.locator('.bk-player-screen').count()).toBe(0);
    await patch(page, `/projects/${id}/access-settings`, { scheduledOpenAt: null, scheduledCloseAt: new Date(Date.now() - 1000).toISOString(), closedText: 'Приём ответов окончен' });
    await p.reload();
    await expect(p.getByTestId('play-state')).toContainText('Приём ответов окончен');
    const color = await p.getByTestId('play-state').evaluate((n) => getComputedStyle(n).color);
    expect(color).toBe('rgb(29, 27, 24)');
    await ctx.close();
  });

  test('PL-02 · адрес QR-кода ведёт на сборку с меткой источника', async ({ page, browser }, info) => {
    const { id, slug } = await published(page);
    const points = (await (await page.request.get(`/api/v1/projects/${id}/access-points`)).json()) as Array<{ code: string }>;
    const { ctx, page: p } = await participant(browser, info.project.use.baseURL!);
    await p.goto(`/q/${points[0]!.code}`);
    await expect(p).toHaveURL(new RegExp(`/s/${slug}\\?p=${points[0]!.code}$`));
    await expect(p.getByText('Привет, участник')).toBeVisible();
    await ctx.close();
  });

  test('L-08 · публикация с ошибками проверки отклоняется, в редакторе сообщение по-русски и путь к проверке', async ({ page }) => {
    const { id } = await seedProject(page, (d) => {
      d.screens[0]!.blocks.push({ ...textBlock('privet_1', 'Один', 20, 40, 300, 60) });
      d.screens.push({ id: 'ekran_dva', name: 'Потерянный', blocks: [] });
      (d.screens[0]!.blocks[0] as { rules?: unknown[] }).rules = [{ id: 'pravilo_1', when: { kind: 'tap', source: { kind: 'block', blockId: 'privet_1' } }, do: [{ kind: 'goTo', to: 'screen', screenId: 'ekran_net' }] }];
    });
    await page.goto(`/app/projects/${id}/edit`);
    await page.getByRole('button', { name: 'Опубликовать' }).click();
    const alert = page.locator('.ed-banner[role="alert"]');
    await expect(alert).toContainText('нельзя опубликовать');
    await expect(alert).toContainText('«Логика» → «Проверка»');
  });
});
