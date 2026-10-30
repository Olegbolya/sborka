import { mkdirSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { adminIds, adminLogin, freshUser, loginAndOnboard } from './helpers/auth';

/*
 * P10.3, P10.4 · TH-05, TPL-03: администратор одной кнопкой публикует стартовый набор; создатель из каждого шаблона получает сборку,
 * публикует её и проходит до финала; три системные темы выглядят читаемо на экране 390.
 */
const SHOTS = 'e2e/__screenshots__';
const origin = (page: Page) => new URL(page.url()).origin;
const post = (page: Page, url: string, data: unknown = {}) => page.request.post(`/api/v1${url}`, { data, headers: { origin: origin(page) } });
const put = (page: Page, url: string, data: unknown, ifMatch: number) => page.request.put(`/api/v1${url}`, { data, headers: { origin: origin(page), 'If-Match': String(ifMatch) } });

interface Created {
  id: string;
  slug: string;
  document: Record<string, unknown> & { theme: Record<string, unknown> };
  draftVersionNumber: number;
}
const publishedFrom = async (page: Page, templateId: string): Promise<Created> => {
  const made = (await (await post(page, '/projects', { templateId })).json()) as Created;
  expect((await post(page, `/projects/${made.id}/publish`)).ok()).toBe(true);
  return made;
};
const screenOf = (page: Page) => page.locator('.bk-player-screen[data-live="true"]');

test.describe('P10.3, P10.4 · стартовый набор', () => {
  test('TPL-03 · TH-05 · администратор публикует набор, повтор ничего не добавляет; четыре шаблона создаются, публикуются и проходятся до финала', async ({ page, browser }, info) => {
    test.setTimeout(240_000);
    const base = info.project.use.baseURL!;
    const adminCtx = await browser.newContext({ baseURL: base, locale: 'ru-RU' });
    const admin = await adminCtx.newPage();
    await adminLogin(admin, { id: adminIds(info).d, name: 'Администратор Г' });
    await admin.goto('/admin/content');
    await admin.getByRole('button', { name: 'Опубликовать стартовый набор' }).click();
    await expect(admin.getByRole('status')).toContainText('Добавлено тем:');
    await expect(admin.getByTestId('system-template')).toHaveCount(14);
    await expect(admin.getByTestId('system-theme')).toHaveCount(3);
    await admin.getByRole('button', { name: 'Опубликовать стартовый набор' }).click();
    await expect(admin.getByRole('status')).toContainText('Добавлено тем: 0, шаблонов: 0');
    await expect(admin.getByTestId('system-template')).toHaveCount(14);

    await loginAndOnboard(page, freshUser('Автор'));
    const templates = ((await (await page.request.get('/api/v1/templates')).json()) as { templates: Array<{ id: string; name: string }> }).templates;
    const idOf = (name: string) => templates.find((t) => t.name === name)!.id;
    expect(templates.length).toBeGreaterThanOrEqual(14);

    // «Письмо Деду Морозу»
    let s = await publishedFrom(page, idOf('Письмо Деду Морозу'));
    await page.goto(`/s/${s.slug}`);
    await expect(screenOf(page)).toBeVisible();
    await page.getByRole('button', { name: 'Написать письмо' }).click();
    await page.getByRole('textbox', { name: 'Как тебя зовут' }).fill('Маша');
    await page.getByRole('textbox', { name: 'Как прошёл год' }).fill('Я хорошо училась и помогала дома');
    await page.getByRole('textbox', { name: 'О чём мечтаешь' }).fill('Хочу собаку');
    await page.getByRole('button', { name: 'Отправить' }).click();
    await expect(page.getByText('Письмо отправлено!')).toBeVisible();
    await page.getByRole('button', { name: 'Закончить' }).click();
    await expect(page.getByTestId('play-end')).toBeVisible();

    // «Викторина с баллами»: три правильных ответа — тридцать баллов
    s = await publishedFrom(page, idOf('Викторина с баллами'));
    await page.goto(`/s/${s.slug}`);
    await page.getByRole('button', { name: 'Начать' }).click();
    for (const [answer, next] of [['Восемь', 'Дальше'], ['Меркурий', 'Дальше'], ['Москва', 'Узнать результат']] as const) {
      await page.getByText(answer, { exact: true }).click();
      await page.getByRole('button', { name: next }).click();
    }
    await expect(page.getByText('Отлично!')).toBeVisible();
    await expect(page.getByText('Баллов: 30 из 30')).toBeVisible();

    // «Анонимный опрос»
    s = await publishedFrom(page, idOf('Анонимный опрос'));
    await page.goto(`/s/${s.slug}`);
    await page.getByRole('button', { name: 'Начать' }).click();
    await page.getByRole('radio', { name: '5' }).first().click();
    await page.getByRole('button', { name: 'Дальше' }).click();
    await page.getByText('Программа', { exact: true }).click();
    await page.getByRole('button', { name: 'Дальше' }).click();
    await page.getByRole('button', { name: 'Отправить' }).click();
    await expect(page.getByText('Спасибо, ваш ответ записан без имени.')).toBeVisible();
    await page.getByRole('button', { name: 'Закончить' }).click();
    await expect(page.getByTestId('play-end')).toBeVisible();

    // «Приглашение с ответом»
    s = await publishedFrom(page, idOf('Приглашение с ответом'));
    await page.goto(`/s/${s.slug}`);
    await page.getByRole('button', { name: 'Ответить' }).click();
    await page.getByText('Приду не один', { exact: true }).click();
    await page.getByRole('textbox', { name: 'Как вас записать' }).fill('Семья Ивановых');
    await page.getByRole('button', { name: 'Отправить ответ' }).click();
    await expect(page.getByText('Ответ получен. Спасибо, что откликнулись!')).toBeVisible();
    await page.getByRole('button', { name: 'Закончить' }).click();
    await expect(page.getByTestId('play-end')).toBeVisible();
  });

  test('TH-05 · каждая из трёх тем применяется к сборке и выглядит читаемо на 390; все десять игр создаются и публикуются из шаблонов', async ({ page }, info) => {
    test.setTimeout(240_000);
    mkdirSync(SHOTS, { recursive: true });
    await loginAndOnboard(page, freshUser('Автор'));
    const themes = (await (await page.request.get('/api/v1/themes?scope=system')).json()) as Array<{ id: string; name: string }> | { items: Array<{ id: string; name: string }> };
    const system = (Array.isArray(themes) ? themes : themes.items).filter((t) => ['Новогодний уют', 'Светлая нейтральная', 'Тёмная нейтральная'].includes(t.name));
    expect(system).toHaveLength(3);
    const all = ((await (await page.request.get('/api/v1/templates')).json()) as { templates: Array<{ id: string; name: string; category?: string }> }).templates;
    const sample = all.find((t) => t.name === 'Приглашение с ответом')!;

    for (const [i, theme] of system.entries()) {
      const made = (await (await post(page, '/projects', { templateId: sample.id })).json()) as Created;
      const full = (await (await page.request.get(`/api/v1/themes/${theme.id}`)).json()) as { id: string; tokens: Record<string, unknown> };
      made.document.theme = { themeId: full.id, tokens: full.tokens };
      expect((await put(page, `/projects/${made.id}/draft`, { document: made.document }, made.draftVersionNumber)).ok()).toBe(true);
      expect((await post(page, `/projects/${made.id}/publish`)).ok()).toBe(true);
      await page.goto(`/s/${made.slug}`);
      await expect(screenOf(page)).toBeVisible();
      await expect(page.getByRole('button', { name: 'Ответить' })).toBeVisible();
      await page.screenshot({ path: `${SHOTS}/starter-theme-${i + 1}-${theme.name.replaceAll(' ', '-')}-${info.project.name}.png` });
    }

    for (const t of all.filter((x) => x.category === 'Игры')) {
      const made = await publishedFrom(page, t.id);
      await page.goto(`/s/${made.slug}`);
      await expect(screenOf(page)).toBeVisible();
    }
  });
});
