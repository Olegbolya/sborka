import { createServer, type Server } from 'node:http';
import { mkdirSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import { freshUser, loginAndOnboard } from './helpers/auth';
import { nextButton, seedProject } from './helpers/editor';
import { subscribeOwner } from './helpers/plan';

/*
 * D-07 · ADR-129 · вебхук сборки в «Настройках доступа». Сервер создателя изображает маленький HTTP-сервер этого теста
 * (вне рабочей среды API разрешает адреса своей машины — `webhookAllowPrivate`).
 */
const SHOTS = 'e2e/__screenshots__';

test.describe('D-07 · вебхук сборки', () => {
  let server: Server;
  let url = '';
  const bodies: string[] = [];

  test.beforeAll(async () => {
    server = createServer((req, res) => {
      let body = '';
      req.on('data', (c: Buffer) => (body += c.toString()));
      req.on('end', () => {
        bodies.push(body);
        res.writeHead(200).end('ok');
      });
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
    const addr = server.address();
    url = `http://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}/hook`;
  });
  test.afterAll(async () => {
    await new Promise((r) => server.close(r));
  });

  test('D-07 · «Старт»: карточка «Вебхук» с замком и словами про «Про», поля адреса нет', async ({ page }) => {
    await loginAndOnboard(page, freshUser('Автор'));
    const { id } = await seedProject(page);
    await page.goto(`/cabinet/projects/${id}`);
    await page.getByRole('button', { name: 'Настройки доступа' }).click();
    const card = page.getByTestId('webhook-card');
    await expect(card).toContainText('Вебхук 🔒');
    await expect(card).toContainText('есть на тарифе «Про»');
    await expect(page.getByLabel('Адрес вебхука')).toHaveCount(0);
  });

  test('D-07 · «Про»: подключить адрес → «Отправить проверку» доставлена → завершённое прохождение приходит на адрес и видно в списке', async ({ page }, info) => {
    await loginAndOnboard(page, freshUser('Автор'));
    const origin = new URL(page.url()).origin;
    const { id } = await seedProject(page, (d) => {
      d.screens[0]!.blocks.push(nextButton('dalshe_1'));
    }, 'Заявки на экскурсию');
    await subscribeOwner(id, 'PRO');
    await page.goto(`/cabinet/projects/${id}`);
    await page.getByRole('button', { name: 'Настройки доступа' }).click();
    await page.getByLabel('Адрес вебхука').fill(url);
    await page.getByRole('button', { name: 'Подключить' }).click();
    const card = page.getByTestId('webhook-card');
    await expect(card.getByRole('status')).toContainText('Адрес сохранён');
    await expect(page.getByTestId('webhook-secret')).not.toContainText('whsec_');
    await card.getByRole('button', { name: 'Показать' }).click();
    await expect(page.getByTestId('webhook-secret')).toContainText('whsec_');

    await card.getByRole('button', { name: 'Отправить проверку' }).click();
    await expect(card.getByRole('status')).toContainText('Проверка доставлена: ответ 200.');
    const list = card.getByRole('list', { name: 'Последние отправки вебхука' });
    await expect(list).toContainText('Проверка');
    await expect(list).toContainText('доставлено');
    expect(bodies.some((b) => (JSON.parse(b) as { event: string }).event === 'ping')).toBe(true);

    // A participant finishes the published project: the passage goes to the address.
    expect((await page.request.post(`/api/v1/projects/${id}/publish`, { headers: { origin } })).ok()).toBe(true);
    const started = await page.request.post(`/api/v1/play/${id}/sessions`, { data: {}, headers: { origin } });
    expect(started.ok(), await started.text()).toBe(true);
    const { sessionId } = (await started.json()) as { sessionId: string };
    expect((await page.request.post(`/api/v1/play/sessions/${sessionId}/complete`, { headers: { origin } })).ok()).toBe(true);
    await expect.poll(() => bodies.map((b) => JSON.parse(b) as { event: string; passage?: { id: string } }).find((b) => b.event === 'passage.completed')?.passage?.id, { timeout: 10_000 }).toBe(sessionId);

    await page.reload();
    await page.getByRole('button', { name: 'Настройки доступа' }).click();
    await expect(list).toContainText('Прохождение');
    mkdirSync(SHOTS, { recursive: true });
    await card.scrollIntoViewIfNeeded();
    await card.screenshot({ path: `${SHOTS}/webhook-${info.project.name}.png` });
  });
});
