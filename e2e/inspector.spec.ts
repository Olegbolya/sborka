import { mkdirSync } from 'node:fs';
import { expect, test, type Locator, type Page } from '@playwright/test';
import { BLOCK_TYPES, createBlock } from '../packages/schema/dist/index.js';
import { freshUser, loginAndOnboard } from './helpers/auth';
import { blockCenter, box, drag, hit, openEditor, saveStatus, seedProject, serverDraft } from './helpers/editor';

const SHOTS = 'e2e/__screenshots__';

test.beforeEach(async ({ page }) => {
  await loginAndOnboard(page, freshUser('Автор'));
});

/** A group of the right panel, opened. */
const section = async (page: Page, id: string): Promise<Locator> => {
  const s = page.locator(`[data-section="${id}"]`);
  await s.scrollIntoViewIfNeeded();
  if ((await s.getAttribute('open')) === null) await s.locator('summary').click();
  return s;
};

const pickInLayers = async (page: Page, name: string) => {
  await page.getByRole('tab', { name: 'Слои' }).click();
  await page.getByRole('list', { name: 'Слои' }).getByRole('button', { name, exact: true }).click();
};

const setNumber = async (s: Locator, label: string, value: string) => {
  const input = s.getByLabel(label, { exact: true });
  await input.fill(value);
  await expect(input).toHaveValue(value);
};

const blockJson = (block: unknown) => JSON.parse(JSON.stringify(block)) as Record<string, unknown>;

test.describe('P3.4 · по одному свойству каждой группы на каждом типе блока — результат в предпросмотре', () => {
  for (const type of BLOCK_TYPES) {
    test(`S-00 · ${type}`, async ({ page }) => {
      const block = createBlock(type);
      const { id } = await seedProject(page, (d) => void d.screens[0]!.blocks.push(blockJson(block)));
      await openEditor(page, id);
      await pickInLayers(page, block.name);

      // S-04 · заливка: слой со своим цветом
      const fills = await section(page, 'fills');
      await fills.getByRole('button', { name: 'Добавить' }).click();
      await fills.getByLabel('Цвет: источник').selectOption('hex');
      await fills.getByLabel('Цвет: HEX').fill('#ff0000');
      // S-03 · скругление
      await setNumber(await section(page, 'radius'), 'Левый верхний угол', '24');
      // S-05 · обводка
      await setNumber(await section(page, 'stroke'), 'Толщина', '3');
      // S-06 · тень
      await (await section(page, 'shadows')).getByRole('button', { name: 'Добавить' }).click();
      // S-07 · прозрачность
      await setNumber(await section(page, 'effects'), 'Прозрачность', '50');
      // S-18 · наклон
      await setNumber(await section(page, 'transform3d'), 'Наклон по X', '20');
      await expect(saveStatus(page)).toHaveText('Сохранено');

      await page.getByRole('button', { name: 'Предпросмотр' }).click();
      const frame = page.getByRole('dialog', { name: 'Предпросмотр' }).locator('[data-preview="true"]');
      await frame.locator('.bk-player-screen[data-live="true"]').waitFor();
      const el = frame.locator(`[data-block-id="${block.id}"]`);
      await expect(el).toHaveCount(1);
      const css = await el.evaluate((node) => {
        const get = (sel: string, prop: string) => {
          const t = sel === '' ? node : node.querySelector(sel);
          return t ? getComputedStyle(t as Element).getPropertyValue(prop) : null;
        };
        return {
          opacity: get('', 'opacity'),
          transform: (node as HTMLElement).style.transform,
          radius: (node.querySelector('.bk-surface') as HTMLElement | null)?.style.borderRadius ?? '',
          shadow: (node.querySelector('.bk-surface') as HTMLElement | null)?.style.boxShadow ?? '',
          fills: Array.from(node.querySelectorAll('.bk-fill')).map((f) => (f as HTMLElement).style.backgroundImage),
          stroke: node.querySelectorAll('.bk-stroke').length,
        };
      });
      expect(css.opacity).toBe('0.5');
      expect(css.transform).toContain('rotateX(20deg)');
      expect(css.radius).toContain('calc(24 * var(--u))');
      expect(css.shadow).not.toBe('');
      expect(css.fills.join(' ')).toContain('rgb(255, 0, 0)');
      expect(css.stroke).toBeGreaterThan(0);

      // The document has the values in the groups the schema names.
      const saved = (await serverDraft(page, id)).doc.screens[0]!.blocks[0] as { style: Record<string, unknown> };
      expect(Object.keys(saved.style).sort()).toEqual(['effects', 'fills', 'radius', 'shadows', 'stroke', 'transform3d']);
    });
  }
});

