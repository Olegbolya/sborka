import { expect, test, type Page } from '@playwright/test';
import { freshUser, loginAndOnboard } from './helpers/auth';
import { addBlock, newScreen, openRule, player, rule, selectBlock } from './helpers/build';
import { hit, openEditor, saveStatus, seedProject, serverDraft, openTab } from './helpers/editor';

/*
 * P6.9 · GS-02 «Своя мини-игра»: игра «Поймай подарок» собирается ТОЛЬКО из универсальных блоков, поведений и правил,
 * через интерфейс редактора; проверяется в предпросмотре с отладчиком, публикуется, проходится участником на телефоне
 * (касаниями), значение «счёт» видно в кабинете, а «убегающая кнопка» сохраняется как «Мой элемент» и работает в другой сборке.
 */

/** Своя картинка подарка: настоящий PNG 2×2. */
const GIFT_PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAFElEQVR4nGP8z8Dwn4EIwDiqEAAAXQQC/0b6dI4AAAAASUVORK5CYII=', 'base64');

/** Свой звук: WAV на одну сотую секунды тишины. */
function wav(): Buffer {
  const samples = 80;
  const data = Buffer.alloc(samples * 2);
  const head = Buffer.alloc(44);
  head.write('RIFF', 0);
  head.writeUInt32LE(36 + data.length, 4);
  head.write('WAVEfmt ', 8);
  head.writeUInt32LE(16, 16);
  head.writeUInt16LE(1, 20);
  head.writeUInt16LE(1, 22);
  head.writeUInt32LE(8000, 24);
  head.writeUInt32LE(16000, 28);
  head.writeUInt16LE(2, 32);
  head.writeUInt16LE(16, 34);
  head.write('data', 36);
  head.writeUInt32LE(data.length, 40);
  return Buffer.concat([head, data]);
}

const screenItem = (page: Page, n: number) => page.getByRole('list', { name: 'Экраны' }).getByRole('listitem').nth(n);
const goToScreen = async (page: Page, n: number) => {
  await openTab(page, 'Экраны');
  await screenItem(page, n).click();
};
const renameScreen = async (page: Page, name: string) => {
  await openTab(page, 'Оформление');
  await page.getByLabel('Название экрана').fill(name);
};

