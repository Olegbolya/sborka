import { expect, test, type Locator, type Page } from '@playwright/test';
import { freshUser, loginAndOnboard } from './helpers/auth';
import { hit, openEditor, saveStatus, seedProject, serverDraft } from './helpers/editor';

/*
 * P3.12 · RG-01, RG-06, RG-07: игра собирается в редакторе через интерфейс, шаг за шагом, без единой строки кода, а потом проходится
 * в предпросмотре. Список шагов — как в документах `packages/themes/examples/rg-01.json`, `rg-06.json`, `rg-07.json`.
 */
type BlockKind = 'text' | 'button' | 'shape' | 'zone' | 'timer' | 'value';

async function addBlock(page: Page, type: BlockKind, name: string, frame: { x: number; y: number; w: number; h: number }, text?: string): Promise<void> {
  await page.getByRole('tab', { name: 'Добавить' }).click();
  await page.locator(`[data-add-type="${type}"]`).click();
  await page.getByRole('tab', { name: 'Содержимое' }).click();
  await page.getByLabel('Название блока').fill(name);
  if (text !== undefined) {
    if ((await page.getByRole('textbox', { name: 'Текст блока' }).count()) === 0) await page.getByRole('button', { name: 'Добавить текст' }).click();
    const field = page.getByRole('textbox', { name: 'Текст блока' });
    await field.click();
    await page.keyboard.press('Control+A');
    await page.keyboard.type(text);
  }
  await page.getByRole('tab', { name: 'Оформление' }).click();
  for (const [label, value] of [['X', frame.x], ['Y', frame.y], ['Ширина', frame.w], ['Высота', frame.h]] as const) await page.getByLabel(label, { exact: true }).fill(String(value));
}

const selectBlock = async (page: Page, name: string) => {
  await hit(page, name).click();
  await page.getByRole('tab', { name: 'Сценарии' }).click();
};
const rule = (page: Page, n: number): Locator => page.locator('[data-rule]').nth(n);
const openRule = async (page: Page, n: number) => {
  const r = rule(page, n);
  if ((await r.getByRole('group', { name: 'Когда' }).count()) === 0) await r.getByRole('button', { name: new RegExp(`^Правило ${n + 1}`) }).click();
  return r;
};
const newScreen = async (page: Page) => {
  await page.getByRole('tab', { name: 'Экраны' }).click();
  await page.getByRole('button', { name: 'Добавить экран' }).click();
};
const player = async (page: Page) => {
  await page.getByRole('button', { name: 'Предпросмотр' }).click();
  const dialog = page.getByRole('dialog', { name: 'Предпросмотр' });
  const frame = dialog.locator('[data-preview="true"]');
  await expect(frame.locator('.bk-player-screen[data-live="true"]')).toBeVisible();
  return { dialog, frame, blk: (id: string) => frame.locator(`[data-block-id="${id}"]`) };
};

