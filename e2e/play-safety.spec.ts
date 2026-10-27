import { expect, test, type Browser, type Page } from '@playwright/test';
import { freshUser, loginAndOnboard } from './helpers/auth';
import { nextButton, seedProject, textBlock } from './helpers/editor';

test.beforeEach(async ({ page }) => {
  await loginAndOnboard(page, freshUser('Автор'));
});

const origin = (page: Page) => new URL(page.url()).origin;
const call = (page: Page, method: 'post' | 'patch', url: string, data: unknown = {}) => page.request[method](`/api/v1${url}`, { data, headers: { origin: origin(page) } });

const LINK = 'https://example.ru/stranica?a=1';

async function published(page: Page) {
  const { id } = await seedProject(page, (d) => {
    d.screens[0]!.blocks.push(
      { id: 'imya_pole', type: 'textInput', name: 'Имя', frame: { x: 20, y: 100, w: 300, h: 80 }, props: {} },
      {
        ...nextButton('ssylka_1', 'Открыть сайт', 260),
        rules: [{ id: 'ssylka_pravilo', when: { kind: 'tap', source: { kind: 'block', blockId: 'ssylka_1' } }, do: [{ kind: 'openLink', url: LINK }] }],
      },
      { ...textBlock('tekst_ssylka', 'Ссылка', 20, 340, 300, 48), textLayer: { paragraphs: [{ kind: 'p', runs: [{ t: 'Наш сайт', href: LINK }] }] } },
    );
  });
  expect((await call(page, 'post', `/projects/${id}/publish`)).ok()).toBe(true);
  const { slug } = (await (await page.request.get(`/api/v1/projects/${id}`)).json()) as { slug: string };
  return { id, slug };
}

const participant = async (browser: Browser, baseURL: string) => {
  const ctx = await browser.newContext({ baseURL, locale: 'ru-RU' });
  return { ctx, page: await ctx.newPage() };
};

test.describe('P5.6 · безопасность участника', () => {
  test('PL-16, TS-11 · подвал и водяной знак на экране; жалоба уходит с категорией и попадает в базу с приоритетом', async ({ page, browser }, info) => {
    const { slug } = await published(page);
    const { ctx, page: p } = await participant(browser, info.project.use.baseURL!);
    await p.goto(`/s/${slug}`);
    await expect(p.locator('.bk-player-screen[data-live="true"]')).toBeVisible();
    const footer = p.getByTestId('play-footer');
    await expect(footer).toContainText('Создано пользователем');
    await expect(p.getByTestId('play-watermark')).toHaveText('Сделано в Блокуме — создать свою');
    await footer.getByRole('button', { name: 'Пожаловаться' }).click();
    const dialog = p.getByTestId('report-dialog');
    await expect(dialog.getByRole('button', { name: 'Отправить' })).toBeDisabled();
    await dialog.getByLabel('Что не так').selectOption('A2');
    await dialog.getByLabel('Опишите коротко').fill('Просят пароль от почты');
    await dialog.getByLabel('Как с вами связаться (необязательно)').fill('a@example.ru');
    await expect(dialog.getByRole('button', { name: 'Отправить' })).toBeDisabled();
    await dialog.getByLabel('Согласен на обработку контакта, чтобы мне ответили').check();
    await dialog.getByRole('button', { name: 'Отправить' }).click();
    await expect(dialog).toContainText('Спасибо, жалоба принята');
    await dialog.getByRole('button', { name: 'Закрыть' }).click();
    await expect(dialog).toHaveCount(0);
    await ctx.close();
  });

  test('PL-17 · под полем ввода — подпись «Не вводите пароли…»', async ({ page, browser }, info) => {
    const { slug } = await published(page);
    const { ctx, page: p } = await participant(browser, info.project.use.baseURL!);
    await p.goto(`/s/${slug}`);
    await expect(p.locator('.bk-player-screen[data-live="true"]')).toBeVisible();
    const field = p.locator('[data-block-id="imya_pole"]');
    await expect(field.getByTestId('field-warning')).toHaveText('Не вводите пароли, коды из СМС и данные банковских карт');
    const input = await field.locator('input').boundingBox();
    const note = await field.getByTestId('field-warning').boundingBox();
    expect(note!.y).toBeGreaterThanOrEqual(input!.y + input!.height - 1);
    await ctx.close();
  });

  test('PL-18 · «Это реклама» в кабинете: на каждом экране плеера «Реклама · рекламодатель · erid»', async ({ page, browser }, info) => {
    const { id, slug } = await published(page);
    await page.goto(`/cabinet/projects/${id}`);
    await page.getByRole('button', { name: 'Настройки доступа' }).click();
    const section = page.getByTestId('ad-section');
    await section.scrollIntoViewIfNeeded();
    await section.getByLabel('Это реклама').focus();
    await page.keyboard.press('Space');
    await expect(section.getByLabel('Это реклама')).toBeChecked();
    await section.getByLabel('Рекламодатель').fill('ООО «Ромашка»');
    await section.getByLabel('erid').fill('!!');
    await section.getByRole('button', { name: 'Сохранить пометку' }).click();
    await expect(section.getByRole('alert')).toContainText('токен рекламы');
    await section.getByLabel('erid').fill('2VtzqwP9abc');
    await section.getByRole('button', { name: 'Сохранить пометку' }).click();
    await expect(section.getByRole('button', { name: 'Сохранено!' })).toBeVisible();

    const { ctx, page: p } = await participant(browser, info.project.use.baseURL!);
    await p.goto(`/s/${slug}`);
    await expect(p.getByTestId('play-ad')).toHaveText('Реклама · ООО «Ромашка» · erid: 2VtzqwP9abc');
    await ctx.close();
  });

  test('PL-22, TS-12 · ссылка в тексте и действие «открыть ссылку» ведут через /out; страница не переходит сама, только по нажатию', async ({ page, browser }, info) => {
    const { slug } = await published(page);
    const { ctx, page: p } = await participant(browser, info.project.use.baseURL!);
    await p.goto(`/s/${slug}`);
    await expect(p.locator('.bk-player-screen[data-live="true"]')).toBeVisible();
    const href = await p.getByRole('link', { name: 'Наш сайт' }).getAttribute('href');
    expect(href).toBe(`/out?u=${encodeURIComponent(LINK)}`);

    const popup = p.waitForEvent('popup');
    await p.getByRole('button', { name: 'Открыть сайт' }).click();
    const out = await popup;
    await expect(out.getByTestId('out-page')).toContainText('Вы переходите на другой сайт');
    await expect(out.getByTestId('out-url')).toHaveText(LINK);
    expect(new URL(out.url()).pathname).toBe('/out');
    await out.waitForTimeout(500);
    expect(new URL(out.url()).pathname).toBe('/out');
    await expect(out.getByRole('link', { name: 'Перейти на сайт' })).toHaveAttribute('href', LINK);

    // Недопустимый адрес не открывается вовсе.
    await out.goto(`/out?u=${encodeURIComponent('javascript:alert(1)')}`);
    await expect(out.getByTestId('out-page')).toContainText('Эту ссылку открыть нельзя');
    await expect(out.getByRole('link', { name: 'Перейти на сайт' })).toHaveCount(0);
    await ctx.close();
  });
});
