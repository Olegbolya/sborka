import { mkdirSync } from 'node:fs';
import { expect, test, type Browser, type Page } from '@playwright/test';
import { freshUser, loginAndOnboard } from './helpers/auth';
import { nextButton, seedProject, textBlock } from './helpers/editor';
import { subscribeOwner } from './helpers/plan';

/*
 * D-13…D-19 · табло: страница /b/{код} для большого экрана, места и итоги, управление из кабинета, {{место}} в конце прохождения.
 */
const SHOTS = 'e2e/__screenshots__';

const choice = (id: string, texts: string[], scores: number[]) => ({
  id,
  type: 'singleChoice',
  name: 'Вопрос',
  frame: { x: 20, y: 120, w: 300, h: 60 * texts.length },
  props: { required: true, options: texts.map((_t, i) => ({ id: `${id}_o${i + 1}`, blockId: `${id}_v${i + 1}`, correct: i === 0, score: scores[i]!, resultTags: [] })) },
  children: texts.map((t, i) => ({ ...textBlock(`${id}_v${i + 1}`, t, 0, i * 60, 300, 50), type: 'shape' })),
});

const participant = async (browser: Browser, baseURL: string) => {
  const ctx = await browser.newContext({ baseURL, locale: 'ru-RU' });
  return { ctx, page: await ctx.newPage() };
};

async function published(page: Page): Promise<{ id: string; slug: string }> {
  const origin = new URL(page.url()).origin;
  const { id } = await seedProject(page, (d) => {
    d.screens[0]!.blocks.push(
      textBlock('zagolovok_1', 'Корпоратив', 20, 20, 300, 40),
      choice('vopros_1', ['Верно', 'Неверно'], [5, 1]),
      { id: 'imya_1', type: 'textInput', name: 'Имя для табло', frame: { x: 20, y: 260, w: 300, h: 56 }, props: {} },
      { id: 'soglasie_1', type: 'consent', name: 'Показывать моё имя на табло', frame: { x: 20, y: 330, w: 300, h: 48 }, props: {} },
      nextButton('dalshe_1', 'Дальше', 420),
    );
    d.screens.push({ id: 'ekran_dva', name: 'Второй', blocks: [textBlock('vtoroj_t', 'Почти всё', 20, 60, 300, 60), nextButton('konec_1', 'Закончить', 200)] });
    d.screens.push({
      id: 'itog_ekran',
      name: 'Итог',
      kind: 'result',
      blocks: [{ ...textBlock('itog_t', 'Итог', 20, 60, 300, 60), textLayer: { paragraphs: [{ kind: 'p', runs: [{ t: 'Ваше место: ' }, { sys: 'место' }, { t: ' из ' }, { sys: 'всего_участников' }] }] } }],
    } as never);
    (d as unknown as { results: unknown[] }).results = [{ kind: 'scoreRange', id: 'rezultat_1', key: 'Итог', screenId: 'itog_ekran', min: 0, max: 100 }];
  }, 'Корпоратив');
  await subscribeOwner(id, 'PRO');
  expect((await page.request.post(`/api/v1/projects/${id}/publish`, { data: {}, headers: { origin } })).ok()).toBe(true);
  expect((await page.request.patch(`/api/v1/projects/${id}/access-settings`, { data: { ageRating: 0 }, headers: { origin } })).ok()).toBe(true);
  const { slug } = (await (await page.request.get(`/api/v1/projects/${id}`)).json()) as { slug: string };
  return { id, slug };
}

/** The whole passage through the screen: answer, name, consent, to the end; returns the text of the result screen. */
async function play(p: Page, slug: string, o: { answer: string; name: string }): Promise<string> {
  await p.goto(`/s/${slug}`);
  await expect(p.locator('.bk-player-screen[data-live="true"]')).toBeVisible();
  await p.getByText(o.answer, { exact: true }).click();
  await p.locator('[data-block-id="imya_1"]').locator('input, textarea').first().fill(o.name);
  await p.locator('[data-block-id="soglasie_1"]').locator('input[type="checkbox"]').check();
  await p.getByRole('button', { name: 'Дальше' }).click();
  await p.getByRole('button', { name: 'Закончить' }).click();
  await expect(p.locator('[data-block-id="itog_t"]')).toContainText('Ваше место:');
  return (await p.locator('[data-block-id="itog_t"]').innerText()).replace(/\s+/g, ' ');
}

