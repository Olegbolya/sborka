import { mkdirSync } from 'node:fs';
import { expect, test } from '@playwright/test';

const SHOTS = 'e2e/__screenshots__';

test.describe('S-02 · S-03 · S-05 · S-18 · S-19: галерея форм', () => {
  test('S-02: все формы, заливки, обводки, тени и маски рисуются без ошибок', async ({ page }, info) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    const res = await page.goto('/dev/shapes');
    expect(res?.status()).toBe(200);
    await expect(page.locator('.bk-screen')).toHaveCount(2);
    expect(await page.locator('.bk-block[data-type="shape"]').count()).toBeGreaterThanOrEqual(36 + 21);
    const star = await page.locator('[data-block-id="gradient-04"] .bk-surface').evaluate((el) => getComputedStyle(el).maskImage);
    expect(star).toContain('data:image/svg+xml');
    expect(await page.locator('[data-block-id="var-08"] .bk-stroke').count()).toBe(1);
    expect(await page.locator('[data-block-id="foto-05"] .bk-shadow').count()).toBe(1);
    const masked = await page.locator('[data-block-id="var-15"]').evaluate((el) => getComputedStyle(el).maskImage);
    expect(masked).toContain('maska-zvezda.png');
    expect(errors).toEqual([]);
    mkdirSync(SHOTS, { recursive: true });
    await page.screenshot({ path: `${SHOTS}/shapes-${info.project.name}.png`, fullPage: true });
  });

  test('S-18: блок наклоняется за указателем (палец или курсор) и возвращается', async ({ page }) => {
    await page.goto('/dev/shapes');
    const block = page.locator('[data-block-id="var-18"]');
    await block.scrollIntoViewIfNeeded();
    const box = (await block.boundingBox())!;
    const tiltAt = async (x: number, y: number) => {
      await page.mouse.move(x, y);
      return block.evaluate((el) => [el.style.getPropertyValue('--bk-tilt-x'), el.style.getPropertyValue('--bk-tilt-y')].map(Number));
    };
    // The markup comes from the server; the block follows the cursor once the page has come alive, so the
    // cursor is moved into the corner again until it does (alternating points — the same point fires no event).
    let k = 0;
    await expect.poll(async () => Math.min(...(await tiltAt(box.x + box.width - 2 - (k++ % 2), box.y + 2))), { timeout: 5000 }).toBeGreaterThan(15);
    await page.mouse.move(5, 5);
    expect(await block.evaluate((el) => el.style.getPropertyValue('--bk-tilt-x'))).toBe('0');
  });
});