const PNG_1PX = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');

const savedBlock = async (page: Page, id: string, index = 0) => (await serverDraft(page, id)).doc.screens[0]!.blocks[index] as Record<string, unknown> & { style: Record<string, unknown> };

/** The fill layers saved so far (none before the first save). */
const savedFills = async (page: Page, id: string) => (((await savedBlock(page, id)).style.fills ?? []) as Array<{ kind: string; color?: { hex?: string; token?: string; alpha?: number }; stops?: unknown[]; angle?: number; media?: { id: string } }>);

const shapeAt = (id: string, name: string, x: number, style: Record<string, unknown> = {}) => ({ ...box(id, name, x, 40, 100, 60), style });

test.describe('P3.4 · работа с контролами', () => {
  test('E-15 · «протягивание»: потянуть название поля меняет число; всё протягивание — один шаг отмены', async ({ page }) => {
    const { id } = await seedProject(page, (d) => void d.screens[0]!.blocks.push(shapeAt('figura_1', 'Фигура', 40)));
    await openEditor(page, id);
    await pickInLayers(page, 'Фигура');
    const radius = await section(page, 'radius');
    const label = radius.getByText('Левый верхний угол', { exact: true });
    const b = (await label.boundingBox())!;
    await page.mouse.move(b.x + 5, b.y + b.height / 2);
    await page.mouse.down();
    await page.mouse.move(b.x + 5 + 30, b.y + b.height / 2, { steps: 6 });
    await page.mouse.up();
    const input = radius.getByLabel('Левый верхний угол', { exact: true });
    await expect.poll(async () => Number(await input.inputValue())).toBeGreaterThanOrEqual(25);
    const dragged = Number(await input.inputValue());
    await page.locator('body').click({ position: { x: 3, y: 3 } });
    await page.keyboard.press('Control+z');
    await expect(input).toHaveValue('0');
    await page.keyboard.press('Control+Shift+z');
    await expect(input).toHaveValue(String(dragged));
  });

  test('E-15 · несколько блоков: общее значение видно, разное — «смешанно»; правка действует на все', async ({ page }) => {
    const { id } = await seedProject(page, (d) =>
      void d.screens[0]!.blocks.push(
        shapeAt('figura_1', 'Первая', 20, { effects: { opacity: 0.8, blur: 0, backdropBlur: 0, blendMode: 'normal' } }),
        shapeAt('figura_2', 'Вторая', 200, { effects: { opacity: 0.5, blur: 0, backdropBlur: 0, blendMode: 'normal' } }),
      ),
    );
    await openEditor(page, id);
    await page.keyboard.press('Control+a');
    const effects = await section(page, 'effects');
    const opacity = effects.getByLabel('Прозрачность', { exact: true });
    await expect(opacity).toHaveAttribute('placeholder', 'смешанно');
    await expect(effects.getByLabel('Размытие', { exact: true })).toHaveValue('0');
    await opacity.fill('30');
    await expect.poll(async () => ((await serverDraft(page, id)).doc.screens[0]!.blocks as Array<{ style: { effects: { opacity: number } } }>).map((b) => b.style.effects.opacity)).toEqual([0.3, 0.3]);
  });

  test('TH-06 · изменённая группа помечена «своё»; «Сбросить к теме» возвращает её к теме', async ({ page }) => {
    const { id } = await seedProject(page, (d) => void d.screens[0]!.blocks.push(shapeAt('figura_1', 'Фигура', 40)));
    await openEditor(page, id);
    await pickInLayers(page, 'Фигура');
    const effects = await section(page, 'effects');
    await expect(page.getByTestId('own-effects')).toHaveCount(0);
    await effects.getByLabel('Прозрачность', { exact: true }).fill('40');
    await expect(page.getByTestId('own-effects')).toBeVisible();
    await expect.poll(async () => Object.keys((await savedBlock(page, id)).style)).toEqual(['effects']);
    await page.getByRole('button', { name: 'Сбросить к теме: Эффекты' }).click();
    await expect(page.getByTestId('own-effects')).toHaveCount(0);
    await expect(effects.getByLabel('Прозрачность', { exact: true })).toHaveValue('100');
    await expect.poll(async () => (await savedBlock(page, id)).style).toEqual({});
  });

  test('S-15 · состояния: правка в «Наведении» не меняет обычный вид', async ({ page }) => {
    const { id } = await seedProject(page, (d) => void d.screens[0]!.blocks.push(shapeAt('figura_1', 'Фигура', 40)));
    await openEditor(page, id);
    await pickInLayers(page, 'Фигура');
    await page.locator('[data-control="state"] select').selectOption('hover');
    await expect(page.getByText('Изменения ниже действуют только в состоянии «Наведение».')).toBeVisible();
    const effects = await section(page, 'effects');
    await effects.getByLabel('Прозрачность', { exact: true }).fill('40');
    await expect.poll(async () => ((await savedBlock(page, id)).states as { hover?: { effects?: { opacity: number } } } | undefined)?.hover?.effects?.opacity).toBe(0.4);
    expect((await savedBlock(page, id)).style.effects).toBeUndefined();
    await page.locator('[data-control="state"] select').selectOption('normal');
    await expect(effects.getByLabel('Прозрачность', { exact: true })).toHaveValue('100');
    await page.locator('[data-control="state"] select').selectOption('hover');
    await expect(effects.getByLabel('Прозрачность', { exact: true })).toHaveValue('40');
    await page.getByRole('button', { name: 'Сбросить к теме: Эффекты' }).click();
    await expect.poll(async () => (await savedBlock(page, id)).states).toBeUndefined();
  });

  test('S-04 · линейный градиент: вид, угол, точки; слои можно переставить и убрать', async ({ page }) => {
    const { id } = await seedProject(page, (d) => void d.screens[0]!.blocks.push(shapeAt('figura_1', 'Фигура', 40)));
    await openEditor(page, id);
    await pickInLayers(page, 'Фигура');
    const fills = await section(page, 'fills');
    await fills.getByRole('button', { name: 'Добавить' }).click();
    await fills.getByLabel('Слой', { exact: true }).selectOption('linear');
    await fills.getByLabel('Угол', { exact: true }).fill('90');
    await fills.getByRole('button', { name: 'Добавить' }).first().click(); // a stop
    await expect(fills.locator('[data-control="fills.stops.offset"]')).toHaveCount(3);
    await fills.getByRole('button', { name: 'Добавить' }).last().click(); // a second fill layer
    await expect(fills.locator('[data-control="fills"] > [data-item]')).toHaveCount(2);
    await fills.getByRole('button', { name: 'Слои заливки 2: выше' }).click();
    await expect.poll(async () => (await savedFills(page, id)).map((f) => f.kind)).toEqual(['solid', 'linear']);
    const fill = (await savedFills(page, id))[1]!;
    expect(fill.angle).toBe(90);
    expect(fill.stops).toHaveLength(3);
    await fills.getByRole('button', { name: 'Слои заливки 1: убрать' }).click();
    await expect.poll(async () => (await savedFills(page, id)).length).toBe(1);

    await page.getByRole('button', { name: 'Предпросмотр' }).click();
    const frame = page.getByRole('dialog', { name: 'Предпросмотр' }).locator('[data-preview="true"]');
    await frame.locator('.bk-player-screen[data-live="true"]').waitFor();
    const bg = await frame.locator('[data-block-id="figura_1"] .bk-fill').first().evaluate((n) => (n as HTMLElement).style.backgroundImage);
    expect(bg).toContain('linear-gradient(90deg');
  });

  test('S-04 · цвет: HEX с проверкой, прозрачность, цвет темы', async ({ page }) => {
    const { id } = await seedProject(page, (d) => void d.screens[0]!.blocks.push(shapeAt('figura_1', 'Фигура', 40)));
    await openEditor(page, id);
    await pickInLayers(page, 'Фигура');
    const fills = await section(page, 'fills');
    await fills.getByRole('button', { name: 'Добавить' }).click();
    await fills.getByLabel('Цвет: источник').selectOption('hex');
    const hex = fills.getByLabel('Цвет: HEX');
    await hex.fill('#12ab');
    await expect.poll(async () => JSON.stringify((await savedFills(page, id))[0]?.color ?? '')).not.toContain('12ab');
    await hex.fill('#12ab34');
    await expect.poll(async () => (await savedFills(page, id))[0]?.color?.hex).toBe('#12ab34');
    await fills.getByLabel('Цвет: прозрачность, %').fill('50');
    await expect.poll(async () => (await savedFills(page, id))[0]?.color?.hex).toBe('#12ab3480');
    await fills.getByLabel('Цвет: источник').selectOption('token');
    await fills.getByLabel('Цвет: цвет темы').selectOption('accent');
    await expect.poll(async () => (await savedFills(page, id))[0]?.color).toEqual({ token: 'accent', alpha: 0.5 });
  });

  test('S-02 · форма: звезда с параметрами; S-03 скругление в процентах', async ({ page }) => {
    const { id } = await seedProject(page, (d) => void d.screens[0]!.blocks.push(shapeAt('figura_1', 'Фигура', 40)));
    await openEditor(page, id);
    await pickInLayers(page, 'Фигура');
    const shape = await section(page, 'shape');
    await shape.getByLabel('Форма', { exact: true }).selectOption('star');
    await shape.getByLabel('Лучей', { exact: true }).fill('7');
    await shape.getByLabel('Глубина', { exact: true }).fill('30');
    const radius = await section(page, 'radius');
    await radius.getByLabel('Единицы', { exact: true }).selectOption('%');
    await radius.getByLabel('Левый верхний угол', { exact: true }).fill('25');
    await expect.poll(async () => (await savedBlock(page, id)).style.shape).toMatchObject({ kind: 'star', points: 7, depth: 0.3 });
    await expect.poll(async () => (await savedBlock(page, id)).style.radius).toMatchObject({ unit: '%', tl: 25 });
    // The schema refuses more than 50 %: the value is not taken.
    await radius.getByLabel('Левый верхний угол', { exact: true }).fill('80');
    await expect.poll(async () => ((await savedBlock(page, id)).style.radius as { tl: number }).tl).toBe(25);
  });

  test('S-10 · текст: размер, начертание, курсив, выравнивание — в документе и в предпросмотре', async ({ page }) => {
    const text = { id: 'tekst_1', type: 'text', name: 'Надпись', frame: { x: 20, y: 40, w: 300, h: 80 }, textLayer: { paragraphs: [{ kind: 'p', runs: [{ t: 'Привет' }] }] } };
    const { id } = await seedProject(page, (d) => void d.screens[0]!.blocks.push(text));
    await openEditor(page, id);
    await pickInLayers(page, 'Надпись');
    const t = await section(page, 'text');
    await setNumber(t, 'Размер', '40');
    await t.getByLabel('Начертание', { exact: true }).selectOption('700');
    await t.getByLabel('Курсив').check();
    await t.getByLabel('По горизонтали', { exact: true }).selectOption('center');
    await t.getByLabel('Регистр', { exact: true }).selectOption('uppercase');
    await expect.poll(async () => (await savedBlock(page, id)).style.text).toMatchObject({ size: 40, weight: 700, italic: true, align: 'center', transform: 'uppercase' });
    await page.getByRole('button', { name: 'Предпросмотр' }).click();
    const frame = page.getByRole('dialog', { name: 'Предпросмотр' }).locator('[data-preview="true"]');
    await frame.locator('.bk-player-screen[data-live="true"]').waitFor();
    const style = await frame.getByText('Привет').evaluate((n) => {
      const cs = getComputedStyle(n);
      return { weight: cs.fontWeight, italic: cs.fontStyle, align: cs.textAlign, transform: cs.textTransform };
    });
    expect(style).toEqual({ weight: '700', italic: 'italic', align: 'center', transform: 'uppercase' });
  });

  test('S-12…S-14 · анимации: появление, постоянная, нажатие — включаются, настраиваются и снимаются', async ({ page }) => {
    const { id } = await seedProject(page, (d) => void d.screens[0]!.blocks.push(shapeAt('figura_1', 'Фигура', 40)));
    await openEditor(page, id);
    await pickInLayers(page, 'Фигура');
    const anim = await section(page, 'animation');
    await anim.getByLabel('Анимация появления').check();
    await anim.getByLabel('Вид', { exact: true }).first().selectOption('slide');
    await setNumber(anim, 'Длительность, мс', '1200');
    await anim.getByLabel('Плавность', { exact: true }).selectOption('spring');
    await anim.getByLabel('Постоянная анимация').check();
    await anim.getByLabel('Реакция на нажатие').check();
    await expect.poll(async () => (await savedBlock(page, id)).animation).toMatchObject({
      enter: { kind: 'slide', durationMs: 1200, easing: { kind: 'spring' } },
      loop: { kind: 'pulse' },
      press: { kind: 'grow' },
    });
    await anim.getByLabel('Анимация появления').uncheck();
    await anim.getByLabel('Постоянная анимация').uncheck();
    await anim.getByLabel('Реакция на нажатие').uncheck();
    await expect.poll(async () => (await savedBlock(page, id)).animation).toBeUndefined();
    // The animated block plays in the preview.
    await anim.getByLabel('Анимация появления').check();
    await page.getByRole('button', { name: 'Предпросмотр' }).click();
    await expect(page.getByRole('dialog', { name: 'Предпросмотр' }).locator('[data-block-id="figura_1"]')).toHaveCount(1);
  });

  test('S-04 · фото в заливке: загрузка в окне выбора, потом выбор из медиатеки; в предпросмотре — картинка', async ({ page }) => {
    const { id } = await seedProject(page, (d) => void d.screens[0]!.blocks.push(shapeAt('figura_1', 'Фигура', 40)));
    await openEditor(page, id);
    await pickInLayers(page, 'Фигура');
    const fills = await section(page, 'fills');
    await fills.getByRole('button', { name: 'Добавить' }).click();
    await fills.getByLabel('Слой', { exact: true }).selectOption('media');
    await fills.getByRole('button', { name: 'Выбрать файл' }).click();
    const dialog = page.getByRole('dialog', { name: 'Выбор файла' });
    await expect(dialog.getByText('В медиатеке пока нет подходящих файлов')).toBeVisible();
    await dialog.getByLabel('Загрузить файл').setInputFiles({ name: 'foto.png', mimeType: 'image/png', buffer: PNG_1PX });
    await expect(dialog).toHaveCount(0);
    await expect.poll(async () => (await savedFills(page, id))[0]).toMatchObject({ kind: 'media', media: { source: 'media' } });
    const first = (await savedFills(page, id))[0]!.media!.id;
    expect(first).not.toBe('media_unset');

    // The second time the file is in the library.
    await fills.getByRole('button', { name: 'Заменить файл' }).click();
    await expect(page.getByRole('dialog', { name: 'Выбор файла' }).locator(`[data-media-id="${first}"]`)).toBeVisible();
    await page.getByRole('dialog', { name: 'Выбор файла' }).locator(`[data-media-id="${first}"]`).click();

    await page.getByRole('button', { name: 'Предпросмотр' }).click();
    const frame = page.getByRole('dialog', { name: 'Предпросмотр' }).locator('[data-preview="true"]');
    await frame.locator('.bk-player-screen[data-live="true"]').waitFor();
    const bg = await frame.locator('[data-block-id="figura_1"] .bk-fill').first().evaluate((n) => (n as HTMLElement).style.backgroundImage);
    expect(bg).toContain(`/api/v1/media/${first}/file`);
  });

  test('S-11 · «Медиа» есть у блоков с файлами, «Раскладка» — у блоков с вложенными', async ({ page }) => {
    const { id } = await seedProject(page, (d) =>
      void d.screens[0]!.blocks.push(blockJson(createBlock('image')), blockJson(createBlock('container')), blockJson(createBlock('button'))),
    );
    await openEditor(page, id);
    await pickInLayers(page, 'Изображение');
    await expect(page.locator('[data-section="media"]')).toHaveCount(1);
    await expect(page.locator('[data-section="layout"]')).toHaveCount(0);
    await pickInLayers(page, 'Контейнер');
    await expect(page.locator('[data-section="layout"]')).toHaveCount(1);
    await expect(page.locator('[data-section="media"]')).toHaveCount(0);
    await pickInLayers(page, 'Кнопка');
    await expect(page.locator('[data-section="layout"]')).toHaveCount(0);
    await expect(page.locator('[data-section="media"]')).toHaveCount(0);
    // S-00: every other group is there.
    for (const g of ['size', 'shape', 'radius', 'fills', 'stroke', 'shadows', 'glow', 'effects', 'filters', 'padding', 'text', 'transform3d', 'mask', 'animation']) {
      await expect(page.locator(`[data-section="${g}"]`)).toHaveCount(1);
    }
  });

  test('S-05 · обводка со своим шаблоном штриха; S-06 свечение; S-08 фильтры', async ({ page }, info) => {
    const { id } = await seedProject(page, (d) => void d.screens[0]!.blocks.push(shapeAt('figura_1', 'Фигура', 40)));
    await openEditor(page, id);
    await pickInLayers(page, 'Фигура');
    const stroke = await section(page, 'stroke');
    await setNumber(stroke, 'Толщина', '4');
    await stroke.getByLabel('Вид', { exact: true }).selectOption('dashed');
    await stroke.getByLabel('Свой шаблон штриха').check();
    await expect.poll(async () => ((await savedBlock(page, id)).style.stroke as { dash?: number[] } | undefined)?.dash).toEqual([8, 4]);
    const glow = await section(page, 'glow');
    await glow.getByLabel('Свечение', { exact: true }).check();
    await expect.poll(async () => (await savedBlock(page, id)).style.glow).toMatchObject({ size: 16 });
    await glow.getByLabel('Свечение', { exact: true }).uncheck();
    await expect.poll(async () => (await savedBlock(page, id)).style.glow).toBeUndefined();
    const filters = await section(page, 'filters');
    await setNumber(filters, 'Сепия', '60');
    await filters.getByLabel('Яркость: ползунок').fill('150');
    await expect.poll(async () => (await savedBlock(page, id)).style.filters).toMatchObject({ sepia: 0.6, brightness: 1.5 });

    mkdirSync(SHOTS, { recursive: true });
    await page.screenshot({ path: `${SHOTS}/inspector-${info.project.name}.png`, fullPage: true });
  });

  test('E-15 · ввод в поле одного блока и отмена: значение возвращается, поле показывает его', async ({ page }) => {
    const { id } = await seedProject(page, (d) => void d.screens[0]!.blocks.push(shapeAt('figura_1', 'Фигура', 40)));
    await openEditor(page, id);
    await pickInLayers(page, 'Фигура');
    const pad = await section(page, 'padding');
    await setNumber(pad, 'Сверху', '12');
    await expect(saveStatus(page)).toHaveText('Сохранено');
    await page.locator('body').click({ position: { x: 3, y: 3 } });
    await page.keyboard.press('Control+z');
    await expect(pad.getByLabel('Сверху', { exact: true })).toHaveValue('0');
    expect(await blockCenter(page, 'Фигура')).toBeTruthy();
    await hit(page, 'Фигура').click();
    await drag(page, await blockCenter(page, 'Фигура'), await blockCenter(page, 'Фигура'));
  });
});
