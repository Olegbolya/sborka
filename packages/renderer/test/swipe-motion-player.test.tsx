import { type RuntimeEvent, createRuntime } from '@blokum/engine';
import { type BlockInput, ProjectDocument } from '@blokum/schema';
import { act, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Artboard, DEV_THEMES, PlayerScreen, RuntimeStore, SWIPE_MAX_MS, classifySwipe } from '../src/index.js';
import { media } from './helpers.js';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
afterEach(() => {
  document.body.innerHTML = '';
  vi.restoreAllMocks();
});

const when = (kind: Record<string, unknown>) => ({ id: `pravilo${Math.random().toString(36).slice(2, 8)}`, when: kind, do: [{ kind: 'wait', ms: 0 }] });
const docWith = (blocks: BlockInput[], rules: unknown[]) => ProjectDocument.parse({ schemaVersion: 1, screens: [{ id: 'ekran1', name: 'Э', blocks, rules }] });

function mount(node: ReactNode) {
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  act(() =>
    root.render(
      <Artboard mode="player" tokens={DEV_THEMES.light} media={media}>
        {node}
      </Artboard>,
    ),
  );
  return Object.assign(host, { unmount: () => act(() => root.unmount()) });
}
const fire = (el: Element, type: string, x: number, y: number, pointerType = 'touch') =>
  act(() => {
    const e = new MouseEvent(type, { bubbles: true, clientX: x, clientY: y, button: 0 });
    Object.defineProperty(e, 'pointerId', { value: 1 });
    Object.defineProperty(e, 'pointerType', { value: pointerType });
    el.dispatchEvent(e);
  });

describe('TR-08 · смахивание', () => {
  it('TR-08 · классификация: направление, минимальный путь, время и «почти по диагонали»', () => {
    expect(classifySwipe(-120, 10, 200)).toBe('left');
    expect(classifySwipe(120, -10, 200)).toBe('right');
    expect(classifySwipe(5, -90, 200)).toBe('up');
    expect(classifySwipe(0, 90, 200)).toBe('down');
    expect(classifySwipe(-20, 0, 100)).toBeNull();
    expect(classifySwipe(-120, 0, SWIPE_MAX_MS + 1)).toBeNull();
    expect(classifySwipe(80, 80, 200)).toBeNull();
  });

  it('TR-08 · экран, где ждут смахивания, сообщает его движку; блок, с которого начали, называется', () => {
    const doc = docWith([{ id: 'karta001', type: 'shape', name: 'Карта', frame: { x: 0, y: 0, w: 100, h: 100 } }], [when({ kind: 'swipe', direction: 'left', on: 'screen' })]);
    const store = new RuntimeStore(createRuntime(doc, { seed: 1 }), () => undefined, { request: () => 1, cancel: () => undefined });
    const spy = vi.spyOn(store, 'dispatch');
    const host = mount(<PlayerScreen screen={doc.screens[0]!} store={store} />);
    const screen = host.querySelector<HTMLElement>('.bk-player-screen')!;
    expect(screen.style.touchAction).toBe('none');
    const card = host.querySelector<HTMLElement>('[data-block-id="karta001"]')!;
    fire(card, 'pointerdown', 300, 100);
    fire(card, 'pointerup', 180, 105);
    expect(spy.mock.calls.map((c) => c[0])).toContainEqual({ type: 'swipe', direction: 'left', blockId: 'karta001' } satisfies RuntimeEvent);
    spy.mockClear();
    fire(screen, 'pointerdown', 300, 100);
    fire(screen, 'pointerup', 305, 220);
    expect(spy.mock.calls.map((c) => c[0])).toEqual([{ type: 'swipe', direction: 'down' }]);
  });

  it('TR-08 · без правила на смахивание жесты не отслеживаются и страница прокручивается как обычно', () => {
    const doc = docWith([{ id: 'prosto01', type: 'shape', name: 'Фигура', frame: { x: 0, y: 0, w: 20, h: 20 } }], []);
    const store = new RuntimeStore(createRuntime(doc, { seed: 1 }), () => undefined, { request: () => 1, cancel: () => undefined });
    const spy = vi.spyOn(store, 'dispatch');
    const host = mount(<PlayerScreen screen={doc.screens[0]!} store={store} />);
    const screen = host.querySelector<HTMLElement>('.bk-player-screen')!;
    expect(screen.style.touchAction).toBe('');
    fire(screen, 'pointerdown', 300, 100);
    fire(screen, 'pointerup', 100, 100);
    expect(spy).not.toHaveBeenCalled();
  });

  it('TR-08 · блок, который тащат, не «смахивается»', () => {
    const doc = docWith([{ id: 'kubik001', type: 'shape', name: 'Кубик', frame: { x: 0, y: 0, w: 100, h: 100 }, behaviors: [{ kind: 'drag' }] }], [when({ kind: 'swipe', direction: 'right', on: 'screen' })]);
    const store = new RuntimeStore(createRuntime(doc, { seed: 1 }), () => undefined, { request: () => 1, cancel: () => undefined });
    const spy = vi.spyOn(store, 'dispatch');
    const host = mount(<PlayerScreen screen={doc.screens[0]!} store={store} />);
    const cube = host.querySelector<HTMLElement>('[data-block-id="kubik001"]')!;
    fire(cube, 'pointerdown', 100, 100);
    fire(cube, 'pointerup', 300, 100);
    expect(spy.mock.calls.filter((c) => c[0].type === 'swipe')).toEqual([]);
  });
});

describe('TR-15 · датчики в плеере', () => {
  it('TR-15 · экран, где ждут встряхивания, слушает датчик и сообщает его движку; после ухода с экрана слушатели сняты', () => {
    const doc = docWith([], [when({ kind: 'deviceMotion', motion: 'shake' })]);
    const store = new RuntimeStore(createRuntime(doc, { seed: 1 }), () => undefined, { request: () => 1, cancel: () => undefined });
    const spy = vi.spyOn(store, 'dispatch');
    const add = vi.spyOn(window, 'addEventListener');
    const remove = vi.spyOn(window, 'removeEventListener');
    const host = mount(<PlayerScreen screen={doc.screens[0]!} store={store} />);
    expect(add.mock.calls.map((c) => c[0])).toEqual(expect.arrayContaining(['devicemotion', 'deviceorientation']));
    let now = 0;
    vi.spyOn(Date, 'now').mockImplementation(() => now);
    for (const t of [0, 200]) {
      now = t;
      act(() => {
        const e = new Event('devicemotion');
        Object.assign(e, { acceleration: { x: 30, y: 0, z: 0 }, accelerationIncludingGravity: null });
        window.dispatchEvent(e);
      });
    }
    expect(spy.mock.calls.map((c) => c[0])).toContainEqual({ type: 'deviceMotion', motion: 'shake' });
    host.unmount();
    expect(remove.mock.calls.map((c) => c[0])).toEqual(expect.arrayContaining(['devicemotion', 'deviceorientation']));
  });

  it('TR-15 · без правила на датчики слушатели не ставятся', () => {
    const doc = docWith([], []);
    const store = new RuntimeStore(createRuntime(doc, { seed: 1 }), () => undefined, { request: () => 1, cancel: () => undefined });
    const add = vi.spyOn(window, 'addEventListener');
    mount(<PlayerScreen screen={doc.screens[0]!} store={store} />);
    expect(add.mock.calls.map((c) => c[0])).not.toContain('devicemotion');
  });
});
