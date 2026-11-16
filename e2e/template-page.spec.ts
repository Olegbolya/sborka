import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { mkdirSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { freshUser, loginAndOnboard } from './helpers/auth';
import { textBlock } from './helpers/editor';

/*
 * TPL-05 · «Собрать такую же»: страница шаблона /t/{адрес} без входа, вход и возврат, черновик-копия с меткой источника,
 * кнопка в плеере только у сборки-примера.
 */
const SHOTS = 'e2e/__screenshots__';
const dbUrl = process.env.DATABASE_URL ?? 'postgresql://blokum:blokum@127.0.0.1:5432/blokum_test';

async function sql(text: string, params: unknown[] = []) {
  const { Client } = createRequire(resolve('packages/db/package.json'))('pg') as { Client: new (o: { connectionString: string }) => { connect(): Promise<void>; end(): Promise<void>; query(t: string, p: unknown[]): Promise<{ rows: Array<Record<string, unknown>> }> } };
  const client = new Client({ connectionString: dbUrl });
  await client.connect();
  try {
    return await client.query(text, params);
  } finally {
    await client.end();
  }
}

/** A signed-in creator makes and publishes a one-screen project; returns its id, address and document. */
async function publishedProject(page: Page, title: string, text: string): Promise<{ id: string; slug: string; document: Record<string, unknown> }> {
  const origin = new URL(page.url()).origin;
  const created = (await (await page.request.post('/api/v1/projects', { data: { title }, headers: { origin } })).json()) as { id: string; slug: string; document: { screens: Array<{ blocks: unknown[] }> }; draftVersionNumber: number };
  created.document.screens[0]!.blocks.push(textBlock('tekst_1', text, 20, 40, 300, 60));
  const put = await page.request.put(`/api/v1/projects/${created.id}/draft`, { data: { document: created.document }, headers: { 'if-match': String(created.draftVersionNumber), origin } });
  expect(put.ok()).toBeTruthy();
  const pub = await page.request.post(`/api/v1/projects/${created.id}/publish`, { data: {}, headers: { origin } });
  expect(pub.ok()).toBeTruthy();
  return { id: created.id, slug: created.slug, document: created.document };
}

test.describe('TPL-05 · «Собрать такую же»', () => {
  test('TPL-05.1 · адреса нет — «Шаблон не найден» со ссылкой на галерею, без входа', async ({ page }, info) => {
    await page.goto('/t/takogo-shablona-net');
    await expect(page.getByRole('heading', { name: 'Шаблон не найден' })).toBeVisible();
    await expect(page.getByTestId('template-gallery-link')).toHaveAttribute('href', '/app/new');
    mkdirSync(SHOTS, { recursive: true });
    await page.screenshot({ path: `${SHOTS}/template-notfound-${info.project.name}.png`, fullPage: true });
  });

  test('TPL-05.2 · TPL-05.5 · невошедший: страница → «Собрать такую же» → вход → редактор с копией; метка источника сохранена, шаблон не тронут', async ({ page }, info) => {
    test.setTimeout(120_000);
    const tag = `${info.project.name.replace(/[^a-z0-9]/g, '')}${Date.now().toString(36)}`;
    const slug = `e2e-${tag}`;
    const owner = freshUser('Автор');
    await loginAndOnboard(page, owner);
    const example = await publishedProject(page, `Пример ${tag}`, 'Привет из примера');
    const made = await sql(`insert into templates (id, name, category, document, is_system, sort, published_at, slug, example_project_id) values ($1, $2, 'Праздники', $3, true, 1, now(), $4, $5) returning id`, [`tpl${tag}`, `Шаблон ${tag}`, JSON.stringify(example.document), slug, example.id]);
    const templateId = made.rows[0]!.id as string;
    try {
      await page.context().clearCookies();
      await page.goto(`/t/${slug}?src=serial-9.9`);
      await expect(page.getByTestId('template-title')).toHaveText(`Шаблон ${tag}`);
      await expect(page.getByTestId('template-try')).toHaveAttribute('href', `/s/${example.slug}`);
      await page.screenshot({ path: `${SHOTS}/template-page-${info.project.name}.png`, fullPage: true });

      await page.getByTestId('template-build').click();
      await page.waitForURL(/\/login/);
      await loginViaEmulatorFromLoginPage(page, freshUser('Зритель'));
      // New person: consents first, then the copy is made without choosing the template again.
      await page.getByLabel('Принимаю').check();
      await page.getByLabel(/обработку персональных данных/).check();
      await page.getByLabel(/18 лет/).check();
      await page.getByRole('button', { name: 'Продолжить' }).click();
      await page.waitForURL(/\/app\/projects\/[^/]+\/edit/);
      const projectId = page.url().match(/projects\/([^/]+)\/edit/)![1]!;
      const row = (await sql(`select source_label, source_template_id, title from projects where id = $1`, [projectId])).rows[0]!;
      expect(row.source_label).toBe('serial-9.9');
      expect(row.source_template_id).toBe(templateId);
      const copy = (await (await page.request.get(`/api/v1/projects/${projectId}`)).json()) as { document: { screens: Array<{ blocks: unknown[] }> } };
      expect(copy.document.screens[0]!.blocks.length).toBeGreaterThan(0);
      const tpl = (await sql(`select document from templates where id = $1`, [templateId])).rows[0]!.document as { screens: Array<{ blocks: unknown[] }> };
      expect(tpl.screens[0]!.blocks.length).toBe(copy.document.screens[0]!.blocks.length);
    } finally {
      await sql(`delete from templates where id = $1`, [templateId]);
    }
  });

  test('TPL-05.2 · вошедший: «Собрать такую же» сразу открывает редактор с копией', async ({ page }, info) => {
    test.setTimeout(120_000);
    const tag = `${info.project.name.replace(/[^a-z0-9]/g, '')}${Date.now().toString(36)}b`;
    const slug = `e2e-${tag}`;
    await loginAndOnboard(page, freshUser('Автор'));
    const example = await publishedProject(page, `Пример ${tag}`, 'Привет');
    const made = await sql(`insert into templates (id, name, category, document, is_system, sort, published_at, slug, example_project_id) values ($1, $2, null, $3, true, 1, now(), $4, $5) returning id`, [`tpl${tag}`, `Шаблон ${tag}`, JSON.stringify(example.document), slug, example.id]);
    try {
      await page.goto(`/t/${slug}`);
      await page.getByTestId('template-build').click();
      await page.waitForURL(/\/app\/projects\/[^/]+\/edit/);
      const projectId = page.url().match(/projects\/([^/]+)\/edit/)![1]!;
      expect(projectId).not.toBe(example.id);
      expect((await sql(`select source_label from projects where id = $1`, [projectId])).rows[0]!.source_label).toBeNull();
    } finally {
      await sql(`delete from templates where id = $1`, [made.rows[0]!.id]);
    }
  });

  test('TPL-05.4 · в плеере кнопка «Собрать такую же» есть у сборки-примера и нет у обычной', async ({ page }, info) => {
    test.setTimeout(120_000);
    const tag = `${info.project.name.replace(/[^a-z0-9]/g, '')}${Date.now().toString(36)}c`;
    const slug = `e2e-${tag}`;
    await loginAndOnboard(page, freshUser('Автор'));
    const example = await publishedProject(page, `Пример ${tag}`, 'Это пример');
    const plain = await publishedProject(page, `Обычная ${tag}`, 'Это обычная');
    const made = await sql(`insert into templates (id, name, category, document, is_system, sort, published_at, slug, example_project_id) values ($1, $2, null, $3, true, 1, now(), $4, $5) returning id`, [`tpl${tag}`, `Шаблон ${tag}`, JSON.stringify(example.document), slug, example.id]);
    try {
      await page.context().clearCookies();
      await page.goto(`/s/${example.slug}`);
      await expect(page.getByText('Это пример')).toBeVisible();
      const link = page.getByTestId('play-build-similar');
      await expect(link).toHaveText('Собрать такую же');
      await expect(link).toHaveAttribute('href', `/t/${slug}/build?src=player`);
      await link.scrollIntoViewIfNeeded();
      await expect(link).toBeVisible();
      await page.screenshot({ path: `${SHOTS}/template-player-${info.project.name}.png`, fullPage: true });
      await page.goto(`/s/${plain.slug}`);
      await expect(page.getByText('Это обычная')).toBeVisible();
      await expect(page.getByTestId('play-build-similar')).toHaveCount(0);
    } finally {
      await sql(`delete from templates where id = $1`, [made.rows[0]!.id]);
    }
  });
});

/** On the login page already: the provider's emulator and back (without the waiting for the cabinet that `loginViaEmulator` does). */
async function loginViaEmulatorFromLoginPage(page: Page, user: { id: string; name: string }): Promise<void> {
  await page.getByRole('link', { name: 'Войти через VK ID' }).click();
  await page.getByLabel('ID пользователя').fill(user.id);
  await page.getByLabel('Имя').fill(user.name);
  await page.getByRole('button', { name: 'Войти через VK ID' }).click();
  await page.waitForURL(/\/onboarding/);
}

