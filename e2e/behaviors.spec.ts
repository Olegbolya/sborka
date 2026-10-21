import { mkdirSync } from 'node:fs';
import { type Page, expect, test } from '@playwright/test';

const SHOTS = 'e2e/__screenshots__';

/** Center of an element in page pixels. */
async function center(page: Page, selector: string) {
  const box = (await page.locator(selector).first().boundingBox())!;
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

/**
 * A gesture by finger (real touch events through CDP — Playwright has no touch drag) or by mouse, depending
 * on the profile: each behavior is checked both ways (P1.9 acceptance).
 */
async function gesture(page: Page, touch: boolean, points: Array<{ x: number; y: number }>) {
  if (!touch) {
    await page.mouse.move(points[0]!.x, points[0]!.y);
    await page.mouse.down();
    for (const p of points.slice(1)) await page.mouse.move(p.x, p.y, { steps: 6 });
    await page.mouse.up();
    return;
  }
  const cdp = await page.context().newCDPSession(page);
  const send = (type: 'touchStart' | 'touchMove' | 'touchEnd', p?: { x: number; y: number }) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: p ? [{ x: p.x, y: p.y, id: 1 }] : [] });
  await send('touchStart', points[0]);
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1]!;
    const b = points[i]!;
    for (let k = 1; k <= 6; k++) await send('touchMove', { x: a.x + ((b.x - a.x) * k) / 6, y: a.y + ((b.y - a.y) * k) / 6 });
  }
  await send('touchEnd');
}

/** Hover for the mouse; for the finger — a touch at that point (BH-02, BH-08 react to touch-down too). */
async function pointAt(page: Page, touch: boolean, p: { x: number; y: number }) {
  if (touch) await gesture(page, true, [p, { x: p.x + 1, y: p.y + 1 }]);
  else await page.mouse.move(p.x, p.y, { steps: 4 });
}

/** A tap by finger or a click by mouse. */
async function press(page: Page, touch: boolean, p: { x: number; y: number }) {
  if (touch) await page.touchscreen.tap(p.x, p.y);
  else await page.mouse.click(p.x, p.y);
}

const scene = (id: string) => `.dev-behavior[data-scene="${id}"]`;

