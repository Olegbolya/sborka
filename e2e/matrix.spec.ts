import { mkdirSync } from 'node:fs';
import { expect, test } from '@playwright/test';

const SHOTS = 'e2e/__screenshots__';

test.describe('S-00: сетка «все блоки × ключевые свойства»', () => {
  for (const theme of ['light', 'dark'] as const) {
    test(`S-00: 22 типа блоков × 6 свойств рисуются без ошибок (${theme === 'light' ? 'светлая' : 'тёмная'} тема)`, async ({ page }, info) => {
      const errors: string[] = [];
      page.on('pageerror', (e) => errors.push(e.message));
      page.on('console', (m) => {
        if (m.type() === 'error') errors.push(m.text());
      });
      page.on('response', (r) => {
        if (r.status() >= 400) errors.push(`${r.status()} ${r.url()}`);
      });
      expect((await page.goto(`/dev/matrix?theme=${theme}`))?.status()).toBe(200);
      await expect(page.locator('.bk-block[data-block-id^="m-"]')).toHaveCount(22 * 6);
      // Every type got the star contour, the dashed stroke, the 3D tilt and the faded mask.
      const stars = await page.locator('.bk-block[data-block-id$="-forma"]').evaluateAll((els) => els.filter((el) => getComputedStyle(el.querySelector(':scope > .bk-surface')!).maskImage.includes('data:image/svg+xml')).length);
      expect(stars).toBe(22);
      await expect(page.locator('.bk-block[data-block-id$="-obvodka"] > .bk-stroke')).toHaveCount(22);
      const tilted = await page.locator('.bk-block[data-block-id$="-tri-d"]').evaluateAll((els) => els.filter((el) => getComputedStyle(el).transform !== 'none').length);
      expect(tilted).toBe(22);
      const masked = await page.locator('.bk-block[data-block-id$="-maska"]').evaluateAll((els) => els.filter((el) => getComputedStyle(el).maskImage.includes('linear-gradient')).length);
      expect(masked).toBe(22);
      await page.waitForTimeout(500);
      expect(errors).toEqual([]);
      mkdirSync(SHOTS, { recursive: true });
      await page.screenshot({ path: `${SHOTS}/matrix-${theme}-${info.project.name}.png`, fullPage: true });
    });
  }
});
