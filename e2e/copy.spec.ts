import { expect, test } from '@playwright/test';
import { freshUser, loginAndOnboard } from './helpers/auth';
import { ensurePanel, hit, openEditor, screensList, seedProject, serverDraft, textBlock } from './helpers/editor';

test.describe('E-08 · копирование с содержимым', () => {
  test('E-08 · кнопки «Копировать экран» и «Вставить экран» переносят экран со всеми блоками', async ({ page }) => {
    await loginAndOnboard(page, freshUser('Автор'));
    const { id } = await seedProject(page, (d) => {
      d.screens[0]!.blocks.push(textBlock('zagolovok_1', 'Заголовок'));
    });
    await openEditor(page, id);
    await ensurePanel(page, 'left');
    await page.getByRole('button', { name: 'Копировать экран' }).click();
    await page.getByRole('button', { name: 'Вставить экран' }).click();
    await expect(screensList(page)).toHaveCount(2);
    await expect.poll(async () => (await serverDraft(page, id)).doc.screens.length, { timeout: 15_000 }).toBe(2);
    const doc = (await serverDraft(page, id)).doc as { screens: Array<{ blocks: Array<{ id: string }> }> };
    expect(doc.screens[1]!.blocks).toHaveLength(1);
    expect(doc.screens[1]!.blocks[0]!.id).not.toBe(doc.screens[0]!.blocks[0]!.id);
  });

  test('E-08 · кнопки «Копировать» и «Вставить» в свойствах блока копируют блок', async ({ page }) => {
    await loginAndOnboard(page, freshUser('Автор'));
    const { id } = await seedProject(page, (d) => {
      d.screens[0]!.blocks.push(textBlock('zagolovok_1', 'Заголовок'));
    });
    await openEditor(page, id);
    await hit(page, 'Заголовок').click();
    await ensurePanel(page, 'right');
    await page.getByRole('button', { name: 'Копировать', exact: true }).click();
    await page.getByRole('button', { name: 'Вставить', exact: true }).click();
    await expect.poll(async () => (await serverDraft(page, id)).doc.screens[0]!.blocks.length, { timeout: 15_000 }).toBe(2);
  });
});

test('E-08 · панель экранов с новыми кнопками помещается на экране', async ({ page }, info) => {
  await loginAndOnboard(page, freshUser('Автор'));
  const { id } = await seedProject(page);
  await openEditor(page, id);
  await ensurePanel(page, 'left');
  await expect(page.getByRole('button', { name: 'Копировать экран' })).toBeVisible();
  await page.screenshot({ path: `e2e/__screenshots__/copy-screen-${info.project.name}.png` });
});
