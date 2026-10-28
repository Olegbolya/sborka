import { gzipSync } from 'node:zlib';
import { expect, test, type Page } from '@playwright/test';
import { freshUser, loginAndOnboard } from '../helpers/auth';
import { nextButton, seedProject, textBlock } from '../helpers/editor';

/*
 * P5.7 · PL-19, N-02: бюджет первого экрана плеера. Считается в проекте «perf-390» (телефон SC-05) на боевой сборке:
 * JS страницы участника, сжатый gzip, ≤ 250 КБ; LCP < 2,5 с на телефоне с замедлением процессора ×4 и сетью 4G.
 * Lighthouse по тем же страницам гоняет workflow «Производительность» (lighthouse-budget.mjs).
 */
const JS_BUDGET_BYTES = 250 * 1024;
const LCP_BUDGET_MS = 2500;

type Doc = Parameters<Parameters<typeof seedProject>[1] & object>[0];

const choice = (id: string, texts: string[]) => ({
  id,
  type: 'singleChoice',
  name: 'Вопрос',
  frame: { x: 20, y: 140, w: 300, h: 60 * texts.length },
  props: { options: texts.map((_t, i) => ({ id: `${id}_o${i + 1}`, blockId: `${id}_v${i + 1}`, correct: false, score: 0 })) },
  children: texts.map((t, i) => ({ ...textBlock(`${id}_v${i + 1}`, t, 0, i * 60, 300, 50), type: 'shape' })),
});

/** Эталонные сборки для замера: простая анкета без правил и сборка с правилами (движок сценариев нужен). */
const builds: Record<string, (d: Doc) => void> = {
  'игра: 50 движущихся шариков': (d) => {
    d.screens[0]!.blocks.push(
      ...Array.from({ length: 50 }, (_, i) => ({
        id: `sharik${String(i).padStart(2, '0')}`,
        type: 'shape',
        name: `Шарик ${i + 1}`,
        frame: { x: 10 + ((i * 37) % 340), y: 10 + ((i * 53) % 700), w: 28, h: 28 },
        style: { shape: { kind: 'ellipse' } },
        behaviors: [{ kind: 'move', angle: (i * 47) % 360, speed: 80 + (i % 7) * 20, edge: 'bounce' }],
      })),
    );
  },
  'простая анкета': (d) => {
    d.screens[0]!.blocks.push(textBlock('zagolovok_1', 'Как вам занятие?', 20, 40, 300, 60), choice('vopros_1', ['Отлично', 'Хорошо', 'Так себе']));
    d.screens[0]!.blocks.push({ id: 'imya_1', type: 'textInput', name: 'Имя', frame: { x: 20, y: 360, w: 300, h: 56 }, props: {} });
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
};

async function measure(page: Page, url: string) {
  const bodies: Array<{ url: string; gzip: number }> = [];
  page.on('response', async (res) => {
    if (!/\.js(\?|$)/.test(res.url())) return;
    const body = await res.body().catch(() => null);
    if (body) bodies.push({ url: res.url(), gzip: gzipSync(body, { level: 6 }).length });
  });
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
  // «Быстрый 4G» из набора Lighthouse: 9 Мбит/с вниз, 150 мс задержки.
  await cdp.send('Network.enable');
  await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 150, downloadThroughput: (9 * 1024 * 1024) / 8, uploadThroughput: (9 * 1024 * 1024) / 8 });
  await page.addInitScript(() => {
    (window as unknown as { __lcp: number }).__lcp = 0;
    new PerformanceObserver((list) => {
      for (const e of list.getEntries()) (window as unknown as { __lcp: number }).__lcp = e.startTime;
    }).observe({ type: 'largest-contentful-paint', buffered: true });
  });
  await page.goto(url, { waitUntil: 'networkidle' });
  await expect(page.locator('.bk-player-screen[data-live="true"]')).toBeVisible();
  const lcp = await page.evaluate(() => (window as unknown as { __lcp: number }).__lcp);
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });
  return { bytes: bodies.reduce((s, b) => s + b.gzip, 0), files: bodies, lcp };
}

for (const [name, shape] of Object.entries(builds)) {
  test(`PL-19: ${name} — JS плеера ≤ 250 КБ gzip, LCP < 2,5 с`, async ({ page, browser }, info) => {
    await loginAndOnboard(page, freshUser('Автор'));
    const { id } = await seedProject(page, shape as never);
    const origin = new URL(page.url()).origin;
    expect((await page.request.post(`/api/v1/projects/${id}/publish`, { data: {}, headers: { origin } })).ok()).toBe(true);
    const { slug } = (await (await page.request.get(`/api/v1/projects/${id}`)).json()) as { slug: string };

    const ctx = await browser.newContext({ ...info.project.use, baseURL: info.project.use.baseURL! });
    const p = await ctx.newPage();
    const r = await measure(p, `/s/${slug}`);
    const kb = r.bytes / 1024;
    info.annotations.push({ type: 'js-gzip', description: `${kb.toFixed(1)} КБ` }, { type: 'lcp', description: `${r.lcp.toFixed(0)} мс` });
    console.log(`[${info.project.name}] ${name}: JS ${kb.toFixed(1)} КБ gzip в ${r.files.length} файлах, LCP ${r.lcp.toFixed(0)} мс`);
    for (const f of r.files.sort((a, b) => b.gzip - a.gzip).slice(0, 6)) console.log(`   ${(f.gzip / 1024).toFixed(1)} КБ ${f.url.replace(/^.*\/_next\//, '')}`);
    expect(r.bytes).toBeLessThanOrEqual(JS_BUDGET_BYTES);
    expect(r.lcp).toBeGreaterThan(0);
    expect(r.lcp).toBeLessThan(LCP_BUDGET_MS);
    if (name.startsWith('игра')) {
      // SC-05 в настоящем плеере: 50 движущихся объектов — не меньше 50 кадров в секунду при замедлении процессора в 4 раза.
      const cdp = await p.context().newCDPSession(p);
      await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
      await p.waitForTimeout(1000);
      const fps = await p.evaluate(
        () =>
          new Promise<number>((resolve) => {
            let frames = 0;
            const start = performance.now();
            const tick = (now: number) => {
              frames += 1;
              if (now - start < 3000) requestAnimationFrame(tick);
              else resolve((frames * 1000) / (now - start));
            };
            requestAnimationFrame(tick);
          }),
      );
      info.annotations.push({ type: 'fps', description: `${fps.toFixed(1)} кадров/с` });
      console.log(`[${info.project.name}] ${name}: ${fps.toFixed(1)} кадров/с при CPU ×4`);
      expect(fps).toBeGreaterThanOrEqual(50);
    }
    await ctx.close();
  });
}
