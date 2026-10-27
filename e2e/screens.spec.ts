import { mkdirSync } from 'node:fs';
import { expect, test, type Locator, type Page } from '@playwright/test';
import { freshUser, loginAndOnboard } from './helpers/auth';
import { openEditor, saveStatus, seedProject, serverDraft, screensList } from './helpers/editor';

test.beforeEach(async ({ page }) => {
  await loginAndOnboard(page, freshUser('Автор'));
});

type SavedScreen = Record<string, any>;

/** The screen as the server has it, once the autosave has caught up with `check`. */
const savedScreen = async (page: Page, id: string, index: number, check: (s: SavedScreen) => boolean): Promise<SavedScreen> => {
  await expect.poll(async () => check((await serverDraft(page, id)).doc.screens[index] as SavedScreen), { timeout: 15_000 }).toBe(true);
  return (await serverDraft(page, id)).doc.screens[index] as SavedScreen;
};

const section = async (page: Page, id: string): Promise<Locator> => {
  const s = page.locator(`[data-section="${id}"]`);
  await s.scrollIntoViewIfNeeded();
  if ((await s.getAttribute('open')) === null) await s.locator('summary').click();
  return s;
};

test.describe('P3.6 · экраны', () => {
  test('E-13 · название, вид и высота экрана меняются в панели и сохраняются', async ({ page }) => {
    const { id } = await seedProject(page);
    await openEditor(page, id);
    const panel = page.getByTestId('screen-panel');
    await panel.getByLabel('Название экрана', { exact: true }).fill('Итог');
    await panel.getByLabel('Какой это экран').selectOption('result');
    await panel.getByLabel('Высота экрана').fill('1200');
    const s = await savedScreen(page, id, 0, (x) => x.name === 'Итог' && x.kind === 'result' && x.height === 1200);
    expect(s).toMatchObject({ name: 'Итог', kind: 'result', height: 1200 });
    await expect(page.getByRole('list', { name: 'Экраны' }).getByText('1. Итог')).toBeVisible();
  });

  test('E-13 · фон экрана: слой заливки цветом попадает в документ и в миниатюру', async ({ page }) => {
    const { id } = await seedProject(page);
    await openEditor(page, id);
    const bg = await section(page, 'screen-background');
    await bg.getByRole('button', { name: 'Добавить' }).click();
    await bg.getByLabel('Цвет: источник').selectOption('hex');
    await bg.getByLabel('Цвет: HEX').fill('#336699');
    const s = await savedScreen(page, id, 0, (x) => x.background?.[0]?.color?.hex === '#336699');
    expect(s.background).toHaveLength(1);
    await expect(screensList(page).first().locator('.bk-screen-bg').first()).toHaveCSS('background-image', /rgb\(51, 102, 153\)/);
  });

  test('P-01 · частицы: включить, выбрать вид, настроить густоту, выключить', async ({ page }) => {
    const { id } = await seedProject(page);
    await openEditor(page, id);
    const sec = await section(page, 'screen-particles');
    await sec.getByRole('checkbox', { name: 'Частицы на экране' }).check();
    await sec.getByLabel('Какие').selectOption('confetti');
    await sec.getByLabel('Скорость').fill('2');
    let s = await savedScreen(page, id, 0, (x) => x.particles?.preset === 'confetti' && x.particles?.speed === 2);
    expect(s.particles).toMatchObject({ preset: 'confetti', speed: 2, density: 0.5 });
    await sec.getByRole('checkbox', { name: 'Частицы на экране' }).uncheck();
    s = await savedScreen(page, id, 0, (x) => x.particles === undefined);
    expect(s.particles).toBeUndefined();
  });

  test('T-01 · переход на экран: вид, длительность и плавность', async ({ page }) => {
    const { id } = await seedProject(page);
    await openEditor(page, id);
    const sec = await section(page, 'screen-transition');
    await sec.getByLabel('Переход', { exact: true }).selectOption('slide');
    await sec.getByLabel('Длительность, мс').fill('900');
    await sec.getByLabel('Плавность').selectOption('spring');
    const s = await savedScreen(page, id, 0, (x) => x.transitionIn?.kind === 'slide' && x.transitionIn?.durationMs === 900 && x.transitionIn?.easing?.kind === 'spring');
    expect(s.transitionIn).toMatchObject({ kind: 'slide', durationMs: 900, easing: { kind: 'spring' } });
  });

  test('L-06 · таймер экрана с переходом по окончании: на другой экран и завершение', async ({ page }) => {
    const { id } = await seedProject(page, (d) => {
      d.screens.push({ id: 'ekran_dva', name: 'Второй', blocks: [] });
    });
    await openEditor(page, id);
    const sec = await section(page, 'screen-timer');
    await sec.getByRole('checkbox', { name: 'Ограничить время на экране' }).check();
    await sec.getByLabel('Секунд на экране').fill('20');
    await sec.getByLabel('Когда время вышло').selectOption('screen');
    await sec.getByLabel('Экран', { exact: true }).selectOption('ekran_dva');
    let s = await savedScreen(page, id, 0, (x) => x.timer?.onExpire?.screenId === 'ekran_dva');
    expect(s.timer).toEqual({ seconds: 20, onExpire: { kind: 'screen', screenId: 'ekran_dva' } });
    await sec.getByLabel('Когда время вышло').selectOption('finish');
    s = await savedScreen(page, id, 0, (x) => x.timer?.onExpire?.kind === 'finish');
    expect(s.timer).toEqual({ seconds: 20, onExpire: { kind: 'finish' } });
    await sec.getByRole('checkbox', { name: 'Ограничить время на экране' }).uncheck();
    s = await savedScreen(page, id, 0, (x) => x.timer === undefined);
    await expect(saveStatus(page)).toHaveText('Сохранено');
  });

  test('E-13 · экраны: добавить, переименовать, дублировать, переставить, удалить', async ({ page }) => {
    const { id } = await seedProject(page);
    await openEditor(page, id);
    await page.getByRole('button', { name: 'Добавить экран' }).click();
    await expect(screensList(page)).toHaveCount(2);
    await page.getByRole('button', { name: 'Дублировать' }).click();
    await expect(screensList(page)).toHaveCount(3);
    await page.getByRole('button', { name: 'Экран выше' }).click();
    await page.getByRole('button', { name: 'Удалить', exact: true }).click();
    await expect(screensList(page)).toHaveCount(2);
    await expect.poll(async () => (await serverDraft(page, id)).doc.screens.length, { timeout: 15_000 }).toBe(2);
  });
});

test('E-13 · вид панели «Экран» (снимок)', async ({ page }, info) => {
  mkdirSync('e2e/__screenshots__', { recursive: true });
  const { id } = await seedProject(page);
  await openEditor(page, id);
  for (const s of ['screen-background', 'screen-transition', 'screen-timer']) await section(page, s);
  await page.getByTestId('screen-panel').getByRole('checkbox', { name: 'Ограничить время на экране' }).check();
  await page.screenshot({ path: `e2e/__screenshots__/screens-panel-${info.project.name}.png`, fullPage: true });
});
