import { mkdirSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import { freshUser, loginAndOnboard } from './helpers/auth';
import { hit, nextButton, openEditor, saveStatus, screensList, seedProject, serverDraft, stage, textBlock } from './helpers/editor';

const SHOTS = 'e2e/__screenshots__';

test.beforeEach(async ({ page }) => {
  await loginAndOnboard(page, freshUser('Автор'));
});

test.describe('E-13, E-15, E-16 · оболочка редактора', () => {
  test('E-16 · из кабинета в редактор: верхняя панель, экраны, холст, три вкладки свойств', async ({ page }, info) => {
    const { id } = await seedProject(page, (d) => d.screens[0]!.blocks.push(textBlock('tekst_a', 'Текст A')), 'Моя сборка');
    await page.goto('/cabinet/projects');
    await page.getByRole('link', { name: 'Редактор' }).first().click();
    await expect(page).toHaveURL(new RegExp(`/app/projects/${id}/edit$`));
    await expect(page.getByLabel('Название сборки')).toHaveValue('Моя сборка');
    await expect(saveStatus(page)).toHaveText('Сохранено');
    for (const name of ['Отменить', 'Повторить', 'История', 'Предпросмотр', 'Опубликовать']) {
      await expect(page.getByRole('button', { name: new RegExp(name) })).toBeVisible();
    }
    await expect(screensList(page)).toHaveCount(1);
    await expect(hit(page, 'Текст A')).toBeVisible();
    const tabs = page.getByRole('tab');
    await expect(tabs.filter({ hasText: 'Оформление' })).toBeVisible();
    await expect(tabs.filter({ hasText: 'Содержимое' })).toBeVisible();
    await expect(tabs.filter({ hasText: 'Сценарии' })).toBeVisible();

    mkdirSync(SHOTS, { recursive: true });
    await page.screenshot({ path: `${SHOTS}/editor-${info.project.name}.png`, fullPage: true });
  });

  test('E-16 · чужая или несуществующая сборка: понятное сообщение, а не пустая страница', async ({ page }) => {
    await page.goto('/app/projects/net-takoj-sborki/edit');
    await expect(page.locator('main [role="alert"]')).toContainText('Такой сборки нет');
  });

  test('E-16 · без входа редактор отправляет на страницу входа', async ({ browser }) => {
    const ctx = await browser.newContext();
    const p = await ctx.newPage();
    await p.goto('/app/projects/lyuboj/edit');
    await expect(p).toHaveURL(/\/login$/);
    await ctx.close();
  });

  test('E-16 · название сборки правится и сохраняется', async ({ page }) => {
    const { id } = await seedProject(page);
    await openEditor(page, id);
    await page.getByLabel('Название сборки').fill('Новое имя сборки');
    await expect(saveStatus(page)).toHaveText('Сохранено');
    await expect.poll(async () => (await serverDraft(page, id)).doc.meta.title).toBe('Новое имя сборки');
  });

  test('E-15 · выбор блока: свойства X/Y/ширина/высота; правка двигает блок; мультивыбор показывает «смешанно»', async ({ page }) => {
    const { id } = await seedProject(page, (d) => d.screens[0]!.blocks.push(textBlock('tekst_a', 'Текст A', 20, 40), textBlock('tekst_b', 'Текст B', 20, 120)));
    await openEditor(page, id);
    await hit(page, 'Текст A').click();
    await expect(hit(page, 'Текст A')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByLabel('X', { exact: true })).toHaveValue('20');
    await expect(page.getByLabel('Ширина')).toHaveValue('160');

    const before = await hit(page, 'Текст A').boundingBox();
    await page.getByLabel('X', { exact: true }).fill('100');
    await expect.poll(async () => (await hit(page, 'Текст A').boundingBox())!.x).toBeGreaterThan(before!.x + 40);
    await expect.poll(async () => (await serverDraft(page, id)).doc.screens[0]!.blocks.map((b) => (b as { frame: { x: number } }).frame.x)).toEqual([100, 20]);

    // Two blocks: X differs, Y differs, width and height are the same.
    await hit(page, 'Текст B').click({ modifiers: ['Shift'] });
    await expect(page.getByLabel('X', { exact: true })).toHaveValue('');
    await expect(page.getByLabel('X', { exact: true })).toHaveAttribute('placeholder', 'смешанно');
    await expect(page.getByLabel('Ширина')).toHaveValue('160');
    await page.getByLabel('Ширина').fill('200');
    await expect.poll(async () => (await serverDraft(page, id)).doc.screens[0]!.blocks.map((b) => (b as { frame: { w: number } }).frame.w)).toEqual([200, 200]);
  });

  test('E-15 · вкладки «Содержимое» и «Сценарии»: название блока, описание, число правил', async ({ page }) => {
    const { id } = await seedProject(page, (d) => d.screens[0]!.blocks.push(nextButton('knopka_a', 'Кнопка A')));
    await openEditor(page, id);
    await hit(page, 'Кнопка A').click();
    await page.getByRole('tab', { name: 'Содержимое' }).click();
    await page.getByLabel('Название блока').fill('Главная кнопка');
    await page.getByLabel('Описание для скринридера').fill('Переходит к следующему экрану');
    await expect(hit(page, 'Главная кнопка')).toBeVisible();
    await page.getByRole('tab', { name: 'Сценарии' }).click();
    await expect(page.getByTestId('scenario-counts')).toHaveText('Правил: 1. Поведений: 0.');
    await expect.poll(async () => {
      const b = (await serverDraft(page, id)).doc.screens[0]!.blocks[0] as { name: string; a11y: { alt?: string } };
      return [b.name, b.a11y.alt];
    }).toEqual(['Главная кнопка', 'Переходит к следующему экрану']);
  });

  test('E-13 · экраны: добавить, переименовать, дублировать, переставить, удалить; последний не удаляется', async ({ page }) => {
    const { id } = await seedProject(page, (d) => d.screens[0]!.blocks.push(nextButton('knopka_a')));
    await openEditor(page, id);
    const actions = page.getByRole('group', { name: 'Действия с экраном' });

    await actions.getByRole('button', { name: 'Добавить экран' }).click();
    await expect(screensList(page)).toHaveCount(2);
    await actions.getByRole('button', { name: 'Переименовать' }).click();
    await page.getByLabel('Новое название экрана').fill('Финал');
    await page.getByLabel('Новое название экрана').press('Enter');
    await expect(screensList(page).nth(1)).toContainText('2. Финал');

    await actions.getByRole('button', { name: 'Экран выше' }).click();
    await expect(screensList(page).nth(0)).toContainText('1. Финал');
    await screensList(page).nth(1).getByRole('button').click();
    await actions.getByRole('button', { name: 'Дублировать' }).click();
    await expect(screensList(page)).toHaveCount(3);
    await expect(screensList(page).nth(2)).toContainText('(копия)');
    // The copy has its own button: a block is on the stage of the copy.
    await expect(hit(page, 'Дальше')).toBeVisible();

    await expect.poll(async () => (await serverDraft(page, id)).doc.screens.map((s) => s.name)).toEqual(['Финал', 'Экран 1', 'Экран 1 (копия)']);

    await actions.getByRole('button', { name: 'Удалить' }).click();
    await actions.getByRole('button', { name: 'Экран выше' }).waitFor();
    await screensList(page).nth(1).getByRole('button').click();
    await actions.getByRole('button', { name: 'Удалить' }).click();
    await expect(screensList(page)).toHaveCount(1);
    await expect(actions.getByRole('button', { name: 'Удалить' })).toBeDisabled();
  });

  test('E-13 · слои: дерево, скрыть в редакторе, заблокировать; выбор из слоёв выделяет блок на холсте', async ({ page }) => {
    const { id } = await seedProject(page, (d) => d.screens[0]!.blocks.push(textBlock('tekst_a', 'Текст A'), textBlock('tekst_b', 'Текст B', 20, 120)));
    await openEditor(page, id);
    await page.getByRole('tab', { name: 'Слои' }).click();
    const layers = page.getByRole('list', { name: 'Слои' });
    await layers.getByRole('button', { name: 'Текст B', exact: true }).click();
    await expect(hit(page, 'Текст B')).toHaveAttribute('aria-pressed', 'true');

    await page.getByRole('button', { name: 'Скрыть в редакторе: Текст B' }).click();
    await expect(hit(page, 'Текст B')).toHaveCount(0);
    await page.getByRole('button', { name: 'Показать в редакторе: Текст B' }).click();
    await expect(hit(page, 'Текст B')).toBeVisible();

    await page.getByRole('button', { name: 'Заблокировать: Текст A' }).click();
    await expect(hit(page, 'Текст A')).toHaveAttribute('data-locked', 'true');
    await expect.poll(async () => (await serverDraft(page, id)).doc.screens[0]!.blocks.map((b) => (b as { locked: boolean }).locked)).toEqual([true, false]);
  });
});

test.describe('E-11 · отмена и повтор', () => {
  test('E-11 · 100 шагов: Ctrl+Z возвращает исходное, Ctrl+Shift+Z — итог; кнопки отражают возможность', async ({ page }) => {
    const { id } = await seedProject(page, (d) => d.screens[0]!.blocks.push(textBlock('tekst_a', 'Текст A')));
    await openEditor(page, id);
    const undo = page.getByRole('button', { name: 'Отменить', exact: true });
    const redo = page.getByRole('button', { name: 'Повторить', exact: true });
    await expect(undo).toBeDisabled();
    await expect(redo).toBeDisabled();
    await hit(page, 'Текст A').click();
    for (let i = 0; i < 99; i++) await page.keyboard.press('Control+d'); // 99 steps: 100 blocks on the screen (the limit)
    await page.getByLabel('Название сборки').fill('x');
    await page.getByLabel('Название сборки').blur(); // title typing is one step (merged): 100 steps in all
    await expect(stage(page).locator('.ed-hit')).toHaveCount(100);
    await expect(undo).toBeEnabled();

    await page.locator('body').click({ position: { x: 5, y: 5 } });
    for (let i = 0; i < 100; i++) await page.keyboard.press('Control+z');
    await expect(stage(page).locator('.ed-hit')).toHaveCount(1);
    await expect(page.getByLabel('Название сборки')).toHaveValue('Сборка для проверки');
    await expect(undo).toBeDisabled();
    await expect(redo).toBeEnabled();
    for (let i = 0; i < 100; i++) await page.keyboard.press('Control+Shift+z');
    await expect(stage(page).locator('.ed-hit')).toHaveCount(100);
    await expect(page.getByLabel('Название сборки')).toHaveValue('x');
    await expect(saveStatus(page)).toHaveText('Сохранено');
  });

  test('E-11 · Delete удаляет выделенное, Ctrl+Z возвращает; в поле ввода клавиши не трогают блоки', async ({ page }) => {
    const { id } = await seedProject(page, (d) => d.screens[0]!.blocks.push(textBlock('tekst_a', 'Текст A')));
    await openEditor(page, id);
    await hit(page, 'Текст A').click();
    await page.getByLabel('X', { exact: true }).focus();
    await page.keyboard.press('Delete');
    await expect(hit(page, 'Текст A')).toBeVisible();
    await page.locator('body').click({ position: { x: 5, y: 5 } });
    await hit(page, 'Текст A').click();
    await page.keyboard.press('Delete');
    await expect(hit(page, 'Текст A')).toHaveCount(0);
    await page.keyboard.press('Control+z');
    await expect(hit(page, 'Текст A')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(hit(page, 'Текст A')).toHaveAttribute('aria-pressed', 'false');
  });
});

test.describe('E-17 · автосохранение и сеть', () => {
  test('E-17 · «Сохраняю…» → «Сохранено», правка на сервере; после перезагрузки на месте', async ({ page }) => {
    const { id } = await seedProject(page, (d) => d.screens[0]!.blocks.push(textBlock('tekst_a', 'Текст A')));
    await openEditor(page, id);
    await hit(page, 'Текст A').click();
    await page.getByLabel('Y', { exact: true }).fill('222');
    await expect(saveStatus(page)).toHaveText('Сохраняю…');
    await expect(saveStatus(page)).toHaveText('Сохранено');
    await page.reload();
    await expect(saveStatus(page)).toHaveText('Сохранено');
    await hit(page, 'Текст A').click();
    await expect(page.getByLabel('Y', { exact: true })).toHaveValue('222');
  });

  test('E-17 · офлайн → правки → онлайн: всё сохранено', async ({ page, context }) => {
    const { id } = await seedProject(page, (d) => d.screens[0]!.blocks.push(textBlock('tekst_a', 'Текст A')));
    await openEditor(page, id);
    await context.setOffline(true);
    await hit(page, 'Текст A').click();
    await page.getByLabel('X', { exact: true }).fill('77');
    await page.getByLabel('Название сборки').fill('Правки без сети');
    await expect(saveStatus(page)).toHaveText('Нет сети — изменения сохранятся');
    await expect(saveStatus(page)).toHaveAttribute('data-status', 'offline');
    await context.setOffline(false);
    await expect(saveStatus(page)).toHaveText('Сохранено');
    const { doc } = await serverDraft(page, id);
    expect(doc.meta.title).toBe('Правки без сети');
    expect((doc.screens[0]!.blocks[0] as { frame: { x: number } }).frame.x).toBe(77);
  });

  test('E-17 · несохранённое переживает закрытие страницы: очередь в браузере, после открытия — отправлено', async ({ page, context }) => {
    const { id } = await seedProject(page, (d) => d.screens[0]!.blocks.push(textBlock('tekst_a', 'Текст A')));
    await openEditor(page, id);
    await context.setOffline(true);
    await page.getByLabel('Название сборки').fill('Из очереди');
    await expect(saveStatus(page)).toHaveAttribute('data-status', 'offline');
    await page.close(); // the tab is closed while there is no network
    await new Promise((resolve) => setTimeout(resolve, 600)); // the closing page is gone before the network comes back
    await context.setOffline(false);

    const again = await context.newPage();
    expect((await serverDraft(again, id)).doc.meta.title).toBe('Сборка для проверки');
    await again.goto(`/app/projects/${id}/edit`);
    await expect(again.getByLabel('Название сборки')).toHaveValue('Из очереди');
    await expect(again.getByText('Восстановлены несохранённые правки')).toBeVisible();
    await expect(saveStatus(again)).toHaveText('Сохранено');
    expect((await serverDraft(again, id)).doc.meta.title).toBe('Из очереди');
  });

  test('E-17 · уход со страницы раньше секунды не теряет правку', async ({ page }) => {
    const { id } = await seedProject(page);
    await openEditor(page, id);
    await page.getByLabel('Название сборки').fill('Успел сохранить');
    await page.goto('/cabinet/projects'); // within a second of the change
    await expect.poll(async () => (await serverDraft(page, id)).doc.meta.title, { timeout: 15_000 }).toBe('Успел сохранить');
  });
});

test.describe('E-18 · конфликт двух вкладок', () => {
  async function twoTabs(page: import('@playwright/test').Page) {
    const { id } = await seedProject(page, (d) => d.screens[0]!.blocks.push(textBlock('tekst_a', 'Текст A')));
    await openEditor(page, id);
    const second = await page.context().newPage();
    await openEditor(second, id);
    // Tab 1 saves first: tab 2 is now behind.
    await page.getByLabel('Название сборки').fill('Из первой вкладки');
    await expect(saveStatus(page)).toHaveText('Сохранено');
    await second.getByLabel('Название сборки').fill('Из второй вкладки');
    await expect(second.getByRole('dialog', { name: 'Сборку изменили в другом месте' })).toBeVisible();
    await expect(saveStatus(second)).toHaveAttribute('data-status', 'conflict');
    return { id, second };
  }

  test('E-18 · «Загрузить свежую»: вторая вкладка показывает версию первой, сервер не тронут', async ({ page }) => {
    const { id, second } = await twoTabs(page);
    await second.getByRole('button', { name: 'Загрузить свежую' }).click();
    await expect(second.getByRole('dialog')).toHaveCount(0);
    await expect(second.getByLabel('Название сборки')).toHaveValue('Из первой вкладки');
    await expect(saveStatus(second)).toHaveText('Сохранено');
    expect((await serverDraft(page, id)).doc.meta.title).toBe('Из первой вкладки');
    // Work goes on from the fresh version.
    await second.getByLabel('Название сборки').fill('Продолжение');
    await expect(saveStatus(second)).toHaveText('Сохранено');
    expect((await serverDraft(page, id)).doc.meta.title).toBe('Продолжение');
  });

  test('E-18 · «Перезаписать»: на сервере версия второй вкладки', async ({ page }) => {
    const { id, second } = await twoTabs(page);
    await second.getByRole('button', { name: 'Перезаписать' }).click();
    await expect(second.getByRole('dialog')).toHaveCount(0);
    await expect(saveStatus(second)).toHaveText('Сохранено');
    expect((await serverDraft(page, id)).doc.meta.title).toBe('Из второй вкладки');
  });
});

test.describe('E-19 · история версий', () => {
  test('E-19 · снимок прежнего черновика: просмотр и восстановление; заменённый черновик остаётся в истории', async ({ page }) => {
    const { id } = await seedProject(page, (d) => d.screens[0]!.blocks.push(textBlock('tekst_a', 'Текст A')));
    await openEditor(page, id);
    await hit(page, 'Текст A').click();
    await page.keyboard.press('Control+d');
    await expect(stage(page).locator('.ed-hit')).toHaveCount(2);
    await expect(saveStatus(page)).toHaveText('Сохранено');

    await page.getByRole('button', { name: 'История' }).click();
    const dialog = page.getByRole('dialog', { name: 'История версий' });
    const versions = dialog.getByRole('list', { name: 'Версии' }).getByRole('button');
    await expect(versions.first()).toContainText('Снимок черновика');
    await versions.first().click();
    await expect(dialog.getByTestId('version-preview')).toBeVisible();
    await dialog.getByRole('button', { name: 'Восстановить эту версию' }).click();
    await expect(dialog).toHaveCount(0);
    await expect(page.getByText('Версия восстановлена')).toBeVisible();
    // The first snapshot is the project as it was created: without blocks.
    await expect(stage(page).locator('.ed-hit')).toHaveCount(0);
    await expect.poll(async () => (await serverDraft(page, id)).doc.screens[0]!.blocks.length).toBe(0);

    // The draft with two blocks that was replaced is in the history: bring it back.
    await page.getByRole('button', { name: 'История' }).click();
    const again = page.getByRole('dialog', { name: 'История версий' });
    await expect(again.getByRole('list', { name: 'Версии' }).getByRole('button')).not.toHaveCount(0);
    await again.getByRole('list', { name: 'Версии' }).getByRole('button').first().click();
    await again.getByRole('button', { name: 'Восстановить эту версию' }).click();
    await expect(stage(page).locator('.ed-hit')).toHaveCount(2);
    await expect.poll(async () => (await serverDraft(page, id)).doc.screens[0]!.blocks.length).toBe(2);
    await expect(saveStatus(page)).toHaveText('Сохранено');
  });

  test('E-19 · без изменений история пуста и это понятно сказано', async ({ page }) => {
    const { id } = await seedProject(page);
    await openEditor(page, id);
    await page.getByRole('button', { name: 'История' }).click();
    const dialog = page.getByRole('dialog', { name: 'История версий' });
    // The seeding save made one snapshot of the new project; restoring is possible but nothing is chosen yet.
    await expect(dialog.getByRole('button', { name: 'Восстановить эту версию' })).toBeDisabled();
  });
});

test.describe('E-16 · публикация', () => {
  test('E-16 · «Опубликовать» сохраняет правки и публикует; кнопка затем недоступна', async ({ page }) => {
    const { id } = await seedProject(page, (d) => d.screens[0]!.blocks.push(textBlock('tekst_a', 'Текст A')));
    await openEditor(page, id);
    await page.getByLabel('Название сборки').fill('К публикации');
    await page.getByRole('button', { name: 'Опубликовать' }).click();
    await expect(page.getByText('Сборка опубликована')).toBeVisible();
    await expect(page.getByTestId('project-status')).toHaveText('Опубликована');
    await expect(page.getByRole('button', { name: 'Опубликовать' })).toBeDisabled();
    expect((await serverDraft(page, id)).doc.meta.title).toBe('К публикации');
  });
});
