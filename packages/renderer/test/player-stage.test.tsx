import { createRuntime } from '@blokum/engine';
import { ProjectDocument, type Transition } from '@blokum/schema';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { media } from './helpers.js';

// Motion is replaced by a recorder: which layers are animated is checked here, how it looks — in e2e.
const calls: Array<{ el: Element; keyframes: Record<string, unknown> }> = [];
const finishers: Array<() => void> = [];
vi.mock('motion', () => ({
  animate: vi.fn((el: Element, keyframes: Record<string, unknown>) => {
    calls.push({ el, keyframes });
    return { finished: new Promise<void>((r) => finishers.push(r)), stop: vi.fn() };
  }),
}));
const { Artboard, DEV_THEMES, PlayerStage, RuntimeStore } = await import('../src/index.js');

const doc = ProjectDocument.parse({
  schemaVersion: 1,
  screens: [
    { id: 'ekran01', name: 'Первый', blocks: [{ id: 'tekst001', type: 'text', name: 'Т', frame: { x: 0, y: 0, w: 200, h: 40 } }] },
    { id: 'ekran02', name: 'Второй', blocks: [{ id: 'tekst002', type: 'text', name: 'Т', frame: { x: 0, y: 0, w: 200, h: 40 } }], transitionIn: { kind: 'zoom', direction: 'left', durationMs: 500, delayMs: 0, easing: { kind: 'preset', name: 'easeOut' }, blur: 0, scale: 1 } },
  ],
});
const slide: Transition = { kind: 'slide', direction: 'left', durationMs: 300, delayMs: 0, easing: { kind: 'preset', name: 'easeOut' }, blur: 0, scale: 1 };

function mount() {
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  const store = new RuntimeStore(createRuntime(doc, { seed: 1 }), () => undefined, { request: () => 1, cancel: () => undefined });
  const draw = (screenId: string, transition: Transition | null) =>
    act(() =>
      root.render(
        <Artboard mode="player" tokens={DEV_THEMES.light} media={media}>
          <PlayerStage screen={doc.screens.find((s) => s.id === screenId)!} screenKey={0} transition={transition} store={store} />
        </Artboard>,
      ),
    );
  return { host, draw, unmount: () => act(() => root.unmount()) };
}

afterEach(() => {
  calls.length = 0;
  document.body.innerHTML = '';
});

describe('T-01…T-08, T-30 · переход между экранами в плеере', () => {
  it('T-01 · без перехода от ветки работает «переход при входе» экрана: уходящий экран — картинка, приходящий — живой', async () => {
    const m = mount();
    m.draw('ekran01', null);
    expect(m.host.querySelector('.bk-screen-out')).toBeNull();
    m.draw('ekran02', null);
    expect(m.host.querySelector('.bk-screen-in')?.getAttribute('data-transition')).toBe('zoom');
    expect(m.host.querySelector('.bk-screen-out .bk-player-leaving')).not.toBeNull();
    expect(m.host.querySelectorAll('.bk-player-screen')).toHaveLength(1);
    expect(m.host.querySelector('.bk-screen-in .bk-player-screen [data-block-id="tekst002"]')).not.toBeNull();
    expect(calls.map((c) => (c.el as HTMLElement).className).sort()).toEqual(['bk-screen-in', 'bk-screen-out']);
    await act(async () => {
      for (const f of finishers) f();
      await new Promise((r) => setTimeout(r, 0));
    });
    expect(m.host.querySelector('.bk-screen-out')).toBeNull();
    m.unmount();
  });

  it('T-30 · переход ветки или действия «перейти» важнее перехода экрана', () => {
    const m = mount();
    m.draw('ekran01', null);
    m.draw('ekran02', slide);
    expect(m.host.querySelector('.bk-screen-in')?.getAttribute('data-transition')).toBe('slide');
    m.unmount();
  });
});
