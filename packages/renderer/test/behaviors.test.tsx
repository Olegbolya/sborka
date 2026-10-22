import { type BlockView as RuntimeView, type RuntimeEvent, createRuntime } from '@blokum/engine';
import { type BlockInput, ProjectDocument } from '@blokum/schema';
import { act, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Artboard, BlockView, DEV_THEMES, DRAG_SLOP, PlayerScreen, RuntimeStore, isPressable, mergeHandlers, onlyMoved, pxPerUnit, scratchedPercent, usesPointer } from '../src/index.js';
import { block, media } from './helpers.js';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const view = (id: string, patch: Partial<RuntimeView> = {}): RuntimeView => ({
  id,
  protoId: id,
  copy: false,
  parentId: null,
  visible: true,
  animateVisibility: false,
  interactive: true,
  dragging: false,
  zoneId: null,
  selected: false,
  x: 10,
  y: 20,
  w: 100,
  h: 80,
  rotation: 0,
  z: 0,
  overrides: {},
  anim: {},
  media: null,
  flipped: false,
  ...patch,
});

function mount(node: ReactNode, extra: Record<string, unknown> = {}) {
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  const events: RuntimeEvent[] = [];
  act(() =>
    root.render(
      <Artboard mode="player" tokens={DEV_THEMES.light} media={media} dispatch={(e) => events.push(e)} {...extra}>
        {node}
      </Artboard>,
    ),
  );
  // One unit is 2 px: the artboard is 780 px wide.
  for (const board of host.querySelectorAll('.bk-artboard')) (board as HTMLElement).getBoundingClientRect = () => ({ width: 780, left: 0, top: 0, height: 2000 }) as DOMRect;
  return { host, events, unmount: () => act(() => root.unmount()) };
}

const fire = (el: Element, type: string, x: number, y: number, pointerId = 1, pointerType = 'touch') =>
  act(() => {
    const e = new MouseEvent(type, { bubbles: true, clientX: x, clientY: y, button: 0 });
    Object.defineProperty(e, 'pointerId', { value: pointerId });
    Object.defineProperty(e, 'pointerType', { value: pointerType });
    el.dispatchEvent(e);
  });

afterEach(() => {
  document.body.innerHTML = '';
  vi.restoreAllMocks();
});

describe('BH-01: перетаскивание указателем', () => {
  const draggable = (extra: Partial<BlockInput> = {}) => block('shape', { id: 'kubik01', behaviors: [{ kind: 'drag' }], ...extra });

  it('BH-01: палец тащит блок — движок получает начало, путь в единицах и конец; блок не прокручивает страницу', () => {
    const b = draggable();
    const m = mount(<BlockView block={b} />, { views: new Map([[b.id, view(b.id)]]) });
    const el = m.host.querySelector<HTMLElement>('[data-block-id="kubik01"]')!;
    expect(el.style.touchAction).toBe('none');
    el.setPointerCapture = vi.fn();
    fire(el, 'pointerdown', 100, 100);
    fire(el, 'pointermove', 102, 101);
    fire(el, 'pointermove', 160, 140);
    fire(el, 'pointerup', 170, 150);
    expect(el.setPointerCapture).toHaveBeenCalledWith(1);
    expect(m.events).toEqual([
      { type: 'dragStart', blockId: 'kubik01' },
      { type: 'dragMove', blockId: 'kubik01', x: 40, y: 40 },
      { type: 'dragEnd', blockId: 'kubik01', x: 45, y: 45 },
    ]);
    m.unmount();
  });

  it('BH-01: перетаскивание — не нажатие: щелчок после него проглатывается; без движения — нажатие', () => {
    const b = draggable();
    const m = mount(<BlockView block={b} />, { views: new Map([[b.id, view(b.id)]]) });
    const el = m.host.querySelector<HTMLElement>('[data-block-id="kubik01"]')!;
    fire(el, 'pointerdown', 100, 100, 1, 'mouse');
    fire(el, 'pointermove', 140, 100, 1, 'mouse');
    fire(el, 'pointerup', 140, 100, 1, 'mouse');
    act(() => el.click());
    expect(m.events.filter((e) => e.type === 'tap')).toEqual([]);
    fire(el, 'pointerdown', 100, 100, 2, 'mouse');
    fire(el, 'pointerup', 100 + DRAG_SLOP, 100, 2, 'mouse');
    act(() => el.click());
    expect(m.events.filter((e) => e.type === 'tap')).toHaveLength(1);
    m.unmount();
  });

  it('BH-01: мультитач — у каждого блока свой палец, второй палец на том же блоке не мешает', () => {
    const a = draggable();
    const c = draggable({ id: 'kubik02' });
    const m = mount(
      <>
        <BlockView block={a} />
        <BlockView block={c} />
      </>,
      { views: new Map([[a.id, view(a.id)], [c.id, view(c.id, { x: 200 })]]) },
    );
    const [ea, ec] = ['kubik01', 'kubik02'].map((id) => m.host.querySelector<HTMLElement>(`[data-block-id="${id}"]`)!);
    fire(ea!, 'pointerdown', 0, 0, 1);
    fire(ec!, 'pointerdown', 400, 0, 2);
    fire(ea!, 'pointerdown', 10, 10, 3);
    fire(ea!, 'pointermove', 20, 0, 1);
    fire(ec!, 'pointermove', 400, 30, 2);
    fire(ea!, 'pointermove', 90, 90, 3);
    fire(ea!, 'pointercancel', 20, 0, 1);
    fire(ec!, 'pointerup', 400, 30, 2);
    expect(m.events).toEqual([
      { type: 'dragStart', blockId: 'kubik01' },
      { type: 'dragStart', blockId: 'kubik02' },
      { type: 'dragMove', blockId: 'kubik01', x: 20, y: 20 },
      { type: 'dragMove', blockId: 'kubik02', x: 200, y: 35 },
      { type: 'dragEnd', blockId: 'kubik01' },
      { type: 'dragEnd', blockId: 'kubik02', x: 200, y: 35 },
    ]);
    m.unmount();
  });

  it('BH-01: в редакторе и у заблокированного сценарием блока перетаскивания нет', () => {
    const b = draggable();
    const m = mount(<BlockView block={b} />, { views: new Map([[b.id, view(b.id, { interactive: false })]]) });
    const el = m.host.querySelector<HTMLElement>('[data-block-id="kubik01"]')!;
    fire(el, 'pointerdown', 0, 0);
    expect(m.events).toEqual([]);
    m.unmount();
    const ed = mount(<BlockView block={b} />, { mode: 'editor' });
    fire(ed.host.querySelector('[data-block-id="kubik01"]')!, 'pointerdown', 0, 0);
    expect(ed.events).toEqual([]);
    ed.unmount();
  });

  it('BH-01: размер единицы берётся из ширины артборда; обработчики складываются', () => {
    const el = document.createElement('div');
    el.getBoundingClientRect = () => ({ width: 0 }) as DOMRect;
    expect(pxPerUnit(el)).toBe(1);
    const calls: string[] = [];
    const merged = mergeHandlers<{ onX: (e: string) => void }>({ onX: (e) => calls.push(`a${e}`) }, { onX: (e) => calls.push(`b${e}`) }, {});
    merged.onX!('1');
    expect(calls).toEqual(['a1', 'b1']);
  });
});

