import { writeFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { freshUser, loginAndOnboard } from './helpers/auth';
import { nextButton, seedProject, textBlock } from './helpers/editor';
import { subscribeOwner } from './helpers/plan';

/*
 * N-02 · три эталонные сборки для нагрузочного теста (`infra/load/play.js`): викторина с ключом, анкета с текстом и
 * шкалой, короткая информационная. Тест создаёт их, публикует и проходит каждую через API так же, как это делает
 * сценарий k6, — значит, сценарий нагрузки опирается на то, что работает. Адреса сборок пишутся в файл из LOAD_SLUGS_FILE.
 */
const origin = (page: Page) => new URL(page.url()).origin;
const post = (page: Page, url: string, data: unknown = {}) => page.request.post(`/api/v1${url}`, { data, headers: { origin: origin(page), 'x-blokum-csrf': '1' } });

const choice = (id: string, texts: string[], multi = false) => ({
  id,
  type: multi ? 'multiChoice' : 'singleChoice',
  name: 'Вопрос',
  frame: { x: 20, y: 120, w: 300, h: 60 * texts.length },
  props: { options: texts.map((_t, i) => ({ id: `${id}_o${i + 1}`, blockId: `${id}_v${i + 1}`, correct: i === 0, score: i === 0 ? 5 : 0, resultTags: [] })) },
  children: texts.map((t, i) => ({ ...textBlock(`${id}_v${i + 1}`, t, 0, i * 60, 300, 50), type: 'shape' })),
});

type Doc = { screens: Array<{ id: string; name: string; blocks: unknown[] }>; meta: Record<string, unknown> };
const shapes: Array<{ title: string; shape: (d: Doc) => void }> = [
  {
    title: 'Эталон: викторина',
    shape: (d) => {
      d.screens[0]!.blocks.push(textBlock('viktorina_1', 'Викторина', 20, 40, 300, 60), choice('vopros_a1', ['Верно', 'Неверно']), nextButton('dalshe_a1', 'Дальше', 330));
      d.screens.push({ id: 'ekran_a2', name: 'Второй', blocks: [choice('vopros_a2', ['Да', 'Нет', 'Не знаю']), nextButton('dalshe_a2', 'Закончить', 330)] });
    },
  },
  {
    title: 'Эталон: анкета',
    shape: (d) => {
      d.screens[0]!.blocks.push(
        textBlock('anketa_t1', 'Анкета', 20, 40, 300, 60),
        { id: 'imya_pole1', type: 'textInput', name: 'Имя', frame: { x: 20, y: 120, w: 300, h: 60 }, props: {} },
        choice('interesy_1', ['Игры', 'Тесты', 'Истории'], true),
        nextButton('dalshe_b1', 'Отправить', 420),
      );
    },
  },
  {
    title: 'Эталон: информация',
    shape: (d) => {
      d.screens[0]!.blocks.push(textBlock('privet_c1', 'Добро пожаловать', 20, 40, 300, 60), nextButton('dalshe_c1', 'Дальше', 200));
      d.screens.push({ id: 'ekran_c2', name: 'Финал', blocks: [textBlock('final_c2', 'Спасибо, что заглянули', 20, 60, 300, 60)] });
    },
  },
];

test.describe('N-02 · эталонные сборки для нагрузочного теста', () => {
  test('N-02 · три эталонные сборки публикуются и проходятся от открытия до завершения', async ({ page }) => {
    await loginAndOnboard(page, freshUser('Автор'));
    const slugs: string[] = [];
    for (const { title, shape } of shapes) {
      const { id } = await seedProject(page, shape as never, title);
      await subscribeOwner(id, 'PRO');
      expect((await post(page, `/projects/${id}/publish`)).ok()).toBe(true);
      const { slug } = (await (await page.request.get(`/api/v1/projects/${id}`)).json()) as { slug: string };
      slugs.push(slug);

      const view = (await (await page.request.get(`/api/v1/play/${slug}`)).json()) as { projectId: string; document: { screens: Array<{ id: string; blocks: Array<{ id: string; type: string; props: { options?: Array<{ id: string }> } }> }> } };
      const started = await post(page, `/play/${view.projectId}/sessions`);
      expect(started.status(), await started.text()).toBe(201);
      const { sessionId } = (await started.json()) as { sessionId: string };
      let n = 0;
      for (const screen of view.document.screens) {
        for (const block of screen.blocks) {
          const value = block.type === 'textInput' ? { kind: 'text', value: 'Нагрузка' } : block.props.options?.[0] ? { kind: 'choice', optionIds: [block.props.options[0].id] } : null;
          if (!value) continue;
          const answered = await post(page, `/play/sessions/${sessionId}/answers`, { blockId: block.id, value, clientEventId: `ref-${Date.now()}-${n++}`, clientTs: Date.now() });
          expect(answered.status(), await answered.text()).toBe(200);
        }
        const saved = await page.request.put(`/api/v1/play/sessions/${sessionId}/state`, { data: { screenId: screen.id, history: [screen.id], variables: {} }, headers: { origin: origin(page), 'x-blokum-csrf': '1' } });
        expect(saved.status(), await saved.text()).toBe(200);
      }
      const done = await post(page, `/play/sessions/${sessionId}/complete`);
      expect(done.status(), await done.text()).toBe(200);
    }
    expect(new Set(slugs).size).toBe(3);
    if (process.env.LOAD_SLUGS_FILE) writeFileSync(process.env.LOAD_SLUGS_FILE, slugs.join(','));
  });
});
