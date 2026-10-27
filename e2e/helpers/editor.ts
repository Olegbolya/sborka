import { expect, type Page } from '@playwright/test';

/** Minimal block literals: the server fills in every default. Identifiers have at least six characters. */
export const textBlock = (id: string, name: string, x = 20, y = 40, w = 160, h = 48) => ({
  id,
  type: 'text',
  name,
  frame: { x, y, w, h },
  textLayer: { paragraphs: [{ kind: 'p', runs: [{ t: name }] }] },
});

export const nextButton = (id: string, name = 'Дальше', y = 300) => ({
  id,
  type: 'button',
  name,
  frame: { x: 95, y, w: 200, h: 56 },
  textLayer: { paragraphs: [{ kind: 'p', runs: [{ t: name }] }] },
  rules: [{ id: `${id}_pravilo`, when: { kind: 'tap', source: { kind: 'block', blockId: id } }, do: [{ kind: 'goTo', to: 'next' }] }],
});

export interface SeedProject {
  id: string;
  revision: number;
}

type Doc = { screens: Array<{ id: string; name: string; blocks: unknown[] }>; variables: unknown[]; meta: { title: string }; settings: Record<string, unknown> };

/** Creates a project through the API and puts the given content in its draft (the page must be signed in). */
export async function seedProject(page: Page, shape: (doc: Doc) => void = () => undefined, title = 'Сборка для проверки'): Promise<SeedProject> {
  const origin = new URL(page.url()).origin;
  const created = await page.request.post('/api/v1/projects', { data: { title }, headers: { origin } });
  expect(created.ok()).toBe(true);
  const project = (await created.json()) as { id: string; draftVersionNumber: number; document: Doc };
  shape(project.document);
  const saved = await page.request.put(`/api/v1/projects/${project.id}/draft`, {
    data: { document: project.document },
    headers: { origin, 'if-match': String(project.draftVersionNumber) },
  });
  expect(saved.ok(), await saved.text()).toBe(true);
  return { id: project.id, revision: ((await saved.json()) as { revision: number }).revision };
}

export async function serverDraft(page: Page, id: string): Promise<{ revision: number; doc: Doc }> {
  const res = await page.request.get(`/api/v1/projects/${id}`);
  const body = (await res.json()) as { draftVersionNumber: number; document: Doc };
  return { revision: body.draftVersionNumber, doc: body.document };
}

export async function openEditor(page: Page, id: string): Promise<void> {
  await page.goto(`/app/projects/${id}/edit`);
  await expect(page.getByTestId('editor')).toBeVisible();
  await expect(page.getByTestId('save-status')).toHaveText('Сохранено');
}

export const stage = (page: Page) => page.getByTestId('stage');
export const hit = (page: Page, name: string) => stage(page).getByRole('button', { name, exact: true });
export const saveStatus = (page: Page) => page.getByTestId('save-status');
export const screensList = (page: Page) => page.getByRole('list', { name: 'Экраны' }).getByRole('listitem');

export interface Geometry {
  left: number;
  top: number;
  unit: number;
}

/** Where the artboard is on the page and how many pixels one unit takes now. */
export async function geometry(page: Page): Promise<Geometry> {
  const st = stage(page);
  await st.scrollIntoViewIfNeeded();
  const box = (await st.boundingBox())!;
  return { left: box.x, top: box.y, unit: Number(await st.getAttribute('data-unit')) };
}

/** Page coordinates of a point of the artboard. */
export async function at(page: Page, x: number, y: number): Promise<{ x: number; y: number }> {
  const g = await geometry(page);
  return { x: g.left + x * g.unit, y: g.top + y * g.unit };
}

export async function blockCenter(page: Page, name: string): Promise<{ x: number; y: number }> {
  await hit(page, name).scrollIntoViewIfNeeded();
  const b = (await hit(page, name).boundingBox())!;
  return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
}

/** Frame of a block as the inspector shows it (the block must be the only one selected). */
export async function frameFields(page: Page): Promise<{ x: number; y: number; w: number; h: number; rotation: number }> {
  const read = async (label: string) => Number(await page.getByLabel(label, { exact: true }).inputValue());
  return { x: await read('X'), y: await read('Y'), w: await read('Ширина'), h: await read('Высота'), rotation: await read('Поворот') };
}

export async function snapOff(page: Page): Promise<void> {
  const b = page.getByRole('button', { name: 'Прилипание' });
  if ((await b.getAttribute('aria-pressed')) === 'true') await b.click();
}

/** Drags with the mouse in steps; `hold` leaves the button pressed so the test can look at the guides. */
export async function drag(page: Page, from: { x: number; y: number }, to: { x: number; y: number }, opts: { modifiers?: Array<'Shift' | 'Alt' | 'Control'>; late?: Array<'Shift' | 'Alt' | 'Control'>; hold?: boolean; steps?: number } = {}): Promise<void> {
  for (const m of opts.modifiers ?? []) await page.keyboard.down(m);
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  // A key pressed after the button is down changes the gesture (Shift on a drag keeps the axis); before it, Shift would add to the selection.
  for (const m of opts.late ?? []) await page.keyboard.down(m);
  await page.mouse.move(to.x, to.y, { steps: opts.steps ?? 8 });
  if (!opts.hold) {
    await page.mouse.up();
    for (const m of [...(opts.late ?? []), ...(opts.modifiers ?? [])]) await page.keyboard.up(m);
  }
}

export async function release(page: Page, modifiers: Array<'Shift' | 'Alt' | 'Control'> = []): Promise<void> {
  await page.mouse.up();
  for (const m of modifiers) await page.keyboard.up(m);
}

export const box = (id: string, name: string, x: number, y: number, w = 100, h = 60) => ({
  id,
  type: 'shape',
  name,
  frame: { x, y, w, h },
});

/** Centre of a handle of the selection box, read when it has stopped moving (it follows the block after a change). */
export async function handleAt(page: Page, name: string): Promise<{ x: number; y: number }> {
  const read = async () => {
    const b = (await page.locator(`[data-handle="${name}"]`).boundingBox())!;
    return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
  };
  let last = await read();
  for (let i = 0; i < 20; i++) {
    await page.waitForTimeout(60);
    const now = await read();
    if (now.x === last.x && now.y === last.y) return now;
    last = now;
  }
  return last;
}
