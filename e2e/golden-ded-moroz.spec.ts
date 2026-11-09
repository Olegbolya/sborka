import { readFileSync } from 'node:fs';
import { expect, test, type Locator, type Page } from '@playwright/test';
import { freshUser, loginAndOnboard } from './helpers/auth';
import { subscribeOwner } from './helpers/plan';
import { addBlock, goToScreen, inspectorSection, newScreen, renameScreen } from './helpers/build';
import { hit, openEditor, openTab, saveStatus, serverDraft } from './helpers/editor';
import { PHOTO_PNG, SMALL_PNG, TINY_GIF, rgbOf, wav } from './helpers/files';

/*
 * P6.8 · GS-01 «Письмо Деду Морозу»: сборка с нуля и СВОЯ тема «Новогодний уют», всё через интерфейс; два браузерных
 * контекста — создатель и участник на телефоне (390). Системных тем, шаблонов и библиотеки в сценарии нет.
 */

type Tokens = {
  colors: Record<string, string>;
  fonts: { heading: { name: string }; body: { name: string } };
  background: Array<{ kind: string }>;
  particles?: { preset: string; images: unknown[] };
  decor: unknown[];
  blockDefaults: Record<string, Record<string, unknown>>;
};
type Theme = { id: string; name: string; tokens: Tokens };

const origin = (page: Page) => new URL(page.url()).origin;
const getTheme = async (page: Page, id: string): Promise<Theme> => (await (await page.request.get(`/api/v1/themes/${id}`)).json()) as Theme;

/** Группа левой панели редактора темы, раскрытая. */
const section = async (page: Page, id: string): Promise<Locator> => {
  const s = page.locator(`[data-section="${id}"]`);
  await s.scrollIntoViewIfNeeded();
  if ((await s.getAttribute('open')) === null) await s.locator('summary').first().click();
  return s;
};

/** Выбор файла: окно «Выбор файла», загрузка своего файла с компьютера. */
const uploadInto = async (page: Page, opener: Locator, file: { name: string; mimeType: string; buffer: Buffer }) => {
  await opener.click();
  const picker = page.getByRole('dialog', { name: 'Выбор файла' });
  await picker.getByLabel('Загрузить файл').setInputFiles(file);
  await expect(picker).toBeHidden();
};