test.describe('P6.9 · GS-02 «Своя мини-игра»', () => {
  // Игру создают за столом: редактор — в окне 1440 в любом проекте; участник ниже открывает свой контекст 390 с касаниями.
  test.use({ actionTimeout: 15_000, viewport: { width: 1440, height: 900 }, hasTouch: false, isMobile: false });
  test('GS-02 · «Поймай подарок»: собрана из блоков, поведений и правил → отладчик → публикация → участник на телефоне → «Мой элемент»', async ({ page, browser }, info) => {
    test.setTimeout(540_000);
    await loginAndOnboard(page, freshUser('Автор игры'));
    const { id } = await seedProject(page, undefined, 'Поймай подарок');
    await openEditor(page, id);

    // ── Переменные: «счёт» (в ответы) и «жизни» (три).
    await page.getByRole('button', { name: 'Сценарии', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Сценарии сборки' });
    await dialog.getByRole('tab', { name: 'Переменные' }).click();
    for (const name of ['счёт', 'жизни']) {
      await dialog.getByLabel('Имя новой переменной').fill(name);
      await dialog.getByRole('button', { name: 'Добавить переменную' }).click();
    }
    await dialog.getByLabel('Записывать «счёт» в ответы').check();
    await dialog.getByLabel('Начальное значение «жизни»', { exact: true }).fill('3');
    await dialog.getByRole('button', { name: 'Закрыть', exact: true }).click();

    // ── Экран 1 «Игра». Шаг 1: СВОЯ картинка подарка — образец, скрыт, падает вниз; генератор копий каждые 0,8 с в случайном месте.
    await renameScreen(page, 'Игра');
    await openTab(page, 'Добавить');
    await page.getByRole('button', { name: 'Из медиатеки', exact: true }).click();
    const picker = page.getByRole('dialog', { name: 'Выбор файла' });
    await picker.getByLabel('Загрузить файл').setInputFiles({ name: 'podarok.png', mimeType: 'image/png', buffer: GIFT_PNG });
    await expect(picker).toBeHidden();
    await openTab(page, 'Содержимое');
    await page.getByLabel('Название блока').fill('Подарок');
    await openTab(page, 'Оформление');
    for (const [label, value] of [['X', 0], ['Y', 0], ['Ширина', 56], ['Высота', 56]] as const) await page.getByLabel(label, { exact: true }).fill(String(value));
    await page.getByLabel('Скрыт, пока правило его не покажет').check();
    await openTab(page, 'Сценарии');
    await page.getByLabel('Добавить поведение').selectOption({ label: 'Движется' });
    const move = page.locator('[data-behavior="move"]');
    await move.getByLabel('Скорость', { exact: true }).fill('160');
    await move.getByLabel('Разброс направления', { exact: true }).fill('15');

    await addBlock(page, 'shape', 'Генератор', { x: 0, y: 0, w: 1, h: 1 });
    await openTab(page, 'Сценарии');
    await page.getByLabel('Добавить поведение').selectOption({ label: 'Выпускает копии' });
    const spawner = page.locator('[data-behavior="spawner"]');
    await spawner.getByLabel('Чьи копии', { exact: true }).selectOption({ label: 'Подарок' });
    await spawner.getByLabel('Как часто', { exact: true }).fill('800');
    await spawner.getByLabel('Где появляются: слева', { exact: true }).fill('10');
    await spawner.getByLabel('Где появляются: сверху', { exact: true }).fill('0');
    await spawner.getByLabel('Где появляются: ширина', { exact: true }).fill('320');
    await spawner.getByLabel('Где появляются: высота', { exact: true }).fill('20');
    await spawner.getByLabel('Не больше копий', { exact: true }).fill('12');

    await addBlock(page, 'zone', 'Низ', { x: 0, y: 760, w: 390, h: 40 });
    await addBlock(page, 'timer', 'Таймер', { x: 20, y: 20, w: 120, h: 40 });
    await openTab(page, 'Содержимое');
    await page.getByLabel('Секунд', { exact: true }).fill('20');
    await page.getByTestId('props-inspector').getByLabel('Вид', { exact: true }).selectOption({ label: 'Секунды' });
    await addBlock(page, 'value', 'Счёт', { x: 230, y: 20, w: 140, h: 40 });
    await openTab(page, 'Содержимое');
    await page.getByLabel('Переменная', { exact: true }).selectOption({ label: 'счёт' });
    await addBlock(page, 'value', 'Жизни', { x: 230, y: 70, w: 140, h: 40 });
    await openTab(page, 'Содержимое');
    await page.getByLabel('Переменная', { exact: true }).selectOption({ label: 'жизни' });

    // ── Экран 2 «Проигрыш» (кнопка ведёт дальше — к результату), экран 3 «Результат»: итог и «убегающая кнопка Нет».
    await newScreen(page);
    await renameScreen(page, 'Проигрыш');
    await addBlock(page, 'text', 'Проигрыш', { x: 20, y: 200, w: 350, h: 100 }, 'Подарки закончились. Попробуй ещё раз!');
    await addBlock(page, 'button', 'Закончить', { x: 95, y: 600, w: 200, h: 60 }, 'Закончить');
    await newScreen(page);
    await renameScreen(page, 'Результат');
    await addBlock(page, 'text', 'Итог', { x: 20, y: 120, w: 350, h: 100 }, 'Ты поймал ');
    // «{{счёт}}» вставляется в текст из списка «Вставить в текст», потом дописывается остаток фразы.
    await openTab(page, 'Содержимое');
    const field = page.getByRole('textbox', { name: 'Текст блока' });
    await field.click();
    await page.keyboard.press('End');
    await page.waitForTimeout(400); // редактор успевает запомнить место курсора до того, как список заберёт фокус
    await page.getByLabel('Вставить в текст').selectOption({ label: 'счёт' });
    await field.click();
    await page.keyboard.press('End');
    await page.keyboard.type(' подарков!');
    await addBlock(page, 'text', 'Вопрос', { x: 20, y: 300, w: 350, h: 60 }, 'Сыграем ещё?');
    await addBlock(page, 'button', 'Нет', { x: 120, y: 420, w: 150, h: 64 }, 'Нет');
    await addBlock(page, 'button', 'Закончить', { x: 95, y: 620, w: 200, h: 60 }, 'Закончить');
    // ── Шаг 4: «Нет» убегает от пальца 5 раз, затем правило превращает его в «Да» (текст и цвет).
    await goToScreen(page, 2);
    await selectBlock(page, 'Нет');
    await rule(page, 0).getByRole('button', { name: 'Правило 1: удалить' }).click();
    await page.getByLabel('Добавить поведение').selectOption({ label: 'Убегает' });
    await page.locator('[data-behavior="flee"]').getByLabel('Сколько раз', { exact: true }).fill('5');
    await page.getByLabel('Добавить правило: когда').selectOption({ label: 'Нажали' });
    let r = await openRule(page, 0);
    await r.getByRole('button', { name: 'Действие 1: Подождать', exact: true }).click();
    await r.getByLabel('Действие 1: что сделать').selectOption({ label: 'Изменить свойство' });
    await r.locator('select[aria-label="Что изменить: что менять"]').selectOption({ label: 'Текст' });
    await r.locator('input[aria-label="Что изменить: новый текст"]').fill('Да');
    await r.getByLabel('Сделать: добавить действие').selectOption({ label: 'Изменить свойство' });
    await r.locator('select[aria-label="Что изменить: что менять"]').last().selectOption({ label: 'Заливка' });
    await r.getByLabel('Что изменить: цвет заливки: источник').selectOption({ label: 'Свой цвет' });
    await r.getByLabel('Что изменить: цвет заливки: HEX').fill('#2E9E5B');
    await r.getByLabel('Что изменить: цвет заливки: HEX').press('Enter');

    // ── Правила экрана 1 (шаг 2 и 3): подарок пойман; подарок упал; жизни кончились; время вышло.
    await goToScreen(page, 0);
    await page.getByRole('button', { name: 'Сценарии', exact: true }).click();
    await dialog.getByRole('tab', { name: 'Правила экрана' }).click();
    // 1 · нажали на копию → счёт + 1, свой звук, копия исчезает.
    await dialog.getByLabel('Добавить правило: когда').selectOption({ label: 'Нажали' });
    r = await openRule(page, 0);
    await r.locator('select[aria-label="На что нажали: что именно"]').selectOption({ label: 'Любая копия блока' });
    await r.locator('select[aria-label="На что нажали: блок"]').selectOption({ label: 'Игра · Подарок' });
    await r.getByRole('button', { name: 'Действие 1: Подождать', exact: true }).click();
    await r.getByLabel('Действие 1: что сделать').selectOption({ label: 'Изменить переменную' });
    await r.locator('select[aria-label="Какую переменную"]').selectOption({ label: 'счёт' });
    await r.getByLabel('Сделать: добавить действие').selectOption({ label: 'Сыграть звук' });
    await r.getByLabel('Звук: выбрать файл').click();
    const sound = page.getByRole('dialog', { name: 'Выбор файла' });
    await sound.getByLabel('Загрузить файл').setInputFiles({ name: 'zvuk.wav', mimeType: 'audio/wav', buffer: wav() });
    await expect(sound).toBeHidden();
    await r.getByLabel('Сделать: добавить действие').selectOption({ label: 'Удалить блок' });
    await r.locator('select[aria-label="Какой блок: что именно"]').selectOption({ label: 'Блок, у которого сработало правило' });
    // 2 · копия коснулась нижней зоны → жизни − 1 и копия исчезает.
    await dialog.getByLabel('Добавить правило: когда').selectOption({ label: 'Столкнулись' });
    r = await openRule(page, 1);
    await r.locator('select[aria-label="Первый блок: что именно"]').selectOption({ label: 'Любая копия блока' });
    await r.locator('select[aria-label="Первый блок: блок"]').selectOption({ label: 'Игра · Подарок' });
    await r.locator('select[aria-label="Второй блок: блок"]').selectOption({ label: 'Игра · Низ' });
    await r.getByRole('button', { name: 'Действие 1: Подождать', exact: true }).click();
    await r.getByLabel('Действие 1: что сделать').selectOption({ label: 'Изменить переменную' });
    await r.locator('select[aria-label="Какую переменную"]').selectOption({ label: 'жизни' });
    await r.getByLabel('Действие 1: что сделать').first().scrollIntoViewIfNeeded();
    await r.locator('select[aria-label="Что сделать"]').selectOption({ label: 'вычесть' });
    await r.getByLabel('Сделать: добавить действие').selectOption({ label: 'Удалить блок' });
    await r.locator('select[aria-label="Какой блок: что именно"]').selectOption({ label: 'Блок, у которого сработало правило' });
    // 3 · если жизни = 0 → экран «Проигрыш».
    await dialog.getByLabel('Добавить правило: когда').selectOption({ label: 'Изменилась переменная' });
    r = await openRule(page, 2);
    await r.locator('select[aria-label="Какая переменная"]').selectOption({ label: 'жизни' });
    await r.getByLabel('Проверять условие').check();
    await r.locator('select[aria-label="Если: переменная"]').selectOption({ label: 'жизни' });
    await r.locator('select[aria-label="Если: как сравнить"]').selectOption({ label: 'равно' });
    await r.locator('input[aria-label="Если: значение"]').fill('0');
    await r.getByRole('button', { name: 'Действие 1: Подождать', exact: true }).click();
    await r.getByLabel('Действие 1: что сделать').selectOption({ label: 'Перейти' });
    await r.getByLabel('Куда').selectOption({ label: 'на выбранный экран' });
    await r.getByLabel('Какой экран').selectOption({ label: '2. Проигрыш' });
    // 4 · таймер 20 с → записать «счёт» в ответы и на экран результата.
    await dialog.getByLabel('Добавить правило: когда').selectOption({ label: 'Прошло время' });
    r = await openRule(page, 3);
    await r.locator('select[aria-label="Как"]').selectOption({ label: 'когда закончился таймер' });
    await r.locator('select[aria-label="Какой таймер"]').selectOption({ label: 'Игра · Таймер' });
    await r.getByRole('button', { name: 'Действие 1: Подождать', exact: true }).click();
    await r.getByLabel('Действие 1: что сделать').selectOption({ label: 'Записать в ответы' });
    await r.getByLabel('Название записи').fill('счёт');
    await r.getByLabel('Сделать: добавить действие').selectOption({ label: 'Перейти' });
    await r.getByLabel('Куда').last().selectOption({ label: 'на выбранный экран' });
    await r.getByLabel('Какой экран').last().selectOption({ label: '3. Результат' });
    await dialog.getByRole('button', { name: 'Закрыть', exact: true }).click();
    await expect(saveStatus(page)).toHaveText('Сохранено');

    // В сохранённом документе — то, что собрано: образец, генератор, четыре правила, поведение «убегает» и правило «Да».
    type Doc = {
      variables: Array<{ name: string; initial: unknown; saveToAnswers: boolean }>;
      screens: Array<{ name: string; blocks: Array<{ id: string; name: string; initiallyHidden?: boolean; behaviors: Array<{ kind: string; prototypeId?: string; everyMs?: number; times?: number }>; rules: Array<{ do: Array<{ kind: string }> }> }>; rules: Array<{ when: { kind: string }; do: Array<{ kind: string }> }> }>;
    };
    const doc = (await serverDraft(page, id)).doc as unknown as Doc;
    const gift = doc.screens[0]!.blocks.find((b) => b.name === 'Подарок')!;
    expect(gift).toMatchObject({ initiallyHidden: true, behaviors: [{ kind: 'move' }] });
    expect(doc.screens[0]!.blocks.find((b) => b.name === 'Генератор')!.behaviors).toMatchObject([{ kind: 'spawner', prototypeId: gift.id, everyMs: 800 }]);
    expect(doc.variables.map((v) => [v.name, v.initial, v.saveToAnswers])).toEqual([['счёт', 0, true], ['жизни', 3, false]]);
    expect(doc.screens[0]!.rules.map((x) => [x.when.kind, x.do.map((a) => a.kind)])).toEqual([
      ['tap', ['setVariable', 'playSound', 'destroy']],
      ['collide', ['setVariable', 'destroy']],
      ['variableChange', ['goTo']],
      ['timer', ['record', 'goTo']],
    ]);
    const no = doc.screens[2]!.blocks.find((b) => b.name === 'Нет')!;
    expect(no.behaviors).toMatchObject([{ kind: 'flee', times: 5 }]);
    expect(no.rules).toHaveLength(1);
    expect(no.rules[0]!.do.map((a) => a.kind)).toEqual(['setProperty', 'setProperty']);

    // ── Шаг 5: предпросмотр с отладчиком. Ловим подарки «пальцем» (клик по каждой копии): видны переменные и журнал правил.
    await goToScreen(page, 0);
    const g = await player(page);
    const copies = `[data-block-id^="${gift.id}"]`;
    await expect(g.frame.locator(copies).first()).toBeVisible({ timeout: 10_000 });
    await g.frame.locator(copies).first().dispatchEvent('click');
    await expect(g.dialog.getByLabel('Переменная «счёт»')).toHaveValue('1');
    await expect(g.dialog.getByLabel('Переменная «жизни»')).toHaveValue('3');
    await expect(g.dialog.getByTestId('debug-log')).toContainText('Сработало правило «когда нажали на');
    // Ничего не ловим дальше: подарки падают на землю, жизни кончаются, игра приходит на экран «Проигрыш».
    await expect(g.frame.getByText('Подарки закончились. Попробуй ещё раз!')).toBeVisible({ timeout: 30_000 });
    await expect(g.dialog.getByTestId('debug-log')).toContainText('жизни');
    await g.dialog.getByRole('button', { name: 'Закрыть' }).click();

    // ── Шаг 6: публикация; участник на «телефоне» (касания) ловит подарки, таймер приводит на экран результата.
    await page.getByRole('button', { name: 'Опубликовать' }).click();
    await expect(page.getByTestId('project-status')).toHaveText(/Опубликована/);
    const { slug } = (await (await page.request.get(`/api/v1/projects/${id}`)).json()) as { slug: string };
    const ctx = await browser.newContext({ baseURL: info.project.use.baseURL!, locale: 'ru-RU', viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
    const p = await ctx.newPage();
    await p.goto(`/s/${slug}`);
    await expect(p.locator('.bk-player-screen[data-live="true"]')).toBeVisible();
    const first = p.locator(copies).first();
    await expect(first).toBeVisible({ timeout: 10_000 });
    await first.tap({ force: true }); // подарок падает: «стабильным» он не бывает
    // Дальше участник ловит всё, что падает (касание по каждой копии), пока таймер не закончится.
    await p.evaluate((selector) => {
      (window as unknown as { __catch: number }).__catch = window.setInterval(() => document.querySelectorAll(selector).forEach((el) => el.dispatchEvent(new MouseEvent('click', { bubbles: true }))), 100);
    }, copies);
    const result = p.locator('[data-type="text"]', { hasText: 'Ты поймал' });
    await expect(result).toContainText(/Ты поймал\s+\d+\s+подарков!/, { timeout: 40_000 });
    const caught = Number((await result.textContent())!.match(/\d+/)![0]);
    expect(caught).toBeGreaterThanOrEqual(1);
    // Убегающая кнопка: «Нет» убегает 5 раз и становится «Да».
    const noId = (await p.locator('[data-type="button"]', { hasText: 'Нет' }).getAttribute('data-block-id'))!;
    const noBlock = p.locator(`[data-block-id="${noId}"]`);
    let taps = 0;
    let tries = 0;
    while (taps < 12 && tries++ < 60 && !/^Да$/.test(((await noBlock.textContent()) ?? '').trim())) {
      const b = (await noBlock.boundingBox())!;
      const x = b.x + b.width / 2;
      const y = b.y + b.height / 2;
      // Убегая, «Нет» может оказаться под «Закончить»: тогда касание попало бы не в неё — ждём следующего места.
      const onTop = await p.evaluate(([px, py, bid]) => !!document.elementFromPoint(px!, py!)?.closest(`[data-block-id="${bid}"]`), [x, y, noId] as const);
      if (!onTop) {
        await p.waitForTimeout(300);
        continue;
      }
      await p.touchscreen.tap(x, y);
      taps += 1;
      await p.waitForTimeout(450);
    }
    await expect(noBlock).toHaveText('Да');
    expect(taps).toBeGreaterThanOrEqual(5); // сначала убегает пять раз, и только потом даётся
    // Участник заканчивает: прохождение завершено, ответ «счёт» ушёл на сервер.
    await p.locator('[data-type="button"]', { hasText: 'Закончить' }).tap();
    const responsesOf = async () => JSON.stringify(((await (await page.request.get(`/api/v1/projects/${id}/responses`)).json()) as { items: unknown[] }).items);
    await expect.poll(responsesOf, { timeout: 15_000 }).toContain('COMPLETED');
    await ctx.close();

    // Кабинет: в ответах значение «счёт».
    await page.goto(`/cabinet/projects/${id}`);
    await expect(page.getByRole('button', { name: /Ответы \(/ })).toBeVisible();
    const firstId = (JSON.parse(await responsesOf()) as { id: string }[])[0]!.id;
    const detailOf = async () => JSON.stringify(await (await page.request.get(`/api/v1/projects/${id}/responses/${firstId}`)).json());
    await expect.poll(detailOf).toContain('счёт');
    const items = await detailOf();
    expect(items).toContain(`${caught}`);
    await page.getByRole('button', { name: 'Карточка' }).click();
    await expect(page.getByText('счёт').first()).toBeVisible();

    // ── Шаг 7: «убегающая кнопка» → «Мой элемент» → вставка в другую сборку, работает без доработки.
    await openEditor(page, id);
    await goToScreen(page, 2);
    await hit(page, 'Нет').click();
    await openTab(page, 'Добавить');
    await page.getByTestId('element-save').click();
    await page.getByLabel('Название элемента').fill('Убегающая кнопка');
    await page.getByLabel('Название элемента').press('Enter');
    await expect(page.getByText('Элемент сохранён.')).toBeVisible();
    const other = await seedProject(page, undefined, 'Другая сборка');
    await openEditor(page, other.id);
    await openTab(page, 'Добавить');
    await page.getByTitle('Вставить «Убегающая кнопка»').click();
    await expect
      .poll(async () => ((await serverDraft(page, other.id)).doc as unknown as Doc).screens[0]!.blocks.length, { timeout: 15_000 })
      .toBe(1);
    const copy = ((await serverDraft(page, other.id)).doc as unknown as Doc).screens[0]!.blocks[0]!;
    expect(copy.name).toBe('Нет');
    expect(copy.behaviors).toMatchObject([{ kind: 'flee', times: 5 }]);
    await goToScreen(page, 0);
    const g2 = await player(page);
    const btn = g2.frame.locator(`[data-block-id="${copy.id}"]`);
    // Подводим курсор шесть раз (убегает пять), затем нажимаем; под нагрузкой нажатие повторяем, пока не сработает.
    for (let i = 0; i < 6; i++) {
      const b = (await btn.boundingBox())!;
      await page.mouse.move(b.x + b.width / 2 - 2, b.y + b.height / 2);
      await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 3 });
      await page.waitForTimeout(600);
    }
    await expect(async () => {
      await btn.click({ force: true, timeout: 2_000 });
      await expect(btn).toContainText('Да', { timeout: 1_000 });
    }).toPass({ timeout: 15_000 });
  });
});
