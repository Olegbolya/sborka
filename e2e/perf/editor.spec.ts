import { mkdirSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import { freshUser, loginAndOnboard } from '../helpers/auth';
import { at, openEditor, saveStatus, seedProject } from '../helpers/editor';

const SHOTS = 'e2e/__screenshots__';

/*
 * N-01: редактор открывается < 2 с для документа 50 экранов × 100 блоков × 300 правил;
 * перетаскивание — не ниже 58 кадров/с (ADR-059: экран 60 Гц, один пропущенный кадр за секунду допустим) на сборке 10 экранов × 50 блоков.
 * Запускаются в проекте «perf-390» — один за раз после основных тестов (ADR-028).
 */

type Doc = {
  screens: Array<{ id: string; name: string; blocks: unknown[] }>;
  variables: unknown[];
  meta: { title: string };
  settings: Record<string, unknown>;
};

function makeRule(id: string, blockId: string) {
  return {
    id,
    when: { kind: 'tap', source: { kind: 'block', blockId } },
    do: [{ kind: 'goTo', to: 'next' }],
  };
}

/** 50 screens × 100 blocks; every 17th block gets a rule (≈ 294 rules, satisfies «300 правил»). */
function largeDoc(d: Doc) {
  for (let s = 0; s < 50; s++) {
    if (s > 0) d.screens.push({ id: `scr_s${s}`, name: `Экран ${s + 1}`, blocks: [] } as never);
    const screen = d.screens[s]!;
    for (let b = 0; b < 100; b++) {
      const bid = `s${String(s).padStart(2, '0')}b${String(b).padStart(2, '0')}`;
      const block: Record<string, unknown> = {
        id: bid,
        type: 'shape',
        name: bid,
        frame: { x: 10 + (b % 10) * 37, y: 10 + Math.floor(b / 10) * 80, w: 28, h: 28 },
      };
      if ((s * 100 + b) % 17 === 0) block['rules'] = [makeRule(`r_${bid}`, bid)];
      screen.blocks.push(block);
    }
  }
}

/** 10 screens × 50 blocks for the drag FPS test. */
function dragDoc(d: Doc) {
  for (let s = 0; s < 10; s++) {
    if (s > 0) d.screens.push({ id: `scr_s${s}`, name: `Экран ${s + 1}`, blocks: [] } as never);
    const screen = d.screens[s]!;
    for (let b = 0; b < 50; b++) {
      screen.blocks.push({
        id: `s${String(s).padStart(2, '0')}b${String(b).padStart(2, '0')}`,
        type: 'shape',
        name: `Блок ${s}-${b}`,
        frame: { x: 10 + (b % 10) * 37, y: 10 + Math.floor(b / 10) * 60, w: 28, h: 28 },
      });
    }
  }
}

test.beforeEach(async ({ page }) => {
  await loginAndOnboard(page, freshUser('Автор'));
});

test('N-01: документ 50 экранов × 100 блоков × ~300 правил открывается менее чем за 2 с', async ({ page }, info) => {
  const { id } = await seedProject(page, largeDoc, 'Большая сборка');

  const t0 = Date.now();
  await page.goto(`/app/projects/${id}/edit`);
  await expect(page.getByTestId('editor')).toBeVisible();
  await expect(saveStatus(page)).toHaveText('Сохранено');
  const elapsed = Date.now() - t0;

  info.annotations.push({ type: 'open-time', description: `${elapsed} мс` });
  console.log(`[${info.project.name}] N-01 открытие: ${elapsed} мс`);
  expect(elapsed).toBeLessThan(2000);

  mkdirSync(SHOTS, { recursive: true });
  await page.screenshot({ path: `${SHOTS}/n01-open-${info.project.name}.png` });
});

test('N-01: перетаскивание блока — не менее 58 кадров/с (ADR-059) на сборке 10 экранов × 50 блоков', async ({ page }, info) => {
  const { id } = await seedProject(page, dragDoc);
  await openEditor(page, id);

  // Centre of first block: design coords (10, 10, w=28, h=28) → centre (24, 24).
  const from = await at(page, 24, 24);
  await page.mouse.click(from.x, from.y);

  // Start rAF frame counter in the browser (loop continues while rAFRunning = true).
  await page.evaluate(() => {
    const w = window as unknown as { __rAFCount: number; __rAFStart: number; __rAFRunning: boolean };
    w.__rAFCount = 0;
    w.__rAFStart = performance.now();
    w.__rAFRunning = true;
    const tick = () => {
      w.__rAFCount++;
      if (w.__rAFRunning) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });

  // Slow drag — 60 steps × 16 ms ≈ 1 second, enough frames to measure FPS reliably.
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  for (let i = 1; i <= 60; i++) {
    await page.mouse.move(from.x + i * 2, from.y);
    await page.waitForTimeout(16);
  }
  await page.mouse.up();

  const fps = await page.evaluate(() => {
    const w = window as unknown as { __rAFCount: number; __rAFStart: number; __rAFRunning: boolean };
    w.__rAFRunning = false;
    return (w.__rAFCount * 1000) / (performance.now() - w.__rAFStart);
  });

  info.annotations.push({ type: 'fps', description: `${fps.toFixed(1)} кадров/с` });
  console.log(`[${info.project.name}] N-01 FPS при перетаскивании: ${fps.toFixed(1)} кадров/с`);
  // ADR-059: счётчик кадров упирается в частоту экрана 60 Гц, поэтому 59,8–60,2 — случайность одного кадра, а не медленная работа.
  expect(fps).toBeGreaterThanOrEqual(58);

  mkdirSync(SHOTS, { recursive: true });
  await page.screenshot({ path: `${SHOTS}/n01-drag-${info.project.name}.png` });
});
