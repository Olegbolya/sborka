import { mkdirSync } from 'node:fs';
import { type Page, expect, test } from '@playwright/test';

const SHOTS = 'e2e/__screenshots__';
const TRANSITIONS: Array<[string, string]> = [
  ['none', 'none'],
  ['fade', 'fade'],
  ['slide', 'slide'],
  ['zoom', 'zoom'],
  ['flip', 'flip'],
  ['blinds', 'blinds'],
  ['particles', 'particles'],
  ['page', 'page'],
  // T-32: the preset of the theme is a slow «шторка».
  ['preset', 'blinds'],
];

const anim = (page: Page, id: string, prop: string) => page.locator(`[data-block-id="${id}"] .bk-anim`).first().evaluate((el, p) => getComputedStyle(el).getPropertyValue(p), prop);

test.describe('S-12…S-14 · T-01…T-32 · P-01…P-08: галерея анимаций', () => {
  test('S-12: галерея показывает каждую анимацию, переход и пресет частиц', async ({ page }, info) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('response', (r) => {
      if (r.status() >= 400) errors.push(`${r.status()} ${r.url()}`);
    });
    expect((await page.goto('/dev/animations'))?.status()).toBe(200);
    await expect(page.locator('.bk-block[data-block-id^="enter-0"]')).toHaveCount(9);
    await expect(page.locator('.bk-block[data-block-id^="loop-0"]')).toHaveCount(9);
    await expect(page.locator('.bk-block[data-block-id^="press-0"]')).toHaveCount(6);
    await expect(page.locator('[data-dev-transition]')).toHaveCount(10);
    await expect(page.locator('.dev-particles canvas.bk-particles')).toHaveCount(8);
    await expect(page.locator('.dev-particles-full canvas.bk-particles')).toHaveCount(1);
    // Enter animations end in the neutral state.
    await expect.poll(() => anim(page, 'enter-00', 'opacity')).toBe('1');
    await expect.poll(() => anim(page, 'enter-08', '--bk-ax').then((v) => Math.abs(Number(v) || 0))).toBeLessThan(0.5);
    await page.waitForTimeout(800);
    expect(errors).toEqual([]);
    mkdirSync(SHOTS, { recursive: true });
    await page.screenshot({ path: `${SHOTS}/animations-${info.project.name}.png`, fullPage: true });
    await page.goto('/dev/animations?theme=dark');
    await page.waitForTimeout(1500);
    await page.screenshot({ path: `${SHOTS}/animations-dark-${info.project.name}.png`, fullPage: true });
    expect(errors).toEqual([]);
  });

  test('S-13: постоянная анимация меняет слой во времени', async ({ page }) => {
    await page.goto('/dev/animations');
    const samples = new Set<string>();
    for (let i = 0; i < 6; i++) {
      samples.add(await anim(page, 'loop-00', '--bk-as'));
      await page.waitForTimeout(120);
    }
    expect(samples.size).toBeGreaterThan(1);
  });

  test('S-14: нажатие запускает реакцию и отпускание возвращает блок', async ({ page }) => {
    await page.goto('/dev/animations');
    const block = page.locator('[data-block-id="press-00"]');
    await block.scrollIntoViewIfNeeded();
    const box = (await block.boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await expect.poll(() => anim(page, 'press-00', '--bk-as').then(Number)).toBeGreaterThan(1.02);
    await page.mouse.up();
    await page.mouse.move(2, 2);
    await expect.poll(() => anim(page, 'press-00', '--bk-as').then(Number)).toBeLessThan(1.01);
  });

  for (const [id, kind] of TRANSITIONS) {
    test(`T-30: кнопка «${id}» меняет экран переходом «${kind}»`, async ({ page }) => {
      await page.goto('/dev/animations');
      await page.locator(`[data-dev-transition="${id}"]`).click();
      await expect(page.locator('.bk-screen-in')).toHaveAttribute('data-transition', kind);
      await expect(page.locator('.bk-screen-in')).toContainText('Экран Б');
      await expect(page.locator('.bk-screen-out')).toHaveCount(0, { timeout: 5000 });
    });
  }

  test('T-20: мем-переход — свой файл и подпись, пропуск нажатием', async ({ page }) => {
    await page.goto('/dev/animations');
    await page.locator('[data-dev-transition="media"]').click();
    const overlay = page.locator('.bk-media-overlay');
    await expect(overlay).toBeVisible();
    await expect(overlay.locator('img')).toHaveAttribute('src', '/dev/snegopad.gif');
    await expect(overlay.locator('.bk-meme-caption')).toHaveText('КОГДА ОТВЕТИЛ ВЕРНО');
    await overlay.click();
    await expect(overlay).toHaveCount(0);
    await expect(page.locator('.bk-screen-in')).toContainText('Экран Б');
  });

  test('T-21: медиа-вставка зависит от вердикта ответа и уходит сама', async ({ page }) => {
    await page.goto('/dev/animations');
    await page.locator('[data-dev-answer="wrong"]').click();
    await expect(page.locator('.bk-meme-caption')).toHaveText('НУ ПОЧТИ…');
    await expect(page.locator('.bk-media-overlay')).toHaveCount(0, { timeout: 4000 });
    await page.locator('[data-dev-answer="correct"]').click();
    await expect(page.locator('.bk-meme-caption')).toHaveText('КОГДА ОТВЕТИЛ ВЕРНО');
  });

  test('T-31: «уменьшить движение» — частиц нет, любой переход — проявление', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto('/dev/animations');
    await expect(page.locator('.bk-block[data-block-id^="loop-0"]')).toHaveCount(9);
    await expect(page.locator('canvas.bk-particles')).toHaveCount(0);
    for (const id of ['slide', 'flip', 'particles', 'preset']) {
      await page.locator(`[data-dev-transition="${id}"]`).click();
      await expect(page.locator('.bk-screen-in')).toHaveAttribute('data-transition', 'fade');
      await expect(page.locator('.bk-screen-out')).toHaveCount(0, { timeout: 3000 });
    }
  });

  const fpsAtCpu4 = async (page: Page): Promise<number> => {
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
    await page.waitForTimeout(500);
    const fps = await page.evaluate(
      () =>
        new Promise<number>((resolve) => {
          let frames = 0;
          const start = performance.now();
          const tick = (now: number) => {
            frames += 1;
            if (now - start < 2000) requestAnimationFrame(tick);
            else resolve((frames * 1000) / (now - start));
          };
          requestAnimationFrame(tick);
        }),
    );
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });
    return fps;
  };

  for (const [name, selector] of [
    ['8 полей частиц разных пресетов', '.dev-particles'],
    ['весь экран снега с плотностью 100 %', '.dev-particles-full'],
  ] as const) {
    test(`P-01: ${name} — не меньше 30 кадров в секунду при замедлении процессора в 4 раза`, async ({ page }, info) => {
      await page.goto('/dev/animations?part=particles');
      await page.locator(selector).first().scrollIntoViewIfNeeded();
      const fps = await fpsAtCpu4(page);
      info.annotations.push({ type: 'fps', description: `${name}: ${fps.toFixed(1)} кадров/с при CPU ×4` });
      console.log(`[${info.project.name}] ${name}: ${fps.toFixed(1)} кадров/с при CPU ×4`);
      expect(fps).toBeGreaterThanOrEqual(30);
    });
  }
});
