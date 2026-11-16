import { mkdirSync } from 'node:fs';
import { expect, test, type Browser, type Page } from '@playwright/test';
import { freshUser, loginAndOnboard } from './helpers/auth';
import { nextButton, seedProject, textBlock } from './helpers/editor';

/*
 * B-24, PL-24, PL-25, PL-26, D-12 · лимит выборов варианта: на экране участника «Занято», ответ на занятое место сервер не берёт,
 * создатель видит, кто занял, и освобождает место.
 */
const SHOTS = 'e2e/__screenshots__';

const choice = (id: string, texts: string[], limits: Array<number | undefined>) => ({
  id,
  type: 'singleChoice',
  name: 'Вопрос',
  frame: { x: 20, y: 120, w: 300, h: 60 * texts.length },
  props: { required: true, options: texts.map((_t, i) => ({ id: `${id}_o${i + 1}`, blockId: `${id}_v${i + 1}`, correct: false, score: 0, resultTags: [], ...(limits[i] ? { limit: limits[i], showRemaining: true } : {}) })) },
  children: texts.map((t, i) => ({ ...textBlock(`${id}_v${i + 1}`, t, 0, i * 60, 300, 50), type: 'shape' })),
});

const participant = async (browser: Browser, baseURL: string) => {
  const ctx = await browser.newContext({ baseURL, locale: 'ru-RU' });
  return { ctx, page: await ctx.newPage() };
};

async function published(page: Page): Promise<{ id: string; slug: string }> {
  const origin = new URL(page.url()).origin;
  const { id } = await seedProject(page, (d) => {
    d.screens[0]!.blocks.push(textBlock('zagolovok_1', 'Что вы принесёте', 20, 20, 300, 40), choice('vopros_1', ['Оливье', 'Селёдка'], [1, undefined]), nextButton('dalshe_1', 'Дальше', 300));
    d.screens.push({ id: 'ekran_dva', name: 'Второй', blocks: [textBlock('spasibo_1', 'Спасибо, записали', 20, 60, 300, 60)] });
  });
  expect((await page.request.post(`/api/v1/projects/${id}/publish`, { data: {}, headers: { origin } })).ok()).toBe(true);
  const { slug } = (await (await page.request.get(`/api/v1/projects/${id}`)).json()) as { slug: string };
  return { id, slug };
}

test.describe('QT · лимит выборов варианта', () => {
  test('PL-25, PL-24, D-12, PL-26 · второй участник видит «Занято» и не может занять место; создатель освобождает его', async ({ page, browser }, info) => {
    test.setTimeout(120_000);
    await loginAndOnboard(page, freshUser('Автор'));
    const { id, slug } = await published(page);

    // Первый участник занимает «Оливье» — последнее место.
    const first = await participant(browser, info.project.use.baseURL!);
    await first.page.goto(`/s/${slug}`);
    await expect(first.page.locator('.bk-player-screen[data-live="true"]')).toBeVisible();
    await expect(first.page.getByTestId('option-left').first()).toBeVisible();
    await first.page.getByText('Оливье', { exact: true }).click();
    await first.page.getByRole('button', { name: 'Дальше' }).click();
    await expect(first.page.getByText('Спасибо, записали')).toBeVisible();

    // Второй участник: у «Оливье» подпись «Занято», вариант не выбирается, «Селёдка» выбирается.
    const second = await participant(browser, info.project.use.baseURL!);
    await second.page.goto(`/s/${slug}`);
    await expect(second.page.locator('.bk-player-screen[data-live="true"]')).toBeVisible();
    await expect(second.page.getByTestId('option-taken')).toHaveText('Занято');
    await second.page.getByText('Оливье', { exact: true }).click();
    await second.page.getByRole('button', { name: 'Дальше' }).click();
    await expect(second.page.getByText('Спасибо, записали')).toHaveCount(0);
    mkdirSync(SHOTS, { recursive: true });
    await second.page.screenshot({ path: `${SHOTS}/choice-limit-player-${info.project.name}.png`, fullPage: true });

    // Создатель видит, кто занял место, и освобождает его.
    await page.goto(`/cabinet/projects/${id}?tab=analytics`);
    await expect(page.getByTestId('choice-limits')).toBeVisible();
    await expect(page.getByTestId('choice-limit-vopros_1_o1')).toContainText('занято 1 из 1');
    await page.screenshot({ path: `${SHOTS}/choice-limit-cabinet-${info.project.name}.png`, fullPage: true });
    await page.locator('[data-testid^="choice-release-"]').first().click();
    await expect(page.getByTestId('choice-limit-vopros_1_o1')).toContainText('занято 0 из 1');

    // Освобождённое место снова доступно.
    await second.page.reload();
    await expect(second.page.locator('.bk-player-screen[data-live="true"]')).toBeVisible();
    await expect(second.page.getByTestId('option-taken')).toHaveCount(0);
    await first.ctx.close();
    await second.ctx.close();
  });
});
