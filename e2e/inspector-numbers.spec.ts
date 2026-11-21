import { expect, test } from '@playwright/test';
import { freshUser, loginAndOnboard } from './helpers/auth';
import { nextButton, openEditor, seedProject } from './helpers/editor';

test.describe('E-15 · числовые поля: границы не мешают набирать', () => {
  test('E-15 · «Высота экрана» (400–5000): число набирается спокойно, вне границ пишется «Минимум»/«Максимум», на выходе из поля ставится граница', async ({ page }) => {
    await loginAndOnboard(page, freshUser('Числа'));
    const { id } = await seedProject(page);
    await openEditor(page, id);
    const field = page.getByLabel('Высота экрана', { exact: true });
    const hint = page.getByTestId('num-hint');

    // Набор числа с нуля: первая цифра меньше минимума, но поле её не заменяет.
    await field.fill('');
    await field.pressSequentially('583');
    await expect(field).toHaveValue('583');
    await expect(hint).toHaveCount(0);

    // Меньше минимума: подсказка, число не трогают, пока поле в руках.
    await field.fill('');
    await field.pressSequentially('100');
    await expect(field).toHaveValue('100');
    await expect(hint).toHaveText('Минимум 400');
    await field.press('Enter');
    await expect(field).toHaveValue('400');
    await expect(hint).toHaveText('Минимум 400: поставили 400');

    // Больше максимума.
    await field.fill('');
    await field.pressSequentially('9000');
    await expect(hint).toHaveText('Максимум 5000');
    await field.blur();
    await expect(field).toHaveValue('5000');

    // Допустимое число доходит до сборки (автосохранение).
    await field.fill('');
    await field.pressSequentially('700');
    await field.blur();
    await expect(page.getByTestId('save-status')).toHaveText('Сохранено');
    await expect(field).toHaveValue('700');
    await expect(hint).toHaveCount(0);

    // Дробное число не доходит до сборки: высота экрана — целое (иначе сервер отвечает «нужно целое число», публикация встаёт).
    await field.fill('583.1');
    await field.blur();
    await expect(field).toHaveValue('583');
    await expect(page.getByTestId('save-status')).toHaveText('Сохранено');
    await field.fill('700');
    await field.blur();
    await expect(page.getByTestId('save-status')).toHaveText('Сохранено');

    // Пояснение: 700 единиц холста шириной 390 — это 646 px на телефоне шириной 360 и 739 px на телефоне шириной 412.
    await expect(page.getByTestId('screen-height-hint')).toContainText('360\u00a0px — 646\u00a0px, 390\u00a0px — 700\u00a0px, 412\u00a0px — 739\u00a0px');
  });
});

test.describe('E-02 · предпросмотр показывает экран без лишнего поля под ним', () => {
  // ADR-128: рамка — целый телефон 390×844; низкий экран растянут до окна, как у участника (PL-16, не больше 1,5), высокий прокручивается.
  test('E-02 · рамка предпросмотра — окно телефона 390×844: экран 580 растянут до низа без полосы фона, высокий экран прокручивается', async ({ page }) => {
    await loginAndOnboard(page, freshUser('Рамка'));
    const { id } = await seedProject(page, (d) => {
      (d.screens[0] as { height?: number }).height = 580;
      d.screens[0]!.blocks.push(nextButton('knopka_0', 'Дальше', 100));
      d.screens.push({ id: 'ekran_vysokij', name: 'Высокий', height: 1200, blocks: [nextButton('knopka_1', 'Закончить', 1100)] } as never);
      (d.meta as Record<string, unknown>).description = 'Проверка рамки';
    });
    await openEditor(page, id);
    await page.getByRole('button', { name: 'Предпросмотр' }).click();
    const frame = page.getByRole('dialog', { name: 'Предпросмотр' }).locator('[data-preview="true"]');
    const scroller = frame.locator('> div').first();
    await expect(frame.locator('.bk-screen')).toBeVisible();
    // The journal of the debugger gets its lines a moment after the screen shows, and the phone is fitted to the room left: the
    // sizes are read once the frame holds still.
    const settled = () => expect.poll(async () => {
      const a = (await scroller.boundingBox())!.height;
      await page.waitForTimeout(200);
      return Math.abs((await scroller.boundingBox())!.height - a);
    }, { timeout: 5_000 }).toBe(0);
    await settled();
    // Окно телефона: ширина 390 единиц, высота 844 — в тех же пропорциях, что у телефона.
    const box = (await scroller.boundingBox())!;
    const u = box.width / 390;
    expect(Math.abs(box.height - 844 * u)).toBeLessThan(1.5);
    // Экран 580 растянут до низа окна (844 / 580 ≈ 1,46 — меньше предела 1,5): полосы фона под ним нет, прокрутки нет.
    const screen1 = (await frame.locator('.bk-screen').first().boundingBox())!;
    expect(Math.abs(screen1.y + screen1.height - (box.y + box.height))).toBeLessThan(1.5);
    expect(await scroller.evaluate((n) => n.scrollHeight - n.clientHeight)).toBeLessThanOrEqual(1);
    // Экран 1200: окно того же размера, экран прокручивается до самого низа.
    await frame.getByRole('button', { name: 'Дальше', exact: true }).click();
    await expect(frame.locator('.bk-screen[aria-label="Высокий"]')).toBeVisible();
    // The journal of the debugger grows by a line, the window gets lower and the phone is shrunk again — evenly: the proportions
    // 390×844 hold at the new scale (it is read anew, not taken from the first screen).
    await settled();
    const box2 = (await scroller.boundingBox())!;
    const h2 = box2.height;
    expect(Math.abs(h2 - 844 * (box2.width / 390))).toBeLessThan(1.5);
    expect(await scroller.evaluate((n) => n.scrollHeight)).toBeGreaterThan(h2 + 100);
  });
});
