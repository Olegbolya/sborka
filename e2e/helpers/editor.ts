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
