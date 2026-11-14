import { mkdirSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import { freshUser, loginAndOnboard } from './helpers/auth';
import { nextButton, seedProject } from './helpers/editor';
import { subscribeOwner } from './helpers/plan';

const SHOTS = 'e2e/__screenshots__';

test.describe('P6.7 · уведомления о прохождениях', () => {
  test('D-07 · «Старт» выбирает только сводку раз в день или тишину; платный тариф — ещё «сразу» и «раз в час»; выбор сохраняется сразу', async ({ page }, info) => {
    await loginAndOnboard(page, freshUser('Автор'));
    const { id } = await seedProject(page, (d) => {
      d.screens[0]!.blocks.push(nextButton('dalshe_1'));
    });
    await page.goto(`/cabinet/projects/${id}`);
    await page.getByRole('button', { name: 'Настройки доступа' }).click();
    const mode = page.getByLabel('Уведомления о прохождениях');
    await expect(mode).toHaveValue('daily');
    await expect(mode.locator('option[value="instant"]')).toBeDisabled();
    await expect(mode.locator('option[value="hourly"]')).toBeDisabled();
    await expect(mode.locator('option[value="daily"]')).toBeEnabled();
    mkdirSync(SHOTS, { recursive: true });
    await mode.scrollIntoViewIfNeeded();
    await page.screenshot({ path: `${SHOTS}/notices-start-${info.project.name}.png` });
    await mode.selectOption('off');
    await expect.poll(async () => ((await (await page.request.get(`/api/v1/projects/${id}/access-settings`)).json()) as { noticeModes: { effective: string } }).noticeModes.effective).toBe('off');

    await subscribeOwner(id, 'PLUS');
    await page.reload();
    await page.getByRole('button', { name: 'Настройки доступа' }).click();
    await expect(mode).toHaveValue('off');
    await expect(mode.locator('option[value="instant"]')).toBeEnabled();
    await mode.selectOption('hourly');
    await expect.poll(async () => ((await (await page.request.get(`/api/v1/projects/${id}/access-settings`)).json()) as { noticeModes: { effective: string } }).noticeModes.effective).toBe('hourly');
    await page.reload();
    await page.getByRole('button', { name: 'Настройки доступа' }).click();
    await expect(mode).toHaveValue('hourly');
    await mode.scrollIntoViewIfNeeded();
    await page.screenshot({ path: `${SHOTS}/notices-plus-${info.project.name}.png` });
  });
});
