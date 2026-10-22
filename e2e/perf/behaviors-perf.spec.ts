import { mkdirSync } from 'node:fs';
import { expect, test } from '@playwright/test';

const SHOTS = 'e2e/__screenshots__';

/*
 * Frame-rate budgets run in the «perf-390» project of playwright.config.ts — the phone of SC-05 — after every
 * other test and one at a time, so the count is not shared with the neighbouring tests' browsers (ADR-028).
 */
test('SC-05: 50 движущихся объектов — не меньше 50 кадров в секунду при замедлении процессора в 4 раза', async ({ page }, info) => {
  await page.goto('/dev/behaviors?part=perf');
  await expect(page.locator('[data-block-id^="sharik-"]')).toHaveCount(50);
  await expect(page.locator('.bk-player-screen[data-live="true"]')).toHaveCount(1);
  await page.waitForTimeout(1000);
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
  // The page settles under the slowdown first; then three seconds of frames are counted.
  await page.waitForTimeout(1000);
  const fps = await page.evaluate(
    () =>
      new Promise<number>((resolve) => {
        let frames = 0;
        const start = performance.now();
        const tick = (now: number) => {
          frames += 1;
          if (now - start < 3000) requestAnimationFrame(tick);
          else resolve((frames * 1000) / (now - start));
        };
        requestAnimationFrame(tick);
      }),
  );
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });
  info.annotations.push({ type: 'fps', description: `${fps.toFixed(1)} кадров/с` });
  console.log(`[${info.project.name}] 50 движущихся объектов: ${fps.toFixed(1)} кадров/с при CPU ×4`);
  expect(fps).toBeGreaterThanOrEqual(50);
  mkdirSync(SHOTS, { recursive: true });
  await page.screenshot({ path: `${SHOTS}/behaviors-perf-${info.project.name}.png` });
});