test.describe('BH-01…BH-08: поведения пальцем и мышью', () => {
  test.beforeEach(async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    expect((await page.goto('/dev/behaviors'))?.status()).toBe(200);
    await expect(page.locator('.dev-behavior')).toHaveCount(8);
    expect(errors).toEqual([]);
  });

  test('BH-01: подарок перетаскивается в мешок и прилипает, мимо — возвращается, ползунок — только по горизонтали', async ({ page, isMobile }) => {
    await page.locator(scene('drag')).scrollIntoViewIfNeeded();
    const bag = (await page.locator('[data-block-id="meshok"]').boundingBox())!;
    const gift = await center(page, '[data-block-id="podarok-0"]');
    await gesture(page, isMobile, [gift, { x: bag.x + bag.width / 2, y: bag.y + bag.height / 2 }]);
    await page.waitForTimeout(400);
    const placed = await center(page, '[data-block-id="podarok-0"]');
    expect(Math.abs(placed.x - (bag.x + bag.width / 2))).toBeLessThan(3);
    expect(Math.abs(placed.y - (bag.y + bag.height / 2))).toBeLessThan(3);
    const other = await center(page, '[data-block-id="podarok-1"]');
    await gesture(page, isMobile, [other, { x: other.x + 40, y: other.y + 120 }]);
    await page.waitForTimeout(500);
    const back = await center(page, '[data-block-id="podarok-1"]');
    expect(Math.hypot(back.x - other.x, back.y - other.y)).toBeLessThan(2);
    const knob = await center(page, '[data-block-id="polzunok"]');
    await gesture(page, isMobile, [knob, { x: knob.x + 60, y: knob.y + 80 }]);
    const moved = await center(page, '[data-block-id="polzunok"]');
    expect(moved.x).toBeGreaterThan(knob.x + 30);
    expect(Math.abs(moved.y - knob.y)).toBeLessThan(1);
  });

  test('BH-02: «Нет» убегает от пальца или курсора 5 раз, потом нажимается и становится «Да!»', async ({ page, isMobile }) => {
    await page.locator(scene('flee')).scrollIntoViewIfNeeded();
    for (let i = 0; i < 5; i++) {
      const before = await center(page, '[data-block-id="knopka-net"]');
      await pointAt(page, isMobile, { x: before.x + 2, y: before.y + 2 });
      await page.waitForTimeout(350);
      const after = await center(page, '[data-block-id="knopka-net"]');
      expect(Math.hypot(after.x - before.x, after.y - before.y)).toBeGreaterThan(10);
    }
    await press(page, isMobile, await center(page, '[data-block-id="knopka-net"]'));
    await expect(page.locator('[data-block-id="knopka-net"]')).toContainText('Да!');
  });

  test('BH-03: скретч-слой стирается и исчезает после 60 %', async ({ page, isMobile }) => {
    await page.locator(scene('scratch')).scrollIntoViewIfNeeded();
    const box = (await page.locator('[data-block-id="serebro"]').boundingBox())!;
    for (let row = 0; row < 6; row++) {
      const y = box.y + (box.height * (row + 0.5)) / 6;
      await gesture(page, isMobile, [
        { x: box.x + 4, y },
        { x: box.x + box.width - 4, y },
      ]);
    }
    await expect.poll(() => page.locator('[data-block-id="serebro"]').evaluate((el) => getComputedStyle(el).opacity), { timeout: 3000 }).toBe('0');
    await expect(page.locator('[data-block-id="priz-podarok"]')).toBeVisible();
  });

  test('BH-04: блоки движутся: отскок, «по кругу», гравитация, свой контур', async ({ page }) => {
    await page.locator(scene('move')).scrollIntoViewIfNeeded();
    const ids = ['myach01', 'oblako', 'yabloko', 'pchela'];
    const first = await Promise.all(ids.map((id) => center(page, `[data-block-id="${id}"]`)));
    await page.waitForTimeout(600);
    const later = await Promise.all(ids.map((id) => center(page, `[data-block-id="${id}"]`)));
    ids.forEach((_, i) => expect(Math.hypot(later[i]!.x - first[i]!.x, later[i]!.y - first[i]!.y)).toBeGreaterThan(5));
  });

  test('BH-05: генератор выпускает снежинки, нажатие ловит их и считает', async ({ page, isMobile }) => {
    await page.locator(scene('spawner')).scrollIntoViewIfNeeded();
    const flakes = page.locator('[data-block-id^="snezhinka~"]');
    await expect.poll(() => flakes.count(), { timeout: 4000 }).toBeGreaterThan(1);
    // A falling target: press where it is going to be a moment later.
    const box = (await flakes.first().boundingBox())!;
    await press(page, isMobile, { x: box.x + box.width / 2, y: box.y + box.height * 0.75 });
    await expect(page.locator('[data-block-id="schet01"]')).toContainText('1');
  });

  test('BH-06: колесо крутится от нажатия и встаёт на выпавший сектор', async ({ page, isMobile }) => {
    await page.locator(scene('wheel')).scrollIntoViewIfNeeded();
    await press(page, isMobile, await center(page, '[data-block-id="koleso"]'));
    await expect(page.locator('[data-block-id^="sektor-"][data-state="selected"]')).toHaveCount(1, { timeout: 6000 });
    // The chosen sector is under the pointer at the top: the highest of the five.
    const ys = await page.locator('[data-block-id^="sektor-"]').evaluateAll((els) => els.map((el) => [el.getAttribute('data-state'), el.getBoundingClientRect().top] as const));
    const top = ys.reduce((a, b) => (b[1] < a[1] ? b : a));
    expect(top[0]).toBe('selected');
  });

  test('BH-07: карточка переворачивается и обратно', async ({ page, isMobile }) => {
    await page.locator(scene('flip')).scrollIntoViewIfNeeded();
    const card = await center(page, '[data-block-id="karta-1"]');
    await expect(page.locator('[data-block-id="oborot-1"]')).toBeHidden();
    await press(page, isMobile, card);
    await expect(page.locator('[data-block-id="oborot-1"]')).toBeVisible();
    await expect(page.locator('[data-block-id="lico-1"]')).toBeHidden();
    await page.waitForTimeout(500);
    await press(page, isMobile, card);
    await expect(page.locator('[data-block-id="lico-1"]')).toBeVisible();
  });

  test('BH-08: звезда следует за пальцем или курсором внутри своей области', async ({ page, isMobile }) => {
    await page.locator(scene('follow')).scrollIntoViewIfNeeded();
    const area = (await page.locator('[data-block-id="oblast"]').boundingBox())!;
    const target = { x: area.x + area.width * 0.2, y: area.y + area.height * 0.25 };
    await pointAt(page, isMobile, target);
    await page.waitForTimeout(800);
    const star = await center(page, '[data-block-id="zvezda"]');
    expect(Math.hypot(star.x - target.x, star.y - target.y)).toBeLessThan(6);
  });

  test('BH-06 · PL-21: колесо крутится с клавиатуры', async ({ page }) => {
    await page.locator('[data-block-id="koleso"]').focus();
    await page.keyboard.press('Enter');
    await expect(page.locator('[data-block-id^="sektor-"][data-state="selected"]')).toHaveCount(1, { timeout: 6000 });
  });
});

test('SC-05: 50 движущихся объектов — не меньше 50 кадров в секунду при замедлении процессора в 4 раза', async ({ page }, info) => {
  await page.goto('/dev/behaviors?part=perf');
  await expect(page.locator('[data-block-id^="sharik-"]')).toHaveCount(50);
  await page.waitForTimeout(500);
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
  info.annotations.push({ type: 'fps', description: `${fps.toFixed(1)} кадров/с` });
  console.log(`[${info.project.name}] 50 движущихся объектов: ${fps.toFixed(1)} кадров/с при CPU ×4`);
  expect(fps).toBeGreaterThanOrEqual(50);
  mkdirSync(SHOTS, { recursive: true });
  await page.screenshot({ path: `${SHOTS}/behaviors-perf-${info.project.name}.png` });
});

test('BH-01…BH-08: скриншоты галереи поведений', async ({ page }, info) => {
  for (const theme of ['light', 'dark'] as const) {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto(`/dev/behaviors?theme=${theme}`);
    await page.waitForTimeout(1200);
    expect(errors).toEqual([]);
    mkdirSync(SHOTS, { recursive: true });
    await page.screenshot({ path: `${SHOTS}/behaviors-${theme}-${info.project.name}.png`, fullPage: true });
  }
});
