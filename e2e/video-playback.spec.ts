import { expect, test } from '@playwright/test';
import { freshUser, loginAndOnboard } from './helpers/auth';
import { nextButton, openEditor, openTab, seedProject, serverDraft } from './helpers/editor';

test.describe('B-04 · видео: звук и повтор в свойствах блока', () => {
  test('B-04 · у видео «Воспроизведение» в свойствах: звук включён по умолчанию, «Без звука», «По кругу», «Кнопка «Ещё раз»» сохраняются', async ({ page }) => {
    await loginAndOnboard(page, freshUser('Видео'));
    const { id } = await seedProject(page, (d) => {
      d.screens[0]!.blocks.push({ id: 'video_blok', type: 'video', name: 'Ролик', frame: { x: 20, y: 40, w: 350, h: 200 } }, nextButton('knopka_v', 'Дальше', 300));
    });
    await openEditor(page, id);
    await openTab(page, 'Слои');
    await page.getByRole('list', { name: 'Слои' }).getByRole('button', { name: 'Ролик', exact: true }).click();
    await openTab(page, 'Содержимое');
    const props = page.getByTestId('props-inspector');
    const play = props.locator('[data-section="playback"]');
    await expect(play.getByLabel('Без звука', { exact: true })).not.toBeChecked(); // звук включён по умолчанию
    await expect(play.getByLabel('По кругу', { exact: true })).toBeChecked();
    await expect(play.getByLabel('Кнопка «Ещё раз» в конце', { exact: true })).not.toBeChecked();

    const media = async () => {
      const doc = (await serverDraft(page, id)).doc as unknown as { screens: Array<{ blocks: Array<{ id: string; style: { media?: Record<string, unknown> } }> }> };
      return doc.screens[0]!.blocks.find((b) => b.id === 'video_blok')!.style.media ?? {};
    };
    await play.getByLabel('Без звука', { exact: true }).check();
    await expect.poll(async () => (await media()).muted).toBe(true);
    await play.getByLabel('Без звука', { exact: true }).uncheck();
    await expect.poll(async () => (await media()).muted).toBe(false);
    await play.getByLabel('По кругу', { exact: true }).uncheck();
    await expect.poll(async () => (await media()).loop).toBe(false);
    await play.getByLabel('Кнопка «Ещё раз» в конце', { exact: true }).check();
    await expect.poll(async () => (await media()).replayButton).toBe(true);
    await expect(play.getByLabel('Без звука', { exact: true })).not.toBeChecked();

    // В «Оформление» → «Медиа» те же настройки (S-00: у каждого ключа схемы есть контрол).
    await openTab(page, 'Оформление');
    const section = page.locator('[data-section="media"]');
    await section.locator('summary').click();
    await expect(section.getByLabel('Без звука', { exact: true })).not.toBeChecked();
    await expect(section.getByLabel('По кругу', { exact: true })).not.toBeChecked();
  });
});
