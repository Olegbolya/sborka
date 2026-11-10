import { mkdirSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import { freshUser, loginAndOnboard } from './helpers/auth';
import { nextButton, seedProject } from './helpers/editor';

const SHOTS = 'e2e/__screenshots__';

test.describe('P8.7 · возрастная категория', () => {
  test('PL-09 · создатель выбирает категорию в настройках доступа, участник видит знак внизу экрана; 18+ включает вопрос про возраст', async ({ page }, info) => {
    await loginAndOnboard(page, freshUser('Автор'));
    const origin = new URL(page.url()).origin;
    const { id } = await seedProject(page, (d) => {
      d.screens[0]!.blocks.push(nextButton('dalshe_1'));
    });
    await page.goto(`/cabinet/projects/${id}`);
    await page.getByRole('button', { name: 'Настройки доступа' }).click();
    const rating = page.locator('#age-rating');
    await expect(rating).toHaveValue('');
    await rating.selectOption('12');
    mkdirSync(SHOTS, { recursive: true });
    await rating.scrollIntoViewIfNeeded();
    await page.screenshot({ path: `${SHOTS}/age-rating-cabinet-${info.project.name}.png` });
    await page.getByRole('button', { name: 'Сохранить настройки' }).click();
    await expect(page.getByRole('button', { name: 'Сохранено!' })).toBeVisible();
    expect((await page.request.post(`/api/v1/projects/${id}/publish`, { headers: { origin } })).ok()).toBe(true);
    const { slug } = (await (await page.request.get(`/api/v1/projects/${id}`)).json()) as { slug: string };
    await page.goto(`/s/${slug}`);
    await expect(page.getByTestId('play-age')).toHaveText('12+');
    await page.screenshot({ path: `${SHOTS}/age-rating-player-${info.project.name}.png` });

    // 18+: the question about the age switches itself on and cannot be switched off.
    await page.goto(`/cabinet/projects/${id}`);
    await page.getByRole('button', { name: 'Настройки доступа' }).click();
    await page.locator('#age-rating').selectOption('18');
    await expect(page.getByLabel('Вопрос про возраст 18+')).toBeChecked();
    await expect(page.getByLabel('Вопрос про возраст 18+')).toBeDisabled();
  });

  test('PL-09 · на странице «Ответы и доступ» категория выбирается одним нажатием и сохраняется', async ({ page }, info) => {
    await loginAndOnboard(page, freshUser('Автор'));
    const { id } = await seedProject(page, (d) => {
      d.screens[0]!.blocks.push(nextButton('dalshe_1'));
    });
    await page.goto(`/cabinet/projects/${id}`);
    const card = page.getByTestId('age-rating-card');
    await expect(card).toContainText('не выбрана');
    await card.getByRole('radio', { name: '16+' }).click();
    await expect(card.getByRole('radio', { name: '16+' })).toHaveAttribute('aria-checked', 'true');
    await expect(card).not.toContainText('не выбрана');
    await expect.poll(async () => ((await (await page.request.get(`/api/v1/projects/${id}/access-settings`)).json()) as { ageRating: number }).ageRating).toBe(16);
    mkdirSync(SHOTS, { recursive: true });
    await page.screenshot({ path: `${SHOTS}/age-rating-card-${info.project.name}.png` });
    // The same choice is in «Настройки доступа».
    await page.getByRole('button', { name: 'Настройки доступа' }).click();
    await expect(page.locator('#age-rating')).toHaveValue('16');
  });

  test('PL-09 · «Опубликовать» без категории сразу открывает окно выбора, после выбора сборка публикуется', async ({ page }, info) => {
    await loginAndOnboard(page, freshUser('Автор'));
    const { id } = await seedProject(page, (d) => {
      d.screens[0]!.blocks.push(nextButton('dalshe_1'));
    });
    // The test server does not require the category, so the answer says it is required (as on the real one).
    await page.route(`**/api/v1/projects/${id}/access-settings`, async (route) => {
      if (route.request().method() !== 'GET') return route.continue();
      const real = (await (await route.fetch()).json()) as Record<string, unknown>;
      return route.fulfill({ json: { ...real, ageRatingRequired: true } });
    });
    await page.goto(`/app/projects/${id}/edit`);
    await page.getByRole('button', { name: 'Опубликовать' }).click();
    const dialog = page.getByRole('dialog', { name: 'Для кого эта сборка?' });
    await expect(dialog).toBeVisible();
    await page.screenshot({ path: `${SHOTS}/age-rating-dialog-${info.project.name}.png` });
    await dialog.getByRole('radio', { name: '12+' }).click();
    await expect(dialog).toBeHidden();
    await expect.poll(async () => ((await (await page.request.get(`/api/v1/projects/${id}`)).json()) as { status: string }).status, { timeout: 15_000 }).toBe('PUBLISHED');
    expect(((await (await page.request.get(`/api/v1/projects/${id}/access-settings`)).json()) as { ageRating: number }).ageRating).toBe(12);
    // The answer to «Опубликовать» must be seen on any screen: a message over the editor, not squeezed under the panels.
    const toast = page.getByTestId('editor-message');
    await expect(toast).toContainText('Сборка опубликована');
    await expect(toast).toBeInViewport({ ratio: 1 });
    await page.screenshot({ path: `${SHOTS}/publish-message-${info.project.name}.png` });
  });
});
