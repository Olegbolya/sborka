import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { mkdirSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { freshUser, loginAndOnboard } from './helpers/auth';
import { textBlock } from './helpers/editor';

/*
 * P10.2: мастер первой сборки — «повод → с нуля или из шаблона → текст и фото → опубликовать → поделиться» меньше чем за 180 с;
 * работает и при пустой галерее шаблонов (шаблонов в базе нет — только «С нуля»), и с системным шаблоном.
 */
const BUDGET_MS = 180_000;
const SHOTS = 'e2e/__screenshots__';
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
const dbUrl = process.env.DATABASE_URL ?? 'postgresql://blokum:blokum@127.0.0.1:5432/blokum_test';

async function sql(text: string, params: unknown[] = []) {
  // `pg` lives in the database package, not at the root of the repository.
  const { Client } = createRequire(resolve('packages/db/package.json'))('pg') as { Client: new (o: { connectionString: string }) => { connect(): Promise<void>; end(): Promise<void>; query(t: string, p: unknown[]): Promise<{ rows: Array<Record<string, unknown>> }> } };
  const client = new Client({ connectionString: dbUrl });
  await client.connect();
  try {
    return await client.query(text, params);
  } finally {
    await client.end();
  }
}

async function stepsOf(page: Page) {
  await expect(page.getByRole('list', { name: 'Шаги' })).toBeVisible();
}

test.describe('P10.2 · мастер первой сборки', () => {
  test('P10.2 · при пустой галерее: с нуля, фото, публикация и ссылка — быстрее 180 с; сборку можно пройти', async ({ page }, info) => {
    test.setTimeout(BUDGET_MS + 60_000);
    // The gallery is empty (the list is also checked empty on the API side); the two browser projects share one database.
    await page.route('**/api/v1/templates', (route) => route.fulfill({ json: { templates: [] } }));
    await loginAndOnboard(page, freshUser('Мастер'));
    const started = Date.now();
    await page.goto('/app/new');
    await stepsOf(page);
    await page.getByRole('button', { name: 'День рождения' }).click();
    await expect(page.getByText('Готовых шаблонов пока нет')).toBeVisible();
    await page.getByRole('button', { name: /^С нуля/ }).click();
    await page.getByLabel('Заголовок').fill('Саша, с днём рождения!');
    await page.getByLabel('Текст').fill('Ждём тебя в субботу.');
    await page.getByLabel('Фото').setInputFiles({ name: 'foto.png', mimeType: 'image/png', buffer: PNG });
    await expect(page.getByAltText('Выбранное фото')).toBeVisible();
    mkdirSync(SHOTS, { recursive: true });
    await page.screenshot({ path: `${SHOTS}/wizard-content-${info.project.name}.png`, fullPage: true });
    await page.getByRole('button', { name: 'Дальше' }).click();
    await page.getByRole('button', { name: 'Опубликовать' }).click();
    const link = page.getByTestId('wizard-link');
    await expect(link).toBeVisible();
    await expect(page.getByAltText('QR-код со ссылкой на сборку')).toBeVisible();
    await page.screenshot({ path: `${SHOTS}/wizard-share-${info.project.name}.png`, fullPage: true });
    expect(Date.now() - started).toBeLessThan(BUDGET_MS);

    // The link works: the participant sees what the wizard put on the screen.
    const url = new URL((await link.textContent())!.trim());
    const player = await page.context().newPage();
    await player.goto(`${new URL(page.url()).origin}${url.pathname}`);
    await expect(player.getByText('Саша, с днём рождения!')).toBeVisible();
    await expect(player.getByText('Ждём тебя в субботу.')).toBeVisible();
  });

  test('P10.2 · из системного шаблона: меняются тексты и фото, сборка независима от шаблона', async ({ page }, info) => {
    test.setTimeout(BUDGET_MS + 60_000);
    const doc = { schemaVersion: 1, meta: { title: 'Шаблон открытки' }, theme: { tokens: {} }, screens: [{ id: 'ekran_1', name: 'Экран 1', blocks: [textBlock('shapka_1', 'Шапка', 20, 40, 300, 60), textBlock('podpis_1', 'Подпись', 20, 140, 300, 60)] }] };
    const cardName = `Открытка ${info.project.name}`;
    const made = await sql(`insert into templates (id, name, category, document, is_system, sort, published_at) values ($1, $3, 'Праздники', $2, true, 1, now()) returning id`, [`tpl${Date.now()}${info.project.name.slice(0, 1)}`, JSON.stringify(doc), cardName]);
    const templateId = made.rows[0]!.id as string;
    try {
      await loginAndOnboard(page, freshUser('Мастер'));
      await page.goto('/app/new');
      await page.getByRole('button', { name: 'Праздник' }).click();
      await page.getByRole('button', { name: new RegExp(`^${cardName}`) }).click();
      await page.getByLabel('Шапка').fill('Дорогая Маша!');
      await page.getByLabel('Подпись').fill('Твоя команда');
      await page.getByLabel('Фото').setInputFiles({ name: 'foto.png', mimeType: 'image/png', buffer: PNG });
      await expect(page.getByAltText('Выбранное фото')).toBeVisible();
      await page.getByRole('button', { name: 'Дальше' }).click();
      await page.getByRole('button', { name: 'Опубликовать' }).click();
      const link = page.getByTestId('wizard-link');
      await expect(link).toBeVisible();
      await sql(`update templates set document = $2 where id = $1`, [templateId, JSON.stringify({ ...doc, screens: [] })]);
      const url = new URL((await link.textContent())!.trim());
      const player = await page.context().newPage();
      await player.goto(`${new URL(page.url()).origin}${url.pathname}`);
      await expect(player.getByText('Дорогая Маша!')).toBeVisible();
      await expect(player.getByText('Твоя команда')).toBeVisible();
    } finally {
      await sql(`delete from templates where id = $1`, [templateId]);
    }
  });

  test('P10.2 · «Назад» с шага содержимого не оставляет лишних черновиков', async ({ page }) => {
    await page.route('**/api/v1/templates', (route) => route.fulfill({ json: { templates: [] } }));
    await loginAndOnboard(page, freshUser('Мастер'));
    const count = async () => ((await (await page.request.get('/api/v1/projects')).json()) as unknown[]).length;
    const before = await count();
    await page.goto('/app/new');
    await page.getByRole('button', { name: 'Игра' }).click();
    await page.getByRole('button', { name: /^С нуля/ }).click();
    await expect(page.getByLabel('Заголовок')).toBeVisible();
    expect(await count()).toBe(before + 1);
    await page.getByRole('button', { name: 'Назад' }).click();
    await page.getByRole('button', { name: /Другой повод/ }).click();
    await expect.poll(count).toBe(before);
  });
});
