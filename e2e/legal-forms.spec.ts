import { mkdirSync } from 'node:fs';
import { expect, test } from '@playwright/test';

const SHOTS = 'e2e/__screenshots__';

test.describe('P8.4, P8.5 · юридические формы', () => {
  test('P8.4 · заявление правообладателя: без обязательных сведений не уходит, полное — принято с номером и сроком', async ({ page }, info) => {
    await page.goto('/legal/complaints');
    await page.getByRole('link', { name: 'Подать заявление правообладателя' }).click();
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Заявление правообладателя');
    mkdirSync(SHOTS, { recursive: true });
    await page.screenshot({ path: `${SHOTS}/legal-copyright-${info.project.name}.png`, fullPage: true });
    expect(await page.evaluate((w) => document.documentElement.scrollWidth - w, page.viewportSize()!.width)).toBeLessThanOrEqual(0);

    await page.getByLabel('Фамилия, имя, отчество').fill('Петрова Анна Сергеевна');
    await page.getByLabel('Электронная почта для ответа').fill('anna@example.ru');
    await page.getByLabel(/^Что защищается/).fill('Моя фотография «Закат над Волгой», опубликована в 2024 году');
    await page.getByLabel(/^Ссылки на страницы/).fill('https://blokker.ru/s/zakat-test');
    await page.getByRole('button', { name: 'Отправить заявление' }).click();
    await expect(page.locator('form [role="alert"]')).toContainText('Паспортные данные');

    await page.getByLabel(/^Паспортные данные/).fill('паспорт 9200 123456, выдан ОВД г. Казани 01.02.2015');
    await page.getByRole('button', { name: 'Отправить заявление' }).click();
    await expect(page.locator('form [role="alert"]')).toContainText('права на материал');
    for (const text of ['права на этот материал', 'разрешения на размещение', 'Согласен на обработку']) await page.getByRole('checkbox', { name: new RegExp(text) }).check();
    await page.getByRole('button', { name: 'Отправить заявление' }).click();
    await expect(page.getByRole('status')).toContainText('Номер заявления');
    await expect(page.getByRole('status')).toContainText('по московскому времени');
  });

  test('P8.5 · запрос о персональных данных: принят с номером и сроком в десять рабочих дней', async ({ page }, info) => {
    await page.goto('/legal/privacy');
    await page.getByRole('link', { name: 'Отправить запрос о своих данных' }).click();
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Запрос о персональных данных');
    mkdirSync(SHOTS, { recursive: true });
    await page.screenshot({ path: `${SHOTS}/legal-data-request-${info.project.name}.png`, fullPage: true });
    await page.getByLabel('О чём запрос').selectOption('DELETE');
    await page.getByLabel(/^Как с вами связаться/).fill('ivan@example.ru');
    await page.getByLabel('Суть запроса').fill('Удалите мои ответы из опроса');
    await page.getByRole('button', { name: 'Отправить запрос' }).click();
    await expect(page.locator('form [role="alert"]')).toContainText('согласитесь');
    await page.getByRole('checkbox').check();
    await page.getByRole('button', { name: 'Отправить запрос' }).click();
    await expect(page.getByRole('status')).toContainText('Номер запроса');
  });
});
