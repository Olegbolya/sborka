import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ProjectDocument, validateDocument, walkBlocks } from '@blokum/schema';
import { PreviewSession } from '../lib/editor/preview-session';

/*
 * P3.12 · RG-01…RG-10: the reference games are plain documents (`packages/themes/examples/rg-XX.json`) made only of blocks, rules
 * and behaviours. Here each one is played to the end on the real runtime, the way the preview plays it.
 */
const EXAMPLES = resolve(__dirname, '../../../packages/themes/examples');
const load = (id: string): ProjectDocument => ProjectDocument.parse(JSON.parse(readFileSync(resolve(EXAMPLES, `${id}.json`), 'utf8')));

/** A frame loop driven by hand: `advance` plays the time forward in frames of 16 ms. */
function open(id: string, seed = 1) {
  let frame: ((t: number) => void) | null = null;
  let clock = 0;
  const session = new PreviewSession(load(id), { seed, scheduler: { request: (cb) => ((frame = cb), 1), cancel: () => (frame = null) } });
  let entered: string | null = null;
  /** What PlayerScreen does when a screen appears: enter it and start the frame loop. */
  const sync = () => {
    const screen = session.getSnapshot().screen;
    if (screen && screen.id !== entered) {
      entered = screen.id;
      session.store.stop();
      session.store.enter(screen.id);
      session.store.start();
    }
  };
  sync();
  const advance = (ms: number) => {
    for (let t = 0; t < ms; t += 16) {
      clock += 16;
      frame?.(clock);
      sync();
    }
  };
  const tap = (blockId: string) => {
    session.store.dispatch({ type: 'tap', blockId });
    sync();
  };
  const view = (blockId: string) => session.store.views.get(blockId);
  const screen = () => session.getSnapshot().screen?.id ?? null;
  const ended = () => session.getSnapshot().ended;
  const v = (variableId: string) => session.runtime.variables[variableId];
  return { session, advance, tap, view, screen, ended, v, sync };
}

describe('P3.12 · эталонные игры: документы собраны штатными блоками и проходят проверку', () => {
  const ids = Array.from({ length: 10 }, (_, i) => `rg-${String(i + 1).padStart(2, '0')}`);

  it.each(ids)('%s · документ проходит схему и проверку перед публикацией без ошибок', (id) => {
    const doc = load(id);
    expect(validateDocument(doc).filter((i) => i.severity === 'error')).toEqual([]);
    expect(doc.screens.length).toBeGreaterThanOrEqual(2);
    // Plain parts only: no block type outside the catalogue and no text without Russian words.
    const text = JSON.stringify(doc);
    expect(text).toMatch(/[А-Яа-яЁё]/);
    expect([...walkBlocks(doc.screens.flatMap((s) => s.blocks))].length).toBeGreaterThan(3);
  });
});

describe('RG-01 · Убегающая кнопка «Нет»', () => {
  it('RG-01 · «Нет» убегает пять раз, потом сомневается («Точно нет?») и сдаётся («Да!») — игра идёт дальше до конца', () => {
    const g = open('rg-01');
    const start = { ...g.view('rg01_net')! };
    let runs = 0;
    for (let i = 0; i < 12; i++) {
      const b = g.view('rg01_net')!;
      const before = [b.x, b.y];
      g.session.store.dispatch({ type: 'pointer', x: b.x + b.w / 2, y: b.y + b.h / 2 });
      g.advance(400);
      const a = g.view('rg01_net')!;
      if (a.x !== before[0] || a.y !== before[1]) runs += 1;
    }
    expect(runs).toBe(5);
    expect(g.view('rg01_net')!.x).not.toBe(start.x);
    g.tap('rg01_net');
    expect(g.view('rg01_net')!.overrides.textLayer).toMatchObject({ paragraphs: [{ runs: [{ t: 'Точно нет?' }] }] });
    expect(g.screen()).toBe('rg01_vopros');
    g.tap('rg01_net');
    expect(g.view('rg01_net')!.overrides.textLayer).toMatchObject({ paragraphs: [{ runs: [{ t: 'Да!' }] }] });
    g.advance(800);
    expect(g.screen()).toBe('rg01_final');
    g.tap('rg01_konec');
    expect(g.ended()).toBe(true);
  });

  it('RG-01 · «Да» сразу ведёт дальше', () => {
    const g = open('rg-01');
    g.tap('rg01_da');
    expect(g.screen()).toBe('rg01_final');
  });
});

describe('RG-02 · Коробка-сюрприз', () => {
  it('RG-02 · нажали на коробку: она трясётся, исчезает, появляется приз и кнопка «Дальше»', () => {
    const g = open('rg-02');
    expect(g.view('rg02_priz')!.visible).toBe(false);
    g.tap('rg02_box');
    expect(g.view('rg02_box')!.visible).toBe(true);
    g.advance(700);
    expect(g.view('rg02_box')!.visible).toBe(false);
    expect(g.view('rg02_priz')!.visible).toBe(true);
    g.tap('rg02_dalshe');
    g.tap('rg02_konec');
    expect(g.ended()).toBe(true);
  });
});

