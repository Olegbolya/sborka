import { mkdirSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import { freshUser, loginAndOnboard } from './helpers/auth';
import { seedProject } from './helpers/editor';

const SHOTS = 'e2e/__screenshots__';

test.describe('Q-03…Q-06 · конструктор QR', () => {
  test('Q-03, Q-04, Q-06 · оформление QR: цвета, форма, рамка с подписью сохраняются; плохой контраст не даёт сохранить; есть PDF и статистика точки', async ({ page }, info) => {
    await loginAndOnboard(page, freshUser('Автор'));
    const { id } = await seedProject(page);
    await page.goto(`/cabinet/projects/${id}`);
    await page.getByRole('button', { name: 'Точки доступа' }).click();
    await expect(page.getByText(/\/q\//).first()).toBeVisible();

    await expect(page.getByRole('link', { name: 'PDF: лист A4' }).first()).toBeVisible();
    await expect(page.getByRole('link', { name: 'PDF: 4 листа A6' }).first()).toBeVisible();
    await expect(page.getByRole('link', { name: 'PDF: визитки 10 шт.' }).first()).toBeVisible();
    await expect(page.getByTestId('point-stats').first()).toContainText('открытий 0');

    await page.getByRole('button', { name: 'Оформление QR' }).first().click();
    const designer = page.getByTestId('qr-designer');
    await expect(designer.getByAltText(/Так выглядит QR-код/)).toBeVisible();
    await designer.getByRole('group', { name: 'Форма точек' }).getByRole('button', { name: 'Круглые' }).click();
    await designer.getByRole('group', { name: 'Форма глазков' }).getByRole('button', { name: 'Скруглённые' }).click();
    await designer.getByLabel('Цвет точек').fill('#1b3a6b');
    await designer.getByLabel('Цвет фона').fill('#fff4d6');
    await designer.getByLabel('Рамка с подписью').check();
    await designer.getByLabel('Подпись под QR').fill('Пройди сборку — 2 минуты');
    await designer.getByRole('button', { name: 'Сохранить оформление' }).click();
    await expect(designer.getByRole('status')).toContainText('Оформление сохранено');

    // Сохранённое оформление видно и после перезагрузки.
    await page.reload();
    await page.getByRole('button', { name: 'Точки доступа' }).click();
    await page.getByRole('button', { name: 'Оформление QR' }).first().click();
    await expect(page.getByLabel('Подпись под QR')).toHaveValue('Пройди сборку — 2 минуты');
    await expect(page.getByRole('group', { name: 'Форма точек' }).getByRole('button', { name: 'Круглые' })).toHaveAttribute('aria-pressed', 'true');
    const png = await page.request.get(`/api/v1/projects/${id}/access-points/${(await (await page.request.get(`/api/v1/projects/${id}/access-points`)).json())[0].id}/qr.png?size=1024`);
    expect(png.status()).toBe(200);
    expect(png.headers()['content-type']).toBe('image/png');

    // Светлые точки на светлом фоне: подсказка сразу, сохранить нельзя.
    await page.getByLabel('Цвет точек').fill('#cccccc');
    await page.getByLabel('Цвет фона').fill('#ffffff');
    await expect(page.getByRole('alert').filter({ hasText: 'мало контраста' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Сохранить оформление' })).toBeDisabled();

    await page.getByLabel('Цвет точек').fill('#1b3a6b');
    await page.getByLabel('Цвет фона').fill('#fff4d6');
    mkdirSync(SHOTS, { recursive: true });
    await page.screenshot({ path: `${SHOTS}/qr-designer-${info.project.name}.png`, fullPage: true });
  });
});