test.describe('P3.12 · игры собираются через интерфейс', () => {
  test('RG-01 · Убегающая кнопка «Нет»: собрана в редакторе из блока, поведения и двух правил с условием по числу срабатываний', async ({ page }) => {
    test.setTimeout(240_000);
    await loginAndOnboard(page, freshUser('Автор игр'));
    const { id } = await seedProject(page);
    await openEditor(page, id);

    // 1 · the screen: a question and two buttons.
    await addBlock(page, 'text', 'Вопрос', { x: 20, y: 120, w: 350, h: 80 }, 'Ты придёшь на ёлку?');
    await addBlock(page, 'button', 'Да', { x: 40, y: 300, w: 140, h: 64 }, 'Да');
    await addBlock(page, 'button', 'Нет', { x: 210, y: 300, w: 140, h: 64 }, 'Нет');

    // 2 · «Нет» runs away five times (the behaviour), and the rule of the button «Дальше» is taken off it.
    await selectBlock(page, 'Нет');
    await rule(page, 0).getByRole('button', { name: 'Правило 1: удалить' }).click();
    await page.getByLabel('Добавить поведение').selectOption({ label: 'Убегает' });
    await page.locator('[data-behavior="flee"]').getByLabel('Сколько раз', { exact: true }).fill('5');

    // 3 · the first press: it doubts (the rule works while it has fired fewer than two times).
    await page.getByLabel('Добавить правило: когда').selectOption({ label: 'Нажали' });
    let r = await openRule(page, 0);
    await r.getByLabel('Проверять условие').check();
    await r.locator('select[aria-label="Если: что проверяем"]').selectOption({ label: 'Сколько правил сработало' });
    await r.locator('select[aria-label="Если: как сравнить"]').selectOption({ label: 'меньше' });
    await r.locator('input[aria-label="Если: сколько раз"]').fill('2');
    await r.getByRole('button', { name: 'Действие 1: Подождать', exact: true }).click();
    await r.getByLabel('Действие 1: что сделать').selectOption({ label: 'Изменить свойство' });
    await r.locator('select[aria-label="Что изменить: что менять"]').selectOption({ label: 'Текст' });
    await r.locator('input[aria-label="Что изменить: новый текст"]').fill('Точно нет?');

    // 4 · the second press: it gives in — «Да!», confetti, a pause and on to the next screen.
    await page.getByLabel('Добавить правило: когда').selectOption({ label: 'Нажали' });
    r = await openRule(page, 1);
    await r.getByLabel('Проверять условие').check();
    await r.locator('select[aria-label="Если: что проверяем"]').selectOption({ label: 'Сколько правил сработало' });
    await r.locator('select[aria-label="Если: как сравнить"]').selectOption({ label: 'не меньше' });
    await r.locator('input[aria-label="Если: сколько раз"]').fill('2');
    await r.getByRole('button', { name: 'Действие 1: Подождать', exact: true }).click();
    await r.getByLabel('Действие 1: что сделать').selectOption({ label: 'Изменить свойство' });
    await r.locator('select[aria-label="Что изменить: что менять"]').selectOption({ label: 'Текст' });
    await r.locator('input[aria-label="Что изменить: новый текст"]').fill('Да!');
    await r.getByLabel('Сделать: добавить действие').selectOption({ label: 'Эффект' });
    await r.getByLabel('Сделать: добавить действие').selectOption({ label: 'Подождать' });
    // A new action opens by itself.
    await r.locator('input[aria-label="Сколько"]').fill('700');
    await r.getByLabel('Сделать: добавить действие').selectOption({ label: 'Перейти' });

    // 5 · the second screen: thanks and the end.
    await newScreen(page);
    await addBlock(page, 'text', 'Ответ', { x: 30, y: 230, w: 330, h: 60 }, 'Я знал! Ждём тебя на ёлке.');
    await addBlock(page, 'button', 'Закончить', { x: 95, y: 600, w: 200, h: 60 }, 'Закончить');
    await expect(saveStatus(page)).toHaveText('Сохранено');

    // The saved document has what was built: the behaviour, two rules with conditions, a second screen.
    type Doc = { screens: Array<{ blocks: Array<{ name: string; behaviors: Array<{ kind: string; times?: number }>; rules: Array<{ if?: { kind: string; op: string; value: number }; do: Array<{ kind: string }> }> }> }> };
    const doc = (await serverDraft(page, id)).doc as unknown as Doc;
    const net = doc.screens[0]!.blocks.find((b) => b.name === 'Нет')!;
    expect(net.behaviors).toMatchObject([{ kind: 'flee', times: 5 }]);
    expect(net.rules.map((x) => x.if)).toMatchObject([{ kind: 'ruleCount', op: 'lt', value: 2 }, { kind: 'ruleCount', op: 'gte', value: 2 }]);
    expect(net.rules[1]!.do.map((a) => a.kind)).toEqual(['setProperty', 'effect', 'wait', 'goTo']);
    expect(doc.screens).toHaveLength(2);

    // Played: it runs away, doubts, gives in; the second screen ends the game.
    await page.getByRole('tab', { name: 'Экраны' }).click();
    await page.getByRole('list', { name: 'Экраны' }).getByRole('listitem').first().click();
    const g = await player(page);
    const net_ = g.blk(await selectedId(g, 'Нет'));
    let moves = 0;
    for (let i = 0; i < 12; i++) {
      const before = (await net_.boundingBox())!;
      const b = (await net_.boundingBox())!;
      await page.mouse.move(b.x + b.width / 2 - 2, b.y + b.height / 2);
      await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 3 });
      await page.waitForTimeout(500);
      const after = (await net_.boundingBox())!;
      if (Math.abs(after.x - before.x) > 3 || Math.abs(after.y - before.y) > 3) moves += 1;
    }
    expect(moves).toBe(5);
    await net_.click();
    await expect(net_).toContainText('Точно нет?');
    await net_.click();
    await expect(g.frame.getByText('Я знал! Ждём тебя на ёлке.')).toBeVisible({ timeout: 10_000 });
    await g.frame.getByRole('button', { name: 'Закончить' }).click();
    await expect(g.dialog.getByTestId('preview-end')).toHaveText(/Прохождение завершено/);
  });
  test('RG-07 · «Перетащи на место»: три фрукта с поведением «Перетаскивается», три зоны, правила «Положили на место» на экране и правило сборки с условием по переменной', async ({ page }) => {
    test.setTimeout(300_000);
    await loginAndOnboard(page, freshUser('Автор игр'));
    const { id } = await seedProject(page);
    await openEditor(page, id);

    // 1 · variables of the assembly (VR-01): points go to the answers, «Разложено» does not.
    await page.getByRole('button', { name: 'Сценарии', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Сценарии сборки' });
    await dialog.getByRole('tab', { name: 'Переменные' }).click();
    for (const name of ['Очки', 'Разложено']) {
      await dialog.getByLabel('Имя новой переменной').fill(name);
      await dialog.getByRole('button', { name: 'Добавить переменную' }).click();
    }
    await dialog.getByLabel('Записывать «Очки» в ответы').check();
    await dialog.getByRole('button', { name: 'Закрыть', exact: true }).click();

    // 2 · the screen: a title, three fruits (shapes with an emoji), three zones with captions, in an order that is not the fruits' order.
    await addBlock(page, 'text', 'Разложи фрукты по подписям', { x: 20, y: 40, w: 350, h: 80 }, 'Разложи фрукты по подписям');
    const fruits: Array<[string, string, number]> = [['🍎', 'Яблоко', 40], ['🍌', 'Банан', 150], ['🍇', 'Виноград', 260]];
    for (const [emoji, , x] of fruits) await addBlock(page, 'shape', emoji, { x, y: 160, w: 90, h: 90 }, emoji);
    const places: Array<[string, number]> = [['Виноград', 40], ['Яблоко', 150], ['Банан', 260]];
    for (const [fruit, x] of places) {
      await addBlock(page, 'zone', `Подпись ${fruit}`, { x, y: 420, w: 90, h: 90 });
      await addBlock(page, 'text', fruit, { x, y: 520, w: 90, h: 30 }, fruit);
    }

    // 3 · every fruit is dragged and snaps to its own zone.
    for (const [emoji, fruit] of fruits) {
      await selectBlock(page, emoji);
      await page.getByLabel('Добавить поведение').selectOption({ label: 'Перетаскивается' });
      const behavior = page.locator('[data-behavior="drag"]');
      await behavior.getByRole('button', { name: 'Добавить зону' }).click();
      await behavior.getByLabel('Прилипает к зонам, 1', { exact: true }).selectOption({ label: `Подпись ${fruit}` });
    }

    // 4 · the rules of the screen: «Положили на место» → +10 points, +1 laid out, confetti.
    await page.getByRole('button', { name: 'Сценарии', exact: true }).click();
    await dialog.getByRole('tab', { name: 'Правила экрана' }).click();
    for (const [i, [emoji, fruit]] of fruits.entries()) {
      await dialog.getByLabel('Добавить правило: когда').selectOption({ label: 'Положили на место' });
      const r = await openRule(page, i);
      await r.locator('select[aria-label="Что кладут: что именно"]').selectOption({ label: 'Блок' });
      await r.locator('select[aria-label="Что кладут: блок"]').selectOption({ label: emoji });
      await r.locator('select[aria-label="Куда кладут: блок"]').selectOption({ label: `Подпись ${fruit}` });
      await r.getByRole('button', { name: 'Действие 1: Подождать', exact: true }).click();
      await r.getByLabel('Действие 1: что сделать').selectOption({ label: 'Изменить переменную' });
      await r.locator('select[aria-label="Какую переменную"]').selectOption({ label: 'Очки' });
      await r.locator('input[aria-label="Значение: число"]').fill('10');
      await r.getByLabel('Сделать: добавить действие').selectOption({ label: 'Изменить переменную' });
      await r.locator('select[aria-label="Какую переменную"]').selectOption({ label: 'Разложено' });
      await r.getByLabel('Сделать: добавить действие').selectOption({ label: 'Эффект' });
    }

    // 5 · the rule of the assembly: when «Разложено» changes and is not less than 3 — wait and go on.
    await dialog.getByRole('tab', { name: 'Правила сборки' }).click();
    await dialog.getByLabel('Добавить правило: когда').selectOption({ label: 'Изменилась переменная' });
    const all = await openRule(page, 0);
    await all.locator('select[aria-label="Какая переменная"]').selectOption({ label: 'Разложено' });
    await all.getByLabel('Проверять условие').check();
    await all.locator('select[aria-label="Если: переменная"]').selectOption({ label: 'Разложено' });
    await all.locator('select[aria-label="Если: как сравнить"]').selectOption({ label: 'не меньше' });
    await all.locator('input[aria-label="Если: значение"]').fill('3');
    await all.getByRole('button', { name: 'Действие 1: Подождать', exact: true }).click();
    await all.locator('input[aria-label="Сколько"]').fill('500');
    await all.getByLabel('Сделать: добавить действие').selectOption({ label: 'Перейти' });
    await dialog.getByRole('button', { name: 'Закрыть', exact: true }).click();
    await newScreen(page);
    await addBlock(page, 'text', 'Готово!', { x: 20, y: 120, w: 350, h: 80 }, 'Готово!');
    await addBlock(page, 'button', 'Закончить', { x: 95, y: 600, w: 200, h: 60 }, 'Закончить');
    await expect(saveStatus(page)).toHaveText('Сохранено');

    type Doc = {
      variables: Array<{ name: string; saveToAnswers: boolean }>;
      rules: Array<{ when: { kind: string }; if?: { op: string; value: number }; do: Array<{ kind: string }> }>;
      screens: Array<{ blocks: Array<{ id: string; name: string; behaviors: Array<{ kind: string; snapToZones?: string[] }> }>; rules: Array<{ when: { kind: string }; do: Array<{ kind: string }> }> }>;
    };
    const doc = (await serverDraft(page, id)).doc as unknown as Doc;
    const blocks = doc.screens[0]!.blocks;
    const idOf = (name: string) => blocks.find((b) => b.name === name)!.id;
    expect(doc.variables.map((v) => [v.name, v.saveToAnswers])).toEqual([['Очки', true], ['Разложено', false]]);
    for (const [emoji, fruit] of fruits) expect(blocks.find((b) => b.name === emoji)!.behaviors).toMatchObject([{ kind: 'drag', snapToZones: [idOf(`Подпись ${fruit}`)] }]);
    expect(doc.screens[0]!.rules.map((r) => [r.when.kind, r.do.map((a) => a.kind)])).toEqual(Array(3).fill(['drop', ['setVariable', 'setVariable', 'effect']]));
    expect(doc.rules).toMatchObject([{ when: { kind: 'variableChange' }, if: { op: 'gte', value: 3 }, do: [{ kind: 'wait' }, { kind: 'goTo' }] }]);

    // Played: every fruit is carried to its own caption; the third one takes the player to the last screen.
    await page.getByRole('tab', { name: 'Экраны' }).click();
    await page.getByRole('list', { name: 'Экраны' }).getByRole('listitem').first().click();
    const g = await player(page);
    for (const [emoji, fruit] of fruits) {
      const from = (await g.blk(idOf(emoji)).boundingBox())!;
      const to = (await g.blk(idOf(`Подпись ${fruit}`)).boundingBox())!;
      await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
      await page.mouse.down();
      await page.mouse.move(to.x + to.width / 2, to.y + to.height / 2, { steps: 12 });
      await page.mouse.up();
    }
    await expect(g.frame.getByText('Готово!')).toBeVisible({ timeout: 10_000 });
    await g.frame.getByRole('button', { name: 'Закончить' }).click();
    await expect(g.dialog.getByTestId('preview-end')).toHaveText(/Прохождение завершено/);
  });
  test('RG-06 · «Поймай объект»: звезда-образец с движением, генератор копий, зона-земля, таймер, счёт и три правила экрана', async ({ page }) => {
    test.setTimeout(300_000);
    await loginAndOnboard(page, freshUser('Автор игр'));
    const { id } = await seedProject(page);
    await openEditor(page, id);

    // 1 · variables.
    await page.getByRole('button', { name: 'Сценарии', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Сценарии сборки' });
    await dialog.getByRole('tab', { name: 'Переменные' }).click();
    for (const name of ['Поймано', 'Упало']) {
      await dialog.getByLabel('Имя новой переменной').fill(name);
      await dialog.getByRole('button', { name: 'Добавить переменную' }).click();
    }
    await dialog.getByLabel('Записывать «Поймано» в ответы').check();
    await dialog.getByRole('button', { name: 'Закрыть', exact: true }).click();

    // 2 · the star (a pattern: hidden at the start — S-16 —, flies down), the generator, the ground, the timer and the score.
    await addBlock(page, 'shape', 'Звезда', { x: 0, y: 0, w: 48, h: 48 }, '⭐');
    await page.getByLabel('Скрыт, пока правило его не покажет').check();
    await page.getByRole('tab', { name: 'Сценарии' }).click();
    await page.getByLabel('Добавить поведение').selectOption({ label: 'Движется' });
    const move = page.locator('[data-behavior="move"]');
    await move.getByLabel('Скорость', { exact: true }).fill('160');
    await move.getByLabel('Разброс направления', { exact: true }).fill('20');
    await addBlock(page, 'shape', 'Генератор', { x: 0, y: 0, w: 1, h: 1 });
    await page.getByRole('tab', { name: 'Сценарии' }).click();
    await page.getByLabel('Добавить поведение').selectOption({ label: 'Выпускает копии' });
    const spawner = page.locator('[data-behavior="spawner"]');
    await spawner.getByLabel('Чьи копии', { exact: true }).selectOption({ label: 'Звезда' });
    await spawner.getByLabel('Как часто', { exact: true }).fill('500');
    await spawner.getByLabel('Где появляются: слева', { exact: true }).fill('10');
    await spawner.getByLabel('Где появляются: сверху', { exact: true }).fill('0');
    await spawner.getByLabel('Где появляются: ширина', { exact: true }).fill('330');
    await spawner.getByLabel('Где появляются: высота', { exact: true }).fill('20');
    await spawner.getByLabel('Не больше копий', { exact: true }).fill('12');
    await addBlock(page, 'zone', 'Земля', { x: 0, y: 700, w: 390, h: 40 });
    await addBlock(page, 'timer', 'Таймер', { x: 20, y: 20, w: 120, h: 40 });
    await page.getByRole('tab', { name: 'Содержимое' }).click();
    await page.getByLabel('Секунд', { exact: true }).fill('8');
    await page.getByTestId('props-inspector').getByLabel('Вид', { exact: true }).selectOption({ label: 'Секунды' });
    await addBlock(page, 'value', 'Счёт', { x: 230, y: 20, w: 140, h: 40 });
    await page.getByRole('tab', { name: 'Содержимое' }).click();
    await page.getByLabel('Переменная', { exact: true }).selectOption({ label: 'Поймано' });

    // 3 · the rules of the screen: a tap on a copy catches it, a copy that touches the ground falls, the timer ends the game.
    await page.getByRole('button', { name: 'Сценарии', exact: true }).click();
    await dialog.getByRole('tab', { name: 'Правила экрана' }).click();
    await dialog.getByLabel('Добавить правило: когда').selectOption({ label: 'Нажали' });
    let r = await openRule(page, 0);
    await r.locator('select[aria-label="На что нажали: что именно"]').selectOption({ label: 'Любая копия блока' });
    await r.locator('select[aria-label="На что нажали: блок"]').selectOption({ label: 'Звезда' });
    await r.getByRole('button', { name: 'Действие 1: Подождать', exact: true }).click();
    await r.getByLabel('Действие 1: что сделать').selectOption({ label: 'Изменить переменную' });
    await r.locator('select[aria-label="Какую переменную"]').selectOption({ label: 'Поймано' });
    await r.getByLabel('Сделать: добавить действие').selectOption({ label: 'Удалить блок' });
    await r.locator('select[aria-label="Какой блок: что именно"]').selectOption({ label: 'Блок, у которого сработало правило' });

    await dialog.getByLabel('Добавить правило: когда').selectOption({ label: 'Столкнулись' });
    r = await openRule(page, 1);
    await r.locator('select[aria-label="Первый блок: что именно"]').selectOption({ label: 'Любая копия блока' });
    await r.locator('select[aria-label="Первый блок: блок"]').selectOption({ label: 'Звезда' });
    await r.locator('select[aria-label="Второй блок: блок"]').selectOption({ label: 'Земля' });
    await r.getByRole('button', { name: 'Действие 1: Подождать', exact: true }).click();
    await r.getByLabel('Действие 1: что сделать').selectOption({ label: 'Изменить переменную' });
    await r.locator('select[aria-label="Какую переменную"]').selectOption({ label: 'Упало' });
    await r.getByLabel('Сделать: добавить действие').selectOption({ label: 'Удалить блок' });
    await r.locator('select[aria-label="Какой блок: что именно"]').selectOption({ label: 'Блок, у которого сработало правило' });

    await dialog.getByLabel('Добавить правило: когда').selectOption({ label: 'Прошло время' });
    r = await openRule(page, 2);
    await r.locator('select[aria-label="Как"]').selectOption({ label: 'когда закончился таймер' });
    await r.locator('select[aria-label="Какой таймер"]').selectOption({ label: 'Таймер' });
    await r.getByRole('button', { name: 'Действие 1: Подождать', exact: true }).click();
    await r.getByLabel('Действие 1: что сделать').selectOption({ label: 'Записать в ответы' });
    await r.getByLabel('Название записи').fill('Поймано');
    await r.getByLabel('Сделать: добавить действие').selectOption({ label: 'Перейти' });
    await dialog.getByRole('button', { name: 'Закрыть', exact: true }).click();

    // 4 · the second screen: the result.
    await newScreen(page);
    await addBlock(page, 'text', 'Готово!', { x: 20, y: 120, w: 350, h: 80 }, 'Готово!');
    await addBlock(page, 'button', 'Закончить', { x: 95, y: 600, w: 200, h: 60 }, 'Закончить');
    await expect(saveStatus(page)).toHaveText('Сохранено');

    type Doc = {
      screens: Array<{ blocks: Array<{ id: string; name: string; initiallyHidden?: boolean; behaviors: Array<{ kind: string; prototypeId?: string; everyMs?: number; max?: number; speed?: number }> }>; rules: Array<{ when: { kind: string }; do: Array<{ kind: string }> }> }>;
    };
    const doc = (await serverDraft(page, id)).doc as unknown as Doc;
    const blocks = doc.screens[0]!.blocks;
    const star = blocks.find((b) => b.name === 'Звезда')!;
    expect(star).toMatchObject({ initiallyHidden: true, behaviors: [{ kind: 'move', speed: 160 }] });
    expect(blocks.find((b) => b.name === 'Генератор')!.behaviors).toMatchObject([{ kind: 'spawner', prototypeId: star.id, everyMs: 500, max: 12 }]);
    expect(doc.screens[0]!.rules.map((x) => [x.when.kind, x.do.map((a) => a.kind)])).toEqual([['tap', ['setVariable', 'destroy']], ['collide', ['setVariable', 'destroy']], ['timer', ['record', 'goTo']]]);

    // Played: a star falls, a tap on it counts, the timer ends the game and the second screen comes.
    await page.getByRole('tab', { name: 'Экраны' }).click();
    await page.getByRole('list', { name: 'Экраны' }).getByRole('listitem').first().click();
    const g = await player(page);
    const copy = g.frame.locator(`[data-block-id^="${star.id}"]:visible`);
    await expect(copy.first()).toBeVisible({ timeout: 8000 });
    await copy.first().dispatchEvent('click');
    await expect(g.frame.getByText('Готово!')).toBeVisible({ timeout: 20_000 });
    await g.frame.getByRole('button', { name: 'Закончить' }).click();
    await expect(g.dialog.getByTestId('preview-end')).toHaveText(/Прохождение завершено/);
  });
});

/** The id of the block with the given name on the screen of the preview (ids are made by the editor, not known in advance). */
async function selectedId(g: { frame: Locator }, name: string): Promise<string> {
  const id = await g.frame.locator('[data-block-id]', { hasText: name }).first().getAttribute('data-block-id');
  return id!;
}
