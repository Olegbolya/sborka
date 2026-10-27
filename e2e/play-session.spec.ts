import { expect, test, type Browser, type Page } from '@playwright/test';
import { freshUser, loginAndOnboard } from './helpers/auth';
import { nextButton, seedProject, textBlock } from './helpers/editor';

test.beforeEach(async ({ page }) => {
  await loginAndOnboard(page, freshUser('Автор'));
});

const origin = (page: Page) => new URL(page.url()).origin;
const post = (page: Page, url: string, data: unknown = {}) => page.request.post(`/api/v1${url}`, { data, headers: { origin: origin(page) } });

const choice = (id: string, texts: string[]) => ({
  id,
  type: 'singleChoice',
  name: 'Вопрос',
  frame: { x: 20, y: 200, w: 300, h: 60 * texts.length },
  props: { options: texts.map((_t, i) => ({ id: `${id}_o${i + 1}`, blockId: `${id}_v${i + 1}`, correct: i === 0, score: i === 0 ? 4 : 0 })) },
  children: texts.map((t, i) => ({ ...textBlock(`${id}_v${i + 1}`, t, 0, i * 60, 300, 50), type: 'shape' })),
});

const textField = (id: string) => ({ id, type: 'textInput', name: 'Имя', frame: { x: 20, y: 340, w: 300, h: 56 }, props: {} });

