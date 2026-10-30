import { mkdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { adminIds, adminLogin, freshUser, loginAndOnboard } from './helpers/auth';

/*
 * P10.3, P10.4 · TH-05, TPL-03: администратор одной кнопкой публикует стартовый набор; шаблоны создаются, публикуются и проходятся до
 * финала; три системные темы выглядят читаемо на экране 390. Системное содержимое общее для всех проверок, поэтому кнопка нажимается
 * на считаные секунды и набор сразу снимается; всё остальное берёт документы и темы прямо из пакета `packages/themes`.
 */
const SHOTS = 'e2e/__screenshots__';
const EXAMPLES = resolve('packages/themes/examples');
const doc = (file: string): Record<string, unknown> & { theme?: unknown } => JSON.parse(readFileSync(resolve(EXAMPLES, `${file}.json`), 'utf8')) as never;
const origin = (page: Page) => new URL(page.url()).origin;
const post = (page: Page, url: string, data: unknown = {}) => page.request.post(`/api/v1${url}`, { data, headers: { origin: origin(page) } });

/** A project with the given document, published; the page must be signed in. */
async function publishedDoc(page: Page, document: Record<string, unknown>): Promise<string> {
  const made = (await (await post(page, '/projects', { title: String((document.meta as { title: string }).title) })).json()) as { id: string; slug: string; draftVersionNumber: number };
  const saved = await page.request.put(`/api/v1/projects/${made.id}/draft`, { data: { document }, headers: { origin: origin(page), 'if-match': String(made.draftVersionNumber) } });
  expect(saved.ok(), await saved.text()).toBe(true);
  expect((await post(page, `/projects/${made.id}/publish`)).ok()).toBe(true);
  return made.slug;
}
const screenOf = (page: Page) => page.locator('.bk-player-screen[data-live="true"]');

test.describe('P10.3, P10.4 · стартовый набор', () => {
  test('TPL-03 · TH-05 · администратор публикует набор кнопкой, повтор ничего не добавляет; набор тут же снимается', async ({ browser }, info) => {
    test.setTimeout(240_000);
    // Системное содержимое одно на оба профиля браузера: проходы ждут друг друга (замок — каталог, его создание неделимо).
    const lock = resolve(tmpdir(), 'blokum-e2e-starter-set.lock');
    await expect.poll(() => { try { mkdirSync(lock); return true; } catch { return false; } }, { timeout: 120_000, intervals: [500, 1000] }).toBe(true);
    const ctx = await browser.newContext({ baseURL: info.project.use.baseURL!, locale: 'ru-RU' });
    const admin = await ctx.newPage();
    await adminLogin(admin, { id: adminIds(info).d, name: 'Администратор Г' });
    await admin.goto('/admin/content');
    const press = () => admin.getByRole('button', { name: 'Опубликовать стартовый набор' }).click();
    /** Снимает всё системное содержимое: перед проверкой набор должен быть пуст, после — тоже. */
    const clear = async () => {
      for (const kind of ['templates', 'themes']) {
        const rows = (await (await admin.request.get(`/api/v1/admin/${kind}`)).json()) as Array<{ id: string }>;
        for (const r of rows) await admin.request.delete(`/api/v1/admin/${kind}/${r.id}`, { headers: { origin: origin(admin) } });
      }
    };
    try {
      await clear();
      await admin.reload();
      await press();
      await expect(admin.getByRole('status')).toContainText('Добавлено тем: 3, шаблонов: 14');
      await expect(admin.getByTestId('system-template')).toHaveCount(14);
      await expect(admin.getByTestId('system-theme')).toHaveCount(3);
      await press();
      await expect(admin.getByRole('status')).toContainText('Добавлено тем: 0, шаблонов: 0');
    } finally {
      await clear();
      await ctx.close();
      rmSync(lock, { recursive: true, force: true });
    }
  });

  test('TPL-03 · четыре шаблона публикуются и проходятся до финала; десять игр публикуются и открываются', async ({ page }) => {
    test.setTimeout(240_000);
    await loginAndOnboard(page, freshUser('Автор'));
    const slug = async (file: string) => publishedDoc(page, doc(file));

    // «Письмо Деду Морозу»
    await page.goto(`/s/${await slug('tpl-ded-moroz')}`);
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
    await page.goto(`/s/${await slug('tpl-viktorina')}`);
    await page.getByRole('button', { name: 'Начать' }).click();
    for (const [answer, next] of [['Восемь', 'Дальше'], ['Меркурий', 'Дальше'], ['Москва', 'Узнать результат']] as const) {
      await page.getByText(answer, { exact: true }).click();
      await page.getByRole('button', { name: next }).click();
    }
    await expect(page.getByText('Отлично!')).toBeVisible();
    await expect(page.getByText('Баллов: 30 из 30')).toBeVisible();

    // «Анонимный опрос»
    await page.goto(`/s/${await slug('tpl-opros')}`);
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
    await page.goto(`/s/${await slug('tpl-rsvp')}`);
    await page.getByRole('button', { name: 'Ответить' }).click();
    await page.getByText('Приду не один', { exact: true }).click();
    await page.getByRole('textbox', { name: 'Как вас записать' }).fill('Семья Ивановых');
    await page.getByRole('button', { name: 'Отправить ответ' }).click();
    await expect(page.getByText('Ответ получен. Спасибо, что откликнулись!')).toBeVisible();
    await page.getByRole('button', { name: 'Закончить' }).click();
    await expect(page.getByTestId('play-end')).toBeVisible();

    for (let n = 1; n <= 10; n++) {
      await page.goto(`/s/${await slug(`rg-${String(n).padStart(2, '0')}`)}`);
      await expect(screenOf(page)).toBeVisible();
    }
  });

  test('TH-05 · каждая из трёх тем выглядит читаемо на 390', async ({ page }, info) => {
    test.setTimeout(180_000);
    mkdirSync(SHOTS, { recursive: true });
    await page.setViewportSize({ width: 390, height: 844 });
    await loginAndOnboard(page, freshUser('Автор'));
    const { STARTER_THEMES } = (await import('../packages/themes/dist/src/index.js')) as { STARTER_THEMES: ReadonlyArray<{ name: string; tokens: Record<string, unknown> }> };
    for (const [i, theme] of STARTER_THEMES.entries()) {
      const document = doc('tpl-rsvp');
      document.theme = { tokens: theme.tokens };
      await page.goto(`/s/${await publishedDoc(page, document)}`);
      await expect(screenOf(page)).toBeVisible();
      await expect(page.getByRole('button', { name: 'Ответить' })).toBeVisible();
      await page.screenshot({ path: `${SHOTS}/starter-theme-${i + 1}-${theme.name.replaceAll(' ', '-')}-${info.project.name}.png` });
    }
  });
});
