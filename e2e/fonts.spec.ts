import { mkdirSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { adminLogin, freshUser, loginAndOnboard } from './helpers/auth';
import { openEditor, openTab, saveStatus, seedProject, serverDraft, textBlock } from './helpers/editor';

/** The administrators of this browser project who fill the library (scripts/e2e-api.sh). */
const libraryAdminId = (info: { project: { name: string } }): string => (info.project.name.startsWith('mobile') ? '700000000040' : '700000000039');
const CSRF = { 'X-Blokum-CSRF': '1' };

/** A real font file that every checkout has: Geist, the font of Next.js. */
function geistFile(): string {
  const pnpm = path.resolve('node_modules/.pnpm');
  const next = readdirSync(pnpm).find((d) => d.startsWith('next@'));
  if (!next) throw new Error('В node_modules нет Next.js');
  return path.join(pnpm, next, 'node_modules/next/dist/compiled/@vercel/og/Geist-Regular.ttf');
}

test.beforeEach(async ({ page }) => {
  await loginAndOnboard(page, freshUser('Автор'));
});

/** The block is chosen and its «Свой шрифт» is turned on. */
async function ownFontOnBlock(page: Page): Promise<void> {
  const { id } = await seedProject(page, (d) => void d.screens[0]!.blocks.push(textBlock('tekst_shrift', 'Заголовок')));
  await openEditor(page, id);
  await openTab(page, 'Слои');
  await page.getByRole('list', { name: 'Слои' }).getByRole('button', { name: 'Заголовок', exact: true }).click();
  const group = page.locator('[data-section="text"]');
  await group.scrollIntoViewIfNeeded();
  if ((await group.getAttribute('open')) === null) await group.locator('summary').click();
  await group.getByLabel('Шрифт', { exact: true }).selectOption('font');
  test.info().annotations.push({ type: 'project', description: id });
}

const savedFont = async (page: Page): Promise<unknown> => {
  const id = test.info().annotations.find((a) => a.type === 'project')!.description!;
  await expect(saveStatus(page)).toHaveText('Сохранено');
  const block = (await serverDraft(page, id)).doc.screens[0]!.blocks[0] as { style: { text: { font: unknown } } };
  return block.style.text.font;
};

test.describe('TH-04 · свой шрифт выбирается в редакторе', () => {
  test('TH-04 · загрузка файла: шрифт попадает в «Мои шрифты», в документ и на холст; шрифт без русских букв — с предупреждением', async ({ page }, info) => {
    await ownFontOnBlock(page);
    await page.getByLabel('Файл шрифта').setInputFiles(geistFile());
    const picker = page.getByLabel('Название шрифта', { exact: true });
    await expect(picker).not.toHaveValue('', { timeout: 15_000 });
    const mine = (await (await page.request.get('/api/v1/fonts')).json()) as Array<{ id: string; family: string; hasCyrillic: boolean }>;
    expect(mine).toHaveLength(1);
    const font = mine[0]!;
    await expect(picker).toHaveValue(font.id);
    await expect(picker.locator('optgroup[label="Мои шрифты"] option')).toHaveText([font.family]);
    expect(await savedFont(page)).toEqual({ kind: 'font', id: font.id });
    await expect(page.getByTestId('font-sample')).toBeVisible();
    // Текст на холсте нарисован этим шрифтом, а не системным.
    await expect
      .poll(() => page.evaluate((fid) => [...document.querySelectorAll('[data-testid="stage"] *')].some((e) => getComputedStyle(e).fontFamily.includes(`bk-font-${fid}`)), font.id))
      .toBe(true);
    const warning = page.getByRole('alert').filter({ hasText: 'нет русских букв' });
    await expect(warning).toHaveCount(font.hasCyrillic ? 0 : 1);
    mkdirSync('e2e/__screenshots__', { recursive: true });
    await page.getByTestId('font-sample').scrollIntoViewIfNeeded();
    await page.getByRole('button', { name: 'Загрузить свой шрифт' }).scrollIntoViewIfNeeded();
    await page.screenshot({ path: `e2e/__screenshots__/fonts-picker-${info.project.name}.png` });
  });

  test('TH-04 · файл не шрифт — отказ по-русски, документ не меняется', async ({ page }) => {
    await ownFontOnBlock(page);
    await page.getByLabel('Файл шрифта').setInputFiles({ name: 'ne-shrift.ttf', mimeType: 'font/ttf', buffer: Buffer.alloc(300, 0xaa) });
    await expect(page.getByRole('alert').filter({ hasText: 'Неподдерживаемый формат файла' })).toBeVisible({ timeout: 15_000 });
    expect(((await (await page.request.get('/api/v1/fonts')).json()) as unknown[]).length).toBe(0);
    expect(await savedFont(page)).toEqual({ kind: 'font', id: 'font_unset' });
  });

  test('LB-02 · шрифт из библиотеки: виден в группе «Из библиотеки», выбирается и попадает в документ', async ({ page, browser }, info) => {
    const adminContext = await browser.newContext();
    const adminPage = await adminContext.newPage();
    await adminLogin(adminPage, { id: libraryAdminId(info), name: 'Библиотекарь' });
    const up = await adminPage.request.post('/api/v1/fonts', { headers: CSRF, multipart: { license: 'OFL', file: { name: 'Geist-Regular.ttf', mimeType: 'font/ttf', buffer: readFileSync(geistFile()) } } });
    expect(up.ok()).toBe(true);
    const fontId = ((await up.json()) as { id: string }).id;
    const collection = (await (await adminPage.request.post('/api/v1/admin/library/collections', { headers: CSRF, data: { kind: 'FONTS', title: 'Шрифты для проверки' } })).json()) as { id: string };
    try {
      const item = await adminPage.request.post('/api/v1/admin/library/items', {
        headers: CSRF,
        data: { collectionId: collection.id, fontId, title: 'Библиотечный Гейст', license: 'OFL', author: 'Авторы Geist', source: 'шрифт Geist под лицензией OFL', tags: ['без засечек'] },
      });
      expect(item.ok()).toBe(true);
      await ownFontOnBlock(page);
      const picker = page.getByLabel('Название шрифта', { exact: true });
      await expect(picker.locator('optgroup[label="Из библиотеки"] option', { hasText: 'Библиотечный Гейст' })).toHaveCount(1, { timeout: 15_000 });
      await picker.selectOption({ label: 'Библиотечный Гейст' });
      expect(await savedFont(page)).toEqual({ kind: 'font', id: fontId });
      await expect
        .poll(() => page.evaluate((fid) => [...document.querySelectorAll('[data-testid="stage"] *')].some((e) => getComputedStyle(e).fontFamily.includes(`bk-font-${fid}`)), fontId))
        .toBe(true);
      // Файл шрифта библиотеки отдаётся вошедшему.
      const file = await page.request.get(`/api/v1/library/fonts/${fontId}/400/file`);
      expect(file.status()).toBe(200);
      expect(file.headers()['content-type']).toContain('font/woff2');
    } finally {
      await adminPage.request.delete(`/api/v1/admin/library/collections/${collection.id}`, { headers: CSRF });
      await adminContext.close();
    }
  });
});
