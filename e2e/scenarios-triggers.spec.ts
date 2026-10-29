import { expect, test, type Locator, type Page } from '@playwright/test';
import { freshUser, loginAndOnboard } from './helpers/auth';
import { hit, openEditor, seedProject } from './helpers/editor';

/*
 * P3.8 · TR-01…TR-16: для каждого триггера правило создаётся в интерфейсе (вкладка «Сценарии» блока), а в предпросмотре
 * действие участника заставляет его сработать — это видно в журнале отладчика.
 */
function wav(): Buffer {
  const rate = 8000;
  const data = Buffer.alloc(800 * 2);
  const h = Buffer.alloc(44);
  h.write('RIFF', 0);
  h.writeUInt32LE(36 + data.length, 4);
  h.write('WAVEfmt ', 8);
  h.writeUInt32LE(16, 16);
  h.writeUInt16LE(1, 20);
  h.writeUInt16LE(1, 22);
  h.writeUInt32LE(rate, 24);
  h.writeUInt32LE(rate * 2, 28);
  h.writeUInt16LE(2, 32);
  h.writeUInt16LE(16, 34);
  h.write('data', 36);
  h.writeUInt32LE(data.length, 40);
  return Buffer.concat([h, data]);
}

const text = (id: string, name: string) => ({ paragraphs: [{ kind: 'p', runs: [{ t: name }] }] });
const block = (id: string, type: string, name: string, x: number, y: number, w: number, h: number, extra: Record<string, unknown> = {}) => ({ id, type, name, frame: { x, y, w, h }, ...extra });

async function world(page: Page, withAudio: boolean): Promise<string> {
  let audioId = '';
  if (withAudio) {
    const origin = new URL(page.url()).origin;
    const res = await page.request.post('/api/v1/media', { multipart: { file: { name: 'z.wav', mimeType: 'audio/wav', buffer: wav() } }, headers: { origin } });
    audioId = ((await res.json()) as { id: string }).id;
  }
  const { id } = await seedProject(page, (d) => {
    d.variables.push({ id: 'peremennaya_ochki', name: 'Очки', type: 'number', initial: 0, saveToAnswers: false });
    const options = ['Да', 'Нет'];
    d.screens[0]!.blocks.push(
      block('knopka_a', 'button', 'Кнопка', 95, 330, 200, 56, { textLayer: text('t', 'Кнопка') }),
      block('figura_b', 'shape', 'Фигура', 20, 100, 100, 100),
      block('zona_z', 'zone', 'Зона', 220, 100, 120, 120),
      block('taimer_t', 'timer', 'Таймер', 20, 420, 120, 40, { props: { seconds: 1, autoStart: true } }),
      block('skretch_s', 'shape', 'Скретч', 20, 480, 300, 120),
      block('vopros_q', 'singleChoice', 'Вопрос', 20, 220, 300, 100, {
        props: { options: options.map((_t, i) => ({ id: `vopros_q_o${i + 1}`, blockId: `vopros_q_v${i + 1}`, correct: false, score: 0 })) },
        children: options.map((t, i) => block(`vopros_q_v${i + 1}`, 'shape', t, 0, i * 44, 300, 40, { textLayer: text('t', t) })),
      }),
      ...(withAudio ? [block('zvuk_a', 'audio', 'Звук', 150, 100, 60, 60, { props: { media: { source: 'media', id: audioId }, volume: 1 } })] : []),
    );
    d.screens.push({ id: 'ekran_vtoroj', name: 'Второй', blocks: [] });
  });
  return id;
}

interface Case {
  /** The name in the list «Добавить правило: когда» and the phrase of the log. */
  title: string;
  phrase: string;
  /** The block of the editor that gets the rule. */
  on: string;
  tr: string;
  /** Before the rule: behaviours the block needs. */
  behaviors?: string[];
  /** Changes of the fields of the new rule. */
  fill?: (rule: Locator, page: Page) => Promise<void>;
  audio?: boolean;
  act: (ctx: { page: Page; frame: Locator; dialog: Locator }) => Promise<void>;
}

const block_ = (frame: Locator, id: string) => frame.locator(`[data-block-id="${id}"]`);
async function center(l: Locator): Promise<{ x: number; y: number }> {
  const b = (await l.boundingBox())!;
  return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
}
async function dragTo(page: Page, from: { x: number; y: number }, to: { x: number; y: number }, steps = 12): Promise<void> {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps });
  await page.mouse.up();
}

