import { mkdirSync } from 'node:fs';
import { expect, test, type Browser, type Page } from '@playwright/test';
import { adminIds, adminLogin, freshUser, loginAndOnboard } from './helpers/auth';
import { nextButton, seedProject, textBlock } from './helpers/editor';

/*
 * P9.3 · AD-02, AD-03, AD-08, AD-11: полный цикл модерации через интерфейс — глазами участника, создателя и двух администраторов, и
 * публикация системных шаблона и темы. Три администратора на проект Playwright: scripts/e2e-api.sh.
 */
const SHOTS = 'e2e/__screenshots__';
const origin = (page: Page) => new URL(page.url()).origin;
const post = (page: Page, url: string, data: unknown = {}) => page.request.post(`/api/v1${url}`, { data, headers: { origin: origin(page) } });

async function published(page: Page, title: string): Promise<{ id: string; slug: string }> {
  const { id } = await seedProject(
    page,
    (d) => {
      d.screens[0]!.blocks.push(textBlock('zagolovok_1', 'Конкурс знатоков истории', 20, 40, 300, 60), nextButton('dalshe_1', 'Дальше', 200));
      d.screens.push({ id: 'ekran_dva', name: 'Второй', blocks: [textBlock('vtoroj_t', 'Спасибо за участие', 20, 60, 300, 60)] });
    },
    title,
  );
  expect((await post(page, `/projects/${id}/publish`)).ok()).toBe(true);
  const { slug } = (await (await page.request.get(`/api/v1/projects/${id}`)).json()) as { slug: string };
  return { id, slug };
}

const newPage = async (browser: Browser, baseURL: string) => {
  const ctx = await browser.newContext({ baseURL, locale: 'ru-RU' });
  return { ctx, page: await ctx.newPage() };
};

