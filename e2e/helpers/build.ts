import { expect, type Locator, type Page } from '@playwright/test';
import { hit, openTab } from './editor';

/* Общие приёмы сборки игр через интерфейс редактора (P3.12, P6.8, P6.9). */
export type BlockKind = 'text' | 'button' | 'shape' | 'zone' | 'timer' | 'value';

export async function addBlock(page: Page, type: BlockKind, name: string, frame: { x: number; y: number; w: number; h: number }, text?: string): Promise<void> {
  await openTab(page, 'Добавить');
  await page.locator(`[data-add-type="${type}"]`).click();
  await openTab(page, 'Содержимое');
  await page.getByLabel('Название блока').fill(name);
  if (text !== undefined) {
    if ((await page.getByRole('textbox', { name: 'Текст блока' }).count()) === 0) await page.getByRole('button', { name: 'Добавить текст' }).click();
    const field = page.getByRole('textbox', { name: 'Текст блока' });
    await field.click();
    await page.keyboard.press('Control+A');
    await page.keyboard.type(text);
  }
  await openTab(page, 'Оформление');
  for (const [label, value] of [['X', frame.x], ['Y', frame.y], ['Ширина', frame.w], ['Высота', frame.h]] as const) await page.getByLabel(label, { exact: true }).fill(String(value));
}

export const selectBlock = async (page: Page, name: string) => {
  await hit(page, name).click();
  await openTab(page, 'Сценарии');
};
export const rule = (page: Page, n: number): Locator => page.locator('[data-rule]').nth(n);
export const openRule = async (page: Page, n: number) => {
  const r = rule(page, n);
  if ((await r.getByRole('group', { name: 'Когда' }).count()) === 0) await r.getByRole('button', { name: new RegExp(`^Правило ${n + 1}`) }).click();
  return r;
};
export const newScreen = async (page: Page) => {
  await openTab(page, 'Экраны');
  await page.getByRole('button', { name: 'Добавить экран' }).click();
};
export const player = async (page: Page) => {
  await page.getByRole('button', { name: 'Предпросмотр' }).click();
  const dialog = page.getByRole('dialog', { name: 'Предпросмотр' });
  const frame = dialog.locator('[data-preview="true"]');
  await expect(frame.locator('.bk-player-screen[data-live="true"]')).toBeVisible();
  return { dialog, frame, blk: (id: string) => frame.locator(`[data-block-id="${id}"]`) };
};

/** The id of the block with the given name on the screen of the preview (ids are made by the editor, not known in advance). */
export async function selectedId(g: { frame: Locator }, name: string): Promise<string> {
  const id = await g.frame.locator('[data-block-id]', { hasText: name }).first().getAttribute('data-block-id');
  return id!;
}
