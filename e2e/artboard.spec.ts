import { mkdirSync } from 'node:fs';
import { expect, test } from '@playwright/test';

const SHOTS = 'e2e/__screenshots__';

test.describe('E-01 · E-02 · P1.4: артборд в плеере', () => {
  for (const theme of ['light', 'dark'] as const) {
    test(`E-02: колонка во всю ширину телефона или 480 px по центру, без transform (${theme})`, async ({ page }, info) => {
      const res = await page.goto(`/dev/artboard?theme=${theme}`);
      expect(res?.status()).toBe(200);
      const viewport = page.viewportSize()!;
      const geometry = await page.evaluate(() => {
        const board = document.querySelector('.bk-artboard')!.getBoundingClientRect();
        const transforms = ['.bk-stage', '.bk-artboard', '.bk-screen'].map((s) => getComputedStyle(document.querySelector(s)!).transform);
        const title = getComputedStyle(document.querySelector('[data-block-id="zagolovok"] .bk-text')!).fontSize;
        return { left: board.left, width: board.width, transforms, title, overflow: document.documentElement.scrollWidth - window.innerWidth };
      });
      const column = Math.min(viewport.width, 480);
      expect(geometry.width).toBeCloseTo(column, 0);
      expect(geometry.left).toBeCloseTo((viewport.width - column) / 2, 0);
      expect(geometry.transforms).toEqual(['none', 'none', 'none']);
      expect(Number.parseFloat(geometry.title)).toBeCloseTo((32 * column) / 390, 1);
      expect(geometry.overflow).toBeLessThanOrEqual(0);
      mkdirSync(SHOTS, { recursive: true });
      await page.screenshot({ path: `${SHOTS}/artboard-${theme}-${info.project.name}.png` });
    });
  }

  test('P1.3: нажатие проходит в движок сценариев, копии появляются по таймеру', async ({ page }) => {
    await page.goto('/dev/artboard');
    await expect(page.locator('[data-block-id="priz-tekst"]')).toHaveCount(0);
    await page.locator('[data-block-id="knopka-start"]').click();
    await expect(page.locator('[data-block-id="priz-tekst"]')).toBeVisible();
    await expect(page.locator('[data-block-id^="snezhinka~"]').first()).toBeVisible({ timeout: 3000 });
    await page.locator('[data-block-id="knopka-start"]').click();
    await expect(page.locator('[data-block-id="priz-tekst"]')).toHaveCount(0);
  });
});
