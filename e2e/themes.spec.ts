import { mkdirSync } from 'node:fs';
import { expect, test, type Locator, type Page } from '@playwright/test';
import { freshUser, loginAndOnboard } from './helpers/auth';
import { box, hit, openEditor, seedProject, serverDraft } from './helpers/editor';

test.beforeEach(async ({ page }) => {
  await loginAndOnboard(page, freshUser('Автор'));
});

const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAMAAABEpIrGAAAAD1BMVEX07+bouSMeWqAiKDHIMh6IFIXGAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAAIUlEQVQ4y2NggQMmOGAEAwYIGFUw4hVAZJjBYFTBiFIAAPdfCQGLP2b1AAAAAElFTkSuQmCC',
  'base64',
);

type Theme = { id: string; name: string; isDefault: boolean; tokens: { colors: Record<string, string>; blockDefaults: Record<string, Record<string, unknown>>; transitions: Array<{ id: string; name: string }> } };

const origin = (page: Page) => new URL(page.url()).origin;
const getTheme = async (page: Page, id: string): Promise<Theme> => (await (await page.request.get(`/api/v1/themes/${id}`)).json()) as Theme;
const putTheme = async (page: Page, id: string, body: unknown) => expect((await page.request.put(`/api/v1/themes/${id}`, { data: body, headers: { origin: origin(page) } })).ok()).toBe(true);

/** A group of the left panel of the theme editor, opened. */
const section = async (page: Page, id: string): Promise<Locator> => {
  const s = page.locator(`[data-section="${id}"]`);
  await s.scrollIntoViewIfNeeded();
  if ((await s.getAttribute('open')) === null) await s.locator('summary').first().click();
  return s;
};

const themeFromPicture = async (page: Page, name = 'Тема из картинки'): Promise<string> => {
  await page.goto('/app/themes');
  await page.getByLabel('Название новой темы').fill(name);
  await page.getByLabel('Картинка для темы').setInputFiles({ name: 'foto.png', mimeType: 'image/png', buffer: PNG });
  await page.waitForURL(/\/app\/themes\/[^/]+\/edit/);
  await expect(page.getByTestId('theme-editor')).toBeVisible();
  return page.url().split('/').at(-2)!;
};

type DraftTheme = { themeId?: string; tokens: Theme['tokens'] };
const draftTheme = async (page: Page, id: string): Promise<DraftTheme> => ((await serverDraft(page, id)).doc as unknown as { theme: DraftTheme }).theme;

const savedStatus = (page: Page) => page.getByTestId('theme-save-status');

