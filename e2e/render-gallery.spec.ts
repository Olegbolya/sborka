import { mkdirSync } from 'node:fs';
import AxeBuilder from '@axe-core/playwright';
import { type Page, expect, test } from '@playwright/test';

const SHOTS = 'e2e/__screenshots__';

const collectErrors = (page: Page) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  page.on('response', (r) => {
    if (r.status() >= 400) errors.push(`${r.status()} ${r.url()}`);
  });
  return errors;
};

test.describe('B-01…B-23 · S-15 · PL-21: галерея блоков', () => {
  for (const theme of ['light', 'dark'] as const) {
    test(`PL-21: каждый блок во всех состояниях, axe — 0 серьёзных нарушений (${theme === 'light' ? 'светлая' : 'тёмная'} тема)`, async ({ page }, info) => {
      const errors = collectErrors(page);
      expect((await page.goto(`/dev/render-gallery?theme=${theme}`))?.status()).toBe(200);
      await expect(page.locator('.dev-block-section')).toHaveCount(22);
      await expect(page.locator('.dev-states figure')).toHaveCount(22 * 9);
      // Each of the 9 states applies to every type: the copy of the block in the grid carries that state.
      for (const state of ['hover', 'pressed', 'selected', 'correct', 'wrong', 'disabled', 'dragging', 'overZone']) {
        await expect(page.locator(`.dev-states .bk-block[data-block-id^="sostoyanie-"][data-state="${state}"]`)).toHaveCount(22);
      }
      await page.waitForTimeout(800);
      const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
      const serious = results.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
      expect(serious.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).slice(0, 3).join(' | ')}`)).toEqual([]);
      expect(errors).toEqual([]);
      mkdirSync(SHOTS, { recursive: true });
      // WebKit refuses a screenshot taller than 32767 pixels, and the gallery of 22 blocks × 9 states is taller on a phone: the first 16000.
      const size = await page.evaluate(() => ({ width: document.documentElement.clientWidth, height: document.documentElement.scrollHeight }));
      await page.screenshot({ path: `${SHOTS}/render-gallery-${theme}-${info.project.name}.png`, fullPage: true, clip: { x: 0, y: 0, width: size.width, height: Math.min(size.height, 16000) } });
    });
  }

  test('B-11 · B-12: варианты выбираются нажатием и клавиатурой, флажки снимаются', async ({ page }) => {
    await page.goto('/dev/render-gallery');
    const single = page.locator('[data-block-id="zhivoi-singlechoice"]');
    await single.getByRole('radio', { name: 'Снеговик' }).click();
    await expect(single.getByRole('radio', { name: 'Снеговик' })).toHaveAttribute('aria-checked', 'true');
    await single.getByRole('radio', { name: 'Ёлка' }).focus();
    await page.keyboard.press('Space');
    await expect(single.getByRole('radio', { name: 'Ёлка' })).toHaveAttribute('aria-checked', 'true');
    await expect(single.getByRole('radio', { name: 'Снеговик' })).toHaveAttribute('aria-checked', 'false');
    const multi = page.locator('[data-block-id="zhivoi-multichoice"]');
    await multi.getByRole('checkbox', { name: 'Ёлка' }).click();
    await multi.getByRole('checkbox', { name: 'Подарки' }).click();
    await multi.getByRole('checkbox', { name: 'Ёлка' }).click();
    await expect(multi.getByRole('checkbox', { name: 'Подарки' })).toHaveAttribute('aria-checked', 'true');
    await expect(multi.getByRole('checkbox', { name: 'Ёлка' })).toHaveAttribute('aria-checked', 'false');
  });

  test('B-13…B-17, B-19, B-20: поля, шкала, свайп, ранжирование и согласие работают в плеере', async ({ page }) => {
    await page.goto('/dev/render-gallery');
    const live = (type: string) => page.locator(`[data-block-id="zhivoi-${type}"]`);
    const field = live('textinput').getByRole('textbox', { name: 'Как зовут оленя' });
    // A page made on the server takes input before React has hold of the field; what is typed then is lost: wait for the hold.
    await expect.poll(() => field.evaluate((el) => Object.keys(el).some((k) => k.startsWith('__reactProps')))).toBe(true);
    await field.fill('Рудольф');
    await expect(field).toHaveValue('Рудольф');
    await live('scale').getByRole('radio', { name: '4 из 5' }).click();
    await expect(live('scale').getByRole('radio', { name: '4 из 5' })).toHaveAttribute('aria-checked', 'true');
    await page.keyboard.press('ArrowRight');
    await expect(live('scale').getByRole('radio', { name: '5 из 5' })).toHaveAttribute('aria-checked', 'true');
    await page.locator('[data-block-id="zhivoi-swipe"] .bk-swipe-button').first().click();
    await expect(page.locator('[data-block-id="zhivoi-swipe"]')).toContainText('Нет');
    await live('ranking').getByRole('button', { name: 'Ниже: Санки' }).click();
    await expect(page.locator('[data-block-id="zhivoi-ranking"] li').first()).toContainText('Коньки');
    const date = live('date').getByRole('textbox', { name: 'Дата праздника, формат дд.мм.гггг' });
    await date.pressSequentially('31122026');
    await expect(date).toHaveValue('31.12.2026');
    await live('contacts').getByRole('textbox', { name: 'Имя' }).fill('Олег');
    const consent = page.locator('[data-block-id="zhivoi-consent"] input[type="checkbox"]');
    await expect(consent).not.toBeChecked();
    await consent.check();
    await expect(consent).toBeChecked();
  });

  test('B-18 · PL-21: кнопка нажимается с клавиатуры, фокус виден', async ({ page }) => {
    await page.goto('/dev/render-gallery');
    const button = page.locator('[data-block-id="zhivoi-button"]');
    await button.focus();
    expect(await button.evaluate((el) => getComputedStyle(el).outlineStyle)).toBe('solid');
    await page.keyboard.press('Enter');
    await expect(page.locator('[data-block-id="zhivoi-button"]')).toBeFocused();
  });

  test('B-04 · B-05 · B-07: видео, звук и Lottie грузятся со своего сайта', async ({ page }) => {
    const requests: string[] = [];
    page.on('request', (r) => requests.push(r.url()));
    await page.goto('/dev/render-gallery');
    await page.locator('[data-block-id="zhivoi-animation"]').scrollIntoViewIfNeeded();
    await expect(page.locator('[data-block-id="zhivoi-video"] video')).toHaveAttribute('src', '/dev/snegopad.mp4');
    await expect(page.locator('[data-block-id="zhivoi-audio"]').getByRole('button', { name: 'Включить звук: Бубенцы' })).toBeVisible();
    await expect.poll(() => requests.some((u) => u.includes('/vendor/dotlottie-player-'))).toBe(true);
    await expect.poll(() => requests.some((u) => u.endsWith('/dev/snezhok.json'))).toBe(true);
    expect(requests.filter((u) => !u.startsWith('http://127.0.0.1') && !u.startsWith('data:') && !u.startsWith('blob:'))).toEqual([]);
  });
});
