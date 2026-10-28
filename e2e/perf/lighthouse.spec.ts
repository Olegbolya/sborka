import { chromium } from '@playwright/test';
import { expect, test } from '@playwright/test';
import { freshUser, loginAndOnboard } from '../helpers/auth';
import { nextButton, seedProject, textBlock } from '../helpers/editor';

/*
 * P5.7 · PL-19: Lighthouse по страницам участника — Performance ≥ 85 на телефоне с замедлением Lighthouse по умолчанию
 * («Slow 4G», процессор ×4), LCP < 2,5 с. Браузер запускается отдельно, с портом отладки; Lighthouse подключается к нему.
 */
const SCORE_BUDGET = 85;
const LCP_BUDGET_MS = 2500;
const DEBUG_PORT = 9333;

type Doc = Parameters<NonNullable<Parameters<typeof seedProject>[1]>>[0];

const builds: Record<string, (d: Doc) => void> = {
  'простая анкета': (d) => {
    const options = ['Отлично', 'Хорошо', 'Так себе'];
    d.screens[0]!.blocks.push(textBlock('zagolovok_1', 'Как вам занятие?', 20, 40, 300, 60), {
      id: 'vopros_1',
      type: 'singleChoice',
      name: 'Вопрос',
      frame: { x: 20, y: 140, w: 300, h: 180 },
      props: { options: options.map((_t, i) => ({ id: `vopros_1_o${i + 1}`, blockId: `vopros_1_v${i + 1}`, correct: false, score: 0 })) },
      children: options.map((t, i) => ({ ...textBlock(`vopros_1_v${i + 1}`, t, 0, i * 60, 300, 50), type: 'shape' })),
    } as never);
    d.screens[0]!.blocks.push({ id: 'imya_1', type: 'textInput', name: 'Имя', frame: { x: 20, y: 360, w: 300, h: 56 }, props: {} } as never);
  },
  'сборка с правилами и переходами': (d) => {
    d.variables.push({ id: 'ochki_var', name: 'очки', type: 'number', initial: 0, saveToAnswers: false });
    d.screens[0]!.blocks.push(
      textBlock('zagolovok_1', 'Поймай подарок', 20, 40, 300, 60),
      { ...nextButton('plyus_1', 'Плюс', 200), rules: [{ id: 'plyus_pravilo', when: { kind: 'tap', source: { kind: 'block', blockId: 'plyus_1' } }, do: [{ kind: 'setVariable', variableId: 'ochki_var', op: 'add', value: 1 }] }] },
      nextButton('dalshe_1', 'Дальше', 300),
    );
    d.screens.push({ id: 'ekran_dva', name: 'Второй', blocks: [textBlock('vtoroj_t', 'Конец', 20, 60, 300, 60)] });
  },
  'игра: 50 движущихся шариков': (d) => {
    d.screens[0]!.blocks.push(
      ...Array.from({ length: 50 }, (_, i) => ({
        id: `sharik${String(i).padStart(2, '0')}`,
        type: 'shape',
        name: `Шарик ${i + 1}`,
        frame: { x: 10 + ((i * 37) % 340), y: 10 + ((i * 53) % 700), w: 28, h: 28 },
        style: { shape: { kind: 'ellipse' } },
        behaviors: [{ kind: 'move', angle: (i * 47) % 360, speed: 80 + (i % 7) * 20, edge: 'bounce' }],
      })) as never[],
    );
  },
};

for (const [name, shape] of Object.entries(builds)) {
  test(`PL-19: Lighthouse · ${name} — Performance ≥ 85, LCP < 2,5 с`, async ({ page }, info) => {
    test.setTimeout(180_000);
    await loginAndOnboard(page, freshUser('Автор'));
    const { id } = await seedProject(page, shape as never);
    const origin = new URL(page.url()).origin;
    expect((await page.request.post(`/api/v1/projects/${id}/publish`, { data: {}, headers: { origin } })).ok()).toBe(true);
    const { slug } = (await (await page.request.get(`/api/v1/projects/${id}`)).json()) as { slug: string };

    const browser = await chromium.launch({ args: [`--remote-debugging-port=${DEBUG_PORT}`], ...(process.env.PW_CHROMIUM_PATH ? { executablePath: process.env.PW_CHROMIUM_PATH } : {}) });
    try {
      const { default: lighthouse } = await import('lighthouse');
      const result = await lighthouse(`${origin}/s/${slug}`, { port: DEBUG_PORT, output: 'json', logLevel: 'error', onlyCategories: ['performance'], formFactor: 'mobile', screenEmulation: { mobile: true, width: 390, height: 844, deviceScaleFactor: 2, disabled: false } });
      const lhr = result!.lhr;
      const score = Math.round((lhr.categories.performance!.score ?? 0) * 100);
      const lcp = lhr.audits['largest-contentful-paint']!.numericValue ?? Infinity;
      info.annotations.push({ type: 'lighthouse', description: `Performance ${score}, LCP ${lcp.toFixed(0)} мс` });
      console.log(`[${info.project.name}] Lighthouse · ${name}: Performance ${score}, LCP ${lcp.toFixed(0)} мс`);
      expect(score).toBeGreaterThanOrEqual(SCORE_BUDGET);
      expect(lcp).toBeLessThan(LCP_BUDGET_MS);
    } finally {
      await browser.close();
    }
  });
}
