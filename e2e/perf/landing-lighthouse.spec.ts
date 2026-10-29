import { type ChildProcess, spawn } from 'node:child_process';
import { chromium } from '@playwright/test';
import { expect, test } from '@playwright/test';

/*
 * P10.1: Lighthouse по страницам сайта на телефоне (замедление по умолчанию) — каждая из четырёх категорий не ниже 90.
 * Сайт закрыт от поиска до запуска, а категория «SEO» требует открытой страницы, поэтому проверяется отдельная копия сервера
 * с включённым SITE_INDEXABLE=1 (так владелец откроет сайт при запуске).
 */
const BUDGET = 90;
const DEBUG_PORT = 9334;
const SITE_PORT = Number(process.env.E2E_WEB_PORT ?? 3110) + 7;
const PAGES = ['/', '/tariffs', '/examples', '/help'];

let server: ChildProcess;

test.beforeAll(async () => {
  server = spawn('pnpm', ['--filter', '@blokum/web', 'exec', 'next', 'start', '--port', String(SITE_PORT), '--hostname', '127.0.0.1'], {
    env: { ...process.env, SITE_INDEXABLE: '1', NEXT_TELEMETRY_DISABLED: '1', API_PORT: process.env.API_PORT ?? '3100' },
    stdio: 'ignore',
  });
  const deadline = Date.now() + 60_000;
  for (;;) {
    try {
      if ((await fetch(`http://127.0.0.1:${SITE_PORT}/healthz`)).ok) break;
    } catch {
      // not up yet
    }
    if (Date.now() > deadline) throw new Error('сервер для Lighthouse не запустился');
    await new Promise((r) => setTimeout(r, 500));
  }
});
test.afterAll(() => {
  server?.kill('SIGTERM');
});

for (const path of PAGES) {
  test(`P10.1: Lighthouse · ${path} — все категории ≥ ${BUDGET} на телефоне`, async ({}, info) => {
    test.setTimeout(180_000);
    const browser = await chromium.launch({ args: [`--remote-debugging-port=${DEBUG_PORT}`], ...(process.env.PW_CHROMIUM_PATH ? { executablePath: process.env.PW_CHROMIUM_PATH } : {}) });
    try {
      const { default: lighthouse } = await import('lighthouse');
      const result = await lighthouse(`http://127.0.0.1:${SITE_PORT}${path}`, {
        port: DEBUG_PORT,
        output: 'json',
        logLevel: 'error',
        onlyCategories: ['performance', 'accessibility', 'best-practices', 'seo'],
        formFactor: 'mobile',
        screenEmulation: { mobile: true, width: 390, height: 844, deviceScaleFactor: 2, disabled: false },
      });
      const cats = result!.lhr.categories;
      const scores = Object.fromEntries(Object.entries(cats).map(([k, v]) => [k, Math.round((v.score ?? 0) * 100)]));
      const failed = Object.values(result!.lhr.audits)
        .filter((a) => a.score !== null && a.score < 0.9 && a.scoreDisplayMode !== 'informative' && a.scoreDisplayMode !== 'notApplicable' && a.scoreDisplayMode !== 'manual')
        .map((a) => `${a.id}=${a.score}`)
        .slice(0, 12);
      info.annotations.push({ type: 'lighthouse', description: JSON.stringify(scores) });
      console.log(`[${info.project.name}] Lighthouse ${path}: ${JSON.stringify(scores)} · слабые проверки: ${failed.join(', ')}`);
      for (const [name, score] of Object.entries(scores)) expect(score, `${path}: ${name}`).toBeGreaterThanOrEqual(BUDGET);
    } finally {
      await browser.close();
    }
  });
}
