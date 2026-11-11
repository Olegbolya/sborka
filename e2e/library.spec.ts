import { expect, test } from '@playwright/test';
import { adminLogin, freshUser, loginAndOnboard } from './helpers/auth';
import { PHOTO_PNG } from './helpers/files';
import { ensurePanel, openEditor, saveStatus, seedProject, serverDraft, openTab } from './helpers/editor';

/** The administrator of this browser project who fills the library (scripts/e2e-api.sh). */
const libraryAdminId = (info: { project: { name: string } }): string => (info.project.name.startsWith('mobile') ? '700000000040' : '700000000039');
const CSRF = { 'X-Blokum-CSRF': '1' };

test.beforeEach(async ({ page }) => {
  await loginAndOnboard(page, freshUser('Автор'));
});

test.describe('LB-03 · вкладка Библиотека — пустое состояние', () => {
  test('LB-03 · вкладка «Библиотека» отображает пустое состояние', async ({ page }) => {
    const { id } = await seedProject(page);
    await openEditor(page, id);

    await openTab(page, 'Библиотека');
    const panel = page.getByTestId('library-panel');
    await expect(panel).toBeVisible();
    await expect(panel).toContainText('Библиотека пополняется');
    await expect(panel.getByRole('link', { name: 'Загрузить своё' })).toBeVisible();
  });
});

test.describe('LB-02 · вкладка «Библиотека» с файлами', () => {
  test('LB-02 · коллекция, поиск, теги, лицензия и автор; вставка — готовый блок со ссылкой на файл библиотеки, который виден на холсте', async ({ page, browser }, info) => {
    // Библиотеку наполняет администратор (LB-05): коллекция, файл, карточка лицензии.
    const adminContext = await browser.newContext();
    const adminPage = await adminContext.newPage();
    await adminLogin(adminPage, { id: libraryAdminId(info), name: 'Библиотекарь' });
    const upload = await adminPage.request.post('/api/v1/media', { headers: CSRF, multipart: { file: { name: 'zvezda.png', mimeType: 'image/png', buffer: PHOTO_PNG } } });
    expect(upload.ok()).toBe(true);
    const mediaId = ((await upload.json()) as { id: string }).id;
    const collection = (await (await adminPage.request.post('/api/v1/admin/library/collections', { headers: CSRF, data: { kind: 'STICKERS', title: 'Звёзды для проверки' } })).json()) as { id: string };
    try {
      const item = await adminPage.request.post('/api/v1/admin/library/items', {
        headers: CSRF,
        data: { collectionId: collection.id, mediaId, title: 'Золотая звезда', license: 'CC0', author: 'Автор Звёздов', source: 'собственный рисунок владельца', tags: ['звезда', 'награда'] },
      });
      expect(item.status()).toBe(201);
      const itemId = ((await item.json()) as { id: string }).id;

      const { id } = await seedProject(page);
      await openEditor(page, id);
      await openTab(page, 'Библиотека');
      const panel = page.getByTestId('library-panel');
      await panel.getByLabel('Коллекция библиотеки').selectOption(collection.id);
      const tile = panel.getByTestId(`library-insert-${itemId}`);
      await expect(tile).toContainText('Золотая звезда');
      await expect(tile).toContainText('CC0 · Автор Звёздов');
      await panel.getByLabel('Найти в библиотеке').fill('нет такого слова');
      await expect(panel.getByText('Ничего не нашлось')).toBeVisible();
      await panel.getByLabel('Найти в библиотеке').fill('звезда');
      await expect(tile).toBeVisible();
      await panel.getByRole('button', { name: 'награда' }).click();
      await expect(tile).toBeVisible();
      await panel.getByRole('button', { name: 'награда' }).click();
      await page.screenshot({ path: `e2e/__screenshots__/library-panel-${info.project.name}.png` });

      await tile.click();
      await expect(saveStatus(page)).toHaveText('Сохранено');
      const block = (await serverDraft(page, id)).doc.screens[0]!.blocks[0] as { type: string; props: { media: { source: string; id: string } } };
      expect(block.type).toBe('image');
      expect(block.props.media).toEqual({ source: 'library', id: itemId });
      // На холсте файл библиотеки действительно загружен.
      await ensurePanel(page, 'right');
      const shown = page.locator('[data-block-id] img').first();
      await expect(shown).toHaveAttribute('src', new RegExp(`/library/items/${itemId}/file`));
      await expect.poll(() => shown.evaluate((el) => (el as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);
    } finally {
      await adminPage.request.delete(`/api/v1/admin/library/collections/${collection.id}`, { headers: CSRF });
      await adminContext.close();
    }
  });
});

