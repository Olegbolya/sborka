import { mkdirSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import { freshUser, loginAndOnboard } from './helpers/auth';
import { at, blockCenter, box, drag, frameFields, geometry, handleAt, hit, nextButton, openEditor, release, saveStatus, seedProject, serverDraft, snapOff, stage } from './helpers/editor';

const SHOTS = 'e2e/__screenshots__';
type Blocks = Array<Record<string, unknown>>;

test.beforeEach(async ({ page }) => {
  await loginAndOnboard(page, freshUser('Автор'));
});

const open = async (page: import('@playwright/test').Page, blocks: Blocks, extra?: (d: { screens: Array<{ blocks: unknown[] }> }) => void) => {
  const { id } = await seedProject(page, (d) => {
    d.screens[0]!.blocks.push(...blocks);
    extra?.(d as never);
  });
  await openEditor(page, id);
  return id;
};

const pressed = (page: import('@playwright/test').Page) => stage(page).locator('.ed-hit[aria-pressed="true"]');
const names = async (page: import('@playwright/test').Page) => (await pressed(page).evaluateAll((els) => els.map((e) => e.getAttribute('aria-label')))).sort();

test.describe('E-04 · выделение', () => {
  test('E-04 · клик выделяет блок, клик по пустому месту снимает; Shift и Ctrl добавляют и убирают', async ({ page }) => {
    await open(page, [box('blok_a', 'Блок A', 20, 40), box('blok_b', 'Блок B', 200, 40)]);
    await hit(page, 'Блок A').click();
    expect(await names(page)).toEqual(['Блок A']);
    await hit(page, 'Блок B').click({ modifiers: ['Shift'] });
    expect(await names(page)).toEqual(['Блок A', 'Блок B']);
    await hit(page, 'Блок A').click({ modifiers: ['Control'] });
    expect(await names(page)).toEqual(['Блок B']);
    await hit(page, 'Блок A').click();
    expect(await names(page)).toEqual(['Блок A']);
    const empty = await at(page, 150, 400);
    await page.mouse.click(empty.x, empty.y);
    expect(await names(page)).toEqual([]);
  });

  test('E-04 · рамка выделяет всё, чего касается; Shift добавляет к выделению; скрытые не выделяются', async ({ page }) => {
    await open(page, [box('blok_a', 'Блок A', 20, 40), box('blok_b', 'Блок B', 200, 40), box('blok_c', 'Блок C', 20, 300), { ...box('blok_h', 'Скрытый', 20, 150), hiddenInEditor: true }]);
    await snapOff(page);
    // From empty space below the blocks up across A and B only.
    await drag(page, await at(page, 10, 250), await at(page, 330, 20), { hold: true });
    await expect(page.getByTestId('marquee')).toBeVisible();
    await release(page);
    await expect(page.getByTestId('marquee')).toHaveCount(0);
    expect(await names(page)).toEqual(['Блок A', 'Блок B']);
    // Shift adds C.
    await drag(page, await at(page, 10, 380), await at(page, 150, 290), { modifiers: ['Shift'] });
    expect(await names(page)).toEqual(['Блок A', 'Блок B', 'Блок C']);
    // A frame over the hidden block's place does not pick it.
    await drag(page, await at(page, 5, 140), await at(page, 60, 220));
    expect(await names(page)).toEqual([]);
  });

  test('E-04 · выделение через панель слоёв отражается на холсте и в свойствах', async ({ page }) => {
    await open(page, [box('blok_a', 'Блок A', 20, 40), box('blok_b', 'Блок B', 200, 40)]);
    await page.getByRole('tab', { name: 'Слои' }).click();
    await page.getByRole('list', { name: 'Слои' }).getByRole('button', { name: 'Блок B', exact: true }).click();
    expect(await names(page)).toEqual(['Блок B']);
    expect((await frameFields(page)).x).toBe(200);
  });
});

test.describe('E-05 · перетаскивание, размер, поворот', () => {
  test('E-05 · перетаскивание двигает блок на то, на сколько сдвинут указатель; это один шаг отмены', async ({ page }) => {
    const id = await open(page, [box('blok_a', 'Блок A', 40, 60)]);
    await snapOff(page);
    const { unit } = await geometry(page);
    const c = await blockCenter(page, 'Блок A');
    await drag(page, c, { x: c.x + 50 * unit, y: c.y + 30 * unit });
    const f = await frameFields(page);
    expect(f.x).toBeCloseTo(90, 0);
    expect(f.y).toBeCloseTo(90, 0);
    await expect.poll(async () => (await serverDraft(page, id)).doc.screens[0]!.blocks.map((b) => (b as { frame: { x: number } }).frame.x)[0]).toBeCloseTo(90, 0);
    await page.keyboard.press('Control+z'); // one press undoes the whole drag
    expect((await frameFields(page)).x).toBe(40);
    expect((await frameFields(page)).y).toBe(60);
    await page.keyboard.press('Control+Shift+z');
    expect((await frameFields(page)).x).toBeCloseTo(90, 0);
  });

  test('E-05 · выделенные вместе блоки едут вместе; закреплённый остаётся на месте; Shift держит ось', async ({ page }) => {
    await open(page, [box('blok_a', 'Блок A', 20, 40), box('blok_b', 'Блок B', 200, 40), { ...box('blok_l', 'Закреплённый', 20, 300), locked: true }]);
    await snapOff(page);
    const { unit } = await geometry(page);
    await page.keyboard.press('Control+a');
    expect(await names(page)).toHaveLength(3);
    const c = await blockCenter(page, 'Блок A');
    await drag(page, c, { x: c.x + 30 * unit, y: c.y + 10 * unit });
    await page.getByRole('tab', { name: 'Слои' }).click();
    const layers = page.getByRole('list', { name: 'Слои' });
    await layers.getByRole('button', { name: 'Закреплённый', exact: true }).click();
    expect((await frameFields(page)).x).toBe(20); // the locked one stayed
    await layers.getByRole('button', { name: 'Блок B', exact: true }).click();
    expect((await frameFields(page)).x).toBeCloseTo(230, 0);
    // Shift: the drag is straight.
    const cb = await blockCenter(page, 'Блок B');
    await drag(page, cb, { x: cb.x + 40 * unit, y: cb.y + 8 * unit }, { late: ['Shift'] });
    const f = await frameFields(page);
    expect(f.x).toBeCloseTo(270, 0);
    expect(f.y).toBeCloseTo(50, 0);
  });

  test('E-05 · клик по блоку из выделенных оставляет только его; перетаскивание — нет', async ({ page }) => {
    await open(page, [box('blok_a', 'Блок A', 20, 40), box('blok_b', 'Блок B', 200, 40)]);
    await page.keyboard.press('Control+a');
    await hit(page, 'Блок A').click();
    expect(await names(page)).toEqual(['Блок A']);
  });

  test('E-05 · маркер юго-восточного угла меняет размер, левый верхний угол остаётся', async ({ page }) => {
    await open(page, [box('blok_a', 'Блок A', 40, 60, 100, 60)]);
    await snapOff(page);
    await hit(page, 'Блок A').click();
    const { unit } = await geometry(page);
    const h = (await page.locator('[data-handle="se"]').boundingBox())!;
    const from = { x: h.x + h.width / 2, y: h.y + h.height / 2 };
    await drag(page, from, { x: from.x + 40 * unit, y: from.y + 20 * unit });
    const f = await frameFields(page);
    expect(f).toMatchObject({ x: 40, y: 60 });
    expect(f.w).toBeCloseTo(140, 0);
    expect(f.h).toBeCloseTo(80, 0);
  });

  test('E-05 · восемь маркеров; боковые меняют одну сторону; Shift — пропорции, Alt — от центра', async ({ page }) => {
    await open(page, [box('blok_a', 'Блок A', 100, 100, 100, 50)]);
    await snapOff(page);
    await hit(page, 'Блок A').click();
    await expect(page.locator('.ed-handle[data-handle]:not([data-handle="rotate"])')).toHaveCount(8);
    const { unit } = await geometry(page);
    const handle = (n: string) => handleAt(page, n);
    // west: the right edge stays
    const w = await handle('w');
    await drag(page, w, { x: w.x - 20 * unit, y: w.y });
    expect(await frameFields(page)).toMatchObject({ x: 80, w: 120, y: 100, h: 50 });
    await page.keyboard.press('Control+z');
    await expect(page.getByLabel('Ширина')).toHaveValue('100');
    // Shift: proportions kept
    const e = await handle('e');
    await drag(page, e, { x: e.x + 50 * unit, y: e.y }, { modifiers: ['Shift'] });
    const prop = await frameFields(page);
    expect(prop.w / prop.h).toBeCloseTo(2, 1);
    expect(prop.w).toBeCloseTo(150, 0);
    await page.keyboard.press('Control+z');
    await expect(page.getByLabel('Ширина')).toHaveValue('100');
    // Alt: grows from the centre
    const se = await handle('se');
    await drag(page, se, { x: se.x + 20 * unit, y: se.y + 10 * unit }, { modifiers: ['Alt'] });
    const alt = await frameFields(page);
    expect(alt.x + alt.w / 2).toBeCloseTo(150, 0);
    expect(alt.y + alt.h / 2).toBeCloseTo(125, 0);
    expect(alt.w).toBeCloseTo(140, 0);
  });

  test('E-05 · рамка нескольких блоков: растягивает блоки пропорционально', async ({ page }) => {
    await open(page, [box('blok_a', 'Блок A', 20, 40, 100, 60), box('blok_b', 'Блок B', 120, 40, 100, 60)]);
    await snapOff(page);
    await page.keyboard.press('Control+a');
    const { unit } = await geometry(page);
    const h = (await page.locator('[data-handle="e"]').boundingBox())!;
    const from = { x: h.x + h.width / 2, y: h.y + h.height / 2 };
    await drag(page, from, { x: from.x + 200 * unit, y: from.y });
    const frames = (await serverDraftFrames(page)).sort((p, q) => p.x - q.x);
    expect(frames[0]!.w).toBeCloseTo(200, 0);
    expect(frames[1]!.x).toBeCloseTo(220, 0);
    expect(frames[1]!.w).toBeCloseTo(200, 0);
  });

  test('E-05 · поворот за маркер; Shift — шаги по 15°', async ({ page }) => {
    await open(page, [box('blok_a', 'Блок A', 100, 200, 100, 100)]);
    await hit(page, 'Блок A').click();
    const r = (await page.locator('[data-handle="rotate"]').boundingBox())!;
    const handle = { x: r.x + r.width / 2, y: r.y + r.height / 2 };
    const centre = await blockCenter(page, 'Блок A');
    // A quarter turn clockwise: from above the centre to the right of it.
    const radius = Math.hypot(handle.x - centre.x, handle.y - centre.y);
    await drag(page, handle, { x: centre.x + radius, y: centre.y });
    expect((await frameFields(page)).rotation).toBeCloseTo(90, 0);
    await page.keyboard.press('Control+z');
    expect((await frameFields(page)).rotation).toBe(0);
    await drag(page, handle, { x: centre.x + radius, y: centre.y - radius * 0.3 }, { modifiers: ['Shift'] });
    expect((await frameFields(page)).rotation % 15).toBe(0);
    expect((await frameFields(page)).rotation).not.toBe(0);
  });

  test('E-05 · закреплённый блок: ни перетаскивания, ни маркеров', async ({ page }) => {
    await open(page, [{ ...box('blok_a', 'Блок A', 40, 60), locked: true }]);
    await hit(page, 'Блок A').click();
    await expect(page.locator('[data-handle]')).toHaveCount(0);
    const { unit } = await geometry(page);
    const c = await blockCenter(page, 'Блок A');
    await drag(page, c, { x: c.x + 30 * unit, y: c.y });
    expect((await frameFields(page)).x).toBe(40);
  });

  test('S-01 · поворот и отражение в свойствах', async ({ page }) => {
    const id = await open(page, [box('blok_a', 'Блок A', 40, 60)]);
    await hit(page, 'Блок A').click();
    await page.getByLabel('Поворот', { exact: true }).fill('45');
    await page.getByRole('button', { name: 'Отразить по горизонтали' }).click();
    await expect.poll(async () => (await serverDraft(page, id)).doc.screens[0]!.blocks[0]).toMatchObject({ frame: { rotation: 45, flipX: true } });
  });
});

async function serverDraftFrames(page: import('@playwright/test').Page) {
  // The inspector shows «смешанно» for several blocks: read frames from the layers by selecting each one.
  const out: Array<{ x: number; y: number; w: number; h: number }> = [];
  await page.getByRole('tab', { name: 'Слои' }).click();
  const layers = page.getByRole('list', { name: 'Слои' }).getByRole('button', { name: /^Блок/ });
  const n = await layers.count();
  const labels = (await layers.allInnerTexts()).map((t) => t.trim());
  for (let i = 0; i < n; i++) {
    await page.getByRole('list', { name: 'Слои' }).getByRole('button', { name: labels[i]!, exact: true }).click();
    const f = await frameFields(page);
    out.push({ x: f.x, y: f.y, w: f.w, h: f.h });
  }
  return out;
}

test.describe('E-06 · прилипание и направляющие', () => {
  test('E-06 · к краю артборда: координата ровно 0, направляющая видна, пока кнопка нажата, и исчезает после', async ({ page }, info) => {
    await open(page, [box('blok_a', 'Блок A', 60, 100)]);
    const { unit } = await geometry(page);
    const c = await blockCenter(page, 'Блок A');
    await drag(page, c, { x: c.x - 57 * unit, y: c.y }, { hold: true });
    await expect(page.getByTestId('guide').first()).toBeVisible();
    await expect(page.locator('[data-testid="guide"][data-axis="x"][data-at="0"][data-kind="artboard"]')).toHaveCount(1);
    mkdirSync(SHOTS, { recursive: true });
    await page.screenshot({ path: `${SHOTS}/guides-${info.project.name}.png` });
    await release(page);
    await expect(page.getByTestId('guide')).toHaveCount(0);
    expect((await frameFields(page)).x).toBe(0);
  });

  test('E-06 · к центру и правому краю артборда', async ({ page }) => {
    await open(page, [box('blok_a', 'Блок A', 60, 100, 100, 60)]);
    const { unit } = await geometry(page);
    let c = await blockCenter(page, 'Блок A');
    await drag(page, c, { x: c.x + 83 * unit, y: c.y }); // x 60 → 143, the centre at 193: pulled to the middle of 390
    expect((await frameFields(page)).x).toBe(145);
    c = await blockCenter(page, 'Блок A');
    await drag(page, c, { x: c.x + 143 * unit, y: c.y });
    expect((await frameFields(page)).x).toBe(290); // the right edge on 390
  });

  test('E-06 · к другому блоку: край в край, с направляющей и расстояниями до соседей', async ({ page }) => {
    await open(page, [box('blok_a', 'Блок A', 40, 100, 60, 60), box('blok_b', 'Блок B', 100, 300, 60, 60)]);
    const { unit } = await geometry(page);
    const c = await blockCenter(page, 'Блок A');
    // Left edge of A near the left edge of B (100): move A to x = 97.
    await drag(page, c, { x: c.x + 57 * unit, y: c.y }, { hold: true });
    await expect(page.locator('[data-testid="guide"][data-axis="x"][data-at="100"][data-kind="block"]')).toHaveCount(1);
    await expect(page.getByTestId('gap').first()).toBeVisible();
    expect(await page.getByTestId('gap').count()).toBeGreaterThan(0);
    await release(page);
    expect((await frameFields(page)).x).toBe(100);
  });

  test('E-06 · Alt отключает прилипание; кнопка «Прилипание» — тоже', async ({ page }) => {
    await open(page, [box('blok_a', 'Блок A', 60, 100)]);
    const { unit } = await geometry(page);
    const c = await blockCenter(page, 'Блок A');
    await drag(page, c, { x: c.x - 57 * unit, y: c.y }, { modifiers: ['Alt'], hold: true });
    await expect(page.getByTestId('guide')).toHaveCount(0);
    await release(page, ['Alt']);
    expect((await frameFields(page)).x).toBeCloseTo(3, 0);
    await page.getByRole('button', { name: 'Прилипание' }).click();
    await expect(page.getByRole('button', { name: 'Прилипание' })).toHaveAttribute('aria-pressed', 'false');
    const c2 = await blockCenter(page, 'Блок A');
    await drag(page, c2, { x: c2.x - 10 * unit, y: c2.y });
    expect((await frameFields(page)).x).toBeCloseTo(-7, 0); // no pull to the edge now
  });

  test('E-06 · сетка 8: кнопка включает сетку и прилипание к ней', async ({ page }) => {
    await open(page, [box('blok_a', 'Блок A', 61, 101)]);
    await page.getByRole('button', { name: 'Сетка' }).click();
    await expect(page.getByTestId('grid')).toBeVisible();
    const { unit } = await geometry(page);
    const c = await blockCenter(page, 'Блок A');
    await drag(page, c, { x: c.x + 5 * unit, y: c.y + 2 * unit }); // → (66, 103): the grid pulls it to (64, 104)
    const f = await frameFields(page);
    expect(f.x % 8).toBe(0);
    expect(f.y % 8).toBe(0);
    await page.getByRole('button', { name: 'Сетка' }).click();
    await expect(page.getByTestId('grid')).toHaveCount(0);
  });

  test('E-06 · при изменении размера край прилипает к границе артборда', async ({ page }) => {
    await open(page, [box('blok_a', 'Блок A', 200, 100, 100, 60)]);
    await hit(page, 'Блок A').click();
    const { unit } = await geometry(page);
    const h = (await page.locator('[data-handle="e"]').boundingBox())!;
    const from = { x: h.x + h.width / 2, y: h.y + h.height / 2 };
    await drag(page, from, { x: from.x + 87 * unit, y: from.y }); // right edge 300 → 387: pulled to 390
    const f = await frameFields(page);
    expect(f.x + f.w).toBe(390);
  });
});

test.describe('E-07 · стрелки', () => {
  test('E-07 · стрелка — 1 единица, Shift+стрелка — 10; быстрые нажатия — один шаг отмены', async ({ page }) => {
    await open(page, [box('blok_a', 'Блок A', 100, 100)]);
    await hit(page, 'Блок A').click();
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Shift+ArrowLeft');
    await page.keyboard.press('Shift+ArrowUp');
    expect(await frameFields(page)).toMatchObject({ x: 92, y: 91 });
    await page.keyboard.press('Control+z');
    expect(await frameFields(page)).toMatchObject({ x: 100, y: 100 });
  });

  test('E-07 · закреплённые блоки стрелками не двигаются, в поле ввода стрелки работают как обычно', async ({ page }) => {
    await open(page, [{ ...box('blok_a', 'Блок A', 100, 100), locked: true }]);
    await hit(page, 'Блок A').click();
    await page.keyboard.press('ArrowRight');
    expect((await frameFields(page)).x).toBe(100);
    await page.getByLabel('X', { exact: true }).focus();
    await page.keyboard.press('ArrowUp'); // a number field steps itself; the block is not touched by the editor's keys
    await expect(page.getByLabel('Название сборки')).toBeVisible();
  });
});

test.describe('E-08 · копировать и вставить', () => {
  test('E-08 · Ctrl+C / Ctrl+V на том же экране: копия сдвинута, выделена, с новым идентификатором', async ({ page }) => {
    const id = await open(page, [box('blok_a', 'Блок A', 40, 60)]);
    await hit(page, 'Блок A').click();
    await page.keyboard.press('Control+c');
    await page.keyboard.press('Control+v');
    await expect(stage(page).locator('.ed-hit')).toHaveCount(2);
    expect(await frameFields(page)).toMatchObject({ x: 52, y: 72 });
    await page.keyboard.press('Control+v');
    await expect(stage(page).locator('.ed-hit')).toHaveCount(3);
    expect(await frameFields(page)).toMatchObject({ x: 64, y: 84 });
    await expect(saveStatusOf(page)).toHaveText('Сохранено');
    const blocks = (await serverDraft(page, id)).doc.screens[0]!.blocks as Array<{ id: string }>;
    expect(new Set(blocks.map((b) => b.id)).size).toBe(3);
  });

  test('E-08 · вырезать убирает блок, вставить на другой экран возвращает на то же место, правила едут вместе', async ({ page }) => {
    await open(page, [nextButton('knopka_a', 'Кнопка A')], (d) => d.screens.push({ id: 'ekran_dva', name: 'Второй', blocks: [] } as never));
    await hit(page, 'Кнопка A').click();
    await page.keyboard.press('Control+x');
    await expect(stage(page).locator('.ed-hit')).toHaveCount(0);
    await page.getByRole('list', { name: 'Экраны' }).getByRole('listitem').nth(1).getByRole('button').click();
    await page.keyboard.press('Control+v');
    await expect(hit(page, 'Кнопка A')).toBeVisible();
    await page.getByRole('tab', { name: 'Сценарии' }).click();
    await expect(page.getByTestId('scenario-counts')).toHaveText('Правил: 1. Поведений: 0.');
    await page.getByRole('tab', { name: 'Оформление' }).click();
    expect(await frameFields(page)).toMatchObject({ x: 95, y: 300 });
  });

  test('E-08 · между сборками: копия из одной сборки вставляется в другую', async ({ page }) => {
    await open(page, [box('blok_a', 'Блок A', 40, 60)]);
    await hit(page, 'Блок A').click();
    await page.keyboard.press('Control+c');
    const other = await seedProject(page, undefined, 'Другая сборка');
    await openEditor(page, other.id);
    await expect(stage(page).locator('.ed-hit')).toHaveCount(0);
    await page.keyboard.press('Control+v');
    await expect(hit(page, 'Блок A')).toBeVisible();
    await expect.poll(async () => (await serverDraft(page, other.id)).doc.screens[0]!.blocks.length).toBe(1);
  });

  test('E-08 · Ctrl+D дублирует на месте со сдвигом; вставка при пустом буфере ничего не делает', async ({ page }) => {
    await open(page, [box('blok_a', 'Блок A', 40, 60)]);
    await page.evaluate(() => localStorage.removeItem('blokum.clipboard'));
    await page.keyboard.press('Control+v');
    await expect(stage(page).locator('.ed-hit')).toHaveCount(1);
    await hit(page, 'Блок A').click();
    await page.keyboard.press('Control+d');
    await expect(stage(page).locator('.ed-hit')).toHaveCount(2);
  });
});

const saveStatusOf = saveStatus;

test.describe('E-09 · группы, выравнивание, порядок, блокировка', () => {
  test('E-09 · группа: Ctrl+G, клик выделяет всю группу, она двигается вместе, Alt берёт один блок, Ctrl+Shift+G разгруппирует', async ({ page }) => {
    await open(page, [box('blok_a', 'Блок A', 20, 40), box('blok_b', 'Блок B', 200, 40), box('blok_c', 'Блок C', 20, 300)]);
    await snapOff(page);
    await hit(page, 'Блок A').click();
    await hit(page, 'Блок B').click({ modifiers: ['Shift'] });
    await page.keyboard.press('Control+g');
    await page.getByRole('tab', { name: 'Слои' }).click();
    await expect(page.getByRole('button', { name: 'Группа (2)' })).toBeVisible();
    await page.keyboard.press('Escape');
    await hit(page, 'Блок A').click();
    expect(await names(page)).toEqual(['Блок A', 'Блок B']);
    const { unit } = await geometry(page);
    const c = await blockCenter(page, 'Блок A');
    await drag(page, c, { x: c.x, y: c.y + 20 * unit });
    await page.keyboard.press('Escape');
    await hit(page, 'Блок B').click({ modifiers: ['Alt'] });
    expect(await names(page)).toEqual(['Блок B']);
    expect((await frameFields(page)).y).toBeCloseTo(60, 0);
    await hit(page, 'Блок A').click();
    await page.keyboard.press('Control+Shift+g');
    await expect(page.getByRole('button', { name: 'Группа (2)' })).toHaveCount(0);
    await hit(page, 'Блок A').click();
    expect(await names(page)).toEqual(['Блок A']);
  });

  test('E-09 · копия группы остаётся группой', async ({ page }) => {
    await open(page, [box('blok_a', 'Блок A', 20, 40), box('blok_b', 'Блок B', 200, 40)]);
    await page.keyboard.press('Control+a');
    await page.getByRole('button', { name: 'Сгруппировать' }).click();
    await page.keyboard.press('Control+d');
    await page.getByRole('tab', { name: 'Слои' }).click();
    await expect(page.getByRole('button', { name: 'Группа (2)' })).toHaveCount(2);
  });

  test('E-09 · выравнивание и распределение кнопками в свойствах', async ({ page }) => {
    await open(page, [box('blok_a', 'Блок A', 20, 40, 60, 40), box('blok_b', 'Блок B', 130, 110, 60, 40), box('blok_c', 'Блок C', 300, 200, 60, 40)]);
    await page.keyboard.press('Control+a');
    await page.getByRole('button', { name: 'По верхнему краю' }).click();
    await page.getByRole('button', { name: 'Распределить по горизонтали' }).click();
    const frames = (await serverDraftFrames(page)).sort((p, q) => p.x - q.x);
    expect(frames.map((f) => f.y)).toEqual([40, 40, 40]);
    const gap1 = frames[1]!.x - (frames[0]!.x + frames[0]!.w);
    const gap2 = frames[2]!.x - (frames[1]!.x + frames[1]!.w);
    expect(Math.abs(gap1 - gap2)).toBeLessThan(0.3);
    expect(frames[0]!.x).toBe(20);
    expect(frames[2]!.x).toBe(300);
    await hit(page, 'Блок A').click();
    await page.getByRole('button', { name: 'По центру', exact: true }).click(); // one block: to the artboard
    await expect.poll(async () => (await frameFields(page)).x).toBe(165);
  });

  test('E-09 · порядок слоёв: на передний план, назад; в панели слоёв верхний слой — первый', async ({ page }) => {
    await open(page, [box('blok_a', 'Блок A', 20, 40), box('blok_b', 'Блок B', 60, 60), box('blok_c', 'Блок C', 100, 80)]);
    await page.getByRole('tab', { name: 'Слои' }).click();
    const layers = page.getByRole('list', { name: 'Слои' });
    const order = async () => (await layers.locator('[data-layer-id]').allInnerTexts()).map((t) => t.trim());
    expect(await order()).toEqual(['Блок C', 'Блок B', 'Блок A']);
    await hit(page, 'Блок A').click({ position: { x: 4, y: 4 } });
    await page.getByRole('button', { name: 'На передний план' }).click();
    await page.getByRole('tab', { name: 'Слои' }).click();
    expect(await order()).toEqual(['Блок A', 'Блок C', 'Блок B']);
    await page.keyboard.press('Control+BracketLeft');
    expect(await order()).toEqual(['Блок C', 'Блок A', 'Блок B']);
    await page.keyboard.press('Control+Shift+BracketLeft');
    expect(await order()).toEqual(['Блок C', 'Блок B', 'Блок A']);
    await page.keyboard.press('Control+Shift+BracketRight');
    expect(await order()).toEqual(['Блок A', 'Блок C', 'Блок B']);
  });

  test('E-09 · блокировка из слоёв: блок не двигается и не меняет размер, снятие возвращает', async ({ page }) => {
    await open(page, [box('blok_a', 'Блок A', 40, 60)]);
    await snapOff(page);
    await page.getByRole('tab', { name: 'Слои' }).click();
    await page.getByRole('button', { name: 'Заблокировать: Блок A' }).click();
    const { unit } = await geometry(page);
    const c = await blockCenter(page, 'Блок A');
    await drag(page, c, { x: c.x + 30 * unit, y: c.y });
    expect((await frameFields(page)).x).toBe(40);
    await page.getByRole('button', { name: 'Разблокировать: Блок A' }).click();
    const c2 = await blockCenter(page, 'Блок A');
    await drag(page, c2, { x: c2.x + 30 * unit, y: c2.y });
    expect((await frameFields(page)).x).toBeCloseTo(70, 0);
  });
});

test.describe('E-10 · масштаб и панорамирование', () => {
  const zoomText = (page: import('@playwright/test').Page) => page.getByTestId('zoom');

  test('E-10 · кнопки масштаба: шаги от 25 до 400 %, пределы, «100 %»', async ({ page }) => {
    await open(page, [box('blok_a', 'Блок A', 40, 60)]);
    const percent = async () => Number((await zoomText(page).innerText()).replace('%', ''));
    for (let i = 0; i < 12 && (await page.getByRole('button', { name: 'Приблизить' }).isEnabled()); i++) await page.getByRole('button', { name: 'Приблизить' }).click();
    expect(await percent()).toBe(400);
    await expect(page.getByRole('button', { name: 'Приблизить' })).toBeDisabled();
    for (let i = 0; i < 14 && (await page.getByRole('button', { name: 'Отдалить' }).isEnabled()); i++) await page.getByRole('button', { name: 'Отдалить' }).click();
    expect(await percent()).toBe(25);
    await expect(page.getByRole('button', { name: 'Отдалить' })).toBeDisabled();
    await zoomText(page).click();
    expect(await percent()).toBe(100);
    expect((await geometry(page)).unit).toBe(1);
  });

  test('E-10 · «Вписать»: экран целиком виден в окне холста', async ({ page }) => {
    await open(page, [box('blok_a', 'Блок A', 40, 60)]);
    await page.getByRole('button', { name: 'Приблизить' }).click();
    await page.getByRole('button', { name: 'Приблизить' }).click();
    await page.getByRole('button', { name: 'Вписать' }).click();
    const canvas = (await page.getByTestId('canvas').boundingBox())!;
    const st = (await stage(page).boundingBox())!;
    if (canvas.height > st.height) {
      // on the wide layout the canvas has its own height: the whole screen fits in it
      expect(st.height).toBeLessThanOrEqual(canvas.height + 1);
      expect(st.width).toBeLessThanOrEqual(canvas.width + 1);
    } else {
      expect(st.width).toBeLessThanOrEqual(canvas.width + 1);
    }
  });

  test('E-10 · Ctrl + колесо приближает вокруг указателя; Ctrl+0 вписывает; Ctrl+1 — 100 %', async ({ page }) => {
    // The block is in the middle of the artboard: the point under the pointer can stay under it (near the edge the scroll runs out).
    await open(page, [box('blok_a', 'Блок A', 145, 60)]);
    const before = (await geometry(page)).unit;
    const c = await blockCenter(page, 'Блок A');
    await page.mouse.move(c.x, c.y);
    await page.keyboard.down('Control');
    await page.mouse.wheel(0, -300);
    await page.keyboard.up('Control');
    await expect.poll(async () => (await geometry(page)).unit).toBeGreaterThan(before * 1.2);
    // the point under the pointer stays under it
    const scrollable = await page.getByTestId('canvas').evaluate((el) => el.scrollWidth > el.clientWidth + 4);
    // On the narrow layout the whole page scrolls, not the canvas: keeping the point under the pointer is the mobile editor's job (P3.14).
    if (scrollable) await expect.poll(async () => Math.abs((await blockCenter(page, 'Блок A')).x - c.x)).toBeLessThan(40);
    await page.keyboard.press('Control+1');
    await expect.poll(async () => (await geometry(page)).unit).toBe(1);
    await page.keyboard.press('Control+0');
    await expect.poll(async () => (await geometry(page)).unit).not.toBe(1);
  });

  test('E-10 · пробел + перетаскивание двигает холст, блоки при этом не трогаются; без пробела колесо прокручивает', async ({ page }) => {
    await open(page, [box('blok_a', 'Блок A', 40, 60)]);
    await page.keyboard.press('Control+1');
    for (let i = 0; i < 4; i++) await page.getByRole('button', { name: 'Приблизить' }).click(); // big enough to scroll
    const canvas = page.getByTestId('canvas');
    const scroll = () => canvas.evaluate((el) => [el.scrollLeft, el.scrollTop]);
    const canScroll = await canvas.evaluate((el) => el.scrollHeight > el.clientHeight + 4 || el.scrollWidth > el.clientWidth + 4);
    await canvas.scrollIntoViewIfNeeded();
    const box0 = (await canvas.boundingBox())!;
    const view = page.viewportSize()!;
    // On the narrow layout the canvas is taller than the window: press inside what is visible.
    const start = { x: box0.x + box0.width / 2, y: Math.min(Math.max(box0.y + box0.height / 2, 60), view.height - 60) };
    const s0 = await scroll();
    await page.keyboard.down('Space');
    await expect(canvas).toHaveAttribute('data-panning', 'true');
    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    // Toward the side the canvas can still scroll to (it may already be at one end).
    await page.mouse.move(start.x + (s0[0]! > 0 ? 60 : -60), start.y + (s0[1]! > 0 ? 60 : -60), { steps: 5 });
    await page.mouse.up();
    await page.keyboard.up('Space');
    const s1 = await scroll();
    // When the canvas has nothing to scroll (the narrow layout scrolls the whole page) the press must still do nothing else.
    if (canScroll) expect(s1).not.toEqual(s0);
    await expect(canvas).toHaveAttribute('data-panning', 'false');
    // nothing was selected or moved by the panning
    expect(await names(page)).toEqual([]);
    expect(((await serverDraft(page, (await page.url().match(/projects\/([^/]+)\//))![1]!)).doc.screens[0]!.blocks[0] as { frame: { x: number } }).frame.x).toBe(40);
    await page.mouse.move(start.x, start.y);
    await page.mouse.wheel(0, 120);
    await expect.poll(async () => (await scroll())[1]).toBeGreaterThanOrEqual(s1[1]!);
  });

  test('E-10 · перетаскивание при увеличении считается в единицах артборда, а не в пикселях', async ({ page }) => {
    await open(page, [box('blok_a', 'Блок A', 40, 60)]);
    await snapOff(page);
    await page.getByRole('button', { name: 'Приблизить' }).click();
    await page.getByRole('button', { name: 'Приблизить' }).click();
    const { unit } = await geometry(page);
    expect(unit).toBeGreaterThan(1);
    await hit(page, 'Блок A').scrollIntoViewIfNeeded();
    const c = await blockCenter(page, 'Блок A');
    await drag(page, c, { x: c.x + 30 * unit, y: c.y });
    expect((await frameFields(page)).x).toBeCloseTo(70, 0);
  });

  test('E-10 · два пальца: щипок меняет масштаб, сдвиг пары — прокрутка; одним пальцем рамка выделения', async ({ page }) => {
    await open(page, [box('blok_a', 'Блок A', 145, 60)]);
    await page.keyboard.press('Control+1');
    await page.getByRole('button', { name: 'Приблизить' }).click();
    await page.getByRole('button', { name: 'Приблизить' }).click();
    const canvas = page.getByTestId('canvas');
    await canvas.scrollIntoViewIfNeeded();
    const b = (await canvas.boundingBox())!;
    const view = page.viewportSize()!;
    const cx = b.x + b.width / 2;
    const cy = Math.min(Math.max(b.y + b.height / 2, 120), view.height - 120);
    const touch = (type: string, id: number, x: number, y: number, target: 'stage' | 'canvas' = 'canvas') =>
      (target === 'stage' ? stage(page) : canvas).dispatchEvent(type, { pointerType: 'touch', pointerId: id, isPrimary: id === 1, clientX: x, clientY: y, button: 0, buttons: 1 });
    const unit0 = (await geometry(page)).unit;
    await touch('pointerdown', 1, cx - 50, cy, 'stage');
    await touch('pointerdown', 2, cx + 50, cy, 'stage');
    await touch('pointermove', 1, cx - 100, cy);
    await touch('pointermove', 2, cx + 100, cy); // the fingers are twice as far apart
    await expect.poll(async () => (await geometry(page)).unit).toBeGreaterThan(unit0 * 1.5);
    const scroll = () => canvas.evaluate((el) => el.scrollLeft);
    const before = await scroll();
    await touch('pointermove', 1, cx - 160, cy);
    await touch('pointermove', 2, cx + 40, cy); // both moved 60 px to the left: the content follows
    await expect.poll(scroll).not.toBe(before);
    await touch('pointerup', 1, cx - 160, cy);
    await touch('pointerup', 2, cx + 40, cy);
    // Two fingers never moved the block.
    expect(await names(page)).toEqual([]);
  });
});
