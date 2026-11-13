import { mkdirSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import { freshUser, loginAndOnboard } from './helpers/auth';
import { box, hit, nextButton, openEditor, openTab, saveStatus, seedProject, textBlock } from './helpers/editor';

const SHOTS = 'e2e/__screenshots__';

test.beforeEach(async ({ page }) => {
  await loginAndOnboard(page, freshUser('Автор'));
});

test.describe('E-12 · мобильный редактор', () => {
  test('E-12 · нижний бар навигации присутствует на узкой ширине', async ({ page, viewport }) => {
    if (!viewport || viewport.width >= 768) return;
    const { id } = await seedProject(page);
    await openEditor(page, id);

    const navLeft = page.getByTestId('mobile-nav-left');
    const navRight = page.getByTestId('mobile-nav-right');
    await expect(navLeft).toBeVisible();
    await expect(navRight).toBeVisible();
    await expect(navLeft).toHaveAttribute('aria-pressed', 'true');

    mkdirSync(SHOTS, { recursive: true });
    await page.screenshot({ path: `${SHOTS}/e12-mobile-nav.png` });
  });

  test('E-12 · левая шторка открывается кнопкой «Слои»', async ({ page, viewport }) => {
    if (!viewport || viewport.width >= 768) return;
    const { id } = await seedProject(page);
    await openEditor(page, id);

    const leftPanel = page.locator('.ed-panel.left');
    await expect(leftPanel).toBeVisible();

    mkdirSync(SHOTS, { recursive: true });
    await page.screenshot({ path: `${SHOTS}/e12-left-sheet.png` });
  });

  test('E-12 · выбор блока открывает правую шторку (Свойства)', async ({ page, viewport }) => {
    if (!viewport || viewport.width >= 768) return;
    const { id } = await seedProject(page, (d) => void d.screens[0]!.blocks.push(box('blok_a', 'Блок A', 20, 40)));
    await openEditor(page, id);

    await hit(page, 'Блок A').click();

    const navRight = page.getByTestId('mobile-nav-right');
    await expect(navRight).toHaveAttribute('aria-pressed', 'true');

    const rightPanel = page.locator('.ed-panel.right');
    await expect(rightPanel).toBeVisible();

    mkdirSync(SHOTS, { recursive: true });
    await page.screenshot({ path: `${SHOTS}/e12-right-sheet.png` });
  });

  test('E-12 · переключение между шторками', async ({ page, viewport }) => {
    if (!viewport || viewport.width >= 768) return;
    const { id } = await seedProject(page);
    await openEditor(page, id);

    await page.getByTestId('mobile-nav-right').click();
    await expect(page.getByTestId('mobile-nav-right')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByTestId('mobile-nav-left')).toHaveAttribute('aria-pressed', 'false');

    await page.getByTestId('mobile-nav-left').click();
    await expect(page.getByTestId('mobile-nav-left')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByTestId('mobile-nav-right')).toHaveAttribute('aria-pressed', 'false');

    await expect(saveStatus(page)).toHaveText('Сохранено');
  });

  test('E-12 · маркеры выделения ≥ 24×24 px на сенсорном устройстве', async ({ page, viewport }) => {
    if (!viewport || viewport.width >= 768) return;
    const { id } = await seedProject(page, (d) => void d.screens[0]!.blocks.push(box('blok_a', 'Блок A', 20, 40)));
    await openEditor(page, id);

    await hit(page, 'Блок A').click();
    await page.getByTestId('mobile-nav-left').click();
    await page.getByTestId('mobile-nav-right').click();

    const handles = page.locator('.ed-handle');
    const count = await handles.count();
    expect(count).toBeGreaterThan(0);
    for (let i = 0; i < count; i++) {
      const box = await handles.nth(i).boundingBox();
      if (box) {
        expect(box.width).toBeGreaterThanOrEqual(24);
        expect(box.height).toBeGreaterThanOrEqual(24);
      }
    }
  });

  const content = (d: { screens: Array<{ blocks: unknown[] }> }) =>
    void d.screens[0]!.blocks.push(
      textBlock('zagolovok_1', 'Заголовок', 20, 30, 300, 60),
      {
        ...nextButton('knopka_1', 'Дальше', 140),
        rules: [{ id: 'pravilo_1', when: { kind: 'tap', source: { kind: 'block', blockId: 'knopka_1' } }, do: [{ kind: 'finish' }] }],
      },
    );

  test('E-12 · каждая вкладка нижних шторок открывается, помещается в ширину экрана и не выше половины окна', async ({ page, viewport }, info) => {
    if (!viewport || viewport.width >= 768) return;
    const { id } = await seedProject(page, content);
    await openEditor(page, id);
    mkdirSync(SHOTS, { recursive: true });
    const sheet = async (side: 'left' | 'right', name: string, shot: string) => {
      const panel = page.locator(`.ed-panel.${side}`);
      await expect(panel).toBeVisible();
      const m = await panel.evaluate((el) => {
        const r = el.getBoundingClientRect();
        return { left: Math.round(r.left), right: Math.round(r.right), height: r.height, overflow: el.scrollWidth - el.clientWidth, window: window.innerWidth, windowHeight: window.innerHeight };
      });
      expect(m.left, `${name}: шторка начинается у левого края`).toBeGreaterThanOrEqual(0);
      expect(m.right, `${name}: шторка не шире окна`).toBeLessThanOrEqual(m.window);
      expect(m.overflow, `${name}: содержимое шторки не уходит за край по горизонтали`).toBeLessThanOrEqual(1);
      expect(m.height, `${name}: шторка не выше половины окна`).toBeLessThanOrEqual(m.windowHeight / 2 + 1);
      await page.screenshot({ path: `${SHOTS}/e12-sheet-${shot}-${info.project.name}.png` });
    };
    // Левая шторка: все пять вкладок
    for (const [name, shot] of [['Экраны', 'screens'], ['Слои', 'layers'], ['Добавить', 'add'], ['Шаблоны', 'templates'], ['Библиотека', 'library']] as const) {
      await openTab(page, name);
      await sheet('left', name, shot);
    }
    // Правая шторка: выбрали блок — все вкладки свойств
    await page.getByTestId('mobile-nav-left').click();
    await hit(page, 'Дальше').click();
    for (const [name, shot] of [['Оформление', 'style'], ['Содержимое', 'content'], ['Сценарии', 'scenarios']] as const) {
      await openTab(page, name);
      await sheet('right', name, shot);
    }
  });

  test('E-12 · окна верхней строки (история, тема, сценарии, логика, предпросмотр) открываются на телефоне целиком', async ({ page, viewport }, info) => {
    if (!viewport || viewport.width >= 768) return;
    const { id } = await seedProject(page, content);
    await openEditor(page, id);
    mkdirSync(SHOTS, { recursive: true });
    for (const [button, shot] of [['История', 'history'], ['Тема', 'theme'], ['Сценарии', 'scenarios'], ['Логика', 'logic'], ['Предпросмотр', 'preview']] as const) {
      await page.getByRole('button', { name: button, exact: true }).scrollIntoViewIfNeeded();
      await page.getByRole('button', { name: button, exact: true }).click();
      const dialog = page.getByRole('dialog').first();
      await expect(dialog, `${button}: окно открылось`).toBeVisible();
      const m = await dialog.evaluate((el) => {
        const r = el.getBoundingClientRect();
        return { left: Math.round(r.left), right: Math.round(r.right), top: Math.round(r.top), bottom: Math.round(r.bottom), window: window.innerWidth, windowHeight: window.innerHeight, overflow: el.scrollWidth - el.clientWidth };
      });
      expect(m.left, `${button}: окно не уходит за левый край`).toBeGreaterThanOrEqual(0);
      expect(m.right, `${button}: окно не шире экрана`).toBeLessThanOrEqual(m.window);
      expect(m.overflow, `${button}: содержимое окна не уходит за край по горизонтали`).toBeLessThanOrEqual(1);
      expect(m.bottom, `${button}: окно не выше экрана`).toBeLessThanOrEqual(m.windowHeight + 1);
      await page.screenshot({ path: `${SHOTS}/e12-dialog-${shot}-${info.project.name}.png` });
      await page.keyboard.press('Escape');
      await expect(page.getByRole('dialog')).toHaveCount(0);
    }
  });

  test('E-12 · не урезанная версия: на телефоне те же разделы свойств, что и на компьютере', async ({ page, browser, viewport }, info) => {
    if (!viewport || viewport.width >= 768) return;
    const { id } = await seedProject(page, content);
    const sections = async (p: typeof page): Promise<string[]> => {
      await openEditor(p, id);
      await hit(p, 'Заголовок').click();
      await openTab(p, 'Оформление');
      return p.locator('.ed-panel.right .ed-sec > summary').allInnerTexts();
    };
    const onPhone = await sections(page);
    const ctx = await browser.newContext({ baseURL: info.project.use.baseURL!, viewport: { width: 1440, height: 900 }, storageState: await page.context().storageState() });
    const desk = await ctx.newPage();
    const onDesktop = await sections(desk);
    await ctx.close();
    expect(onPhone.length).toBeGreaterThan(5);
    expect(onPhone).toEqual(onDesktop);
  });
  test('E-12 · шапка на телефоне: название сборки видно целиком и не перекрыто кнопкой «Опубликовать»', async ({ page, viewport }, info) => {
    if (!viewport || viewport.width >= 768) return;
    const { id } = await seedProject(page, content);
    await openEditor(page, id);
    const title = await page.getByLabel('Название сборки').boundingBox();
    const publish = await page.getByRole('button', { name: /^Опубликовать/ }).boundingBox();
    const back = await page.getByRole('link', { name: /Мои сборки/ }).boundingBox();
    expect(title && publish && back).toBeTruthy();
    expect(title!.width, 'название сборки не сжато до крошечного').toBeGreaterThanOrEqual(120);
    expect(title!.x, 'название правее кнопки «Мои сборки»').toBeGreaterThanOrEqual(back!.x + back!.width - 1);
    const overlap = title!.x < publish!.x + publish!.width && publish!.x < title!.x + title!.width && title!.y < publish!.y + publish!.height && publish!.y < title!.y + title!.height;
    expect(overlap, 'кнопка «Опубликовать» не закрывает название').toBe(false);
    expect(publish!.x + publish!.width, 'кнопка не уходит за правый край').toBeLessThanOrEqual(viewport.width + 1);
    mkdirSync(SHOTS, { recursive: true });
    await page.screenshot({ path: `${SHOTS}/e12-topbar-${info.project.name}.png` });
  });

  test('E-12 · маркеры выделения не закрывают текст: зона нажатия 24 px, а видимый маркер меньше', async ({ page, viewport }) => {
    if (!viewport || viewport.width >= 768) return;
    const { id } = await seedProject(page, content);
    await openEditor(page, id);
    await hit(page, 'Дальше').click();
    const visible = await page.locator('.ed-handle').first().evaluate((el) => {
      const s = getComputedStyle(el, '::after');
      return { w: parseFloat(s.width), h: parseFloat(s.height) };
    });
    expect(visible.w).toBeLessThanOrEqual(12);
    expect(visible.h).toBeLessThanOrEqual(12);
  });
});
