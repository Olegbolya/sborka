import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, test, type Locator, type Page } from '@playwright/test';
import { freshUser, loginAndOnboard } from './helpers/auth';
import { openEditor } from './helpers/editor';

/*
 * P3.12 · RG-01…RG-10: каждая эталонная игра (документ `packages/themes/examples/rg-XX.json`, собранный только штатными блоками,
 * правилами и поведениями) проходится в предпросмотре настоящего браузера до конца.
 */
const EXAMPLES = resolve('packages/themes/examples');
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');

interface Game {
  dialog: Locator;
  frame: Locator;
  blk: (id: string) => Locator;
}

async function startGame(page: Page, id: string, patch: (json: string, page: Page) => Promise<string> = (s) => Promise.resolve(s)): Promise<Game> {
  await loginAndOnboard(page, freshUser('Игрок'));
  const origin = new URL(page.url()).origin;
  const created = await page.request.post('/api/v1/projects', { data: { title: id }, headers: { origin } });
  const project = (await created.json()) as { id: string; draftVersionNumber: number };
  const doc = JSON.parse(await patch(readFileSync(resolve(EXAMPLES, `${id}.json`), 'utf8'), page)) as unknown;
  const saved = await page.request.put(`/api/v1/projects/${project.id}/draft`, { data: { document: doc }, headers: { origin, 'if-match': String(project.draftVersionNumber) } });
  expect(saved.ok(), await saved.text()).toBe(true);
  await openEditor(page, project.id);
  await page.getByRole('button', { name: 'Предпросмотр' }).click();
  const dialog = page.getByRole('dialog', { name: 'Предпросмотр' });
  const frame = dialog.locator('[data-preview="true"]');
  await expect(frame.locator('.bk-player-screen[data-live="true"]')).toBeVisible();
  return { dialog, frame, blk: (b) => frame.locator(`[data-block-id="${b}"]`) };
}

const center = async (l: Locator) => {
  await l.scrollIntoViewIfNeeded();
  const b = (await l.boundingBox())!;
  return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
};
async function drag(page: Page, from: { x: number; y: number }, to: { x: number; y: number }) {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 14 });
  await page.mouse.up();
}
const theEnd = (g: Game) => expect(g.dialog.getByTestId('preview-end')).toHaveText(/Прохождение завершено/);

