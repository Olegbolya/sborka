import { expect, test, type Page } from '@playwright/test';
import { freshUser, loginAndOnboard } from './helpers/auth';
import { lowContrast } from './helpers/contrast';
import { nextButton, seedProject } from './helpers/editor';

/** Интерфейсный текст в обеих темах читается: контраст не меньше 3:1 (заголовки и элементы управления, WCAG 1.4.11) — без «белого на белом». */
const THEMES = ['light', 'dark'] as const;

const setTheme = async (page: Page, theme: (typeof THEMES)[number], baseURL: string) => {
  await page.context().addCookies([{ name: 'bk_theme', value: theme, url: baseURL }]);
  await page.emulateMedia({ colorScheme: theme === 'dark' ? 'light' : 'dark' }); // выбор на сайте побеждает системную тему
};
const check = async (page: Page, where: string) => {
  const bad = await lowContrast(page);
  expect(bad, `${where}: текст сливается с фоном`).toEqual([]);
};

for (const theme of THEMES) {
  test(`UX · контраст (${theme === 'dark' ? 'тёмная' : 'светлая'} тема): сайт, кабинет, аккаунт, редактор и его окна`, async ({ page }, info) => {
    const baseURL = info.project.use.baseURL!;
    await setTheme(page, theme, baseURL);
    for (const path of ['/', '/help', '/tariffs', '/examples']) {
      await page.goto(path);
      await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
      await check(page, path);
    }
    await loginAndOnboard(page, freshUser('Контраст'));
    const { id } = await seedProject(page, (d) => void d.screens[0]!.blocks.push(nextButton('dalshe_1')));
    for (const path of ['/cabinet/projects', `/cabinet/projects/${id}`, '/cabinet/billing', '/account']) {
      await page.goto(path);
      await page.waitForLoadState('networkidle');
      await check(page, path);
    }
    await page.route(`**/api/v1/projects/${id}/access-settings`, async (route) => {
      if (route.request().method() !== 'GET') return route.continue();
      const real = (await (await route.fetch()).json()) as Record<string, unknown>;
      return route.fulfill({ json: { ...real, ageRatingRequired: true } });
    });
    await page.goto(`/app/projects/${id}/edit`);
    await expect(page.getByTestId('save-status')).toHaveText('Сохранено');
    await check(page, 'редактор');
    await page.getByRole('button', { name: 'Опубликовать' }).click();
    await expect(page.getByRole('dialog', { name: 'Для кого эта сборка?' })).toBeVisible();
    await check(page, 'окно «Для кого эта сборка?»');
    await page.screenshot({ path: `e2e/__screenshots__/contrast-age-${theme}-${info.project.name}.png` });
    await page.getByTestId('age-close').click();
    await page.getByRole('button', { name: 'Предпросмотр' }).click();
    await expect(page.getByRole('dialog', { name: 'Предпросмотр' })).toBeVisible();
    await check(page, 'предпросмотр');
  });
}

test('UX · «Оформление» в аккаунте: светлое и тёмное меняются сразу и сохраняются после перезагрузки; «Как в системе» снова следует системе', async ({ page }, info) => {
  await page.emulateMedia({ colorScheme: 'dark' });
  await loginAndOnboard(page, freshUser('Тема'));
  await page.goto('/account');
  const setting = page.getByTestId('theme-setting');
  const bg = () => page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  const systemDark = await bg();
  await setting.getByRole('radio', { name: 'Светлое' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await expect(setting.getByRole('radio', { name: 'Светлое' })).toHaveAttribute('aria-checked', 'true');
  const light = await bg();
  expect(light).not.toBe(systemDark);
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  expect(await bg()).toBe(light);
  await page.screenshot({ path: `e2e/__screenshots__/theme-setting-light-${info.project.name}.png` });
  await page.goto('/cabinet/projects');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await page.goto('/account');
  await page.getByTestId('theme-setting').getByRole('radio', { name: 'Как в системе' }).click();
  await expect(page.locator('html')).not.toHaveAttribute('data-theme', /.+/);
  expect(await bg()).toBe(systemDark);
});