const CASES: Case[] = [
  { tr: 'TR-01', title: 'Нажали', phrase: 'нажали на «Кнопка»', on: 'Кнопка', act: async ({ frame }) => void (await block_(frame, 'knopka_a').click()) },
  { tr: 'TR-02', title: 'Нажали дважды', phrase: 'нажали дважды на «Кнопка»', on: 'Кнопка', act: async ({ frame }) => void (await block_(frame, 'knopka_a').dblclick()) },
  {
    tr: 'TR-03',
    title: 'Нажали и держат',
    phrase: 'держат нажатым «Кнопка»',
    on: 'Кнопка',
    fill: async (rule) => void (await rule.locator('input[aria-label="Как долго держат"]').fill('300')),
    act: async ({ page, frame }) => {
      const c = await center(block_(frame, 'knopka_a'));
      await page.mouse.move(c.x, c.y);
      await page.mouse.down();
      await page.waitForTimeout(800);
      await page.mouse.up();
    },
  },
  { tr: 'TR-04', title: 'Навели курсор или палец', phrase: 'навели на «Кнопка»', on: 'Кнопка', act: async ({ frame }) => void (await block_(frame, 'knopka_a').hover()) },
  {
    tr: 'TR-05',
    title: 'Потащили',
    phrase: 'начали тащить «Фигура»',
    on: 'Фигура',
    behaviors: ['Перетаскивается'],
    act: async ({ page, frame }) => {
      const c = await center(block_(frame, 'figura_b'));
      await dragTo(page, c, { x: c.x + 40, y: c.y + 60 });
    },
  },
  {
    tr: 'TR-06',
    title: 'Положили на место',
    phrase: '«Фигура» положили на «Зона»',
    on: 'Фигура',
    behaviors: ['Перетаскивается'],
    act: async ({ page, frame }) => {
      await dragTo(page, await center(block_(frame, 'figura_b')), await center(block_(frame, 'zona_z')));
    },
  },
  {
    tr: 'TR-07',
    title: 'Столкнулись',
    phrase: '«Фигура» коснулся «Зона»',
    on: 'Фигура',
    behaviors: ['Перетаскивается'],
    fill: async (rule) => {
      await rule.locator('select[aria-label="Второй блок: блок"]').selectOption({ label: 'Экран 1 · Зона' });
    },
    act: async ({ page, frame }) => {
      await dragTo(page, await center(block_(frame, 'figura_b')), await center(block_(frame, 'zona_z')), 20);
    },
  },
  {
    tr: 'TR-08',
    title: 'Смахнули',
    phrase: 'смахнули влево',
    on: 'Кнопка',
    act: async ({ page, frame }) => {
      await frame.locator('.bk-player-screen').scrollIntoViewIfNeeded();
      // A row of the screen whose two ends are really the screen under the finger (on a phone the dialog is wider and taller than the window).
      const row = await page.evaluate(() => {
        const screen = document.querySelector('[data-preview="true"] .bk-player-screen')!.getBoundingClientRect();
        const hits = (x: number, y: number) => document.elementFromPoint(x, y)?.closest('.bk-player-screen') !== null && document.elementFromPoint(x, y) !== null;
        for (let y = Math.max(screen.top, 0) + 20; y < Math.min(screen.bottom, innerHeight) - 10; y += 10) {
          const left = Math.max(screen.left, 0) + 30;
          const right = Math.min(screen.right, innerWidth) - 30;
          if (hits(left, y) && hits(right, y)) return { left, right, y };
        }
        return null;
      });
      expect(row, 'на экране нашлась полоса для жеста').not.toBeNull();
      const { left, right, y } = row!;
      await dragTo(page, { x: right, y }, { x: left, y }, 10);
    },
  },
  { tr: 'TR-09', title: 'Экран открылся или закрывается', phrase: 'экран открылся', on: 'Кнопка', act: async () => undefined },
  {
    tr: 'TR-10',
    title: 'Прошло время',
    phrase: 'прошло 0.5 с',
    on: 'Кнопка',
    fill: async (rule) => void (await rule.locator('input[aria-label="Секунд"]').fill('0.5')),
    act: async ({ page }) => void (await page.waitForTimeout(1200)),
  },
  {
    tr: 'TR-10',
    title: 'Прошло время',
    phrase: 'закончился таймер «Таймер»',
    on: 'Кнопка',
    fill: async (rule) => {
      await rule.locator('select[aria-label="Как"]').selectOption({ label: 'когда закончился таймер' });
      await rule.locator('select[aria-label="Какой таймер"]').selectOption({ label: 'Экран 1 · Таймер' });
    },
    act: async ({ page }) => void (await page.waitForTimeout(2500)),
  },
  {
    tr: 'TR-11',
    title: 'Изменилась переменная',
    phrase: 'изменилась переменная «Очки»',
    on: 'Кнопка',
    act: async ({ dialog }) => void (await dialog.getByLabel('Переменная «Очки»').fill('7')),
  },
  { tr: 'TR-12', title: 'Ответили на вопрос', phrase: 'ответили на «Вопрос»', on: 'Кнопка', act: async ({ frame }) => void (await frame.getByText('Да', { exact: true }).click()) },
  {
    tr: 'TR-13',
    title: 'Закончилось видео или звук',
    phrase: 'закончилось «Звук»',
    on: 'Кнопка',
    audio: true,
    fill: async (rule) => {
      await rule.locator('select[aria-label="Какой блок: блок"]').selectOption({ label: 'Экран 1 · Звук' });
    },
    act: async ({ frame }) => void (await frame.locator('audio').evaluate((a) => a.dispatchEvent(new Event('ended')))),
  },
  {
    tr: 'TR-14',
    title: 'Стёрли',
    phrase: 'стёрли 60% у «Скретч»',
    on: 'Скретч',
    behaviors: ['Стирается'],
    act: async ({ page, frame }) => {
      await block_(frame, 'skretch_s').scrollIntoViewIfNeeded();
      const b = (await block_(frame, 'skretch_s').boundingBox())!;
      await page.mouse.move(b.x + 5, b.y + 10);
      await page.mouse.down();
      for (let row = 0; row < 6; row++) {
        await page.mouse.move(b.x + b.width - 5, b.y + 10 + row * (b.height / 6), { steps: 8 });
        await page.mouse.move(b.x + 5, b.y + 10 + (row + 0.5) * (b.height / 6), { steps: 8 });
      }
      await page.mouse.up();
    },
  },
  {
    tr: 'TR-15',
    title: 'Встряхнули или наклонили телефон',
    phrase: 'встряхнули телефон',
    on: 'Кнопка',
    act: async ({ page }) => {
      for (let i = 0; i < 2; i++) {
        await page.evaluate(() => window.dispatchEvent(new DeviceMotionEvent('devicemotion', { acceleration: { x: 30, y: 0, z: 0 }, accelerationIncludingGravity: { x: 30, y: 0, z: 9.8 } })));
        await page.waitForTimeout(200);
      }
    },
  },
  { tr: 'TR-16', title: 'Нажали клавишу', phrase: 'нажали клавишу «Enter»', on: 'Кнопка', act: async ({ page }) => void (await page.keyboard.press('Enter')) },
];

