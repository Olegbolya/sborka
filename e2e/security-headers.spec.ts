import { expect, test, type Page } from '@playwright/test';
import { freshUser, loginAndOnboard } from './helpers/auth';
import { nextButton, openEditor, seedProject, textBlock } from './helpers/editor';

/*
 * P9.4 · N-04, docs/02-ARCHITECTURE.md §8 п. 2: заголовки безопасности на каждой странице и ни одного нарушения политики
 * (скрипты, стили, картинки, анимации, редактор работают под строгим CSP).
 */
const watch = async (page: Page) => {
  const problems: string[] = [];
  page.on('console', (m) => {
    if (/Content Security Policy|Refused to/i.test(m.text())) problems.push(m.text());
  });
  await page.addInitScript(() => {
    document.addEventListener('securitypolicyviolation', (e) => {
      console.error(`Refused to load by CSP: ${e.violatedDirective} ${e.blockedURI} ${e.sourceFile}:${e.lineNumber} ${e.sample}`);
    });
  });
  return problems;
};

const headersOf = async (page: Page, url: string) => {
  const res = await page.goto(url);
  expect(res?.status(), url).toBeLessThan(400);
  return res!.headers();
};

test.describe('P9.4 · заголовки безопасности и CSP', () => {
  test('N-04 · строгая политика: скрипты только с nonce запроса, без unsafe-eval, ни одного inline-скрипта без nonce', async ({ page }) => {
    const problems = await watch(page);
    const h = await headersOf(page, '/login');
    const csp = h['content-security-policy']!;
    expect(csp).toContain("default-src 'self'");
    expect(csp).toMatch(/script-src [^;]*'nonce-[A-Za-z0-9+/=]+'/);
    expect(csp).not.toMatch(/script-src[^;]*'unsafe-eval'/);
    expect(csp).not.toMatch(/script-src[^;]*'unsafe-inline'/);
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("object-src 'none'");
    expect(h['x-content-type-options']).toBe('nosniff');
    // ASVS V8.2.1, V14.3.3: страница не кэшируется и не называет сервер.
    expect(h['cache-control']).toContain('no-store');
    expect(h['x-powered-by']).toBeUndefined();
    expect(h['referrer-policy']).toBe('strict-origin-when-cross-origin');
    expect(h['permissions-policy']).toContain('camera=()');
    expect(h['permissions-policy']).toContain('accelerometer=()');
    const nonce = /'nonce-([^']+)'/.exec(csp)![1]!;
    // Каждый скрипт страницы несёт nonce этого запроса.
    const scripts = await page.locator('script:not([src])').evaluateAll((els) => els.map((e) => (e as HTMLScriptElement).nonce));
    expect(scripts.length).toBeGreaterThan(0);
    for (const n of scripts) expect(n).toBe(nonce);
    // Запрос и ответ другого запроса — другой nonce.
    const second = (await headersOf(page, '/login'))['content-security-policy']!;
    expect(/'nonce-([^']+)'/.exec(second)![1]).not.toBe(nonce);
    expect(problems).toEqual([]);
  });

  test('N-04 · страницы сайта, кабинета, редактора и плеера открываются под политикой без нарушений; датчики движения — только у плеера', async ({ page, browser }, info) => {
    await loginAndOnboard(page, freshUser('Автор'));
    const problems = await watch(page);
    const { id } = await seedProject(page, (d) => {
      d.screens[0]!.blocks.push(textBlock('zagolovok_1', 'Проверка заголовков', 20, 40, 300, 60), nextButton('dalshe_1', 'Дальше', 200));
      d.screens.push({ id: 'ekran_dva', name: 'Второй', blocks: [textBlock('vtoroj_t', 'Второй экран', 20, 60, 300, 60)] });
    });
    const origin = new URL(page.url()).origin;
    expect((await page.request.post(`/api/v1/projects/${id}/publish`, { data: {}, headers: { origin } })).ok()).toBe(true);
    const { slug } = (await (await page.request.get(`/api/v1/projects/${id}`)).json()) as { slug: string };

    for (const url of ['/', '/account', '/cabinet/projects', `/cabinet/projects/${id}`, '/app/themes', '/legal/terms']) {
      const h = await headersOf(page, url);
      expect(h['content-security-policy'], url).toBeTruthy();
      expect(h['permissions-policy'], url).toContain('accelerometer=()');
      await page.waitForLoadState('networkidle');
    }

    await page.goto(`/app/projects/${id}/edit`);
    await openEditor(page, id);

    const visitor = await browser.newContext({ baseURL: info.project.use.baseURL!, locale: 'ru-RU' });
    const v = await visitor.newPage();
    const visitorProblems = await watch(v);
    const h = await headersOf(v, `/s/${slug}`);
    expect(h['permissions-policy']).toContain('accelerometer=(self)');
    await expect(v.locator('.bk-player-screen[data-live="true"]')).toBeVisible();
    await v.getByRole('button', { name: 'Дальше' }).click();
    await expect(v.getByText('Второй экран')).toBeVisible();
    await v.goto('/dev/render-gallery');
    await v.locator('[data-block-id="zhivoi-animation"]').scrollIntoViewIfNeeded();
    await expect.poll(() => v.locator('[data-block-id="zhivoi-animation"] canvas').count()).toBeGreaterThan(0);
    expect(visitorProblems).toEqual([]);
    expect(problems).toEqual([]);
    await visitor.close();
  });
});