test.describe('P3.10 · темы', () => {
  test('TH-02, TH-06 · тема из картинки → правка цветов и стиля кнопки → применение к сборке → ручные правки не затёрты', async ({ page }) => {
    const themeId = await themeFromPicture(page);
    await expect(page.getByLabel('Название темы')).toHaveValue('Тема из картинки');
    // 5–8 цветов картинки стали своими цветами темы.
    const swatches = page.locator('[data-color^="foto_"]');
    expect(await swatches.count()).toBeGreaterThanOrEqual(5);
    expect(await swatches.count()).toBeLessThanOrEqual(8);
    await expect(page.getByTestId('contrast-summary')).toContainText('Контраст в норме');

    // Цвет основной; стиль кнопок по умолчанию — скругление 24.
    await page.getByLabel('Основной: HEX').fill('#00AA00');
    const defaults = await section(page, 'block-defaults');
    await defaults.getByLabel('Вид блока').selectOption('button');
    const radius = await section(page, 'default-radius');
    await radius.getByLabel('Левый верхний угол', { exact: true }).fill('24');
    await expect(radius.getByTestId('own-default-radius')).toBeVisible();
    await expect(savedStatus(page)).toHaveText('Сохранено');
    await expect.poll(async () => (await getTheme(page, themeId)).tokens.colors.primary, { timeout: 15_000 }).toBe('#00AA00');
    await expect.poll(async () => JSON.stringify((await getTheme(page, themeId)).tokens.blockDefaults.button ?? {}), { timeout: 15_000 }).toContain('"tl":24');

    // Сборка с двумя кнопками: у одной своё скругление, у другой нет.
    const own4 = { unit: 'u', tl: 4, tr: 4, br: 4, bl: 4 };
    const { id } = await seedProject(page, (d) => {
      d.screens[0]!.blocks.push(
        { ...box('knopka_svoya', 'Своя кнопка', 20, 40, 160, 56), type: 'button', style: { radius: own4 } },
        { ...box('knopka_ordinarnaya', 'Обычная кнопка', 20, 120, 160, 56), type: 'button' },
      );
    });
    await openEditor(page, id);
    await page.getByRole('button', { name: 'Тема', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Тема сборки' });
    await dialog.getByRole('button', { name: 'Применить тему: Тема из картинки' }).click();
    await expect(dialog).toHaveCount(0);
    await expect.poll(async () => JSON.stringify(await draftTheme(page, id)), { timeout: 15_000 }).toContain(themeId);
    const doc = (await serverDraft(page, id)).doc as unknown as { theme: DraftTheme; screens: Array<{ blocks: Array<{ id: string; style: { radius?: { tl: number } } }> }> };
    expect(doc.theme.tokens.colors.primary).toBe('#00AA00');
    const [own, plain] = doc.screens[0]!.blocks;
    expect(own!.style.radius?.tl).toBe(4);
    expect(plain!.style.radius).toBeUndefined();

    // В предпросмотре: у обычной кнопки скругление из темы, у своей — своё.
    await page.getByRole('button', { name: 'Предпросмотр' }).click();
    const frame = page.getByRole('dialog', { name: 'Предпросмотр' }).locator('[data-preview="true"]');
    await frame.locator('.bk-player-screen[data-live="true"]').waitFor();
    const radiusOf = (blockId: string) => frame.locator(`[data-block-id="${blockId}"] .bk-surface`).evaluate((n) => (n as HTMLElement).style.borderRadius);
    expect(await radiusOf('knopka_ordinarnaya')).toContain('calc(24 * var(--u))');
    expect(await radiusOf('knopka_svoya')).toContain('calc(4 * var(--u))');
  });

  test('TH-03 · правка темы доходит до черновика при открытии, ручные правки на месте; сервер не переписывает документы сам', async ({ page }) => {
    const created = await page.request.post('/api/v1/themes', { data: { name: 'Общая' }, headers: { origin: origin(await (async () => { await page.goto('/app/themes'); return page; })()) } });
    expect(created.ok()).toBe(true);
    const theme = (await created.json()) as Theme;
    const { id } = await seedProject(page, (d) => void d.screens[0]!.blocks.push({ ...box('figura_svoya', 'Своя фигура', 20, 40, 100, 60), style: { effects: { opacity: 0.5 } } }));
    await openEditor(page, id);
    await page.getByRole('button', { name: 'Тема', exact: true }).click();
    await page.getByRole('dialog', { name: 'Тема сборки' }).getByRole('button', { name: 'Применить тему: Общая' }).click();
    await expect.poll(async () => JSON.stringify(await draftTheme(page, id)), { timeout: 15_000 }).toContain(theme.id);

    await putTheme(page, theme.id, { tokens: { ...theme.tokens, colors: { ...theme.tokens.colors, primary: '#0000FF' } } });
    // Документ на сервере не тронут правкой темы…
    expect((await draftTheme(page, id)).tokens.colors.primary).not.toBe('#0000FF');
    // …а при открытии редактора черновик берёт новые цвета, и ручная правка фигуры остаётся.
    await openEditor(page, id);
    await expect(page.getByText(/изменилась — оформление сборки обновлено/)).toBeVisible();
    await expect
      .poll(async () => (await draftTheme(page, id)).tokens.colors.primary, { timeout: 15_000 })
      .toBe('#0000FF');
    const block = (await serverDraft(page, id)).doc.screens[0]!.blocks[0] as { style: { effects: { opacity: number } } };
    expect(block.style.effects.opacity).toBe(0.5);
  });

  test('TH-02 · проверка контраста: слабый текст помечен предупреждением, тему всё равно можно сохранить', async ({ page }) => {
    await themeFromPicture(page, 'Слабая');
    await page.getByLabel('Фон: HEX').fill('#FFFFFF');
    await page.getByLabel('Поверхность: HEX').fill('#FFFFFF');
    await page.getByLabel('Текст: HEX').fill('#EEEEEE');
    const summary = page.getByTestId('contrast-summary');
    await expect(summary).toContainText('Плохо читается');
    await expect(page.locator('[data-contrast="text-background"]')).toHaveAttribute('data-ok', 'false');
    await expect(savedStatus(page)).toHaveText('Сохранено');
    await page.getByLabel('Текст: HEX').fill('#111111');
    await page.getByLabel('Приглушённый: HEX').fill('#555555');
    await page.getByLabel('Основной: HEX').fill('#0A3D91');
    await page.getByLabel('Акцент: HEX').fill('#0A3D91');
    await page.getByLabel('Успех: HEX').fill('#0B5E1F');
    await page.getByLabel('Ошибка: HEX').fill('#8B1030');
    await expect(summary).toContainText('Контраст в норме');
  });

  test('TH-01 · свои цвета: добавить, неверное имя отклоняется, убрать; роли убрать нельзя', async ({ page }) => {
    const themeId = await themeFromPicture(page, 'Палитра');
    await page.getByLabel('Имя нового цвета').fill('плохое имя');
    await page.getByRole('button', { name: 'Добавить цвет' }).click();
    await expect(page.getByRole('alert').filter({ hasText: 'латиница' })).toBeVisible();
    await page.getByLabel('Имя нового цвета').fill('hero_1');
    await page.getByRole('button', { name: 'Добавить цвет' }).click();
    await expect(page.locator('[data-color="hero_1"]')).toBeVisible();
    await expect.poll(async () => (await getTheme(page, themeId)).tokens.colors.hero_1, { timeout: 15_000 }).toBe('#888888');
    await page.getByRole('button', { name: 'Убрать цвет «hero_1»' }).click();
    await expect.poll(async () => (await getTheme(page, themeId)).tokens.colors.hero_1, { timeout: 15_000 }).toBeUndefined();
    await expect(page.getByRole('button', { name: /Убрать цвет «(Фон|Текст)»/ })).toHaveCount(0);
  });

  test('TH-03 · «Мои темы»: создать, копия, по умолчанию (новая сборка начинается с неё), удалить; лимит тарифа по-русски', async ({ page }) => {
    await page.goto('/app/themes');
    await expect(page.getByTestId('themes-empty')).toBeVisible();
    await expect(page.getByTestId('system-themes-empty')).toBeVisible();
    await page.getByLabel('Название новой темы').fill('Первая');
    await page.getByRole('button', { name: 'Новая тема' }).click();
    await page.waitForURL(/\/edit/);
    await page.getByRole('button', { name: 'Сделать темой по умолчанию' }).click();
    await expect(page.getByRole('button', { name: 'Тема по умолчанию ✓' })).toBeVisible();
    await page.getByRole('link', { name: '← Мои темы' }).click();
    const first = page.locator('[data-testid="my-themes"] li').first();
    await expect(first).toContainText('по умолчанию');
    // Новая сборка берёт тему по умолчанию.
    const project = (await (await page.request.post('/api/v1/projects', { data: { title: 'Новая' }, headers: { origin: origin(page) } })).json()) as { document: { theme: { themeId?: string } } };
    expect(project.document.theme.themeId).toBe(await first.getAttribute('data-theme-id'));
    // Копия — вторая тема; третья упирается в лимит «Старта».
    await page.getByRole('button', { name: 'Сделать копию: Первая' }).click();
    await expect(page.locator('[data-testid="my-themes"] li')).toHaveCount(2);
    await page.getByLabel('Название новой темы').fill('Третья');
    await page.getByRole('button', { name: 'Новая тема' }).click();
    await expect(page.locator('main [role=alert]')).toContainText('до 2 своих тем');
    page.once('dialog', (d) => void d.accept());
    await page.getByRole('button', { name: 'Удалить: Первая (копия)' }).click();
    await expect(page.locator('[data-testid="my-themes"] li')).toHaveCount(1);
  });

  test('T-32 · свой переход в теме выбирается на экране сборки «Из темы»', async ({ page }) => {
    const themeId = await themeFromPicture(page, 'С переходами');
    const transitions = await section(page, 'theme-transitions');
    await transitions.getByRole('button', { name: 'Добавить' }).click();
    await transitions.getByLabel('Название перехода').fill('Мягкий');
    await transitions.getByLabel('Вид перехода').selectOption('zoom');
    await expect.poll(async () => JSON.stringify((await getTheme(page, themeId)).tokens.transitions), { timeout: 15_000 }).toContain('"zoom"');
    const presetId = (await getTheme(page, themeId)).tokens.transitions[0]!.id;
    const { id } = await seedProject(page);
    await openEditor(page, id);
    await page.getByRole('button', { name: 'Тема', exact: true }).click();
    await page.getByRole('dialog', { name: 'Тема сборки' }).getByRole('button', { name: 'Применить тему: С переходами' }).click();
    await expect.poll(async () => JSON.stringify(await draftTheme(page, id)), { timeout: 15_000 }).toContain(presetId);
    const panel = page.getByTestId('screen-panel');
    const sec = panel.locator('[data-section="screen-transition"]');
    await sec.locator('summary').click();
    await sec.getByLabel('Переход', { exact: true }).selectOption('preset');
    await sec.getByLabel('Переход из темы').selectOption({ label: 'Мягкий' });
    await expect.poll(async () => JSON.stringify((await serverDraft(page, id)).doc.screens[0]), { timeout: 15_000 }).toContain(`"presetId":"${presetId}"`);
  });

  test('TH-02 · «Сохранить оформление как тему» берёт цвета сборки', async ({ page }) => {
    const { id } = await seedProject(page);
    await openEditor(page, id);
    await page.getByRole('button', { name: 'Тема', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Тема сборки' });
    await dialog.getByLabel('Название темы').fill('Из сборки');
    await dialog.getByRole('button', { name: 'Сохранить как тему' }).click();
    await expect(dialog.getByRole('list', { name: 'Мои темы' })).toContainText('Из сборки');
    await expect(dialog.getByTestId('theme-current')).toContainText('Из сборки');
    const list = (await (await page.request.get('/api/v1/themes?scope=mine')).json()) as Array<{ name: string }>;
    expect(list.map((t) => t.name)).toEqual(['Из сборки']);
  });

  test('TH-02 · вид редактора темы с образцовым экраном (снимки)', async ({ page }, info) => {
    mkdirSync('e2e/__screenshots__', { recursive: true });
    await themeFromPicture(page, 'Снимок');
    await expect(page.getByTestId('theme-sample').locator('[data-block-id]').first()).toBeVisible();
    await expect(page.locator('[data-block-id]').filter({ hasText: 'Заголовок и обычный текст темы' })).toBeVisible();
    await section(page, 'colors');
    await page.screenshot({ path: `e2e/__screenshots__/themes-editor-${info.project.name}.png`, fullPage: true });
    await page.goto('/app/themes');
    await page.screenshot({ path: `e2e/__screenshots__/themes-list-${info.project.name}.png` });
  });
});