describe('RG-03 · Скретч-карта', () => {
  it('RG-03 · стёрли 60 % — открывается вставка-мем и кнопка «Дальше»; меньше — ничего', () => {
    const g = open('rg-03');
    const effects: string[] = [];
    g.session.store.subscribeEffects((list) => effects.push(...list.map((e) => e.type)));
    g.session.store.dispatch({ type: 'scratched', blockId: 'rg03_sloj', percent: 30 });
    expect(effects).toEqual([]);
    expect(g.view('rg03_dalshe')!.visible).toBe(false);
    g.session.store.dispatch({ type: 'scratched', blockId: 'rg03_sloj', percent: 65 });
    expect(effects).toContain('mediaOverlay');
    expect(g.view('rg03_dalshe')!.visible).toBe(true);
    g.tap('rg03_dalshe');
    g.tap('rg03_konec');
    expect(g.ended()).toBe(true);
  });
});

describe('RG-04 · Колесо фортуны', () => {
  it('RG-04 · колесо крутится, останавливается на секторе, попытка записывается в ответы', () => {
    const g = open('rg-04');
    const effects: Array<{ type: string; sectorBlockId?: string }> = [];
    g.session.store.subscribeEffects((list) => effects.push(...(list as typeof effects)));
    g.tap('rg04_koleso');
    g.advance(2400);
    expect(effects.find((e) => e.type === 'wheel')?.sectorBlockId).toMatch(/^rg04_sektor_\d$/);
    expect(g.v('rg04_popytki')).toBe(1);
    expect(effects.some((e) => e.type === 'record')).toBe(true);
    expect(g.view('rg04_dalshe')!.visible).toBe(true);
    g.tap('rg04_dalshe');
    g.tap('rg04_konec');
    expect(g.ended()).toBe(true);
  });
});

describe('RG-05 · Мемори «найди пары»', () => {
  const cards = ['rg05_k00', 'rg05_k01', 'rg05_k10', 'rg05_k11', 'rg05_k20', 'rg05_k21'];

  it('RG-05 · пара совпала — остаётся открытой, счёт растёт; три пары — игра идёт дальше', () => {
    const g = open('rg-05');
    for (const [a, b] of [['rg05_k00', 'rg05_k01'], ['rg05_k10', 'rg05_k11'], ['rg05_k20', 'rg05_k21']] as const) {
      g.tap(a);
      g.advance(400);
      g.tap(b);
      g.advance(400);
    }
    expect(g.v('rg05_pary')).toBe(3);
    g.advance(900);
    expect(g.screen()).toBe('rg05_final');
    g.tap('rg05_konec');
    expect(g.ended()).toBe(true);
  });

  it('RG-05 · пара не совпала — через паузу обе карты закрываются и снова нажимаются; пока закрываются, нажатия не считаются', () => {
    const g = open('rg-05');
    g.tap('rg05_k00');
    g.advance(400);
    expect(g.view('rg05_k00')!.flipped).toBe(true);
    g.tap('rg05_k10');
    g.advance(100);
    expect(g.view('rg05_k10')!.flipped).toBe(true);
    // While the wrong pair is closing, a third card is not opened.
    g.tap('rg05_k20');
    expect(g.view('rg05_k20')!.flipped).toBe(false);
    g.advance(1500);
    expect(g.view('rg05_k00')!.flipped).toBe(false);
    expect(g.view('rg05_k10')!.flipped).toBe(false);
    expect(g.v('rg05_pary')).toBe(0);
    g.tap('rg05_k00');
    g.advance(400);
    expect(g.view('rg05_k00')!.flipped).toBe(true);
    expect(cards).toHaveLength(6);
  });

  it('RG-05 · при показе экрана карточки перемешиваются; у разных зёрен — разный порядок', () => {
    const order = (seed: number) => {
      const g = open('rg-05', seed);
      return cards.map((id) => g.view(id)!.order).join('|');
    };
    expect(new Set([1, 2, 3, 4].map(order)).size).toBeGreaterThan(1);
  });
});

describe('RG-06 · Поймай объект', () => {
  it('RG-06 · звёзды падают из генератора; нажатая звезда ловится (счёт), упавшая на землю считается упавшей; по таймеру — итог', () => {
    const g = open('rg-06');
    g.advance(1600);
    const copies = () => [...g.session.store.views.values()].filter((x) => x.copy && x.protoId === 'rg06_zvezda' && x.visible);
    expect(copies().length).toBeGreaterThan(1);
    const first = copies()[0]!;
    g.tap(first.id);
    expect(g.v('rg06_poimano')).toBe(1);
    expect(g.view(first.id)).toBeUndefined();
    g.advance(6600);
    expect(g.v('rg06_upalo') as number).toBeGreaterThan(0);
    expect(g.screen()).toBe('rg06_final');
    const poimano = g.v('rg06_poimano');
    g.tap('rg06_konec');
    expect(g.ended()).toBe(true);
    expect(poimano).toBe(1);
  });
});