test.describe('P3.8 · правило с каждым триггером создаётся в интерфейсе и срабатывает в предпросмотре', () => {
  for (const c of CASES) {
    test(`${c.tr} · «${c.title}»: ${c.phrase}`, async ({ page }) => {
      test.setTimeout(120_000);
      await loginAndOnboard(page, freshUser('Сценарист'));
      const id = await world(page, c.audio === true);
      await openEditor(page, id);
      await hit(page, c.on).click();
      await page.getByRole('tab', { name: 'Сценарии' }).click();
      for (const behavior of c.behaviors ?? []) await page.getByLabel('Добавить поведение').selectOption({ label: behavior });
      await page.getByLabel('Добавить правило: когда').selectOption({ label: c.title });
      const rule = page.locator('[data-rule]').last();
      await c.fill?.(rule, page);

      await page.getByRole('button', { name: 'Предпросмотр' }).click();
      const dialog = page.getByRole('dialog', { name: 'Предпросмотр' });
      const frame = dialog.locator('[data-preview="true"]');
      await expect(frame.locator('.bk-player-screen[data-live="true"]')).toBeVisible();
      await c.act({ page, frame, dialog });
      await expect(dialog.getByTestId('debug-log')).toContainText(`Сработало правило «когда ${c.phrase}»`, { timeout: 10_000 });
    });
  }
});
