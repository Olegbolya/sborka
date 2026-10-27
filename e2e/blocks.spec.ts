import { mkdirSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { BLOCK_TYPES, createBlock, type BlockType } from '../packages/schema/dist/index.js';
import { freshUser, loginAndOnboard } from './helpers/auth';
import { hit, openEditor, saveStatus, seedProject, serverDraft } from './helpers/editor';

test.beforeEach(async ({ page }) => {
  await loginAndOnboard(page, freshUser('Автор'));
});

type Saved = Record<string, any> & { type: string; name: string; props: Record<string, any>; children: Saved[] };

const savedBlocks = async (page: Page, id: string): Promise<Saved[]> => {
  await expect(saveStatus(page)).toHaveText('Сохранено');
  return (await serverDraft(page, id)).doc.screens[0]!.blocks as Saved[];
};

const open = async (page: Page, shape?: Parameters<typeof seedProject>[1]) => {
  const { id } = await seedProject(page, shape);
  await openEditor(page, id);
  return id;
};

const add = async (page: Page, type: BlockType) => {
  await page.getByRole('tab', { name: 'Добавить' }).click();
  await page.locator(`[data-add-type="${type}"]`).click();
};

const contentTab = (page: Page) => page.getByRole('tab', { name: 'Содержимое' }).click();

test.describe('P3.5 · каталог блоков', () => {
  for (const type of BLOCK_TYPES.filter((t) => t !== 'consent')) {
    test(`E-14 · «Добавить» кладёт на экран блок «${type}» — он в документе и на холсте`, async ({ page }) => {
      const id = await open(page);
      await add(page, type);
      const expected = createBlock(type);
      await expect(hit(page, expected.name)).toBeVisible();
      const blocks = await savedBlocks(page, id);
      expect(blocks[0]).toMatchObject({ type, name: expected.name });
      expect(blocks).toHaveLength(type === 'contacts' ? 2 : 1);
      // Новый блок выбран: его свойства уже в панели справа.
      await expect(page.getByTestId('own-fills')).toHaveCount(0);
      await expect(page.getByRole('complementary', { name: 'Свойства' })).toBeVisible();
    });
  }

  test('B-19 · контактные данные приходят вместе с согласием на обработку персональных данных', async ({ page }) => {
    const id = await open(page);
    await add(page, 'contacts');
    const blocks = await savedBlocks(page, id);
    expect(blocks.map((b) => b.type)).toEqual(['contacts', 'consent']);
    await expect(hit(page, 'Согласие на обработку ПД')).toBeVisible();
  });

  test('E-14 · поиск находит блок по слову и не показывает остальные', async ({ page }) => {
    await open(page);
    await page.getByRole('tab', { name: 'Добавить' }).click();
    await page.getByLabel('Найти блок').fill('шкал');
    await expect(page.locator('[data-add-type]')).toHaveCount(1);
    await expect(page.locator('[data-add-type="scale"]')).toBeVisible();
    await page.getByLabel('Найти блок').fill('такого нет');
    await expect(page.getByText('Такого блока нет.')).toBeVisible();
  });

  test('B-21 · выбранный контейнер принимает новый блок внутрь', async ({ page }) => {
    const id = await open(page);
    await add(page, 'container');
    await add(page, 'button');
    const blocks = await savedBlocks(page, id);
    expect(blocks.map((b) => b.type)).toEqual(['container']);
    expect(blocks[0]!.children.map((b) => b.type)).toEqual(['button']);
  });
});

test.describe('P3.5 · содержимое блоков', () => {
  test('B-08 · свойство таймера меняется и сохраняется; значение вне границ схемы не принимается', async ({ page }) => {
    const id = await open(page);
    await add(page, 'timer');
    await contentTab(page);
    const seconds = page.getByLabel('Секунд', { exact: true });
    await seconds.fill('90');
    await expect(seconds).toHaveValue('90');
    expect((await savedBlocks(page, id))[0]!.props.seconds).toBe(90);
    await page.getByTestId('props-inspector').getByLabel('Вид', { exact: true }).selectOption('words');
    expect((await savedBlocks(page, id))[0]!.props).toMatchObject({ seconds: 90, format: 'words' });
  });

  test('B-11 · варианты вопроса: добавить, поправить текст, отметить правильный, баллы, метки, порядок, убрать', async ({ page }) => {
    const id = await open(page);
    await add(page, 'singleChoice');
    await contentTab(page);
    await page.getByRole('button', { name: 'Добавить вариант' }).click();
    await expect(page.locator('[data-option]')).toHaveCount(3);
    await page.getByLabel('Текст варианта 3').fill('Третий');
    await page.locator('[data-control="option-2.correct"]').getByRole('checkbox').check();
    await page.getByLabel('Баллы').nth(2).fill('7');
    await page.getByLabel('Метки результата (через запятую)').nth(2).fill('лиса, сова');
    await page.getByRole('button', { name: 'Вариант 3: выше' }).click();
    let q = (await savedBlocks(page, id))[0]!;
    expect(q.props.options).toHaveLength(3);
    expect(q.children).toHaveLength(3);
    expect(q.props.options[1]).toMatchObject({ correct: true, score: 7, resultTags: ['лиса', 'сова'] });
    expect(q.children.find((c) => c.id === q.props.options[1].blockId)!.textLayer.paragraphs[0].runs[0].t).toBe('Третий');
    await page.getByRole('button', { name: 'Вариант 3: убрать' }).click();
    await expect(page.locator('[data-option]')).toHaveCount(2);
    await expect(page.getByRole('button', { name: 'Вариант 2: убрать' })).toBeDisabled();
    q = (await savedBlocks(page, id))[0]!;
    expect(q.props.options).toHaveLength(2);
    expect(q.children).toHaveLength(2);
  });

  test('B-12 · в вопросе с несколькими ответами правильными можно отметить сколько угодно вариантов', async ({ page }) => {
    const id = await open(page);
    await add(page, 'multiChoice');
    await contentTab(page);
    await page.locator('[data-control="option-0.correct"]').getByRole('checkbox').check();
    await page.locator('[data-control="option-1.correct"]').getByRole('checkbox').check();
    expect((await savedBlocks(page, id))[0]!.props.options.map((o: { correct: boolean }) => o.correct)).toEqual([true, true]);
  });

  test('B-23 · блок «Значение» привязывается к новой переменной, имя которой проверяется', async ({ page }) => {
    const id = await open(page);
    await add(page, 'value');
    await contentTab(page);
    await page.getByLabel('Имя новой переменной').fill('1 плохо');
    await page.getByRole('button', { name: 'Создать' }).click();
    await expect(page.getByRole('alert').filter({ hasText: 'Имя — буквы' })).toBeVisible();
    await page.getByLabel('Имя новой переменной').fill('очки');
    await page.getByRole('button', { name: 'Создать' }).click();
    await expect(page.getByLabel('Переменная', { exact: true })).toHaveText(/очки/);
    await expect(saveStatus(page)).toHaveText('Сохранено');
    const draft = (await serverDraft(page, id)).doc as unknown as { variables: Array<{ id: string; name: string }>; screens: Array<{ blocks: Saved[] }> };
    expect(draft.variables.map((v) => v.name)).toEqual(['очки']);
    expect(draft.screens[0]!.blocks[0]!.props.variableId).toBe(draft.variables[0]!.id);
  });

  test('B-19 · набор запрашиваемых контактов: хотя бы одно поле остаётся', async ({ page }) => {
    const id = await open(page);
    await add(page, 'contacts');
    await contentTab(page);
    const group = page.getByRole('group', { name: 'Что спрашивать' });
    await group.getByLabel('Email').check();
    expect((await savedBlocks(page, id))[0]!.props.fields).toEqual(['name', 'phone', 'email']);
    await group.getByLabel('Имя').uncheck();
    await group.getByLabel('Телефон').uncheck();
    await group.getByLabel('Email').click();
    await expect(group.getByLabel('Email')).toBeChecked();
    expect((await savedBlocks(page, id))[0]!.props.fields).toEqual(['email']);
  });

  test('B-13 · пункты ранжирования: добавить, переименовать, переставить', async ({ page }) => {
    const id = await open(page);
    await add(page, 'ranking');
    await contentTab(page);
    await page.getByRole('button', { name: 'Добавить', exact: true }).click();
    await page.getByLabel('Название пункта').nth(3).fill('Четвёртый');
    await page.getByRole('button', { name: 'Пункты 4: выше' }).click();
    const items = (await savedBlocks(page, id))[0]!.props.items as Array<{ label: string }>;
    expect(items.map((i) => i.label)).toEqual(['Пункт 1', 'Пункт 2', 'Четвёртый', 'Пункт 3']);
  });

  test('B-01 · текст: жирный, список, ссылка и подстановка переменной сохраняются в документе', async ({ page }) => {
    const id = await open(page);
    await add(page, 'text');
    await contentTab(page);
    const field = page.getByRole('textbox', { name: 'Текст блока' });
    await field.click();
    await page.keyboard.press('Control+A');
    await page.keyboard.type('Привет');
    await page.keyboard.press('Control+A');
    await page.getByRole('button', { name: 'Жирный' }).click();
    await page.keyboard.press('End');
    await page.keyboard.press('Enter');
    await expect(field.locator('p')).toHaveCount(2);
    await page.getByRole('button', { name: 'Список', exact: true }).click();
    await expect(field.locator('li')).toHaveCount(1);
    await page.keyboard.type('пункт');
    await page.getByLabel('Вставить в текст').selectOption({ label: 'баллы' });
    // Сохранение идёт с небольшой задержкой: ждём, пока в документе на сервере появится вся правка.
    await expect
      .poll(async () => (await serverDraft(page, id)).doc.screens[0]!.blocks[0] as Saved, { timeout: 15_000 })
      .toMatchObject({
        textLayer: {
          paragraphs: [
            { kind: 'p', runs: [{ t: 'Привет', b: true }] },
            { kind: 'bullet', runs: [{ t: 'пункт' }, { sys: 'баллы' }] },
          ],
        },
      });
    await page.keyboard.press('Control+A');
    await page.getByRole('button', { name: 'Ссылка', exact: true }).click();
    await page.getByLabel('Адрес ссылки').fill('javascript:alert(1)');
    await page.getByRole('button', { name: 'Поставить' }).click();
    await expect(page.getByRole('alert').filter({ hasText: 'Ссылка должна начинаться' })).toBeVisible();
    await page.getByLabel('Адрес ссылки').fill('https://example.ru/a');
    await page.getByRole('button', { name: 'Поставить' }).click();
    await expect.poll(async () => JSON.stringify((await serverDraft(page, id)).doc.screens[0]!.blocks[0]), { timeout: 15_000 }).toContain('"href":"https://example.ru/a"');
    expect(JSON.stringify((await serverDraft(page, id)).doc.screens[0]!.blocks[0])).not.toContain('javascript');
  });

  test('B-01 · отмена возвращает прежний текст и в редакторе текста', async ({ page }) => {
    const id = await open(page);
    await add(page, 'text');
    await contentTab(page);
    const field = page.getByRole('textbox', { name: 'Текст блока' });
    await field.click();
    await page.keyboard.press('Control+A');
    await page.keyboard.type('Первый');
    await expect(saveStatus(page)).toHaveText('Сохранено');
    await page.locator('body').click({ position: { x: 5, y: 5 } });
    await page.getByRole('button', { name: 'Отменить' }).click();
    await expect(field).not.toHaveText('Первый');
    const runs = (await savedBlocks(page, id))[0]!.textLayer?.paragraphs?.[0]?.runs ?? [];
    expect(JSON.stringify(runs)).not.toContain('Первый');
  });

  test('B-02 · изображение из медиатеки добавляется готовым блоком с пропорциями файла', async ({ page }) => {
    const id = await open(page);
    await page.getByRole('tab', { name: 'Добавить' }).click();
    await page.getByRole('button', { name: 'Из медиатеки', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Выбор файла' });
    await dialog.getByLabel('Загрузить файл').setInputFiles({
      name: 'foto.png',
      mimeType: 'image/png',
      buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64'),
    });
    await expect(dialog).toBeHidden();
    const block = (await savedBlocks(page, id))[0]!;
    expect(block.type).toBe('image');
    expect(block.props.media.source).toBe('media');
    expect(block.frame.w).toBe(300);
    // Размеры файла ещё не известны (их определяет обработка): берётся 4:3.
    expect(block.frame.h).toBe(225);
  });
});

test('E-14 · вид панелей «Добавить» и «Содержимое» вопроса (снимки)', async ({ page }, info) => {
  mkdirSync('e2e/__screenshots__', { recursive: true });
  await open(page);
  await add(page, 'singleChoice');
  await page.getByRole('tab', { name: 'Добавить' }).click();
  await page.screenshot({ path: `e2e/__screenshots__/blocks-add-${info.project.name}.png` });
  await contentTab(page);
  await page.screenshot({ path: `e2e/__screenshots__/blocks-content-${info.project.name}.png`, fullPage: true });
});
