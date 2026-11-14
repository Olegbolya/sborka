import { mkdirSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import { freshUser, loginAndOnboard } from './helpers/auth';
import { nextButton, seedProject } from './helpers/editor';
import { subscribeOwner } from './helpers/plan';

const SHOTS = 'e2e/__screenshots__';

test.describe('P7.1 · свой адрес ссылки', () => {
  test('PL-01 · «Старт»: поле закрыто с пояснением; на платном тарифе адрес меняется, занятый и неверный отклоняются понятным текстом', async ({ page }, info) => {
    await loginAndOnboard(page, freshUser('Автор'));
    const { id } = await seedProject(page, (d) => {
      d.screens[0]!.blocks.push(nextButton('dalshe_1'));
    });
    await page.goto(`/cabinet/projects/${id}`);
    await page.getByRole('button', { name: 'Настройки доступа' }).click();
    const field = page.getByLabel('Адрес ссылки');
    await expect(field).toBeDisabled();
    await expect(page.getByText('Свой адрес недоступен на тарифе «Старт»')).toBeVisible();
    mkdirSync(SHOTS, { recursive: true });
    await field.scrollIntoViewIfNeeded();
    await page.screenshot({ path: `${SHOTS}/slug-start-${info.project.name}.png` });

    await subscribeOwner(id, 'AUTHOR');
    await page.reload();
    await page.getByRole('button', { name: 'Настройки доступа' }).click();
    await expect(field).toBeEnabled();
    const own = `konkurs-${id.slice(0, 5).toLowerCase().replace(/[^a-z0-9]/g, 'x')}`;
    await field.fill('ab');
    await page.getByRole('button', { name: 'Сменить адрес' }).click();
    await expect(page.getByRole('status')).toContainText('не короче 3 символов');
    await field.fill('admin');
    await page.getByRole('button', { name: 'Сменить адрес' }).click();
    await expect(page.getByRole('status')).toContainText('Этот адрес занят');
    await field.fill(own);
    await page.getByRole('button', { name: 'Сменить адрес' }).click();
    await expect(page.getByRole('status')).toContainText('Адрес сохранён');
    await field.scrollIntoViewIfNeeded();
    await page.screenshot({ path: `${SHOTS}/slug-author-${info.project.name}.png` });
    await page.reload();
    await page.getByRole('button', { name: 'Настройки доступа' }).click();
    await expect(field).toHaveValue(own);
  });
});