describe('BH-03: стираемый слой', () => {
  it('BH-03: доля стёртого считается по прозрачным пикселям', () => {
    const data = new Uint8ClampedArray(10 * 10 * 4).fill(255);
    expect(scratchedPercent(data, 10, 10, 1)).toBe(0);
    for (let i = 0; i < 50; i++) data[i * 4 + 3] = 0;
    expect(scratchedPercent(data, 10, 10, 1)).toBe(50);
    expect(scratchedPercent(new Uint8ClampedArray(0), 0, 0)).toBe(0);
  });

  it('BH-03: палец стирает линию кистью, маска обновляется, порог гасит слой и уходит в движок', () => {
    vi.useFakeTimers();
    let cleared = 0;
    const g = {
      fillRect: vi.fn(),
      beginPath: vi.fn(),
      moveTo: vi.fn(),
      lineTo: vi.fn(),
      stroke: vi.fn(() => (cleared += 35)),
      getImageData: vi.fn(() => {
        const data = new Uint8ClampedArray(100 * 80 * 4).fill(255);
        const n = Math.min(100 * 80, Math.round((cleared / 100) * 100 * 80));
        for (let i = 0; i < n; i++) data[i * 4 + 3] = 0;
        return { data };
      }),
      globalCompositeOperation: '',
      lineCap: '',
      lineJoin: '',
      lineWidth: 0,
      fillStyle: '',
    };
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(g as unknown as CanvasRenderingContext2D);
    vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockReturnValue('data:image/png;base64,MASKA');
    const b = block('shape', { id: 'sloi0001', frame: { x: 0, y: 0, w: 100, h: 80 }, behaviors: [{ kind: 'scratch', brush: 30, threshold: 60 }] });
    const m = mount(<BlockView block={b} />, { views: new Map([[b.id, view(b.id, { x: 0, y: 0 })]]) });
    const el = m.host.querySelector<HTMLElement>('[data-block-id="sloi0001"]')!;
    el.getBoundingClientRect = () => ({ left: 0, top: 0, width: 200, height: 160 }) as DOMRect;
    fire(el, 'pointerdown', 20, 20);
    fire(el, 'pointermove', 180, 20);
    expect(g.lineWidth).toBe(30);
    expect(g.globalCompositeOperation).toBe('destination-out');
    expect(g.lineTo).toHaveBeenLastCalledWith(90.01, 10);
    act(() => {
      vi.advanceTimersByTime(60);
    });
    expect(el.style.maskImage).toContain('MASKA');
    expect(m.events).toEqual([{ type: 'scratched', blockId: 'sloi0001', percent: 70 }]);
    expect(el.style.opacity).toBe('0');
    expect(el.style.pointerEvents).toBe('none');
    fire(el, 'pointerup', 0, 0);
    m.unmount();
    vi.useRealTimers();
  });
});

