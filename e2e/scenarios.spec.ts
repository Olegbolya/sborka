import { expect, test, type Page } from '@playwright/test';
import { freshUser, loginAndOnboard } from './helpers/auth';
import { hit, openEditor, seedProject, serverDraft, textBlock } from './helpers/editor';

/* P3.8 · SC-02: the rules of a block are made in the interface, without code. */
type Rule = { when: Record<string, unknown>; do: Array<Record<string, unknown>>; if?: Record<string, unknown> };
const rulesOf = async (page: Page, id: string, blockId: string): Promise<Rule[]> => {
  const doc = (await serverDraft(page, id)).doc as unknown as { screens: Array<{ blocks: Array<{ id: string; rules: Rule[] }> }> };
  return doc.screens[0]!.blocks.find((b) => b.id === blockId)!.rules;
};

test.describe('P3.8 · конструктор правил', () => {
  test('SC-02 · правило «Нажали → скрыть блок» собирается в интерфейсе; блок выбирается кликом по холсту', async ({ page }, info) => {
    await loginAndOnboard(page, freshUser('Сценарист'));
    const { id } = await seedProject(page, (d) => {
      d.screens[0]!.blocks.push(
        { id: 'knopka_a', type: 'button', name: 'Кнопка', frame: { x: 95, y: 300, w: 200, h: 56 }, textLayer: { paragraphs: [{ kind: 'p', runs: [{ t: 'Жми' }] }] } },
        textBlock('korobka_1', 'Коробка', 20, 60, 160, 48),
      );
    });
    await openEditor(page, id);
    await hit(page, 'Кнопка').click();
    await page.getByRole('tab', { name: 'Сценарии' }).click();
    await page.getByLabel('Добавить правило: когда').selectOption({ label: 'Нажали' });
    const rule = page.locator('[data-rule]').first();
    await expect(rule).toContainText('Когда нажали на «Кнопка»');
    await rule.getByRole('button', { name: 'Действие 1: Подождать', exact: true }).click();
    await rule.getByLabel('Действие 1: что сделать').selectOption({ label: 'Показать или скрыть' });
    await rule.getByLabel('Что сделать', { exact: true }).selectOption({ label: 'скрыть' });
    // The target is chosen by a tap on the canvas.
    await rule.getByRole('button', { name: /Какие блоки, 1: блок: указать на холсте|Какие блоки, 1.*указать на холсте/ }).click();
    await expect(page.getByTestId('picker-hint')).toBeVisible();
    await hit(page, 'Коробка').click();
    await expect(page.getByTestId('picker-hint')).toHaveCount(0);
    await expect.poll(async () => (await rulesOf(page, id, 'knopka_a'))[0]?.do[0]).toMatchObject({ kind: 'visibility', mode: 'hide', targets: [{ kind: 'block', blockId: 'korobka_1' }] });
    expect((await rulesOf(page, id, 'knopka_a'))[0]!.when).toMatchObject({ kind: 'tap', source: { kind: 'block', blockId: 'knopka_a' } });
    await page.screenshot({ path: `e2e/__screenshots__/scenario-editor-${info.project.name}.png` });
    // The selection did not jump to the block that was tapped for the answer.
    await expect(page.getByTestId('scenario-counts')).toHaveText('Правил: 1. Поведений: 0.');
  });

  test('BH-02 · поведение «Убегает» добавляется, настраивается и убирается', async ({ page }) => {
    await loginAndOnboard(page, freshUser('Сценарист'));
    const { id } = await seedProject(page, (d) => void d.screens[0]!.blocks.push(textBlock('bezhit_1', 'Нет', 120, 200, 160, 56)));
    await openEditor(page, id);
    await hit(page, 'Нет').click();
    await page.getByRole('tab', { name: 'Сценарии' }).click();
    await page.getByLabel('Добавить поведение').selectOption({ label: 'Убегает' });
    const behavior = page.locator('[data-behavior="flee"]');
    await expect(behavior).toBeVisible();
    await behavior.getByLabel('Сколько раз', { exact: true }).fill('3');
    const behaviorsOf = async () => ((await serverDraft(page, id)).doc as unknown as { screens: Array<{ blocks: Array<{ behaviors: Array<Record<string, unknown>> }> }> }).screens[0]!.blocks[0]!.behaviors;
    await expect.poll(behaviorsOf).toMatchObject([{ kind: 'flee', times: 3 }]);
    await expect(page.getByTestId('scenario-counts')).toHaveText('Правил: 0. Поведений: 1.');
    await behavior.getByRole('button', { name: 'Поведение «Убегает»: убрать' }).click();
    await expect.poll(behaviorsOf).toEqual([]);
  });

  test('VR-01 · переменная создаётся в общей панели; правило экрана и правило сборки собираются там же', async ({ page }) => {
    await loginAndOnboard(page, freshUser('Сценарист'));
    const { id } = await seedProject(page, (d) => void d.screens[0]!.blocks.push(textBlock('tekst_1', 'Подпись', 20, 40, 160, 48)));
    await openEditor(page, id);
    await page.getByRole('button', { name: 'Сценарии', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Сценарии сборки' });
    await dialog.getByRole('tab', { name: 'Переменные' }).click();
    await dialog.getByLabel('Имя новой переменной').fill('Очки');
    await dialog.getByRole('button', { name: 'Добавить переменную' }).click();
    await dialog.getByLabel('Начальное значение «Очки»').fill('5');
    await dialog.getByLabel('Записывать «Очки» в ответы').check();
    const variables = async () => ((await serverDraft(page, id)).doc as unknown as { variables: Array<Record<string, unknown>> }).variables;
    await expect.poll(variables).toMatchObject([{ name: 'Очки', type: 'number', initial: 5, saveToAnswers: true }]);
    await dialog.getByLabel('Имя новой переменной').fill('1плохо');
    await expect(dialog.getByRole('alert')).toContainText('Имя — буквы');
    await expect(dialog.getByRole('button', { name: 'Добавить переменную' })).toBeDisabled();

    await dialog.getByRole('tab', { name: 'Правила сборки' }).click();
    await dialog.getByLabel('Добавить правило: когда').selectOption({ label: 'Нажали клавишу' });
    await expect(dialog.locator('[data-rule]')).toContainText('Когда нажали клавишу «Enter»');
    await dialog.getByRole('tab', { name: 'Правила экрана' }).click();
    await dialog.getByLabel('Добавить правило: когда').selectOption({ label: 'Экран открылся или закрывается' });
    await expect(dialog.locator('[data-rule]')).toContainText('Когда экран открылся');
    const docRules = async () => (await serverDraft(page, id)).doc as unknown as { rules: Array<{ when: { kind: string } }>; screens: Array<{ rules: Array<{ when: { kind: string } }> }> };
    await expect.poll(async () => (await docRules()).rules.map((r) => r.when.kind)).toEqual(['key']);
    await expect.poll(async () => (await docRules()).screens[0]!.rules.map((r) => r.when.kind)).toEqual(['screen']);
    await dialog.getByRole('tab', { name: 'Все правила' }).click();
    await expect(dialog).toContainText('Сборка: 1');
    await expect(dialog).toContainText('Экран «Экран 1»: 1');
  });

  test('SC-03 · отладчик: журнал правил, подсветка источника, правка переменной меняет блок «Значение», пошаговый режим', async ({ page }, info) => {
    await loginAndOnboard(page, freshUser('Сценарист'));
    const { id } = await seedProject(page, (d) => {
      d.variables.push({ id: 'peremennaya_ochki', name: 'Очки', type: 'number', initial: 5, saveToAnswers: false });
      d.screens[0]!.blocks.push(
        { id: 'schet_1', type: 'value', name: 'Счёт', frame: { x: 95, y: 80, w: 200, h: 80 }, props: { variableId: 'peremennaya_ochki', format: 'number' } },
        {
          id: 'plyus_1',
          type: 'button',
          name: 'Плюс',
          frame: { x: 95, y: 300, w: 200, h: 56 },
          textLayer: { paragraphs: [{ kind: 'p', runs: [{ t: 'Плюс' }] }] },
          rules: [{ id: 'plyus_pravilo', when: { kind: 'tap', source: { kind: 'block', blockId: 'plyus_1' } }, do: [{ kind: 'setVariable', variableId: 'peremennaya_ochki', op: 'add', value: 1 }, { kind: 'setVariable', variableId: 'peremennaya_ochki', op: 'add', value: 10 }] }],
        },
      );
    });
    await openEditor(page, id);
    await page.getByRole('button', { name: 'Предпросмотр' }).click();
    const dialog = page.getByRole('dialog', { name: 'Предпросмотр' });
    const frame = dialog.locator('[data-preview="true"]');
    const log = dialog.getByTestId('debug-log');
    await expect(frame.locator('.bk-player-screen[data-live="true"]')).toBeVisible();
    await expect(log).toContainText('Пока ничего не сработало');
    await expect(frame.getByText('5', { exact: true })).toBeVisible();

    await frame.getByRole('button', { name: 'Плюс' }).click();
    await expect(frame.getByText('16', { exact: true })).toBeVisible();
    await expect(log).toContainText('Сработало правило «когда нажали на «Плюс»»');
    await expect(log).toContainText('Действие: прибавить «Очки» (1)');
    await expect(dialog.getByTestId('debug-highlight')).toBeVisible();
    await page.screenshot({ path: `e2e/__screenshots__/debugger-${info.project.name}.png` });

    // The debugger sets the variable by hand and the block of the screen shows it at once.
    await dialog.getByLabel('Переменная «Очки»').fill('42');
    await expect(frame.getByText('42', { exact: true })).toBeVisible();

    // Step mode: the rule waits before each action.
    await dialog.getByLabel('Пошагово: правила ждут перед каждым действием').check();
    await frame.getByRole('button', { name: 'Плюс' }).click();
    await expect(frame.getByText('42', { exact: true })).toBeVisible();
    await expect(dialog.getByTestId('debug-waiting')).toHaveText('Ждёт: 1');
    await expect(log).toContainText('ждёт шага');
    await dialog.getByRole('button', { name: 'Шаг', exact: true }).click();
    await expect(frame.getByText('43', { exact: true })).toBeVisible();
    await dialog.getByRole('button', { name: 'Шаг', exact: true }).click();
    await expect(frame.getByText('53', { exact: true })).toBeVisible();
    await expect(dialog.getByTestId('debug-waiting')).toHaveText('Ждёт: 0');
    await dialog.getByRole('button', { name: 'Очистить журнал' }).click();
    await expect(log).toContainText('Пока ничего не сработало');
  });

  test('SC-07 · проверка называет место ошибки и ведёт к правилу: блока — на вкладку «Сценарии», экрана — в общую панель', async ({ page }) => {
    await loginAndOnboard(page, freshUser('Сценарист'));
    const { id } = await seedProject(page, (d) => {
      d.screens[0]!.blocks.push({
        id: 'knopka_a',
        type: 'button',
        name: 'Кнопка',
        frame: { x: 95, y: 300, w: 200, h: 56 },
        textLayer: { paragraphs: [{ kind: 'p', runs: [{ t: 'Жми' }] }] },
        rules: [{ id: 'pravilo_a', when: { kind: 'tap', source: { kind: 'block', blockId: 'knopka_a' } }, do: [{ kind: 'visibility', targets: [{ kind: 'block', blockId: 'udalyonnyj_blok' }], mode: 'hide' }] }],
      });
      (d.screens[0] as unknown as { rules: unknown[] }).rules = [{ id: 'pravilo_e', when: { kind: 'screen', phase: 'show' }, do: [{ kind: 'setVariable', variableId: 'udalyonnaya_peremennaya', op: 'add', value: 1 }] }];
    });
    await openEditor(page, id);
    await page.getByRole('button', { name: 'Логика' }).click();
    const dialog = page.getByRole('dialog', { name: 'Логика сборки' });
    await dialog.getByRole('tab', { name: /^Проверка/ }).click();
    const missingBlock = dialog.locator('[data-issue="MISSING_BLOCK"]');
    await expect(missingBlock.getByTestId('issue-where')).toHaveText('Где: Экран «Экран 1» · блок «Кнопка» · правило 1');
    await missingBlock.getByRole('button', { name: 'Показать' }).click();
    // The block is selected, the tab «Сценарии» is shown and the rule is open.
    await expect(page.getByRole('tab', { name: 'Сценарии', selected: true })).toBeVisible();
    await expect(page.locator('[data-rule="pravilo_a"]').getByRole('group', { name: 'Когда' })).toBeVisible();

    await page.getByRole('button', { name: 'Логика' }).click();
    await page.getByRole('dialog', { name: 'Логика сборки' }).getByRole('tab', { name: /^Проверка/ }).click();
    const missingVariable = page.getByRole('dialog', { name: 'Логика сборки' }).locator('[data-issue="MISSING_VARIABLE"]');
    await expect(missingVariable.getByTestId('issue-where')).toHaveText('Где: Экран «Экран 1» · правило 1');
    await missingVariable.getByRole('button', { name: 'Показать' }).click();
    const panel = page.getByRole('dialog', { name: 'Сценарии сборки' });
    await expect(panel.getByRole('tab', { name: 'Правила экрана', selected: true })).toBeVisible();
    await expect(panel.locator('[data-rule="pravilo_e"]').getByRole('group', { name: 'Когда' })).toBeVisible();
  });

  test('SC-06 · блок с правилом копируется в другую сборку: переменная создаётся, при занятом имени — связать или создать новую', async ({ page }) => {
    await loginAndOnboard(page, freshUser('Сценарист'));
    const withRule = {
      id: 'knopka_a',
      type: 'button',
      name: 'Жми',
      frame: { x: 95, y: 300, w: 200, h: 56 },
      textLayer: { paragraphs: [{ kind: 'p', runs: [{ t: 'Жми' }] }] },
      rules: [{ id: 'pravilo_a', when: { kind: 'tap', source: { kind: 'block', blockId: 'knopka_a' } }, do: [{ kind: 'setVariable', variableId: 'peremennaya_ochki', op: 'add', value: 1 }] }],
    };
    const a = await seedProject(page, (d) => {
      d.variables.push({ id: 'peremennaya_ochki', name: 'Очки', type: 'number', initial: 0, saveToAnswers: false });
      d.screens[0]!.blocks.push(withRule);
    }, 'Источник');
    const empty = await seedProject(page, () => undefined, 'Пустая');
    const busy = await seedProject(page, (d) => void d.variables.push({ id: 'drugie_ochki', name: 'Очки', type: 'number', initial: 100, saveToAnswers: false }), 'С очками');

    await openEditor(page, a.id);
    await hit(page, 'Жми').click();
    await page.keyboard.press('Control+c');

    type Doc = { variables: Array<{ id: string; name: string }>; screens: Array<{ blocks: Array<{ name: string; rules: Array<{ do: Array<{ variableId?: string }> }> }> }> };
    const docOf = async (project: string) => (await serverDraft(page, project)).doc as unknown as Doc;

    // An empty assembly: the variable comes with the block.
    await openEditor(page, empty.id);
    await page.keyboard.press('Control+v');
    await expect.poll(async () => (await docOf(empty.id)).variables.map((v) => v.name)).toEqual(['Очки']);
    const pasted = await docOf(empty.id);
    expect(pasted.screens[0]!.blocks.find((b) => b.name === 'Жми')!.rules.at(-1)!.do[0]!.variableId).toBe(pasted.variables[0]!.id);

    // The name «Очки» is taken: the person chooses.
    await openEditor(page, busy.id);
    await page.keyboard.press('Control+v');
    const dialog = page.getByRole('dialog', { name: 'Переменные с такими же именами' });
    await expect(dialog).toBeVisible();
    await dialog.getByLabel('Связать с переменной «Очки» этой сборки').check();
    await dialog.getByRole('button', { name: 'Вставить' }).click();
    await expect.poll(async () => (await docOf(busy.id)).screens[0]!.blocks.length).toBe(1);
    const linked = await docOf(busy.id);
    expect(linked.variables.map((v) => v.id)).toEqual(['drugie_ochki']);
    expect(linked.screens[0]!.blocks[0]!.rules.at(-1)!.do[0]!.variableId).toBe('drugie_ochki');

    await page.keyboard.press('Control+v');
    await page.getByRole('dialog', { name: 'Переменные с такими же именами' }).getByLabel('Создать новую переменную под другим именем').check();
    await page.getByRole('dialog', { name: 'Переменные с такими же именами' }).getByRole('button', { name: 'Вставить' }).click();
    await expect.poll(async () => (await docOf(busy.id)).variables.map((v) => v.name)).toEqual(['Очки', 'Очки_копия']);
  });
});
