import { expect, test } from '@playwright/test';

/*
 * P1.10: visual regressions of the service galleries P1.4–P1.9 at 390 and 1440, light and dark. The reference
 * images live in `e2e/__visual__` and are made on CI's browser (ADR-029); the threshold is 0.1 % of pixels.
 *
 * Every gallery moves — animations, particles, behaviors, timers — so the page clock is frozen: it starts at a
 * fixed moment, stands still while the page loads and then runs a fixed three seconds before the shot. Video and animated GIF are played by
 * the browser itself and can't follow the page clock, so their frames are masked.
 */
const GALLERIES = [
  { path: '/dev/artboard', name: 'artboard' },
  { path: '/dev/matrix', name: 'matrix' },
  { path: '/dev/shapes', name: 'shapes' },
  { path: '/dev/animations', name: 'animations' },
  { path: '/dev/render-gallery', name: 'render-gallery' },
  { path: '/dev/behaviors', name: 'behaviors' },
] as const;

const START = new Date('2026-12-31T12:00:00+03:00');

for (const gallery of GALLERIES) {
  for (const theme of ['light', 'dark'] as const) {
    test(`P1.10: ${gallery.name}, ${theme === 'light' ? 'светлая' : 'тёмная'} тема — как на эталоне`, async ({ page }) => {
      test.setTimeout(90_000);
      // Particles, scatter and the wheel use randomness: the same seed gives the same picture every run.
      await page.addInitScript(() => {
        let seed = 20261231;
        Math.random = () => {
          seed = (seed + 0x6d2b79f5) | 0;
          let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
          t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
          return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
        };
      });
      // Time stands still while the page loads and comes alive, then runs exactly three seconds and stops:
      // every run takes the shot at the same moment of every animation and moving block.
      await page.clock.install({ time: START });
      await page.clock.pauseAt(START.getTime() + 1000);
      // Not «networkidle»: a looping video keeps the network busy for good.
      await page.goto(`${gallery.path}?theme=${theme}`, { waitUntil: 'load' });
      await page.evaluate(() => document.fonts.ready);
      await page.clock.runFor(3000);
      await expect(page).toHaveScreenshot(`${gallery.name}-${theme}.png`, {
        fullPage: true,
        animations: 'disabled',
        caret: 'hide',
        mask: [page.locator('video, img[src*=".gif"], [style*=".gif"]')],
        maxDiffPixelRatio: 0.001,
        timeout: 20_000,
      });
    });
  }
}