test.describe('P3.12 · эталонные игры проходятся в предпросмотре', () => {
  test('RG-01 · Убегающая кнопка «Нет»: убегает, сомневается, сдаётся — и игра идёт дальше', async ({ page }) => {
    test.setTimeout(120_000);
    const g = await startGame(page, 'rg-01');
    const net = g.blk('rg01_net');
    let moves = 0;
    for (let i = 0; i < 12; i++) {
      const before = (await net.boundingBox())!;
      const c = await center(net);
      await page.mouse.move(c.x - 2, c.y);
      await page.mouse.move(c.x, c.y, { steps: 3 });
      await page.waitForTimeout(500);
      const after = (await net.boundingBox())!;
      if (Math.abs(after.x - before.x) > 3 || Math.abs(after.y - before.y) > 3) moves += 1;
    }
    expect(moves).toBe(5);
    await net.click();
    await expect(net).toContainText('Точно нет?');
    await net.click();
    await expect(g.blk('rg01_konec')).toBeVisible({ timeout: 10_000 });
    await g.blk('rg01_konec').click();
    await theEnd(g);
  });

  test('RG-02 · Коробка-сюрприз: нажали — тряска, коробка исчезла, приз и «Дальше»', async ({ page }) => {
    const g = await startGame(page, 'rg-02');
    await expect(g.blk('rg02_priz')).toHaveCount(0);
    await g.blk('rg02_box').click();
    await expect(g.blk('rg02_priz')).toBeVisible({ timeout: 8000 });
    await expect(g.blk('rg02_box')).toHaveCount(0);
    await g.blk('rg02_dalshe').click();
    await g.blk('rg02_konec').click();
    await theEnd(g);
  });

  test('RG-03 · Скретч-карта: стёрли слой — вставка с подписью и «Дальше»', async ({ page }) => {
    test.setTimeout(120_000);
    // The insert uses a file of the library (`memfile_zamenite_01` in the document): a real picture is put in its place.
    const g = await startGame(page, 'rg-03', async (json, p) => {
      const up = await p.request.post('/api/v1/media', { multipart: { file: { name: 'meme.png', mimeType: 'image/png', buffer: PNG } }, headers: { origin: new URL(p.url()).origin } });
      return json.replaceAll('memfile_zamenite_01', ((await up.json()) as { id: string }).id);
    });
    const layer = g.blk('rg03_sloj');
    await layer.scrollIntoViewIfNeeded();
    const b = (await layer.boundingBox())!;
    await page.mouse.move(b.x + 5, b.y + 8);
    await page.mouse.down();
    for (let row = 0; row < 7 && (await g.frame.locator('.bk-media-overlay').count()) === 0; row++) {
      await page.mouse.move(b.x + b.width - 5, b.y + 8 + row * ((b.height - 16) / 6), { steps: 8 });
      await page.mouse.move(b.x + 5, b.y + 8 + (row + 0.5) * ((b.height - 16) / 6), { steps: 8 });
    }
    await page.mouse.up();
    await expect(g.frame.locator('.bk-media-overlay')).toBeVisible({ timeout: 8000 });
    await expect(g.frame.locator('.bk-meme-caption')).toHaveText('Приз твой!');
    await expect(g.blk('rg03_dalshe')).toBeVisible({ timeout: 8000 });
    await g.blk('rg03_dalshe').click();
    await g.blk('rg03_konec').click();
    await theEnd(g);
  });

  test('RG-04 · Колесо фортуны: крутится, останавливается, попытка считается', async ({ page }) => {
    const g = await startGame(page, 'rg-04');
    await g.blk('rg04_koleso').click();
    await expect(g.blk('rg04_dalshe')).toBeVisible({ timeout: 10_000 });
    await g.blk('rg04_dalshe').click();
    await expect(g.frame).toContainText('Вы крутили колесо раз: 1');
    await g.blk('rg04_konec').click();
    await theEnd(g);
  });

  test('RG-05 · Мемори: три пары находятся, неверная пара закрывается; игра идёт дальше сама', async ({ page }) => {
    test.setTimeout(120_000);
    const g = await startGame(page, 'rg-05');
    const open = async (id: string) => {
      await g.blk(id).scrollIntoViewIfNeeded();
      await g.blk(id).click();
      await page.waitForTimeout(450);
    };
    // A wrong pair first: both cards turn back.
    await open('rg05_k00');
    await open('rg05_k10');
    await page.waitForTimeout(1200);
    for (const [a, b] of [['rg05_k00', 'rg05_k01'], ['rg05_k10', 'rg05_k11'], ['rg05_k20', 'rg05_k21']]) {
      await open(a!);
      await open(b!);
    }
    await expect(g.blk('rg05_konec')).toBeVisible({ timeout: 10_000 });
    await g.blk('rg05_konec').click();
    await theEnd(g);
  });

  test('RG-06 · Поймай объект: звёзды падают, пойманная считается, по таймеру — итог', async ({ page }) => {
    test.setTimeout(120_000);
    const g = await startGame(page, 'rg-06');
    const star = g.frame.locator('[data-block-id^="rg06_zvezda"]:visible');
    await expect(star.first()).toBeVisible({ timeout: 8000 });
    // A falling star is hit by the event itself: it moves too fast for a click with a pointer.
    await star.first().dispatchEvent('click');
    await expect(g.blk('rg06_konec')).toBeVisible({ timeout: 20_000 });
    await expect(g.frame).toContainText(/Поймано звёзд: [1-9]/);
    await g.blk('rg06_konec').click();
    await theEnd(g);
  });

  test('RG-07 · Перетащи на место: фрукты по подписям, баллы, игра идёт дальше', async ({ page }) => {
    test.setTimeout(120_000);
    const g = await startGame(page, 'rg-07');
    for (let i = 0; i < 3; i++) {
      const from = await center(g.blk(`rg07_f${i}`));
      const to = await center(g.blk(`rg07_z${i}`));
      await drag(page, from, to);
      await page.waitForTimeout(250);
    }
    await expect(g.blk('rg07_konec')).toBeVisible({ timeout: 10_000 });
    await expect(g.frame).toContainText('Баллов: 30');
    await g.blk('rg07_konec').click();
    await theEnd(g);
  });

  test('RG-08 · Квест: к избушке — ключ и победа; к озеру — заперто', async ({ page }) => {
    const g = await startGame(page, 'rg-08');
    await g.blk('rg08_vlevo').click();
    await g.blk('rg08_otkryt').click();
    await expect(g.frame).toContainText('Дверь открылась');
    await g.blk('rg08_p2').click();
    await theEnd(g);
  });

  test('RG-09 · Кликер на время: пять секунд, шесть нажатий — итог 6', async ({ page }) => {
    test.setTimeout(120_000);
    const g = await startGame(page, 'rg-09');
    for (let i = 0; i < 6; i++) {
      await g.blk('rg09_zhmi').click();
      await page.waitForTimeout(150);
    }
    await expect(g.blk('rg09_konec')).toBeVisible({ timeout: 12_000 });
    await expect(g.frame).toContainText('Кликов за 5 секунд: 6');
    await g.blk('rg09_konec').click();
    await theEnd(g);
  });

  test('RG-10 · Угадай по размытому фото: фото проясняется, верный ответ — 10 баллов из 10', async ({ page }) => {
    test.setTimeout(120_000);
    const g = await startGame(page, 'rg-10');
    const blur = () => g.blk('rg10_foto').evaluate((el) => getComputedStyle(el.querySelector('.bk-surface') ?? el).filter + '|' + getComputedStyle(el).filter);
    const early = await blur();
    await page.waitForTimeout(6500);
    const late = await blur();
    expect(late).not.toBe(early);
    await g.frame.getByText('Слон', { exact: true }).click();
    await g.blk('rg10_dalshe').click();
    await expect(g.frame).toContainText('Баллов: 10 из 10');
    await g.blk('rg10_konec').click();
    await theEnd(g);
  });
});