async function published(page: Page, shape: (d: { screens: Array<{ id: string; name: string; blocks: unknown[] }>; variables: unknown[]; settings: Record<string, unknown> }) => void = () => undefined) {
  const { id } = await seedProject(page, (d) => {
    d.variables.push({ id: 'ochki_var', name: 'очки', type: 'number', initial: 0, saveToAnswers: false });
    d.screens[0]!.blocks.push(
      { ...textBlock('schet_1', 'Очки', 20, 20, 300, 40), textLayer: { paragraphs: [{ kind: 'p', runs: [{ t: 'Очки: ' }, { v: 'ochki_var' }] }] } },
      { ...nextButton('plyus_1', 'Плюс', 70), rules: [{ id: 'plyus_pravilo', when: { kind: 'tap', source: { kind: 'block', blockId: 'plyus_1' } }, do: [{ kind: 'setVariable', variableId: 'ochki_var', op: 'add', value: 1 }] }] },
      choice('vopros_1', ['Да', 'Нет']),
      textField('imya_1'),
      nextButton('dalshe_1', 'Дальше', 420),
    );
    d.screens.push({ id: 'ekran_dva', name: 'Второй', blocks: [textBlock('vtoroj_t', 'Это второй экран', 20, 60, 300, 60), nextButton('konec_1', 'Закончить', 200)] });
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

type Detail = { status: string; score: number | null; resultKey: string | null; answers: Array<{ blockId: string | null; value: { kind: string; value?: string; optionIds?: string[] } }> };
const sessions = async (page: Page, id: string): Promise<Detail[]> => {
  const list = (await (await page.request.get(`/api/v1/projects/${id}/responses`)).json()) as { items: Array<{ id: string }> };
  return Promise.all(list.items.map(async (r) => (await (await page.request.get(`/api/v1/projects/${id}/responses/${r.id}`)).json()) as Detail));
};

test.describe('P5.3 · прохождение и ответы', () => {
  test('PL-11, PL-12 · сеть пропала посреди прохождения: ответы и переменные дошли после возврата сети, после перезагрузки — то же место и те же значения', async ({ page, browser }, info) => {
    const { id, slug } = await published(page);
    const { ctx, page: p } = await participant(browser, info.project.use.baseURL!);
    await p.goto(`/s/${slug}`);
    await expect(p.locator('.bk-player-screen[data-live="true"]')).toBeVisible();
    await p.getByRole('button', { name: 'Плюс' }).click();
    await p.getByRole('button', { name: 'Плюс' }).click();
    await expect(p.getByText('Очки: 2')).toBeVisible();

    await ctx.setOffline(true);
    await p.getByText('Да', { exact: true }).click();
    await p.getByRole('button', { name: 'Плюс' }).click();
    await expect(p.getByText('Очки: 3')).toBeVisible();
    await p.getByRole('button', { name: 'Дальше' }).click();
    await expect(p.getByText('Это второй экран')).toBeVisible();
    // Пока сети нет, на сервере ответа нет.
    expect((await sessions(page, id))[0]!.answers.filter((a) => a.blockId === 'vopros_1')).toHaveLength(0);

    await ctx.setOffline(false);
    await expect
      .poll(async () => (await sessions(page, id))[0]!.answers.find((a) => a.blockId === 'vopros_1')?.value.optionIds, { timeout: 30_000 })
      .toEqual(['vopros_1_o1']);

    await p.reload();
    await expect(p.getByText('Это второй экран')).toBeVisible();
    await p.getByRole('button', { name: '← Назад' }).click();
    await expect(p.getByText('Очки: 3')).toBeVisible();
    // Один человек — одно прохождение: перезагрузка не создала второго.
    expect(await sessions(page, id)).toHaveLength(1);
    await ctx.close();
  });

  test('TS-10, PL-13 · номер карты в текстовом ответе: участнику сообщение, на сервере ничего не сохраняется', async ({ page, browser }, info) => {
    const { id, slug } = await published(page);
    const { ctx, page: p } = await participant(browser, info.project.use.baseURL!);
    await p.goto(`/s/${slug}`);
    await expect(p.locator('.bk-player-screen[data-live="true"]')).toBeVisible();
    const field = p.locator('[data-block-id="imya_1"]').locator('input, textarea').first();
    await field.fill('4111 1111 1111 1111');
    await expect(p.getByTestId('play-message')).toContainText('Похоже на номер карты');
    await field.fill('Анна');
    await expect.poll(async () => (await sessions(page, id))[0]!.answers.find((a) => a.blockId === 'imya_1')?.value.value, { timeout: 15_000 }).toBe('Анна');
    const stored = JSON.stringify(await sessions(page, id));
    expect(stored).not.toContain('4111');
    await ctx.close();
  });

  test('PL-15 · итог считает сервер: после последнего экрана — результат и баллы в тексте экрана результата', async ({ page, browser }, info) => {
    const { id, slug } = await published(page, (d) => {
      d.screens.push({
        id: 'itog_ekran',
        name: 'Итог',
        kind: 'result',
        blocks: [{ ...textBlock('itog_t', 'Итог', 20, 60, 300, 60), textLayer: { paragraphs: [{ kind: 'p', runs: [{ t: 'Вы набрали ' }, { sys: 'баллы' }, { t: ' из ' }, { sys: 'максимум' }, { t: ', ' }, { sys: 'результат' }] }] } }],
      } as never);
      (d as unknown as { results: unknown[] }).results = [{ kind: 'scoreRange', id: 'rezultat_1', key: 'Отлично', screenId: 'itog_ekran', min: 4, max: 100 }];
    });
    const { ctx, page: p } = await participant(browser, info.project.use.baseURL!);
    await p.goto(`/s/${slug}`);
    await expect(p.locator('.bk-player-screen[data-live="true"]')).toBeVisible();
    await p.getByText('Да', { exact: true }).click();
    await p.getByRole('button', { name: 'Дальше' }).click();
    await p.getByRole('button', { name: 'Закончить' }).click();
    await expect(p.locator('[data-block-id="itog_t"]')).toContainText('Вы набрали 4 из 4, Отлично');
    await expect.poll(async () => (await sessions(page, id))[0]!.status, { timeout: 15_000 }).toBe('COMPLETED');
    const done = (await sessions(page, id))[0]!;
    expect(done).toMatchObject({ score: 4, resultKey: 'Отлично' });
    // В ответах сети, которые видел участник, ключа нет.
    await p.reload();
    await expect(p.locator('[data-block-id="itog_t"]')).toContainText('Отлично');
    expect(await sessions(page, id)).toHaveLength(1);
    await ctx.close();
  });

  test('L-03 · «сразу»: после ответа сервер присылает верно/неверно, а ответ уже нельзя поменять', async ({ page, browser }, info) => {
    const { id, slug } = await published(page, (d) => void (d.settings.feedbackMode = 'instant'));
    const { ctx, page: p } = await participant(browser, info.project.use.baseURL!);
    const seen: string[] = [];
    p.on('response', async (r) => {
      if (r.url().includes('/api/v1/play/')) seen.push(await r.text().catch(() => ''));
    });
    await p.goto(`/s/${slug}`);
    await expect(p.locator('.bk-player-screen[data-live="true"]')).toBeVisible();
    // До ответа ни в одном ответе сервера нет ключа.
    expect(seen.join('\n')).not.toMatch(/"correct"|"score"/);
    await p.getByText('Нет', { exact: true }).click();
    await expect.poll(() => seen.join('\n'), { timeout: 15_000 }).toContain('"correctOptionIds"');
    await p.getByText('Да', { exact: true }).click();
    await expect.poll(async () => (await sessions(page, id))[0]!.answers.find((a) => a.blockId === 'vopros_1')?.value.optionIds, { timeout: 15_000 }).toEqual(['vopros_1_o2']);
    await ctx.close();
  });
  test('RN-01 · колесо: исход заранее называет сервер, весов секторов в сетевых ответах нет', async ({ page, browser }, info) => {
    const { id, slug } = await published(page, (d) => {
      d.screens[0]!.blocks.push({
        id: 'koleso_1',
        type: 'container',
        name: 'Колесо',
        frame: { x: 20, y: 480, w: 200, h: 200 },
        props: {},
        behaviors: [{ kind: 'wheel', spinMs: 2000, sectors: [{ blockId: 'sektor_a', weight: 7 }, { blockId: 'sektor_b', weight: 3 }] }],
        children: [
          { ...textBlock('sektor_a', 'Приз А', 0, 0, 80, 40), type: 'shape' },
          { ...textBlock('sektor_b', 'Приз Б', 100, 0, 80, 40), type: 'shape' },
        ],
      });
    });
    const { ctx, page: p } = await participant(browser, info.project.use.baseURL!);
    const seen: string[] = [];
    p.on('response', async (r) => {
      if (r.url().includes('/api/v1/play/')) seen.push(await r.text().catch(() => ''));
    });
    await p.goto(`/s/${slug}`);
    await expect(p.locator('.bk-player-screen[data-live="true"]')).toBeVisible();
    await expect.poll(() => seen.join('\n'), { timeout: 15_000 }).toContain('"outcome"');
    expect(seen.join('\n')).not.toMatch(/"weight"/);
    expect(JSON.stringify(await sessions(page, id))).not.toContain('"weight"');
    await ctx.close();
  });
});
