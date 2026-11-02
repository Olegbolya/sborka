import { mkdirSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import { freshUser, loginAndOnboard } from './helpers/auth';
import { box, hit, openEditor, saveStatus, seedProject } from './helpers/editor';

const SHOTS = 'e2e/__screenshots__';

test.beforeEach(async ({ page }) => {
  await loginAndOnboard(page, freshUser('Автор'));
});

test.describe('E-12 · мобильный редактор', () => {
  test('E-12 · нижний бар навигации присутствует на узкой ширине', async ({ page, viewport }) => {
    if (!viewport || viewport.width >= 768) return;
    const { id } = await seedProject(page);
    await openEditor(page, id);

    const navLeft = page.getByTestId('mobile-nav-left');
    const navRight = page.getByTestId('mobile-nav-right');
    await expect(navLeft).toBeVisible();
    await expect(navRight).toBeVisible();
    await expect(navLeft).toHaveAttribute('aria-pressed', 'true');

    mkdirSync(SHOTS, { recursive: true });
    await page.screenshot({ path: `${SHOTS}/e12-mobile-nav.png` });
  });

  test('E-12 · левая шторка открывается кнопкой «Слои»', async ({ page, viewport }) => {
    if (!viewport || viewport.width >= 768) return;
    const { id } = await seedProject(page);
    await openEditor(page, id);

    const leftPanel = page.locator('.ed-panel.left');
    await expect(leftPanel).toBeVisible();

    mkdirSync(SHOTS, { recursive: true });
    await page.screenshot({ path: `${SHOTS}/e12-left-sheet.png` });
  });

  test('E-12 · выбор блока открывает правую шторку (Свойства)', async ({ page, viewport }) => {
    if (!viewport || viewport.width >= 768) return;
    const { id } = await seedProject(page, (d) => void d.screens[0]!.blocks.push(box('blok_a', 'Блок A', 20, 40)));
    await openEditor(page, id);

    await hit(page, 'Блок A').click();

    const navRight = page.getByTestId('mobile-nav-right');
    await expect(navRight).toHaveAttribute('aria-pressed', 'true');

    const rightPanel = page.locator('.ed-panel.right');
    await expect(rightPanel).toBeVisible();

    mkdirSync(SHOTS, { recursive: true });
    await page.screenshot({ path: `${SHOTS}/e12-right-sheet.png` });
  });

  test('E-12 · переключение между шторками', async ({ page, viewport }) => {
    if (!viewport || viewport.width >= 768) return;
    const { id } = await seedProject(page);
    await openEditor(page, id);

    await page.getByTestId('mobile-nav-right').click();
    await expect(page.getByTestId('mobile-nav-right')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByTestId('mobile-nav-left')).toHaveAttribute('aria-pressed', 'false');

    await page.getByTestId('mobile-nav-left').click();
    await expect(page.getByTestId('mobile-nav-left')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByTestId('mobile-nav-right')).toHaveAttribute('aria-pressed', 'false');

    await expect(saveStatus(page)).toHaveText('Сохранено');
  });

  test('E-12 · маркеры выделения ≥ 24×24 px на сенсорном устройстве', async ({ page, viewport }) => {
    if (!viewport || viewport.width >= 768) return;
    const { id } = await seedProject(page, (d) => void d.screens[0]!.blocks.push(box('blok_a', 'Блок A', 20, 40)));
    await openEditor(page, id);

    await hit(page, 'Блок A').click();
    await page.getByTestId('mobile-nav-left').click();
    await page.getByTestId('mobile-nav-right').click();

    const handles = page.locator('.ed-handle');
    const count = await handles.count();
    expect(count).toBeGreaterThan(0);
    for (let i = 0; i < count; i++) {
      const box = await handles.nth(i).boundingBox();
      if (box) {
        expect(box.width).toBeGreaterThanOrEqual(24);
        expect(box.height).toBeGreaterThanOrEqual(24);
      }
    }
  });
});