describe('BH-06 · BH-07: колесо и переворот', () => {
  const card = () =>
    block('container', {
      id: 'kartochka',
      behaviors: [{ kind: 'flip', frontId: 'licevaya1', backId: 'rubashka1' }],
      children: [block('shape', { id: 'licevaya1' }), block('shape', { id: 'rubashka1' })],
    });

  it('BH-07: до ребра видна лицевая сторона, после — обратная, не зеркальная', () => {
    const at = (rotateY: number) => {
      const m = mount(<BlockView block={card()} />, { views: new Map([['kartochka', view('kartochka', { anim: { rotateY } })]]) });
      const [front, back] = ['licevaya1', 'rubashka1'].map((id) => m.host.querySelector<HTMLElement>(`[data-block-id="${id}"]`)!);
      const r = [front!.style.visibility, back!.style.visibility, back!.style.transform];
      m.unmount();
      return r;
    };
    expect(at(30)).toEqual(['', 'hidden', 'scaleX(-1)']);
    expect(at(150)).toEqual(['hidden', '', 'scaleX(-1)']);
    expect(at(-200)).toEqual(['hidden', '', 'scaleX(-1)']);
  });

  it('BH-06 · BH-07 · PL-21: колесо и карточка по нажатию — кнопки для клавиатуры', () => {
    expect(isPressable(card())).toBe(true);
    expect(isPressable(block('container', { behaviors: [{ kind: 'flip', frontId: 'aaaaaa', backId: 'bbbbbb', on: 'action' }] }))).toBe(false);
    expect(isPressable(block('container', { behaviors: [{ kind: 'wheel', sectors: [{ blockId: 'sektor0' }, { blockId: 'sektor1' }] }] }))).toBe(true);
  });
});

describe('BH-02 · BH-08: указатель на экране', () => {
  const docWith = (blocks: BlockInput[]) => ProjectDocument.parse({ schemaVersion: 1, screens: [{ id: 'ekran1', name: 'Э', blocks }] });

  it('BH-08: движение указателя над экраном уходит в движок в единицах, и блок следует', () => {
    const doc = docWith([{ id: 'zvezda01', type: 'shape', name: 'Звезда', frame: { x: 0, y: 0, w: 20, h: 20 }, behaviors: [{ kind: 'follow', lagMs: 0 }] }]);
    expect(usesPointer(doc.screens[0]!)).toBe(true);
    let cb: ((t: number) => void) | null = null;
    const store = new RuntimeStore(createRuntime(doc, { seed: 1 }), () => undefined, { request: (fn) => ((cb = fn), 1), cancel: () => undefined });
    const m = mount(<PlayerScreen screen={doc.screens[0]!} store={store} />);
    const screen = m.host.querySelector<HTMLElement>('.bk-player-screen')!;
    screen.getBoundingClientRect = () => ({ left: 0, top: 0, width: 780, height: 1688 }) as DOMRect;
    fire(screen, 'pointermove', 400, 600);
    act(() => {
      cb?.(1000);
      cb?.(1016);
    });
    expect(store.views.get('zvezda01')).toMatchObject({ x: 190, y: 290 });
    m.unmount();
  });

  it('BH-02: без убегающих и следующих блоков указатель не отслеживается', () => {
    const doc = docWith([{ id: 'prosto01', type: 'shape', name: 'Фигура', frame: { x: 0, y: 0, w: 20, h: 20 } }]);
    expect(usesPointer(doc.screens[0]!)).toBe(false);
    const store = new RuntimeStore(createRuntime(doc, { seed: 1 }), () => undefined, { request: () => 1, cancel: () => undefined });
    const spy = vi.spyOn(store, 'dispatch');
    const m = mount(<PlayerScreen screen={doc.screens[0]!} store={store} />);
    fire(m.host.querySelector('.bk-player-screen')!, 'pointermove', 10, 10);
    expect(spy).not.toHaveBeenCalled();
    m.unmount();
  });
});


describe('SC-05: сдвиг без перерисовки экрана', () => {
  const doc = ProjectDocument.parse({ schemaVersion: 1, screens: [{ id: 'ekran1', name: 'Э', blocks: [{ id: 'sharik01', type: 'shape', name: 'Шарик', frame: { x: 10, y: 20, w: 20, h: 20 } }] }] });

  it('SC-05: только смена места — прямой сдвиг; «изменился», но стоит на месте (ответ, переменная) — перерисовка', () => {
    const store = new RuntimeStore(createRuntime(doc, { seed: 1 }), () => undefined, { request: () => 1, cancel: () => undefined });
    store.enter('ekran1');
    const view = store.views.get('sharik01')!;
    expect(onlyMoved(view, { ...view, x: 15 })).toBe(true);
    expect(onlyMoved(view, { ...view })).toBe(false);
    expect(onlyMoved(view, { ...view, x: 15, selected: !view.selected })).toBe(false);
  });
});
