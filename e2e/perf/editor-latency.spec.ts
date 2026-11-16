import { expect, test } from '@playwright/test';
import { freshUser, loginAndOnboard } from '../helpers/auth';
import { at, openEditor, seedProject, textBlock } from '../helpers/editor';

/*
 * N-01 · задержка редактора: от движения мыши до следующего кадра при перетаскивании и от нажатия клавиши до кадра при вводе
 * в поле свойств. Процессор замедлен в 4 раза (обычный ноутбук). Сборка — 5 экранов × 30 блоков разных типов.
 */
type Doc = { screens: Array<{ id: string; name: string; blocks: unknown[] }> };

function realisticDoc(d: Doc) {
  for (let s = 0; s < 5; s++) {
    if (s > 0) d.screens.push({ id: `scr_s${s}`, name: `Экран ${s + 1}`, blocks: [] } as never);
    const screen = d.screens[s]!;
    for (let b = 0; b < 30; b++) {
      const id = `blok_s${s}b${String(b).padStart(2, "0")}`;
      const x = 10 + (b % 3) * 125;
      const y = 10 + Math.floor(b / 3) * 70;
      screen.blocks.push(b % 2 === 0 ? textBlock(id, `Текст ${s}-${b}`, x, y, 110, 50) : { id, type: 'shape', name: `Фигура ${s}-${b}`, frame: { x, y, w: 110, h: 50 } });
    }
  }
}

/** Starts counting: after each input event, the time until the next frame is painted. */
async function startProbe(page: import('@playwright/test').Page, kind: 'pointermove' | 'input') {
  await page.evaluate((k) => {
    const w = window as unknown as { __lat: number[] };
    w.__lat = [];
    window.addEventListener(
      k,
      () => {
        const t0 = performance.now();
        requestAnimationFrame(() => setTimeout(() => w.__lat.push(performance.now() - t0), 0));
      },
      { capture: true },
    );
  }, kind);
}

const stats = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  return { n: s.length, median: s[Math.floor(s.length / 2)]!, p95: s[Math.floor(s.length * 0.95)]!, max: s[s.length - 1]! };
};

// Запись трассировки снимает страницу на каждом движении мыши и сама даёт задержку: в замере её нет.
test.use({ trace: 'off' });

/** With a profiling build (`next build --profile`) React reports how long each part of the editor took to draw. */
async function hookReact(page: import('@playwright/test').Page) {
  await page.addInitScript(() => {
    const parts = { left: 0, canvas: 0, right: 0, top: 0, commits: 0 };
    (window as unknown as { __parts: typeof parts }).__parts = parts;
    type Fiber = { tag: number; stateNode: unknown; actualDuration?: number; child: Fiber | null; sibling: Fiber | null; alternate: Fiber | null };
    const walk = (f: Fiber | null) => {
      for (let n = f; n; n = n.sibling) {
        const el = n.stateNode as HTMLElement | null;
        if (n.tag === 5 && el && typeof el.className === 'string') {
          const c = el.className;
          // Rendered in this commit: the duration is counted once per part.
          if (c === 'ed-panel left' || c.startsWith('ed-panel left')) { parts.left += n.actualDuration ?? 0; continue; }
          if (c === 'ed-center') { parts.canvas += n.actualDuration ?? 0; continue; }
          if (c.startsWith('ed-panel right')) { parts.right += n.actualDuration ?? 0; continue; }
        }
        walk(n.child);
      }
    };
    (window as unknown as { __REACT_DEVTOOLS_GLOBAL_HOOK__: unknown }).__REACT_DEVTOOLS_GLOBAL_HOOK__ = {
      supportsFiber: true,
      renderers: new Map(),
      inject: () => 1,
      onCommitFiberRoot: (_id: number, root: { current: Fiber & { actualDuration?: number } }) => {
        if (!(window as unknown as { __count?: boolean }).__count) return;
        parts.commits += 1;
        parts.top += root.current.actualDuration ?? 0;
        walk(root.current.child);
      },
      onCommitFiberUnmount: () => undefined,
      onPostCommitFiberRoot: () => undefined,
      checkDCE: () => undefined,
    };
  });
}

test.beforeEach(async ({ page }) => {
  if (process.env.REACT_PARTS) await hookReact(page);
  await loginAndOnboard(page, freshUser('Автор'));
});

test('E-05 · N-01 · задержка перетаскивания и ввода в поле при замедлении процессора ×4', async ({ page }, info) => {
  test.setTimeout(180_000);
  const { id } = await seedProject(page, realisticDoc as never);
  // Компьютер: холст и обе панели видны сразу, как у автора за ноутбуком.
  await page.setViewportSize({ width: 1440, height: 900 });
  await openEditor(page, id);
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });

  const from = await at(page, 65, 35);
  await page.mouse.click(from.x, from.y);
  await startProbe(page, 'pointermove');
  await page.evaluate(() => ((window as unknown as { __count: boolean }).__count = true));
  await cdp.send('Performance.enable');
  const m0 = Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map((m) => [m.name, m.value]));
  if (process.env.PROFILE) { await cdp.send('Profiler.enable'); await cdp.send('Profiler.start'); }
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  for (let i = 1; i <= 40; i++) {
    await page.mouse.move(from.x + i * 2, from.y + i);
    await page.waitForTimeout(16);
  }
  await page.mouse.up();
  await page.waitForTimeout(300);
  if (process.env.PROFILE) {
    const { profile } = await cdp.send('Profiler.stop');
    (await import('node:fs')).writeFileSync(process.env.PROFILE, JSON.stringify(profile));
  }
  const m1 = Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map((m) => [m.name, m.value]));
  const spent = ['ScriptDuration', 'RecalcStyleDuration', 'LayoutDuration', 'TaskDuration', 'LayoutCount', 'RecalcStyleCount', 'Nodes'].map((k) => `${k} ${k.endsWith('Duration') ? ((m1[k]! - m0[k]!) * 1000).toFixed(0) + ' мс' : (m1[k]! - (k === 'Nodes' ? 0 : m0[k]!)).toFixed(0)}`).join(', ');
  console.log(`[${info.project.name}] за перетаскивание: ${spent}`);
  if (process.env.REACT_PARTS) console.log(`[${info.project.name}] React, мс: ${JSON.stringify(await page.evaluate(() => (window as unknown as { __parts: unknown }).__parts))}`);
  const drag = stats(await page.evaluate(() => (window as unknown as { __lat: number[] }).__lat));

  // Typing the name of the selected block in the inspector.
  await page.getByRole('tab', { name: 'Содержимое' }).click();
  const name = page.getByLabel('Название блока', { exact: true }).first();
  await name.click();
  await startProbe(page, 'input');
  await page.keyboard.type('Новое имя блока', { delay: 30 });
  await page.waitForTimeout(300);
  const typing = stats(await page.evaluate(() => (window as unknown as { __lat: number[] }).__lat));
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });

  const line = `[${info.project.name}] перетаскивание: медиана ${drag.median.toFixed(0)} мс, 95% ${drag.p95.toFixed(0)} мс, макс ${drag.max.toFixed(0)} мс; ввод: медиана ${typing.median.toFixed(0)} мс, 95% ${typing.p95.toFixed(0)} мс, макс ${typing.max.toFixed(0)} мс`;
  console.log(line);
  info.annotations.push({ type: 'latency', description: line });
  expect(drag.n).toBeGreaterThan(20);
  expect(typing.n).toBeGreaterThan(10);
});