test.describe('P6.8 · GS-01 «Письмо Деду Морозу»', () => {
  test.use({ actionTimeout: 15_000, viewport: { width: 1440, height: 900 }, hasTouch: false, isMobile: false });

  test('GS-01 · своя тема «Новогодний уют» → три экрана с мемами → публикация с лимитом → участник → кабинет → шаблон', async ({ page, browser }, info) => {
    test.setTimeout(540_000);
    await loginAndOnboard(page, freshUser('Автор письма'));

    // ── Шаг 2: тема «Новогодний уют» с нуля — фото ёлки, цвета, шрифт, фон, снег из своей снежинки, гирлянда, стиль кнопок.
    await page.goto('/app/themes');
    await page.getByLabel('Название новой темы').fill('Новогодний уют');
    await page.getByLabel('Картинка для темы').setInputFiles({ name: 'elka.png', mimeType: 'image/png', buffer: PHOTO_PNG });
    await page.waitForURL(/\/app\/themes\/[^/]+\/edit/);
    await expect(page.getByTestId('theme-editor')).toBeVisible();
    const themeId = page.url().split('/').at(-2)!;
    const swatches = page.locator('[data-color^="foto_"]');
    expect(await swatches.count()).toBeGreaterThanOrEqual(5); // палитра извлечена из фото
    await page.getByLabel('Основной: HEX').fill('#B3261E');
    await page.getByLabel('Акцент: HEX').fill('#F2B705');
    await (await section(page, 'theme-fonts')).getByLabel('Шрифт заголовков').selectOption({ label: 'Скруглённый' });
    const background = await section(page, 'theme-background');
    await background.getByLabel('Слой', { exact: true }).selectOption({ label: 'Фото, GIF или видео' });
    await uploadInto(page, background.getByRole('button', { name: 'Выбрать файл' }), { name: 'fon.png', mimeType: 'image/png', buffer: PHOTO_PNG });
    const particles = await section(page, 'theme-particles');
    await particles.getByRole('checkbox', { name: 'Частицы на экране' }).check();
    await particles.getByRole('group', { name: 'Свои картинки' }).getByRole('button', { name: 'Добавить' }).click();
    await uploadInto(page, particles.getByRole('group', { name: 'Свои картинки' }).getByRole('button', { name: 'Выбрать файл' }), { name: 'snezhinka.png', mimeType: 'image/png', buffer: SMALL_PNG });
    // Пока нет ни одной своей картинки, вид «Свои картинки» схема не принимает: сначала картинка, потом вид.
    await particles.getByLabel('Какие').selectOption({ label: 'Свои картинки' });
    const decor = await section(page, 'theme-decor');
    await decor.getByRole('button', { name: 'Добавить' }).click();
    await uploadInto(page, decor.getByRole('button', { name: 'Выбрать файл' }), { name: 'girlyanda.png', mimeType: 'image/png', buffer: SMALL_PNG });
    const defaults = await section(page, 'block-defaults');
    await defaults.getByLabel('Вид блока').selectOption('button');
    const radius = await section(page, 'default-radius');
    await radius.getByLabel('Левый верхний угол', { exact: true }).fill('28');
    await expect(page.getByTestId('theme-save-status')).toHaveText('Сохранено');
    await expect
      .poll(async () => {
        const t = (await getTheme(page, themeId)).tokens;
        return t.colors.primary === '#B3261E' && t.particles?.preset === 'custom' && t.particles.images.length === 1 && t.decor.length === 1 && JSON.stringify(t.blockDefaults.button ?? {}).includes('"tl":28');
      }, { timeout: 20_000 })
      .toBe(true);
    const saved = (await getTheme(page, themeId)).tokens;
    expect(saved.colors.accent).toBe('#F2B705');
    expect(saved.fonts.heading.name).toBe('rounded');
    expect(saved.background[0]!.kind).toBe('media');
    expect(saved.particles?.images).toHaveLength(1);
    expect(saved.decor).toHaveLength(1);
    expect(JSON.stringify(saved.blockDefaults.button)).toContain('"tl":28');

    // ── Шаг 1: пустая сборка из кабинета; ничего готового (системных тем и шаблонов) не используется.
    await page.goto('/cabinet/projects');
    await page.getByRole('button', { name: '+ Создать сборку' }).click();
    await expect(page.getByRole('button', { name: 'Редактор' })).toHaveCount(1);
    const projects = (await (await page.request.get('/api/v1/projects')).json()) as Array<{ id: string }>;
    const id = projects[0]!.id;
    await openEditor(page, id);
    await page.getByRole('button', { name: 'Тема', exact: true }).click();
    const themeDialog = page.getByRole('dialog', { name: 'Тема сборки' });
    await themeDialog.getByRole('list', { name: 'Мои темы' }).getByRole('button', { name: 'Применить тему: Новогодний уют' }).click();
    await expect(themeDialog).toHaveCount(0);
    await expect.poll(async () => JSON.stringify(((await serverDraft(page, id)).doc as unknown as { theme: unknown }).theme), { timeout: 20_000 }).toContain(themeId);

    // ── Шаг 3: экран 1 — заголовок и вопрос с четырьмя вариантами; один вариант оформлен по-своему.
    await renameScreen(page, 'Желание');
    await addBlock(page, 'text', 'Заголовок', { x: 20, y: 40, w: 350, h: 90 }, 'Что бы ты хотел получить от Деда Мороза?');
    await openTab(page, 'Добавить');
    await page.getByRole('button', { name: /^Выбор одного варианта/ }).click();
    await openTab(page, 'Содержимое');
    await page.getByLabel('Название блока').fill('Подарок');
    for (let i = 3; i <= 4; i++) await page.getByRole('button', { name: 'Добавить вариант' }).click();
    for (const [i, text] of ['Санки', 'Конструктор', 'Книгу', 'Щенка'].entries()) await page.getByLabel(`Текст варианта ${i + 1}`, { exact: true }).fill(text);
    await openTab(page, 'Оформление');
    for (const [label, value] of [['X', 20], ['Y', 150], ['Ширина', 350], ['Высота', 380]] as const) await page.getByLabel(label, { exact: true }).fill(String(value));
    await addBlock(page, 'button', 'Дальше', { x: 95, y: 570, w: 200, h: 64 }, 'Дальше');
    await expect(saveStatus(page)).toHaveText('Сохранено');
    // Вариант «Конструктор»: другая ширина и высота, скругление, форма «звезда», заливка своим GIF, 3D-наклон.
    await openTab(page, 'Слои');
    await page.getByRole('list', { name: 'Слои' }).getByRole('button', { name: 'Вариант 2', exact: true }).click();
    await openTab(page, 'Оформление');
    for (const [label, value] of [['Ширина', 300], ['Высота', 70]] as const) await page.getByLabel(label, { exact: true }).fill(String(value));
    await (await inspectorSection(page, 'radius')).getByLabel('Левый верхний угол', { exact: true }).fill('18');
    await (await inspectorSection(page, 'shape')).getByLabel('Форма', { exact: true }).selectOption({ label: 'Звезда' });
    const fills = await inspectorSection(page, 'fills');
    await fills.getByRole('button', { name: 'Добавить' }).click();
    await fills.getByLabel('Слой', { exact: true }).selectOption({ label: 'Фото, GIF или видео' });
    await uploadInto(page, fills.getByRole('button', { name: 'Выбрать файл' }), { name: 'konstruktor.gif', mimeType: 'image/gif', buffer: TINY_GIF });
    await (await inspectorSection(page, 'transform3d')).getByLabel('Наклон по X', { exact: true }).fill('20');
    await expect(saveStatus(page)).toHaveText('Сохранено');
    const doc1 = (await serverDraft(page, id)).doc as unknown as { screens: Array<{ blocks: Array<{ name: string; children: Array<{ name: string; frame: { w: number; h: number }; style: Record<string, unknown> }> }> }> };
    const star = doc1.screens[0]!.blocks.find((b) => b.name === 'Подарок')!.children[1]!;
    expect(star.frame).toMatchObject({ w: 300, h: 70 });
    expect(JSON.stringify(star.style)).toContain('"kind":"star"');
    expect(JSON.stringify(star.style)).toContain('"tl":18');
    expect(JSON.stringify(star.style)).toContain('"rotateX":20');
    expect(JSON.stringify(star.style.fills)).toContain('"kind":"media"');

    // ── Шаг 4а: на экране 1 — свой мем для варианта «Щенка» (T-21): другая картинка и своя подпись.
    await goToScreen(page, 0);
    await openTab(page, 'Оформление');
    const byAnswer = await inspectorSection(page, 'screen-media-by-answer');
    await byAnswer.getByLabel('Свой мем для ответа').check();
    await byAnswer.getByLabel('Случай 1: когда').selectOption({ label: 'выбран вариант' });
    await byAnswer.getByLabel('Случай 1: вариант').selectOption({ label: '4. Вариант 4' });
    await uploadInto(page, byAnswer.getByLabel('Случай 1: мем: картинка или видео: выбрать файл'), { name: 'shchenok.gif', mimeType: 'image/gif', buffer: TINY_GIF });
    await byAnswer.getByLabel('Случай 1: мем: подпись').check();
    await byAnswer.getByLabel('Случай 1: мем: текст подписи').fill('ЩЕНОК? ЗВУЧИТ СЕРЬЁЗНО');

    // ── Экран 2: текстовый ответ «Напиши пожелание».
    await newScreen(page);
    await renameScreen(page, 'Письмо');
    await addBlock(page, 'text', 'Просьба', { x: 20, y: 40, w: 350, h: 80 }, 'Напиши пожелание');
    await openTab(page, 'Добавить');
    await page.getByRole('button', { name: /^Текстовый ответ/ }).click();
    await openTab(page, 'Содержимое');
    await page.getByLabel('Название блока').fill('Пожелание');
    await openTab(page, 'Оформление');
    for (const [label, value] of [['X', 20], ['Y', 150], ['Ширина', 350], ['Высота', 160]] as const) await page.getByLabel(label, { exact: true }).fill(String(value));
    await addBlock(page, 'button', 'Отправить', { x: 95, y: 400, w: 200, h: 64 }, 'Отправить');

    // ── Шаг 4б: мем-переход между экранами 1 и 2 (T-20): свой GIF на 1,5 с с подписью в стиле мема.
    await goToScreen(page, 1);
    await openTab(page, 'Оформление');
    const transition = await inspectorSection(page, 'screen-transition');
    await transition.getByLabel('Переход', { exact: true }).selectOption({ label: 'Вставка из медиатеки' });
    await uploadInto(page, transition.getByRole('button', { name: 'Выбрать файл' }).first(), { name: 'pishet.gif', mimeType: 'image/gif', buffer: TINY_GIF });
    await transition.getByLabel('Сколько показывать, с', { exact: true }).fill('1.5');
    await transition.getByLabel('Подпись поверх', { exact: true }).check();
    await transition.getByLabel('Текст подписи', { exact: true }).fill('ДЕД МОРОЗ УЖЕ ПИШЕТ ОТВЕТ');

    // ── Шаг 5: экран 3 — финал; правило «при показе экрана → конфетти и свой звук».
    await newScreen(page);
    await renameScreen(page, 'Финал');
    await addBlock(page, 'text', 'Спасибо', { x: 20, y: 120, w: 350, h: 120 }, 'Письмо отправлено! Дед Мороз уже читает.');
    await addBlock(page, 'button', 'Закончить', { x: 95, y: 400, w: 200, h: 64 }, 'Закончить');
    await goToScreen(page, 2);
    await page.getByRole('button', { name: 'Сценарии', exact: true }).click();
    const rules = page.getByRole('dialog', { name: 'Сценарии сборки' });
    await rules.getByRole('tab', { name: 'Правила экрана' }).click();
    await expect(rules.getByLabel('Экран', { exact: true })).toHaveValue(/./);
    await rules.getByLabel('Добавить правило: когда').selectOption({ label: 'Экран открылся или закрывается' });
    const finalRule = rules.locator('[data-rule]').first();
    await finalRule.getByLabel('Сделать: добавить действие').selectOption({ label: 'Эффект' });
    await finalRule.getByLabel('Сделать: добавить действие').selectOption({ label: 'Сыграть звук' });
    await uploadInto(page, finalRule.getByLabel('Звук: выбрать файл'), { name: 'kolokolchik.wav', mimeType: 'audio/wav', buffer: wav() });
    await rules.getByRole('button', { name: 'Закрыть', exact: true }).click();
    await expect(saveStatus(page)).toHaveText('Сохранено');

    // В документе всё лежит так, как собрано: мем по ответу, мем-переход, правило финала.
    type Node = Record<string, unknown>;
    const doc2 = (await serverDraft(page, id)).doc as unknown as { screens: Array<Node & { mediaByAnswer?: { cases: Array<{ when: Node; overlay: { caption?: { text: string } } }> }; transitionIn?: { kind: string; overlay: { seconds: number; caption?: { text: string } } }; rules: Array<{ when: Node; do: Array<{ kind: string }> }> }> };
    expect(doc2.screens).toHaveLength(3);
    expect(doc2.screens[0]!.mediaByAnswer!.cases[0]).toMatchObject({ when: { kind: 'option' }, overlay: { caption: { text: 'ЩЕНОК? ЗВУЧИТ СЕРЬЁЗНО' } } });
    expect(doc2.screens[1]!.transitionIn).toMatchObject({ kind: 'media', overlay: { seconds: 1.5, caption: { text: 'ДЕД МОРОЗ УЖЕ ПИШЕТ ОТВЕТ' } } });
    expect(doc2.screens[2]!.rules[0]).toMatchObject({ when: { kind: 'screen', phase: 'show' } });
    expect(doc2.screens[2]!.rules[0]!.do.map((a) => a.kind)).toEqual(['wait', 'effect', 'playSound']); // «Подождать» — действие, с которого начинается любое новое правило

    // Предпросмотр: для варианта «Щенка» показывается его мем, а потом — экран «Письмо».
    await page.getByRole('button', { name: 'Предпросмотр' }).click();
    const preview = page.getByRole('dialog', { name: 'Предпросмотр' }).locator('[data-preview="true"]');
    await preview.locator('.bk-player-screen[data-live="true"]').waitFor();
    await preview.getByText('Щенка', { exact: true }).click();
    await preview.getByText('Дальше', { exact: true }).click();
    await expect(preview.locator('.bk-meme-caption')).toHaveText('ЩЕНОК? ЗВУЧИТ СЕРЬЁЗНО');
    await expect(preview.getByText('Напиши пожелание')).toBeVisible({ timeout: 10_000 });
    await page.getByRole('dialog', { name: 'Предпросмотр' }).getByRole('button', { name: 'Закрыть' }).first().click();

    // ── Шаг 6: публикация, лимит 50 переходов, ссылка и QR (PNG и SVG).
    await page.getByRole('button', { name: 'Опубликовать', exact: true }).click();
    await expect(page.getByText('Сборка опубликована')).toBeVisible();
    const { slug } = (await (await page.request.get(`/api/v1/projects/${id}`)).json()) as { slug: string };
    await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
    await page.goto(`/cabinet/projects/${id}`);
    await page.getByRole('button', { name: 'Настройки доступа' }).click();
    await page.getByLabel('Максимум начатых прохождений').fill('50');
    await page.getByRole('button', { name: 'Сохранить настройки' }).click();
    await expect(page.getByRole('button', { name: 'Сохранено!' })).toBeVisible();
    await page.getByRole('button', { name: 'Точки доступа' }).click();
    await page.getByRole('button', { name: 'Скопировать ссылку' }).first().click();
    const link = await page.evaluate(() => navigator.clipboard.readText());
    expect(link).toMatch(new RegExp(`/(q/[a-z0-9]+|s/${slug})`));
    const download = async (name: string | RegExp) => {
      const [file] = await Promise.all([page.waitForEvent('download'), page.getByRole('link', { name }).first().click()]);
      return readFileSync((await file.path())!);
    };
    expect((await download('QR PNG 1024')).subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a');
    expect((await download('QR SVG')).toString('utf8')).toContain('<svg');

    // ── Шаг 7: участник (без регистрации, другой браузер, 390 пикселей) проходит три экрана.
    const base = info.project.use.baseURL!;
    const guest = async () => {
      const ctx = await browser.newContext({ baseURL: base, viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, locale: 'ru-RU' });
      return { ctx, p: await ctx.newPage() };
    };
    const painted = (canvas: Locator) =>
      canvas.evaluate((c: HTMLCanvasElement) => {
        const g = c.getContext('2d');
        return !!g && g.getImageData(0, 0, c.width, c.height).data.some((v, i) => i % 4 === 3 && v > 0);
      });
    const { ctx, p } = await guest();
    await p.goto(link);
    await expect(p.getByText('Что бы ты хотел получить от Деда Мороза?')).toBeVisible();
    await expect.poll(() => painted(p.locator('canvas.bk-particles').first()), { timeout: 15_000 }).toBe(true); // снег из своей снежинки
    await p.getByText('Санки', { exact: true }).tap();
    await p.getByText('Дальше', { exact: true }).tap();
    await expect(p.locator('.bk-meme-caption')).toHaveText('ДЕД МОРОЗ УЖЕ ПИШЕТ ОТВЕТ'); // мем-переход
    await expect(p.getByText('Напиши пожелание')).toBeVisible({ timeout: 10_000 });
    await p.getByRole('textbox').fill('Хочу санки и мандарины');
    await p.getByText('Отправить', { exact: true }).tap();
    await expect(p.getByText('Письмо отправлено! Дед Мороз уже читает.')).toBeVisible();
    await expect.poll(() => painted(p.locator('canvas.bk-particles').last()), { timeout: 10_000 }).toBe(true); // конфетти финала
    await p.getByText('Закончить', { exact: true }).tap();
    await expect
      .poll(async () => JSON.stringify(((await (await page.request.get(`/api/v1/projects/${id}/responses`)).json()) as { items: unknown[] }).items), { timeout: 15_000 })
      .toContain('COMPLETED');
    await ctx.close();

    // ── Шаг 8: в кабинете — время, выбранный вариант, текст пожелания, путь, источник; счётчик «1 из 50».
    await page.goto(`/cabinet/projects/${id}`);
    await expect(page.getByTestId('starts-counter')).toHaveText('1 из 50');
    await page.getByRole('button', { name: 'Карточка' }).click();
    const card = page.getByTestId('response-path').locator('xpath=ancestor::div[1]/parent::div');
    await expect(page.getByText(/^Длительность: \d/)).toBeVisible();
    await expect(page.getByTestId('response-path')).toHaveText('Путь: Желание → Письмо → Финал');
    await expect(page.getByTestId('response-source')).toContainText('Источник:');
    await expect(card.getByText('Санки', { exact: true })).toBeVisible();
    await expect(card.getByText('Хочу санки и мандарины', { exact: true })).toBeVisible();

    // ── Шаг 9: 51-й участник видит «Сборка закрыта» в оформлении темы.
    const projectId = id;
    await subscribeOwner(projectId); // лимит сборки — 50, а не месячный лимит «Старта» (30)
    for (let i = 1; i < 50; i++) {
      const started = await page.request.post(`/api/v1/play/${projectId}/sessions`, { data: {}, headers: { origin: origin(page) } });
      expect(started.status(), await started.text()).toBe(201);
    }
    const late = await guest();
    await late.p.goto(`/s/${slug}`);
    await expect(late.p.getByTestId('play-state')).toContainText('Сборка закрыта');
    expect(await late.p.getByTestId('play-state').evaluate((n) => getComputedStyle(n).color)).toBe(rgbOf(saved.colors.text!));
    await late.ctx.close();

    // ── Шаг 10: сборка — шаблон; новая сборка из него — копия, независимая от исходной; тема переносится на другую сборку.
    type Shape = { theme: { themeId?: string; tokens: Tokens }; screens: Array<{ name: string; blocks: Array<{ name: string; type: string; textLayer?: unknown; style: Record<string, unknown>; children: Array<{ name: string }> }> }> };
    const shapeOf = async (projectId: string) => (await serverDraft(page, projectId)).doc as unknown as Shape;
    const outline = (d: Shape) => d.screens.map((sc) => ({ name: sc.name, blocks: sc.blocks.map((b) => ({ name: b.name, type: b.type, text: JSON.stringify(b.textLayer ?? null), style: JSON.stringify(b.style), options: b.children.map((c) => c.name) })) }));
    await openEditor(page, id);
    await page.getByTestId('tool-template-save').click();
    await page.getByTestId('tab-templates').click();
    await expect(page.getByTestId('templates-mine-section')).toBeVisible();
    const [copyPage] = await Promise.all([page.context().waitForEvent('page'), page.getByTestId('templates-mine-section').locator('button').first().click()]);
    await copyPage.waitForLoadState('networkidle');
    const copyId = copyPage.url().match(/\/app\/projects\/([^/]+)\/edit/)![1]!;
    await copyPage.close();
    expect(copyId).not.toBe(id);
    const original = await shapeOf(id);
    const copy = await shapeOf(copyId);
    expect(outline(copy)).toEqual(outline(original)); // копия идентична
    expect(copy.theme.tokens).toEqual(original.theme.tokens);
    const edited = (await serverDraft(page, copyId)).doc as unknown as { screens: Array<{ name: string }> };
    edited.screens[0]!.name = 'Только в копии';
    const put = await page.request.put(`/api/v1/projects/${copyId}/draft`, { data: { document: edited }, headers: { origin: origin(page), 'if-match': String((await serverDraft(page, copyId)).revision) } });
    expect(put.ok(), await put.text()).toBe(true);
    expect((await shapeOf(id)).screens[0]!.name).toBe('Желание'); // исходная не изменилась

    // «Новогодний уют» на другой сборке: оформление переносится, свои правки той сборки остаются.
    const other = await page.request.post('/api/v1/projects', { data: { title: 'Другая сборка' }, headers: { origin: origin(page) } });
    const otherProject = (await other.json()) as { id: string; draftVersionNumber: number; document: { screens: Array<{ blocks: unknown[] }> } };
    const frame = (x: number) => ({ x, y: 40, w: 160, h: 56, rotation: 0 });
    otherProject.document.screens[0]!.blocks.push(
      { id: 'svoya_knopka_1', type: 'button', name: 'Своя кнопка', frame: frame(20), style: { radius: { unit: 'u', tl: 4, tr: 4, br: 4, bl: 4 } } },
      { id: 'obychnaya_knopka', type: 'button', name: 'Обычная кнопка', frame: frame(200), style: {} },
    );
    expect((await page.request.put(`/api/v1/projects/${otherProject.id}/draft`, { data: { document: otherProject.document }, headers: { origin: origin(page), 'if-match': String(otherProject.draftVersionNumber) } })).ok()).toBe(true);
    await openEditor(page, otherProject.id);
    await page.getByRole('button', { name: 'Тема', exact: true }).click();
    const dlg = page.getByRole('dialog', { name: 'Тема сборки' });
    await dlg.getByRole('list', { name: 'Мои темы' }).getByRole('button', { name: 'Применить тему: Новогодний уют' }).click();
    await expect(dlg).toHaveCount(0);
    await expect.poll(async () => (await shapeOf(otherProject.id)).theme.themeId, { timeout: 20_000 }).toBe(themeId);
    const moved = await shapeOf(otherProject.id);
    expect(moved.theme.tokens.colors.primary).toBe('#B3261E');
    expect(moved.theme.tokens.particles?.preset).toBe('custom');
    const [own, plain] = moved.screens[0]!.blocks;
    expect(JSON.stringify(own!.style)).toContain('"tl":4');
    expect(plain!.style.radius).toBeUndefined();
  });
});
