import { mkdirSync } from 'node:fs';
import { expect, test } from '@playwright/test';

const SHOTS = 'e2e/__screenshots__';

test.describe('P10.1 · лендинг', () => {
  test('P10.1 · главная: тарифы из базы, вопросы, подвал со всеми документами; без горизонтальной прокрутки', async ({ page }, info) => {
    await page.goto('/');
    await expect(page.getByRole('heading', { level: 1 })).toContainText('Собери что угодно');
    await expect(page.locator('[data-plan]')).toHaveCount(5);
    await expect(page.locator('[data-plan="FREE"]')).toContainText('Старт');
    await expect(page.locator('[data-plan="PLUS"]')).toContainText('349');
    await expect(page.locator('.lp-faq details')).not.toHaveCount(0);
    for (const type of ['terms', 'offer', 'privacy', 'pd-consent', 'dpa', 'content-rules', 'cookies', 'marketing', 'complaints', 'contacts']) {
      await expect(page.locator(`footer a[href="/legal/${type}"]`).first()).toBeVisible();
    }
    expect(await page.evaluate((w) => document.documentElement.scrollWidth - w, page.viewportSize()!.width)).toBeLessThanOrEqual(0);
    mkdirSync(SHOTS, { recursive: true });
    await page.screenshot({ path: `${SHOTS}/landing-home-${info.project.name}.png`, fullPage: true });
  });

  test('P10.1 · живая демо-сборка на главной играется: кнопка убегает, потом её можно поймать', async ({ page }, info) => {
    const touch = info.project.name === 'mobile-390';
    await page.goto('/');
    // The player's code is fetched when the place comes near the screen; a tap on the placeholder does the same.
    const start = page.getByRole('button', { name: 'Поиграть', exact: true });
    if (await start.isVisible()) await start.click();
    const demo = page.getByTestId('demo-catch');
    await expect(demo).toBeVisible();
    const button = demo.getByRole('button', { name: 'Нажми меня' });
    await expect(button).toBeVisible();
    await button.scrollIntoViewIfNeeded();
    const before = (await button.boundingBox())!;
    // A pointer coming to the button makes it run away (the behaviour «Убегает»; the finger's flee is checked by behaviors.spec).
    if (!touch) {
      await page.mouse.move(before.x + 5, before.y + before.height / 2);
      await page.mouse.move(before.x + before.width / 2, before.y + before.height / 2, { steps: 8 });
      await page.waitForTimeout(600);
      const after = await button.boundingBox();
      expect(after && (Math.abs(after.x - before.x) > 4 || Math.abs(after.y - before.y) > 4), 'кнопка убежала от указателя').toBe(true);
    }
    // It runs only a few times (`times` of the behaviour), then stays and answers.
    for (let i = 0; i < 8 && (await demo.getByRole('button', { name: 'Нажми меня' }).count()) > 0; i++) {
      const box = await button.boundingBox();
      if (!box) break;
      const to = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
      if (touch) await page.touchscreen.tap(to.x, to.y);
      else await page.mouse.click(to.x, to.y);
      await page.waitForTimeout(500);
    }
    await expect(demo.getByText('Поймали!')).toBeVisible();
  });

  test('P10.1 · «Примеры», «Тарифы» и «Помощь» открываются, на «Примерах» три сборки', async ({ page }, info) => {
    await page.goto('/examples');
    await expect(page.getByRole('heading', { level: 1, name: 'Примеры' })).toBeVisible();
    await expect(page.locator('.lp-examples > li')).toHaveCount(3);
    await page.goto('/tariffs');
    await expect(page.getByRole('heading', { level: 1, name: 'Тарифы' })).toBeVisible();
    await expect(page.locator('[data-plan]')).toHaveCount(5);
    await page.screenshot({ path: `${SHOTS}/landing-tariffs-${info.project.name}.png`, fullPage: true });
    await page.goto('/help');
    await expect(page.getByRole('heading', { level: 1, name: 'Помощь' })).toBeVisible();
    for (const path of ['/examples', '/tariffs', '/help']) {
      expect(await page.evaluate((w) => document.documentElement.scrollWidth - w, page.viewportSize()!.width), path).toBeLessThanOrEqual(0);
    }
  });
});