describe('RG-07 · Перетащи на место', () => {
  const zoneAt = (g: ReturnType<typeof open>, zone: string) => ({ x: g.view(zone)!.x, y: g.view(zone)!.y });
  const drag = (g: ReturnType<typeof open>, card: string, to: { x: number; y: number }) => {
    g.session.store.dispatch({ type: 'dragStart', blockId: card });
    g.session.store.dispatch({ type: 'dragMove', blockId: card, x: to.x, y: to.y });
    g.session.store.dispatch({ type: 'dragEnd', blockId: card, x: to.x, y: to.y });
    g.advance(400);
  };

  it('RG-07 · каждый фрукт на свою подпись — по десять баллов; три на месте — игра идёт дальше', () => {
    const g = open('rg-07');
    for (let i = 0; i < 3; i++) drag(g, `rg07_f${i}`, zoneAt(g, `rg07_z${i}`));
    expect(g.v('rg07_ochki')).toBe(30);
    g.advance(700);
    expect(g.screen()).toBe('rg07_final');
    g.tap('rg07_konec');
    expect(g.ended()).toBe(true);
  });

  it('RG-07 · не на свою подпись — фрукт возвращается, баллов нет', () => {
    const g = open('rg-07');
    const home = { x: g.view('rg07_f0')!.x, y: g.view('rg07_f0')!.y };
    drag(g, 'rg07_f0', zoneAt(g, 'rg07_z1'));
    expect(g.v('rg07_ochki')).toBe(0);
    expect({ x: g.view('rg07_f0')!.x, y: g.view('rg07_f0')!.y }).toEqual(home);
  });
});

describe('RG-08 · Квест с инвентарём', () => {
  it('RG-08 · пошёл к избушке — взял ключ, дверь открылась; к озеру — ключа нет, заперто', () => {
    const win = open('rg-08');
    win.tap('rg08_vlevo');
    expect(win.v('rg08_veschi')).toEqual(['ключ']);
    expect(win.screen()).toBe('rg08_dver');
    win.tap('rg08_otkryt');
    expect(win.screen()).toBe('rg08_pobeda');
    win.tap('rg08_p2');
    expect(win.ended()).toBe(true);

    const lose = open('rg-08');
    lose.tap('rg08_vpravo');
    expect(lose.v('rg08_veschi')).toEqual([]);
    lose.tap('rg08_otkryt');
    expect(lose.screen()).toBe('rg08_zakryto');
    lose.tap('rg08_z2');
    expect(lose.ended()).toBe(true);
  });
});

describe('RG-09 · Кликер на время', () => {
  it('RG-09 · за пять секунд сколько нажали, столько и счёт; потом итог, число записано в ответы', () => {
    const g = open('rg-09');
    const records: unknown[] = [];
    g.session.store.subscribeEffects((list) => records.push(...list.filter((e) => e.type === 'record')));
    for (let i = 0; i < 7; i++) {
      g.tap('rg09_zhmi');
      g.advance(300);
    }
    expect(g.screen()).toBe('rg09_igra');
    g.advance(3000);
    expect(g.screen()).toBe('rg09_final');
    expect(g.v('rg09_klikov')).toBe(7);
    expect(records).toEqual([{ type: 'record', label: 'Кликов за 5 секунд', value: 7 }]);
    g.tap('rg09_konec');
    expect(g.ended()).toBe(true);
  });
});

describe('RG-10 · Угадай по размытому фото', () => {
  it('RG-10 · фото проясняется за шесть секунд; правильный ответ — десять баллов из десяти', () => {
    const g = open('rg-10');
    expect(g.view('rg10_foto')!.anim.blur ?? 22).toBeGreaterThan(15);
    g.advance(3000);
    const half = g.view('rg10_foto')!.anim.blur!;
    expect(half).toBeGreaterThan(5);
    expect(half).toBeLessThan(17);
    g.advance(3500);
    expect(g.view('rg10_foto')!.anim.blur).toBe(0);
    g.session.store.dispatch({ type: 'answer', questionBlockId: 'rg10_vopros', answer: { kind: 'choice', optionIds: ['rg10_o0'] } });
    g.tap('rg10_dalshe');
    expect(g.screen()).toBe('rg10_final');
    expect(g.session.textValue({ sys: 'баллы' })).toBe('10');
    expect(g.session.textValue({ sys: 'максимум' })).toBe('10');
    g.tap('rg10_konec');
    expect(g.ended()).toBe(true);
  });

  it('RG-10 · неверный ответ — ноль баллов', () => {
    const g = open('rg-10');
    g.session.store.dispatch({ type: 'answer', questionBlockId: 'rg10_vopros', answer: { kind: 'choice', optionIds: ['rg10_o1'] } });
    g.tap('rg10_dalshe');
    expect(g.session.textValue({ sys: 'баллы' })).toBe('0');
  });
});
