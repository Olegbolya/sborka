import { expect, test, type Locator, type Page } from '@playwright/test';
import { freshUser, loginAndOnboard } from './helpers/auth';
import { createBlock } from '../packages/schema/dist/index.js';
import { collapsePanels, ensurePanel, openEditor, openTab, saveStatus, seedProject, serverDraft } from './helpers/editor';

/**
 * E-21 · Перо, карандаш, редактирование узлов.
 * Acceptance: pen draws closed shape with 6 nodes, node edit, fill + stroke.
 */
/** A group of the right panel, opened. */
const section = async (page: Page, id: string): Promise<Locator> => {
  const s = page.locator(`[data-section="${id}"]`);
  await s.scrollIntoViewIfNeeded();
  if ((await s.getAttribute('open')) === null) await s.locator('summary').click();
  return s;
};

test.describe('E-21 · Перо и редактирование узлов', () => {
  test.beforeEach(async ({ page }) => {
    await loginAndOnboard(page, freshUser('Автор'));
  });

  test('E-21 · перо — замкнутая форма из 6 узлов, редактирование узла, заливка, обводка', async ({ page }) => {
    const { id } = await seedProject(page, undefined, 'Тест пера');
    await openEditor(page, id);

    // Click the pen tool
    await page.getByTestId('tool-pen').click();
    await expect(page.getByTestId('tool-pen')).toHaveAttribute('aria-pressed', 'true');

    await collapsePanels(page);
    const stage = page.getByTestId('stage');
    const stageBox = await stage.boundingBox();
    expect(stageBox).not.toBeNull();

    // Click 6 anchor nodes on the stage
    const nodes = [
      { x: 0.2, y: 0.2 },
      { x: 0.5, y: 0.1 },
      { x: 0.8, y: 0.2 },
      { x: 0.8, y: 0.6 },
      { x: 0.5, y: 0.7 },
      { x: 0.2, y: 0.6 },
    ];
    for (const { x, y } of nodes) {
      await stage.click({ position: { x: stageBox!.width * x, y: stageBox!.height * y } });
    }

    // Enter closes the contour: one shape block appears with a closed path of exactly 6 nodes
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('pen-overlay')).toHaveCount(0);
    await expect(page.getByTestId('selection-box')).toBeVisible();
    const shapeOf = async () => {
      await expect(saveStatus(page)).toHaveText('Сохранено');
      const blocks = (await serverDraft(page, id)).doc.screens[0]!.blocks as Array<{ type: string; style: { shape: { kind: string; d: string; closed: boolean }; fills?: unknown[]; stroke?: { width?: number } } }>;
      expect(blocks).toHaveLength(1);
      expect(blocks[0]!.type).toBe('shape');
      return blocks[0]!.style;
    };
    const drawn = await shapeOf();
    expect(drawn.shape.kind).toBe('path');
    expect(drawn.shape.closed).toBe(true);
    const nodeCount = (d: string) => (d.match(/[MLC]/gi) ?? []).length;
    expect(nodeCount(drawn.shape.d)).toBe(6);

    // A double click on the shape enters node editing; dragging node 3 changes the contour but keeps 6 nodes
    const selBounds = (await page.getByTestId('selection-box').boundingBox())!;
    await page.mouse.dblclick(selBounds.x + selBounds.width / 2, selBounds.y + selBounds.height / 2);
    await expect(page.getByTestId('node-editor')).toBeVisible();
    await page.getByTestId('node-3').scrollIntoViewIfNeeded();
    const node0 = (await page.getByTestId('node-3').boundingBox())!;
    await page.mouse.move(node0.x + node0.width / 2, node0.y + node0.height / 2);
    await page.mouse.down();
    await page.mouse.move(node0.x + node0.width / 2 + 24, node0.y + node0.height / 2 + 12, { steps: 4 });
    await page.mouse.up();
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('node-editor')).toHaveCount(0);
    await expect.poll(async () => ((await serverDraft(page, id)).doc.screens[0]!.blocks[0] as { style: { shape: { d: string } } }).style.shape.d, { timeout: 15_000 }).not.toBe(drawn.shape.d);
    const edited = await shapeOf();
    expect(nodeCount(edited.shape.d)).toBe(6);

    // Fill and stroke are set in the inspector and land in the document
    await page.getByTestId('tool-select').click();
    // Escape leaves node editing and drops the selection: the shape is picked again in the layers
    await openTab(page, 'Слои');
    await page.getByRole('list', { name: 'Слои' }).getByRole('button', { name: createBlock('shape').name, exact: true }).click();
    await ensurePanel(page, 'right');
    await openTab(page, 'Оформление');
    const fills = await section(page, 'fills');
    await fills.getByRole('button', { name: 'Добавить' }).click();
    await fills.getByLabel('Цвет: источник').selectOption('hex');
    await fills.getByLabel('Цвет: HEX').fill('#00aa55');
    const stroke = await section(page, 'stroke');
    const width = stroke.getByLabel('Толщина', { exact: true });
    await width.fill('4');
    await expect(width).toHaveValue('4');
    const styled = await shapeOf();
    expect(JSON.stringify(styled.fills)).toContain('#00aa55');
    expect(styled.stroke?.width).toBe(4);
    expect(styled.shape.d).toBe(edited.shape.d);
  });
});
