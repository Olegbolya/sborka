import { mkdirSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { freshUser, loginAndOnboard } from './helpers/auth';
import { player } from './helpers/build';
import { nextButton, openEditor, openTab, screensList, seedProject, serverDraft, textBlock } from './helpers/editor';

/**
 * TPL-01, TPL-02, TPL-03, TPL-04, ME-01, ME-02, SC-06 · Шаблоны и мои элементы.
 * Приёмка P3.11:
 *   шаблон → новая сборка → правка копии не меняет шаблон;
 *   галерея без единого системного шаблона показывает пустое состояние и предлагает «Мои шаблоны»;
 *   элемент с правилом вставлен в другую сборку и работает в предпросмотре.
 */

interface Own {
  id: string;
  name: string;
  coverMediaId: string | null;
}
const mine = async (page: Page): Promise<Own[]> => ((await (await page.request.get('/api/v1/templates/mine')).json()) as { templates: Own[] }).templates;
interface Var {
  id: string;
  name: string;
}
const origin = (page: Page) => new URL(page.url()).origin;

/** The system gallery as the server would answer it (the real one is filled by the owner and may be empty or not). */
const systemGallery = async (page: Page, templates: Array<{ id: string; name: string; category: string | null }>) =>
  page.route(/\/api\/v1\/templates(\?.*)?$/, (route) => (route.request().method() === 'GET' ? route.fulfill({ json: { templates: templates.map((t) => ({ ...t, coverMediaId: null, isSystem: true })) } }) : route.fallback()));

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');

test.describe('TPL · шаблоны', () => {
  test.beforeEach(async ({ page }) => {
    await loginAndOnboard(page, freshUser('Автор'));
  });

  test('TPL-01, TPL-02, TPL-04 · шаблон → новая сборка → правка копии не меняет ни шаблон, ни исходную сборку', async ({ page }) => {
    const { id } = await seedProject(page, (d) => void d.screens[0]!.blocks.push(textBlock('tekst_isxod', 'Исходный текст', 20, 40, 300, 60)), 'Исходная сборка');
    await openEditor(page, id);
    await page.getByTestId('tool-template-save').click();
    await expect.poll(async () => (await mine(page)).length).toBe(1);
    const template = (await mine(page))[0]!;
    expect(template.name).toBe('Исходная сборка');

    await openTab(page, 'Шаблоны');
    const [copy] = await Promise.all([page.context().waitForEvent('page'), page.getByTestId(`template-item-${template.id}`).click()]);
    await copy.waitForURL(/\/app\/projects\/[^/]+\/edit/);
    const copyId = /projects\/([^/]+)\/edit/.exec(copy.url())![1]!;
    expect(copyId).not.toBe(id);
    await expect(copy.getByTestId('save-status')).toHaveText('Сохранено');
    expect((await serverDraft(copy, copyId)).doc.screens[0]!.blocks).toHaveLength(1);

    // Правка копии через интерфейс: ещё один текстовый блок
    await openTab(copy, 'Добавить');
    await copy.locator('[data-add-type="text"]').click();
    await expect.poll(async () => (await serverDraft(copy, copyId)).doc.screens[0]!.blocks.length).toBe(2);

    // Шаблон и исходная сборка остались прежними
    const content = (await (await page.request.get(`/api/v1/templates/${template.id}`)).json()) as { screens: Array<{ blocks: unknown[] }> };
    expect(content.screens[0]!.blocks).toHaveLength(1);
    expect((await serverDraft(page, id)).doc.screens[0]!.blocks).toHaveLength(1);
    expect((await mine(page)).map((t) => t.id)).toEqual([template.id]);
    await copy.close();
  });

  test('TPL-03 · галерея без единого системного шаблона: пустое состояние и предложение открыть «Мои шаблоны»', async ({ page }) => {
    await systemGallery(page, []);
    const { id } = await seedProject(page, undefined, 'Для пустой галереи');
    await openEditor(page, id);
    await openTab(page, 'Шаблоны');
    const empty = page.getByTestId('template-empty-state');
    await expect(empty).toContainText('Системных шаблонов пока нет.');
    // Своих тоже нет: подсказка, как их получить
    await expect(page.getByTestId('templates-mine-empty')).toBeVisible();
    await expect(page.getByTestId('template-open-mine')).toHaveCount(0);

    await page.getByTestId('tool-template-save').click();
    await expect.poll(async () => (await mine(page)).length).toBe(1);
    await openTab(page, 'Экраны');
    await openTab(page, 'Шаблоны');
    await expect(empty).toContainText('Системных шаблонов пока нет.');
    await expect(page.getByTestId('template-open-mine')).toHaveText('Открыть «Мои шаблоны»');
    await page.getByTestId('template-open-mine').click();
    await expect(page.getByTestId('templates-mine-section')).toContainText('Для пустой галереи');
  });

  test('TPL-03 · галерея с шаблонами: категории и поиск', async ({ page }) => {
    await systemGallery(page, [
      { id: 'sistema_1', name: 'Викторина с баллами', category: 'Обучение' },
      { id: 'sistema_2', name: 'Анонимный опрос', category: 'Опросы' },
      { id: 'sistema_3', name: 'Письмо Деду Морозу', category: 'Обучение' },
    ]);
    const { id } = await seedProject(page);
    await openEditor(page, id);
    await openTab(page, 'Шаблоны');
    await expect(page.getByTestId('template-category')).toHaveCount(2);
    await expect(page.locator('[data-testid^="template-row-sistema_"]')).toHaveCount(3);
    await page.getByLabel('Категория шаблонов').selectOption('Опросы');
    await expect(page.locator('[data-testid^="template-row-sistema_"]')).toHaveCount(1);
    await expect(page.getByTestId('template-row-sistema_2')).toContainText('Анонимный опрос');
    await page.getByLabel('Категория шаблонов').selectOption('');
    await page.getByLabel('Поиск шаблонов').fill('письмо');
    await expect(page.locator('[data-testid^="template-row-sistema_"]')).toHaveCount(1);
    await page.getByLabel('Поиск шаблонов').fill('нет-такого-9731');
    await expect(page.getByTestId('template-no-match')).toBeVisible();
    await expect(page.getByTestId('template-empty-state')).toHaveCount(0);
  });

  test('TPL-02 · мои шаблоны: вставить один экран, переименовать, обложка, удалить', async ({ page }, info) => {
    const source = await seedProject(
      page,
      (d) => {
        d.screens[0]!.blocks.push(textBlock('tekst_pervyj', 'Первый экран шаблона', 20, 40, 300, 60));
        d.screens.push({ id: 'ekran_final', name: 'Финал', blocks: [textBlock('tekst_final', 'Текст финала', 20, 60, 300, 60)] });
      },
      'Шаблон из двух экранов',
    );
    await openEditor(page, source.id);
    await page.getByTestId('tool-template-save').click();
    await expect.poll(async () => (await mine(page)).length).toBe(1);
    const template = (await mine(page))[0]!;

    // Вставка одного экрана в другую сборку
    const target = await seedProject(page, undefined, 'Принимающая сборка');
    await openEditor(page, target.id);
    await expect(screensList(page)).toHaveCount(1);
    await openTab(page, 'Шаблоны');
    await page.getByTestId(`template-screens-${template.id}`).click();
    await expect(page.getByTestId('template-screens').getByRole('button')).toHaveCount(2);
    await page.getByTestId('template-screen-ekran_final').click();
    await expect(screensList(page)).toHaveCount(2);
    await expect.poll(async () => (await serverDraft(page, target.id)).doc.screens.map((s) => s.name)).toEqual(['Экран 1', 'Финал (копия)']);
    const inserted = (await serverDraft(page, target.id)).doc.screens[1]!.blocks as Array<{ id: string }>;
    expect(inserted).toHaveLength(1);
    expect(inserted[0]!.id).not.toBe('tekst_final');
    // Сам шаблон не изменился
    const content = (await (await page.request.get(`/api/v1/templates/${template.id}`)).json()) as { screens: Array<{ name: string }> };
    expect(content.screens.map((s) => s.name)).toEqual(['Экран 1', 'Финал']);

    // Переименовать
    await page.getByRole('button', { name: 'Переименовать «Шаблон из двух экранов»' }).click();
    await page.getByLabel('Название шаблона').fill('Мой новый шаблон');
    await page.keyboard.press('Enter');
    await expect(page.getByTestId(`template-row-${template.id}`)).toContainText('Мой новый шаблон');
    expect((await mine(page))[0]!.name).toBe('Мой новый шаблон');

    // Обложка: диалог выбора файла открывается; готовая обложка видна в строке и снимается
    await page.getByRole('button', { name: 'Обложка «Мой новый шаблон»' }).click();
    await expect(page.getByRole('dialog', { name: 'Выбор файла' })).toBeVisible();
    await page.keyboard.press('Escape');
    const up = await page.request.post('/api/v1/media', { headers: { origin: origin(page) }, multipart: { file: { name: 'oblozhka.png', mimeType: 'image/png', buffer: PNG } } });
    const media = (await up.json()) as { id: string };
    expect((await page.request.patch(`/api/v1/templates/${template.id}`, { data: { coverMediaId: media.id }, headers: { origin: origin(page) } })).ok()).toBe(true);
    await openTab(page, 'Экраны');
    await openTab(page, 'Шаблоны');
    await expect(page.getByTestId(`template-row-${template.id}`).getByTestId('cover-thumb')).toBeAttached();
    mkdirSync('e2e/__screenshots__', { recursive: true });
    await page.getByTestId(`template-row-${template.id}`).scrollIntoViewIfNeeded();
    await page.screenshot({ path: `e2e/__screenshots__/templates-${info.project.name}.png` });
    await page.getByRole('button', { name: 'Убрать обложку «Мой новый шаблон»' }).click();
    await expect(page.getByTestId(`template-row-${template.id}`).getByTestId('cover-thumb')).toHaveCount(0);
    expect((await mine(page))[0]!.coverMediaId).toBeNull();

    // Удалить: сборки, созданные из шаблона, остаются
    page.once('dialog', (d) => void d.accept());
    await page.getByRole('button', { name: 'Удалить шаблон «Мой новый шаблон»' }).click();
    await expect(page.getByTestId(`template-row-${template.id}`)).toHaveCount(0);
    expect(await mine(page)).toHaveLength(0);
    expect((await serverDraft(page, target.id)).doc.screens).toHaveLength(2);
  });
});

test.describe('ME · мои элементы', () => {
  test.beforeEach(async ({ page }) => {
    await loginAndOnboard(page, freshUser('Автор'));
  });

  const counter = (page: Page) =>
    seedProject(
      page,
      (d) => {
        d.variables.push({ id: 'ochki_var', name: 'Очки', type: 'number', initial: 0, saveToAnswers: false });
        d.screens[0]!.blocks.push(
          { ...textBlock('schet_1', 'Очки', 20, 20, 300, 40), textLayer: { paragraphs: [{ kind: 'p', runs: [{ t: 'Очки: ' }, { v: 'ochki_var' }] }] } },
          {
            ...nextButton('plyus_1', 'Плюс', 100),
            rules: [{ id: 'plyus_pravilo', when: { kind: 'tap', source: { kind: 'block', blockId: 'plyus_1' } }, do: [{ kind: 'setVariable', variableId: 'ochki_var', op: 'add', value: 1 }] }],
          },
        );
      },
      'Сборка со счётчиком',
    );

  /** Saves the two blocks of the counter as an element and returns its id. */
  const saveCounterElement = async (page: Page): Promise<string> => {
    const { id } = await counter(page);
    await openEditor(page, id);
    await page.keyboard.press('Control+a');
    await openTab(page, 'Добавить');
    await page.getByTestId('element-save').click();
    await page.getByLabel('Название элемента').fill('Счётчик очков');
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('elements-panel')).toContainText('Счётчик очков');
    const list = (await (await page.request.get('/api/v1/elements')).json()) as { elements: Array<{ id: string; name: string }> };
    expect(list.elements.map((e) => e.name)).toEqual(['Счётчик очков']);
    return list.elements[0]!.id;
  };

  test('ME-01, ME-02, SC-06 · элемент с правилом вставлен в другую сборку и работает в предпросмотре; переменная создана', async ({ page }) => {
    const elementId = await saveCounterElement(page);
    const other = await seedProject(page, undefined, 'Другая сборка');
    await openEditor(page, other.id);
    await openTab(page, 'Добавить');
    await page.getByTestId(`element-insert-${elementId}`).click();
    await expect(page.getByTestId('selection-box')).toBeVisible();
    // Нет переменной с таким именем — диалога нет, переменная создана вместе с правилом
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect.poll(async () => ((await serverDraft(page, other.id)).doc.variables as Var[]).map((v) => v.name)).toEqual(['Очки']);

    const g = await player(page);
    await expect(g.frame.getByText('Очки: 0')).toBeVisible();
    await g.frame.getByRole('button', { name: 'Плюс' }).click();
    await expect(g.frame.getByText('Очки: 1')).toBeVisible();
    await g.frame.getByRole('button', { name: 'Плюс' }).click();
    await expect(g.frame.getByText('Очки: 2')).toBeVisible();
  });

  test('ME-02, SC-06 · переменная с таким именем уже есть: предлагается связать или создать под другим именем', async ({ page }) => {
    const elementId = await saveCounterElement(page);
    const withVar = (title: string) => seedProject(page, (d) => void d.variables.push({ id: 'staraya_var', name: 'Очки', type: 'number', initial: 5, saveToAnswers: false }), title);

    // Связать: новой переменной нет, вставленные блоки читают существующую
    const linked = await withVar('Связать');
    await openEditor(page, linked.id);
    await openTab(page, 'Добавить');
    await page.getByTestId(`element-insert-${elementId}`).click();
    const dialog = page.getByRole('dialog', { name: 'Переменные с такими же именами' });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole('radio', { name: /Связать с переменной «Очки»/ })).toBeChecked();
    await dialog.getByRole('button', { name: 'Вставить' }).click();
    await expect.poll(async () => (await serverDraft(page, linked.id)).doc.screens[0]!.blocks.length).toBe(2);
    const after = (await serverDraft(page, linked.id)).doc;
    expect((after.variables as Var[]).map((v) => v.id)).toEqual(['staraya_var']);
    expect(JSON.stringify(after.screens[0]!.blocks)).toContain('staraya_var');
    const g = await player(page);
    await expect(g.frame.getByText('Очки: 5')).toBeVisible();
    await g.frame.getByRole('button', { name: 'Плюс' }).click();
    await expect(g.frame.getByText('Очки: 6')).toBeVisible();
    await page.keyboard.press('Escape');

    // Создать под другим именем: появилась вторая переменная
    const renamed = await withVar('Переименовать');
    await openEditor(page, renamed.id);
    await openTab(page, 'Добавить');
    await page.getByTestId(`element-insert-${elementId}`).click();
    const dialog2 = page.getByRole('dialog', { name: 'Переменные с такими же именами' });
    await dialog2.getByRole('radio', { name: /Создать новую переменную/ }).check();
    await dialog2.getByRole('button', { name: 'Вставить' }).click();
    await expect.poll(async () => (await serverDraft(page, renamed.id)).doc.variables.length).toBe(2);
    const names = ((await serverDraft(page, renamed.id)).doc.variables as Var[]).map((v) => v.name);
    expect(new Set(names).size).toBe(2);

    // Отмена не вставляет ничего
    const cancelled = await withVar('Отмена');
    await openEditor(page, cancelled.id);
    await openTab(page, 'Добавить');
    await page.getByTestId(`element-insert-${elementId}`).click();
    await page.getByRole('dialog', { name: 'Переменные с такими же именами' }).getByRole('button', { name: 'Отмена' }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    expect((await serverDraft(page, cancelled.id)).doc.screens[0]!.blocks).toHaveLength(0);
  });

  test('ME-01 · мои элементы: переименовать, обложка, удалить', async ({ page }, info) => {
    const elementId = await saveCounterElement(page);
    const row = page.getByTestId(`element-row-${elementId}`);
    await page.getByRole('button', { name: 'Переименовать «Счётчик очков»' }).click();
    await page.getByLabel('Новое название элемента').fill('Счётчик 2');
    await page.keyboard.press('Enter');
    await expect(row).toContainText('Счётчик 2');
    const listed = async () => ((await (await page.request.get('/api/v1/elements')).json()) as { elements: Array<{ name: string; coverMediaId: string | null }> }).elements[0]!;
    expect((await listed()).name).toBe('Счётчик 2');

    await page.getByRole('button', { name: 'Обложка «Счётчик 2»' }).click();
    await expect(page.getByRole('dialog', { name: 'Выбор файла' })).toBeVisible();
    await page.keyboard.press('Escape');
    const up = await page.request.post('/api/v1/media', { headers: { origin: origin(page) }, multipart: { file: { name: 'oblozhka.png', mimeType: 'image/png', buffer: PNG } } });
    const media = (await up.json()) as { id: string };
    expect((await page.request.patch(`/api/v1/elements/${elementId}`, { data: { coverMediaId: media.id }, headers: { origin: origin(page) } })).ok()).toBe(true);
    await openTab(page, 'Экраны');
    await openTab(page, 'Добавить');
    await expect(row.getByTestId('cover-thumb')).toBeAttached();
    mkdirSync('e2e/__screenshots__', { recursive: true });
    await row.scrollIntoViewIfNeeded();
    await page.screenshot({ path: `e2e/__screenshots__/elements-${info.project.name}.png` });
    await page.getByRole('button', { name: 'Убрать обложку «Счётчик 2»' }).click();
    await expect(row.getByTestId('cover-thumb')).toHaveCount(0);
    expect((await listed()).coverMediaId).toBeNull();

    page.once('dialog', (d) => void d.accept());
    await page.getByRole('button', { name: 'Удалить «Счётчик 2»' }).click();
    await expect(row).toHaveCount(0);
    expect(((await (await page.request.get('/api/v1/elements')).json()) as { elements: unknown[] }).elements).toHaveLength(0);
  });
});