test.describe('P9.3 · админка модерации', () => {
  test('AD-03 · жалоба P0 → автоснятие → очередь → блокировка → сообщение → обжалование → другой администратор → восстановление; всё в аудите', async ({ page, browser }, info) => {
    test.setTimeout(240_000);
    const base = info.project.use.baseURL!;
    const ids = adminIds(info);
    const title = `Конкурс ${Date.now()}`;
    await loginAndOnboard(page, freshUser('Автор'));
    const { id, slug } = await published(page, title);

    // Участник жалуется на тяжёлое нарушение — сборка сразу недоступна.
    const visitor = await newPage(browser, base);
    await visitor.page.goto(`/s/${slug}`);
    await expect(visitor.page.locator('.bk-player-screen[data-live="true"]')).toBeVisible();
    await visitor.page.getByTestId('play-footer').getByRole('button', { name: 'Пожаловаться' }).click();
    const dialog = visitor.page.getByTestId('report-dialog');
    await dialog.getByLabel('Что не так').selectOption('A4');
    await dialog.getByLabel('Опишите коротко').fill('Призывы к беспорядкам в заданиях конкурса');
    await dialog.getByRole('button', { name: 'Отправить' }).click();
    await expect(dialog).toContainText('Спасибо, жалоба принята');
    await visitor.page.reload();
    await expect(visitor.page.getByText('Недоступно')).toBeVisible();

    // Первый администратор: случай в очереди с приоритетом и сроком, автоматическое решение в истории.
    const first = await newPage(browser, base);
    await adminLogin(first.page, { id: ids.a, name: 'Администратор А' });
    await first.page.goto('/admin/queue');
    const row = first.page.getByTestId('queue-row').filter({ hasText: title });
    await expect(row).toContainText('P0');
    await expect(row).toContainText(/осталось|просрочено/);
    mkdirSync(SHOTS, { recursive: true });
    await first.page.screenshot({ path: `${SHOTS}/admin-queue-${info.project.name}.png`, fullPage: true });
    await row.getByRole('link').click();
    await expect(first.page.getByTestId('sla')).toContainText(/осталось|просрочено/);
    await expect(first.page.getByTestId('project-status')).toHaveText('Закрыта');
    await expect(first.page.getByTestId('history-item').first()).toContainText('автоматически');
    await expect(first.page.getByText('Призывы к беспорядкам в заданиях конкурса')).toBeVisible();
    await expect(first.page.getByText('Конкурс знатоков истории')).toBeVisible();
    await first.page.getByRole('button', { name: 'Взять в работу' }).click();
    await expect(first.page.getByText('Жалоба в работе')).toBeVisible();
    await first.page.screenshot({ path: `${SHOTS}/admin-case-${info.project.name}.png`, fullPage: true });

    const form = first.page.getByRole('form', { name: 'Решение по сборке' });
    await form.getByLabel('Решение').selectOption({ label: 'Заблокировать сборку' });
    await form.getByLabel('Причина').selectOption({ label: 'A4 · Экстремизм и терроризм' });
    await form.getByLabel('Комментарий для создателя и для журнала').fill('Нарушение подтвердилось');
    await form.getByRole('button', { name: 'Заблокировать сборку' }).click();
    await expect(first.page.getByTestId('project-status')).toHaveText('Заблокирована');

    // Создатель получил сообщение и обжалует.
    await page.goto('/cabinet/projects');
    const note = page.getByTestId('notification').filter({ hasText: 'заблокирована' });
    await expect(note).toContainText('Нарушение подтвердилось');
    await expect(note).toContainText('Обжаловать');
    await note.getByRole('link', { name: 'Открыть сборку' }).click();
    const notice = page.getByRole('region', { name: 'Решение модераторов' });
    await expect(notice).toContainText('Заблокировать сборку');
    await page.screenshot({ path: `${SHOTS}/admin-creator-notice-${info.project.name}.png`, fullPage: true });
    await notice.getByLabel('Почему решение стоит пересмотреть').fill('Это учебный конкурс по истории, призывов в нём нет.');
    await notice.getByRole('button', { name: 'Обжаловать' }).click();
    await expect(page.getByTestId('appeal-state')).toContainText('Ждёт решения');

    // Тот, кто принял решение, пересмотреть его сразу не может; другой администратор восстанавливает.
    await first.page.goto('/admin/appeals');
    const mine = first.page.getByTestId('appeal').filter({ hasText: title });
    await first.page.screenshot({ path: `${SHOTS}/admin-appeals-${info.project.name}.png`, fullPage: true });
    await mine.getByLabel('Комментарий к решению по обращению').fill('Пересматриваю сам');
    await mine.getByRole('button', { name: 'Удовлетворить и восстановить' }).click();
    await expect(mine.getByRole('alert')).toContainText('другой модератор');

    const second = await newPage(browser, base);
    await adminLogin(second.page, { id: ids.b, name: 'Администратор Б' });
    await second.page.goto('/admin/appeals');
    const theirs = second.page.getByTestId('appeal').filter({ hasText: title });
    await theirs.getByLabel('Комментарий к решению по обращению').fill('Проверил: призывов нет');
    await theirs.getByRole('button', { name: 'Удовлетворить и восстановить' }).click();
    await expect(second.page.getByRole('status')).toContainText('Обращение удовлетворено');
    await expect(second.page.getByTestId('appeal').filter({ hasText: title })).toHaveCount(0);

    // Сборка снова в публикации, создатель видит ответ.
    await page.reload();
    await expect(page.getByTestId('appeal-state')).toContainText('Удовлетворено');
    await expect(page.getByTestId('appeal-state')).toContainText('Проверил: призывов нет');
    await visitor.page.goto(`/s/${slug}`);
    await expect(visitor.page.locator('.bk-player-screen[data-live="true"]')).toBeVisible();
    await page.goto('/cabinet/projects');
    await expect(page.getByTestId('notification').filter({ hasText: 'восстановлена' })).toBeVisible();

    // Все шаги — в аудите.
    await second.page.goto('/admin/audit');
    await expect(second.page.getByRole('table', { name: 'Журнал аудита' })).toBeVisible();
    const log = (await (await second.page.request.get('/api/v1/admin/audit?limit=500')).json()) as Array<{ action: string; targetId: string }>;
    const actions = log.map((r) => r.action);
    for (const a of ['MODERATION_UNPUBLISH', 'REPORT_TAKEN', 'MODERATION_BLOCK_PROJECT', 'APPEAL_CREATED', 'MODERATION_RESTORE', 'APPEAL_GRANTED']) expect(actions, a).toContain(a);
    expect(log.filter((r) => r.targetId === id).map((r) => r.action)).toEqual(expect.arrayContaining(['MODERATION_UNPUBLISH', 'MODERATION_BLOCK_PROJECT', 'MODERATION_RESTORE', 'APPEAL_CREATED']));
    await Promise.all([visitor.ctx.close(), first.ctx.close(), second.ctx.close()]);
  });

  test('AD-11 · администратор публикует сборку как системный шаблон и тему — как системную, создатели видят тему, администратор снимает оба', async ({ page, browser }, info) => {
    test.setTimeout(180_000);
    const base = info.project.use.baseURL!;
    const author = freshUser('Автор');
    const title = `Шаблон ${Date.now()}`;
    await loginAndOnboard(page, author);
    const { id } = await published(page, title);

    const admin = await newPage(browser, base);
    await adminLogin(admin.page, { id: adminIds(info).c, name: 'Администратор В' });
    await admin.page.goto('/admin/users');
    await admin.page.getByLabel(/Имя, почта, телефон/).fill(author.name);
    await admin.page.getByRole('button', { name: 'Найти' }).click();
    await admin.page.getByTestId('user-row').filter({ hasText: author.name }).getByRole('link').click();
    const projectCard = admin.page.locator('div', { hasText: id }).filter({ has: admin.page.getByRole('button', { name: 'Опубликовать как системный шаблон' }) }).last();
    await projectCard.getByRole('button', { name: 'Опубликовать как системный шаблон' }).click();
    await expect(admin.page.getByRole('status')).toContainText('опубликована как системный шаблон');
    await projectCard.getByRole('button', { name: 'Тему сборки — системной' }).click();
    await expect(admin.page.getByRole('status')).toContainText('опубликована как системная');

    await admin.page.goto('/admin/content');
    const template = admin.page.getByTestId('system-template').filter({ hasText: title });
    await expect(template).toBeVisible();
    const theme = admin.page.getByTestId('system-theme').filter({ hasText: `Тема «${title}»` });
    await expect(theme).toBeVisible();

    // Создатели видят системную тему в своём списке.
    const listed = async () => ((await (await page.request.get('/api/v1/themes?scope=system')).json()) as Array<{ name: string }> | { items: Array<{ name: string }> });
    const names = async () => {
      const r = await listed();
      return (Array.isArray(r) ? r : r.items).map((t) => t.name);
    };
    expect(await names()).toContain(`Тема «${title}»`);

    await template.getByRole('button', { name: 'Снять' }).click();
    await expect(admin.page.getByTestId('system-template').filter({ hasText: title })).toHaveCount(0);
    await theme.getByRole('button', { name: 'Снять' }).click();
    await expect(admin.page.getByTestId('system-theme').filter({ hasText: `Тема «${title}»` })).toHaveCount(0);
    expect(await names()).not.toContain(`Тема «${title}»`);

    const log = (await (await admin.page.request.get('/api/v1/admin/audit?limit=500')).json()) as Array<{ action: string }>;
    for (const a of ['SYSTEM_TEMPLATE_PUBLISHED', 'SYSTEM_TEMPLATE_REMOVED', 'SYSTEM_THEME_PUBLISHED', 'SYSTEM_THEME_REMOVED']) expect(log.map((r) => r.action), a).toContain(a);
    await admin.ctx.close();
  });

  test('AD-01 · обычному пользователю админка закрыта', async ({ page }) => {
    await loginAndOnboard(page, freshUser('Автор'));
    await page.goto('/admin/queue');
    await expect(page.getByRole('heading', { name: 'Нет доступа' })).toBeVisible();
    expect((await page.request.get('/api/v1/admin/queue')).status()).toBe(403);
  });
});
