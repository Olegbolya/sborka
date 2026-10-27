import { mkdirSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { freshUser, loginAndOnboard } from './helpers/auth';
import { nextButton, openEditor, seedProject, serverDraft, textBlock } from './helpers/editor';

test.beforeEach(async ({ page }) => {
  await loginAndOnboard(page, freshUser('Автор'));
});

const question = (id: string, name: string, y: number, texts: string[]) => ({
  id,
  type: 'singleChoice',
  name,
  frame: { x: 20, y, w: 300, h: 60 * texts.length },
  props: { options: texts.map((_t, i) => ({ id: `${id}_o${i + 1}`, blockId: `${id}_v${i + 1}` })) },
  children: texts.map((t, i) => ({ ...textBlock(`${id}_v${i + 1}`, t, 0, i * 60, 300, 50), type: 'shape' })),
});

const goTo = (id: string, name: string, y: number, to: Record<string, unknown>) => ({
  ...nextButton(id, name, y),
  rules: [{ id: `${id}_pravilo`, when: { kind: 'tap', source: { kind: 'block', blockId: id } }, do: [to] }],
});

const resultScreen = (id: string, name: string, text: string) => ({ id, name, kind: 'result', blocks: [textBlock(`${id}_t`, text, 20, 60, 300, 60)] });

const openLogic = async (page: Page, tab: string) => {
  await page.getByRole('button', { name: 'Логика', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Логика сборки' });
  await dialog.getByRole('tab', { name: new RegExp(`^${tab}`) }).click();
  return dialog;
};

const play = async (page: Page, picks: string[]) => {
  await page.getByRole('button', { name: 'Предпросмотр' }).click();
  const dialog = page.getByRole('dialog', { name: 'Предпросмотр' });
  const frame = dialog.locator('[data-preview="true"]');
  await frame.locator('.bk-player-screen[data-live="true"]').waitFor();
  await frame.getByText(picks[0]!, { exact: true }).click();
  await frame.getByRole('button', { name: 'Дальше' }).click();
  await frame.getByText(picks[1]!, { exact: true }).click();
  await frame.getByRole('button', { name: 'Узнать' }).click();
  return { dialog, frame };
};

test.describe('P3.7 · логика', () => {
  test('L-04 · личностный тест на 3 результата собирается через интерфейс и проходится тремя путями', async ({ page }, info) => {
    const { id } = await seedProject(page, (d) => {
      d.screens[0]!.blocks.push(question('vopros_1', 'Вопрос 1', 40, ['Лиса 1', 'Сова 1', 'Волк 1']), nextButton('knopka_1', 'Дальше', 300));
      d.screens.push({ id: 'ekran_dva', name: 'Второй', blocks: [question('vopros_2', 'Вопрос 2', 40, ['Лиса 2', 'Сова 2', 'Волк 2']), goTo('knopka_2', 'Узнать', 300, { kind: 'finish' })] });
      d.screens.push(resultScreen('itog_lisa', 'Итог лиса', 'Вы — лиса'), resultScreen('itog_sova', 'Итог сова', 'Вы — сова'), resultScreen('itog_volk', 'Итог волк', 'Вы — волк'));
    });
    await openEditor(page, id);

    // Метки результата у шести вариантов — в панели «Содержимое» вопроса.
    for (const [screenName, q, tags] of [['Экран 1', 'Вопрос 1', ['лиса', 'сова', 'волк']], ['Второй', 'Вопрос 2', ['лиса', 'сова', 'волк']]] as const) {
      await page.getByRole('tab', { name: 'Экраны' }).click();
      await page.getByRole('button', { name: new RegExp(screenName) }).first().click();
      await page.getByRole('tab', { name: 'Слои' }).click();
      await page.getByRole('list', { name: 'Слои' }).getByRole('button', { name: q, exact: true }).click();
      await page.getByRole('tab', { name: 'Содержимое' }).click();
      for (const [i, tag] of tags.entries()) await page.getByLabel('Метки результата (через запятую)').nth(i).fill(tag);
    }

    // Три результата по меткам.
    const dialog = await openLogic(page, 'Результаты');
    for (const [i, [name, tag, screen]] of ([['Лиса', 'лиса', 'Итог лиса'], ['Сова', 'сова', 'Итог сова'], ['Волк', 'волк', 'Итог волк']] as const).entries()) {
      await dialog.getByRole('button', { name: 'Добавить результат по метке' }).click();
      const n = i + 1;
      await dialog.getByLabel(`Результат ${n}: название`).fill(name);
      await dialog.getByLabel(`Результат ${n}: метка`).fill(tag);
      await dialog.getByLabel(`Результат ${n}: какой экран показать`).selectOption({ label: `${screen} (результат)` });
    }
    await dialog.getByRole('button', { name: 'Закрыть' }).click();
    await expect.poll(async () => ((await serverDraft(page, id)).doc as unknown as { results: Array<{ tag: string; screenId: string }> }).results.map((r) => `${r.tag}:${r.screenId}`), { timeout: 15_000 }).toEqual(['лиса:itog_lisa', 'сова:itog_sova', 'волк:itog_volk']);

    mkdirSync('e2e/__screenshots__', { recursive: true });
    for (const [picks, text] of [
      [['Лиса 1', 'Лиса 2'], 'Вы — лиса'],
      [['Сова 1', 'Сова 2'], 'Вы — сова'],
      [['Волк 1', 'Волк 2'], 'Вы — волк'],
    ] as const) {
      const run = await play(page, [...picks]);
      await expect(run.frame.getByText(text)).toBeVisible();
      if (text === 'Вы — сова') await page.screenshot({ path: `e2e/__screenshots__/logic-result-${info.project.name}.png` });
      await run.dialog.getByRole('button', { name: 'Закрыть' }).click();
    }
  });

  test('L-02 · ветка «если выбран вариант → экран Y, иначе следующий» проходится в предпросмотре обоими путями', async ({ page }) => {
    const { id } = await seedProject(page, (d) => {
      d.screens[0]!.blocks.push(question('vopros_1', 'Вопрос', 40, ['Налево', 'Направо']), goTo('knopka_1', 'Дальше', 300, { kind: 'goTo', to: 'branch' }));
      d.screens.push({ id: 'ekran_b', name: 'Серединный', blocks: [textBlock('seredina_t', 'Это середина', 20, 60, 300, 60)] });
      d.screens.push({ id: 'ekran_c', name: 'Дальний', blocks: [textBlock('dalnij_t', 'Это дальний экран', 20, 60, 300, 60)] });
    });
    await openEditor(page, id);
    const dialog = await openLogic(page, 'Ветвление');
    await dialog.getByRole('button', { name: 'Добавить ветку' }).click();
    // По умолчанию условие — «выбран первый вариант первого вопроса экрана».
    await dialog.getByLabel('Ветка 1: куда').selectOption('screen');
    await dialog.getByLabel('Ветка 1: экран').selectOption({ label: '3. Дальний' });
    await expect(dialog.getByLabel('Ветка 1: вариант')).toHaveValue('vopros_1_o1');
    await expect.poll(async () => JSON.stringify(((await serverDraft(page, id)).doc.screens[0] as unknown as { branches: unknown[] }).branches), { timeout: 15_000 }).toContain('ekran_c');
    await dialog.getByRole('button', { name: 'Закрыть' }).click();

    for (const [pick, expected] of [['Налево', 'Это дальний экран'], ['Направо', 'Это середина']] as const) {
      await page.getByRole('button', { name: 'Предпросмотр' }).click();
      const preview = page.getByRole('dialog', { name: 'Предпросмотр' });
      const frame = preview.locator('[data-preview="true"]');
      await frame.locator('.bk-player-screen[data-live="true"]').waitFor();
      await frame.getByText(pick, { exact: true }).click();
      await frame.getByRole('button', { name: 'Дальше' }).click();
      await expect(frame.getByText(expected)).toBeVisible();
      await preview.getByRole('button', { name: 'Закрыть' }).click();
    }
  });

  test('L-02 · условие ветки: любой вид из схемы выбирается, группы вкладываются', async ({ page }) => {
    const { id } = await seedProject(page, (d) => {
      d.screens[0]!.blocks.push(question('vopros_1', 'Вопрос', 40, ['Один', 'Два']), nextButton('knopka_1', 'Дальше', 300));
      d.screens.push({ id: 'ekran_b', name: 'Второй', blocks: [] });
      d.variables.push({ id: 'peremennaya_ochki', name: 'Очки', type: 'number', initial: 0, saveToAnswers: false });
    });
    await openEditor(page, id);
    const dialog = await openLogic(page, 'Ветвление');
    await dialog.getByRole('button', { name: 'Добавить ветку' }).click();
    const kind = dialog.getByLabel('Ветка 1: что проверяем');
    await kind.selectOption('variable');
    await dialog.getByLabel('Ветка 1: переменная').selectOption({ label: 'Очки' });
    await dialog.getByLabel('Ветка 1: значение').fill('3');
    await kind.selectOption('group');
    await dialog.getByRole('button', { name: 'Ветка 1: добавить условие' }).click();
    await dialog.getByLabel('Ветка 1.2: что проверяем').selectOption('chance');
    await dialog.getByLabel('Ветка 1.2: вероятность').fill('25');
    await dialog.getByLabel('Ветка 1: когда').selectOption('or');
    await expect
      .poll(async () => JSON.stringify(((await serverDraft(page, id)).doc.screens[0] as unknown as { branches: Array<{ if: unknown }> }).branches[0]?.if), { timeout: 15_000 })
      .toContain('"op":"or"');
    const saved = ((await serverDraft(page, id)).doc.screens[0] as unknown as { branches: Array<{ if: { items: Array<Record<string, unknown>> } }> }).branches[0]!.if;
    expect(saved.items.map((i) => i.kind)).toEqual(['variable', 'chance']);
    expect(saved.items[0]).toMatchObject({ variableId: 'peremennaya_ochki', value: 3 });
    expect(saved.items[1]).toMatchObject({ percent: 25 });
  });

  test('L-02 · схема: недостижимый экран и круг подсвечены, остальное — нет', async ({ page }, info) => {
    const { id } = await seedProject(page, (d) => {
      d.screens[0]!.blocks.push(goTo('knopka_a', 'К третьему', 100, { kind: 'goTo', to: 'screen', screenId: 'ekran_c' }));
      d.screens.push({ id: 'ekran_b', name: 'Забытый', blocks: [] });
      d.screens.push({ id: 'ekran_c', name: 'Третий', blocks: [goTo('knopka_c', 'Обратно', 100, { kind: 'goTo', to: 'screen', screenId: 'ekran_d' })] });
      d.screens.push({ id: 'ekran_d', name: 'Четвёртый', blocks: [goTo('knopka_d1', 'Назад в круг', 100, { kind: 'goTo', to: 'screen', screenId: 'ekran_c' }), goTo('knopka_d2', 'Выход', 200, { kind: 'finish' })] });
    });
    await openEditor(page, id);
    const dialog = await openLogic(page, 'Схема');
    const node = (screenId: string) => dialog.locator(`[data-screen-node="${screenId}"]`);
    await expect(node('ekran_b')).toHaveAttribute('data-state', 'unreachable');
    await expect(node('ekran_c')).toHaveAttribute('data-state', 'loop');
    await expect(node('ekran_d')).toHaveAttribute('data-state', 'loop');
    await expect(dialog.getByTestId('graph-summary').locator('[data-problem="unreachable"]')).toContainText('Забытый');
    await expect(dialog.locator('[data-edge="ekran_c>ekran_d"]')).toHaveCount(1);
    await expect(dialog.locator('[data-edge="ekran_d>ekran_c"]')).toHaveAttribute('data-back', 'true');
    await page.screenshot({ path: `e2e/__screenshots__/logic-graph-${info.project.name}.png` });
    // Клик по экрану ведёт к его веткам.
    await node('ekran_c').click();
    await expect(dialog.getByLabel('Экран', { exact: true })).toHaveValue('ekran_c');
  });

  test('L-08 · проверка: ошибки по-русски, «Показать» ведёт к экрану, круг без выхода найден', async ({ page }) => {
    const { id } = await seedProject(page, (d) => {
      d.screens[0]!.blocks.push(goTo('knopka_a', 'Дальше', 100, { kind: 'goTo', to: 'screen', screenId: 'ekran_b' }));
      d.screens.push({ id: 'ekran_b', name: 'Круг Б', blocks: [goTo('knopka_b', 'Назад', 100, { kind: 'goTo', to: 'screen', screenId: 'ekran_c' })] });
      d.screens.push({ id: 'ekran_c', name: 'Круг В', blocks: [goTo('knopka_c', 'Назад', 100, { kind: 'goTo', to: 'screen', screenId: 'ekran_b' })] });
      d.screens.push({ id: 'ekran_d', name: 'Потерянный', blocks: [] });
    });
    await openEditor(page, id);
    const dialog = await openLogic(page, 'Проверка');
    const summary = dialog.getByTestId('issues-summary');
    await expect(summary).toContainText('ошибок');
    await expect(dialog.locator('[data-issue="ENDLESS_LOOP"]')).toContainText('Круг Б');
    const lost = dialog.locator('[data-issue="UNREACHABLE_SCREEN"]');
    await expect(lost).toContainText('Потерянный');
    await lost.getByRole('button', { name: 'Показать' }).click();
    await expect(dialog).toHaveCount(0);
    await expect(page.getByRole('button', { name: /Потерянный/ })).toHaveAttribute('aria-current', 'true');
  });

  test('L-03 · настройки прохождения: когда показывать верность ответа, ничья, «Назад»', async ({ page }) => {
    const { id } = await seedProject(page);
    await openEditor(page, id);
    const dialog = await openLogic(page, 'Результаты');
    await dialog.getByLabel('Когда показывать, верно ли ответили').selectOption('instant');
    await dialog.getByLabel('Если в личностном тесте ничья').selectOption('random');
    await dialog.getByLabel('Можно вернуться назад').uncheck();
    await expect.poll(async () => JSON.stringify((await serverDraft(page, id)).doc.settings), { timeout: 15_000 }).toContain('"allowBack":false');
    expect((await serverDraft(page, id)).doc.settings).toMatchObject({ feedbackMode: 'instant', tieBreak: 'random', allowBack: false });
  });
});
