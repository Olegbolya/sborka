import { mkdirSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import { freshUser, loginAndOnboard } from './helpers/auth';
import { subscribeOwner } from './helpers/plan';

/*
 * D-07 · «Уведомления во ВКонтакте» в настройках аккаунта (ADR-110). В e2e у API проверочное сообщество (scripts/e2e-api.sh):
 * человек нажимает «Подключить», а сообщение сообществу изображает событие Callback API с секретом — как его прислал бы ВКонтакте.
 */
const SHOTS = 'e2e/__screenshots__';
const SECRET = process.env.VK_CALLBACK_SECRET ?? 'e2e-callback-secret';
const GROUP_ID = Number(process.env.VK_GROUP_ID ?? 230000001);

test.describe('D-07 · ВКонтакте в настройках', () => {
  test('D-07 · «Старт»: сказано, что нужен платный тариф, кнопки привязки нет', async ({ page }) => {
    await loginAndOnboard(page, freshUser('Автор'));
    await page.goto('/account');
    await expect(page.getByText('Уведомления во ВКонтакте')).toBeVisible();
    await expect(page.getByTestId('vk-plan')).toContainText('на платных тарифах');
    await expect(page.getByTestId('vk-connect')).toHaveCount(0);
  });

  test('D-07 · «Автор» (самый простой платный): «Подключить» → ссылка vk.me и код → сообщение сообществу → «ВКонтакте подключён» → «Отключить»', async ({ page }, info) => {
    await loginAndOnboard(page, freshUser('Автор'));
    const origin = new URL(page.url()).origin;
    const created = await page.request.post('/api/v1/projects', { data: { title: 'Для тарифа' }, headers: { origin } });
    await subscribeOwner(((await created.json()) as { id: string }).id, 'AUTHOR');

    await page.goto('/account');
    await page.getByTestId('vk-connect').click();
    const href = await page.getByTestId('vk-open').getAttribute('href');
    const code = (await page.getByTestId('vk-code').innerText()).trim();
    expect(href).toBe(`https://vk.me/${process.env.VK_GROUP_SCREEN_NAME ?? 'blokker_e2e'}?ref=${code}`);
    mkdirSync(SHOTS, { recursive: true });
    await page.getByTestId('vk-settings').scrollIntoViewIfNeeded();
    await page.screenshot({ path: `${SHOTS}/vk-settings-link-${info.project.name}.png` });

    // The person writes to the community by the link: VK sends `message_new` with `ref` to the server.
    const event = { type: 'message_new', group_id: GROUP_ID, secret: SECRET, event_id: 'e2e', v: '5.199', object: { message: { from_id: 777000111, peer_id: 777000111, text: 'Начать', ref: code } } };
    const res = await page.request.post('/api/v1/vk/callback', { data: event });
    expect(await res.text()).toBe('ok');
    await expect(page.getByTestId('vk-linked')).toContainText('ВКонтакте подключён', { timeout: 10_000 });
    await page.screenshot({ path: `${SHOTS}/vk-settings-linked-${info.project.name}.png` });

    await page.getByTestId('vk-disconnect').click();
    await expect(page.getByTestId('vk-connect')).toBeVisible();
  });
});
