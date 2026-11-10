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
    const rating = page.getByLabel('Возрастная категория');
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
    await page.getByLabel('Возрастная категория').selectOption('18');
    await expect(page.getByLabel('Вопрос про возраст 18+')).toBeChecked();
    await expect(page.getByLabel('Вопрос про возраст 18+')).toBeDisabled();
  });
});
