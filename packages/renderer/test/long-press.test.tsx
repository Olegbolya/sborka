import { type RuntimeEvent } from '@blokum/engine';
import { act, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Artboard, BlockView, DEV_THEMES, LONG_PRESS_MAX_MS, LONG_PRESS_MIN_MS } from '../src/index.js';
import { block, media } from './helpers.js';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let clock = 0;
beforeEach(() => {
  vi.useFakeTimers();
  clock = 0;
  vi.spyOn(performance, 'now').mockImplementation(() => clock);
});
afterEach(() => {
  document.body.innerHTML = '';
  vi.useRealTimers();
  vi.restoreAllMocks();
});

function mount(node: ReactNode) {
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  const events: RuntimeEvent[] = [];
  act(() =>
    root.render(
      <Artboard mode="player" tokens={DEV_THEMES.light} media={media} dispatch={(e) => events.push(e)}>
        {node}
      </Artboard>,
    ),
  );
  return { host, events };
}
const fire = (el: Element, type: string, x = 50, y = 50, button = 0, pointerType = 'touch') =>
  act(() => {
    const e = new MouseEvent(type, { bubbles: true, clientX: x, clientY: y, button });
    Object.defineProperty(e, 'pointerId', { value: 1 });
    Object.defineProperty(e, 'pointerType', { value: pointerType });
    el.dispatchEvent(e);
  });
const wait = (ms: number) =>
  act(() => {
    clock += ms;
    vi.advanceTimersByTime(ms);
  });

describe('TR-03 · плеер сообщает движку, сколько блок держали', () => {
  const setup = () => {
    const b = block('button', { id: 'knopka01' });
    const m = mount(<BlockView block={b} />);
    return { ...m, el: m.host.querySelector<HTMLElement>('[data-block-id="knopka01"]')! };
  };

  it('TR-03 · нажали и держали — при отпускании событие с настоящим временем', () => {
    const { el, events } = setup();
    fire(el, 'pointerdown');
    wait(700);
    fire(el, 'pointerup');
    expect(events.filter((e) => e.type === 'longPress')).toEqual([{ type: 'longPress', blockId: 'knopka01', ms: 700 }]);
  });

  it('TR-03 · короткое нажатие и сдвинутый палец ничего не сообщают', () => {
    const { el, events } = setup();
    fire(el, 'pointerdown');
    wait(LONG_PRESS_MIN_MS - 50);
    fire(el, 'pointerup');
    fire(el, 'pointerdown', 50, 50);
    wait(800);
    fire(el, 'pointerup', 90, 50);
    expect(events.filter((e) => e.type === 'longPress')).toEqual([]);
  });

  it('TR-03 · держат дольше трёх секунд — событие уходит само, один раз; отпускание второе не добавляет', () => {
    const { el, events } = setup();
    fire(el, 'pointerdown');
    wait(LONG_PRESS_MAX_MS + 10);
    expect(events.filter((e) => e.type === 'longPress')).toEqual([{ type: 'longPress', blockId: 'knopka01', ms: LONG_PRESS_MAX_MS }]);
    wait(2000);
    fire(el, 'pointerup');
    expect(events.filter((e) => e.type === 'longPress')).toHaveLength(1);
  });

  it('TR-03 · отмена касания и правая кнопка мыши не считаются', () => {
    const { el, events } = setup();
    fire(el, 'pointerdown');
    wait(800);
    fire(el, 'pointercancel');
    fire(el, 'pointerup');
    fire(el, 'pointerdown', 50, 50, 2, 'mouse');
    wait(800);
    fire(el, 'pointerup');
    expect(events.filter((e) => e.type === 'longPress')).toEqual([]);
  });
});