test.describe('D-13…D-19 · табло', () => {
  test('D-13 · D-15 · D-16 · D-17 · D-18 · D-19 · табло: включение, новое прохождение на экране за 6 секунд, место в конце, заморозка и скрытие из кабинета', async ({ page, browser }, info) => {
    test.setTimeout(180_000);
    await loginAndOnboard(page, freshUser('Автор'));
    const { id, slug } = await published(page);
    const origin = new URL(page.url()).origin;

    // Создатель включает табло в кабинете, как человек.
    await page.goto(`/cabinet/projects/${id}?tab=board`);
    await expect(page.getByTestId('board-tab')).toBeVisible();
    await page.getByTestId('board-enabled').check();
    await page.getByTestId('board-nick').selectOption('imya_1');
    await page.getByTestId('board-consent').selectOption('soglasie_1');
    await page.getByTestId('board-save').click();
    await expect(page.getByTestId('board-saved')).toBeVisible();
    await expect(page.getByTestId('board-qr')).toBeVisible();
    const link = (await page.getByTestId('board-link').innerText()).trim();
    expect(link).toMatch(/\/b\/[a-z0-9]{10}$/);
    mkdirSync(SHOTS, { recursive: true });
    await page.screenshot({ path: `${SHOTS}/board-cabinet-${info.project.name}.png`, fullPage: true });

    // Табло на большом экране: пока пусто.
    const screen = await participant(browser, info.project.use.baseURL!);
    await screen.page.goto(new URL(link).pathname);
    await expect(screen.page.getByTestId('board-title')).toHaveText('Корпоратив');
    await expect(screen.page.getByTestId('board-empty')).toBeVisible();
    await expect(screen.page.locator('meta[name="robots"]')).toHaveAttribute('content', /noindex/);

    // Первый участник заканчивает — строка появляется не позже чем через 6 секунд; в конце он видит своё место.
    const first = await participant(browser, info.project.use.baseURL!);
    const text1 = await play(first.page, slug, { answer: 'Верно', name: 'Аня' });
    expect(text1).toContain('Ваше место: 1 из 1');
    const t0 = Date.now();
    await expect(screen.page.getByTestId('board-row')).toHaveCount(1, { timeout: 6000 });
    expect(Date.now() - t0).toBeLessThan(6500);
    await expect(screen.page.getByTestId('board-row').first()).toContainText('Аня');

    // Второй — с меньшим счётом; место 2 из 2 совпадает с позицией на табло.
    const second = await participant(browser, info.project.use.baseURL!);
    const text2 = await play(second.page, slug, { answer: 'Неверно', name: 'Боря' });
    expect(text2).toContain('Ваше место: 2 из 2');
    await expect(screen.page.getByTestId('board-row')).toHaveCount(2, { timeout: 6000 });
    await expect(screen.page.getByTestId('board-row').nth(0)).toContainText('Аня');
    await expect(screen.page.getByTestId('board-row').nth(1)).toContainText('Боря');
    await expect(screen.page.getByTestId('board-total')).toHaveText('2');
    await screen.page.screenshot({ path: `${SHOTS}/board-screen-${info.project.name}.png`, fullPage: true });

    // Кнопка «Открыть табло» на финале участника.
    await expect(first.page.getByTestId('play-board')).toHaveAttribute('href', new URL(link).pathname);

    // Управление: подвести итоги и скрыть строку.
    await page.reload();
    await page.getByTestId('board-hide-Боря').click();
    await expect(screen.page.getByTestId('board-row')).toHaveCount(1, { timeout: 7000 });
    await page.getByTestId('board-freeze').click();
    await expect(screen.page.getByTestId('board-frozen')).toBeVisible({ timeout: 7000 });
    await screen.page.screenshot({ path: `${SHOTS}/board-frozen-${info.project.name}.png`, fullPage: true });
    // Ответов и ключа на табло нет: страница показывает только итоги.
    const api = (await (await page.request.get(`${origin}/api/v1/board/${link.split('/').pop()}`)).text());
    expect(api).not.toContain('optionIds');
    await first.ctx.close();
    await second.ctx.close();
    await screen.ctx.close();
  });

  test('D-16 · табло выключено или адрес чужой — «Табло не найдено»', async ({ page }) => {
    await page.goto('/b/aaaaaaaaaa');
    await expect(page.getByTestId('board-missing')).toBeVisible();
  });
});
