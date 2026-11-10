import { mkdirSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import { freshUser, loginAndOnboard } from './helpers/auth';
import { nextButton, seedProject } from './helpers/editor';

const SHOTS = 'e2e/__screenshots__';

test.describe('P6.5 · аналитика', () => {
  test('D-05 · вкладка «Аналитика»: итоги, воронка по экранам, точки входа; новое прохождение появляется в цифрах', async ({ page }, info) => {
    await loginAndOnboard(page, freshUser('Автор'));
    const origin = new URL(page.url()).origin;
    const { id } = await seedProject(page, (d) => {
      d.screens[0]!.blocks.push(nextButton('dalshe_1'));
    });
    expect((await page.request.post(`/api/v1/projects/${id}/publish`, { headers: { origin } })).ok()).toBe(true);

    await page.goto(`/cabinet/projects/${id}`);
    await page.getByRole('button', { name: 'Аналитика' }).click();
    const box = page.getByTestId('analytics');
    await expect(box.getByText('Начали проходить')).toBeVisible();
    await expect(box.getByText('За этот период прохождений ещё не было.')).toBeVisible();
    await expect(box.getByRole('heading', { name: 'Воронка по экранам' })).toBeVisible();

    const started = await page.request.post(`/api/v1/play/${id}/sessions`, { headers: { origin }, data: {} });
    expect(started.status()).toBe(201);
    await page.getByRole('button', { name: '7 дней' }).click();
    await expect(box.getByText('За этот период прохождений ещё не было.')).toHaveCount(0);
    await expect(box.locator('div', { hasText: /^1$/ }).first()).toBeVisible();
    await expect(box.getByRole('heading', { name: 'Устройства' })).toBeVisible();
    mkdirSync(SHOTS, { recursive: true });
    await page.screenshot({ path: `${SHOTS}/analytics-${info.project.name}.png`, fullPage: true });
  });
});
