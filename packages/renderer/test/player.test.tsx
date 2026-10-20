import { createRuntime } from '@blokum/engine';
import { ProjectDocument, type RuleInput, textOf } from '@blokum/schema';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it, vi } from 'vitest';
import { Artboard, DEV_THEMES, type FrameScheduler, MAX_FRAME_MS, PlayerScreen, RuntimeStore } from '../src/index.js';
import { media } from './helpers.js';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/** Manual frame clock for tests: `frame(ms)` advances time by `ms` and runs the pending callback. */
function manualFrames(): FrameScheduler & { frame: (ms: number) => void; pending: () => boolean } {
  let cb: ((t: number) => void) | null = null;
  let now = 1000;
  return {
    request: (fn) => {
      cb = fn;
      return 1;
    },
    cancel: () => {
      cb = null;
    },
    frame: (ms) => {
      now += ms;
      const run = cb;
      cb = null;
      run?.(now);
    },
    pending: () => cb !== null,
  };
}

const rules: RuleInput[] = [
  { id: 'pravilo01', when: { kind: 'tap', source: { kind: 'block', blockId: 'knopka' } }, do: [{ kind: 'setVariable', variableId: 'schet01', op: 'add', value: 1 }, { kind: 'visibility', targets: [{ kind: 'block', blockId: 'priz01' }], mode: 'show' }] },
  { id: 'pravilo02', when: { kind: 'timer', mode: 'after', seconds: 1 }, do: [{ kind: 'spawn', prototypeId: 'zvezda', at: { kind: 'point', point: { x: 100, y: 100 } } }, { kind: 'effect', effect: 'confetti' }] },
  { id: 'pravilo03', when: { kind: 'key', key: 'Enter' }, do: [{ kind: 'goTo', to: 'next' }] },
];

const doc = ProjectDocument.parse({
  schemaVersion: 1,
  variables: [{ id: 'schet01', name: 'счёт', type: 'number', initial: 0 }],
  screens: [
    {
      id: 'ekran1',
      name: 'Игра',
      rules,
      blocks: [
        { id: 'knopka', type: 'button', name: 'Кнопка', frame: { x: 0, y: 0, w: 100, h: 50 }, textLayer: textOf('Жми'), props: {} },
        { id: 'priz01', type: 'shape', name: 'Приз', frame: { x: 0, y: 100, w: 50, h: 50 }, initiallyHidden: true, props: {} },
        { id: 'zvezda', type: 'shape', name: 'Звезда', frame: { x: 0, y: 200, w: 20, h: 20 }, initiallyHidden: true, props: {} },
      ],
    },
  ],
});

describe('адаптер движка сценариев', () => {
  it('P1.3: изменения за кадр применяются вместе, перерисовка — только при изменениях', () => {
    const frames = manualFrames();
    const onEffects = vi.fn();
    const store = new RuntimeStore(createRuntime(doc, { seed: 1 }), onEffects, frames);
    const listener = vi.fn();
    store.subscribe(listener);
    store.enter('ekran1');
    expect(store.views.get('priz01')?.visible).toBe(false);
    expect(listener).toHaveBeenCalledTimes(1);
    store.start();
    store.start();
    frames.frame(16);
    expect(listener).toHaveBeenCalledTimes(1);
    store.dispatch({ type: 'tap', blockId: 'knopka' });
    expect(store.views.get('priz01')?.visible).toBe(true);
    expect(store.getSnapshot()).toBe(2);
    frames.frame(5000);
    expect(store.runtime.now).toBe(MAX_FRAME_MS);
    for (let i = 0; i < 10; i++) frames.frame(100);
    expect(store.views.get('zvezda~1')).toMatchObject({ copy: true, x: 100, y: 100 });
    expect(onEffects).toHaveBeenCalledWith([{ type: 'effect', effect: 'confetti', intensity: 1 }]);
    store.stop();
    expect(frames.pending()).toBe(false);
    store.dispatch({ type: 'key', key: 'Enter' });
    expect(onEffects).toHaveBeenLastCalledWith([{ type: 'navigate', to: 'next' }]);
    store.leave();
  });

  it('P1.3: экран в плеере — нажатие проходит в движок, копии рисуются, клавиатура слушается', () => {
    const frames = manualFrames();
    const onEffects = vi.fn();
    const store = new RuntimeStore(createRuntime(doc, { seed: 1 }), onEffects, frames);
    const host = document.createElement('div');
    document.body.append(host);
    const root = createRoot(host);
    act(() => {
      root.render(
        <Artboard mode="player" tokens={DEV_THEMES.light} media={media}>
          <PlayerScreen screen={doc.screens[0]!} store={store} />
        </Artboard>,
      );
    });
    expect(host.querySelector('[data-block-id="priz01"]')).toBeNull();
    act(() => {
      (host.querySelector('[data-block-id="knopka"]') as HTMLElement).click();
    });
    expect(host.querySelector('[data-block-id="priz01"]')).not.toBeNull();
    act(() => {
      for (let i = 0; i < 12; i++) frames.frame(100);
    });
    expect(host.querySelector('[data-block-id="zvezda~1"]')).not.toBeNull();
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
    });
    expect(onEffects).toHaveBeenLastCalledWith([{ type: 'navigate', to: 'next' }]);
    act(() => {
      host.querySelector('[data-block-id="knopka"]')!.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    });
    act(() => root.unmount());
    expect(frames.pending()).toBe(false);
    host.remove();
  });
});
