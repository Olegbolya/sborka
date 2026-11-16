import { type Block, type Screen, createBlock } from '@blokum/schema';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it } from 'vitest';
import { Artboard, DEV_THEMES, ScreenView, blockContent } from '../src/index.js';
import { media, screenOf } from './helpers.js';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/** Draws a screen in the editor and counts which blocks drew their content. */
function mount(screen: Screen) {
  const drawn: string[] = [];
  const renderContent = (block: Block, css: Parameters<typeof blockContent>[1], id: string) => {
    drawn.push(id);
    return blockContent(block, css, id);
  };
  const host = document.createElement('div');
  const root = createRoot(host);
  const draw = (s: Screen, tokens = DEV_THEMES.light) =>
    act(() =>
      root.render(
        <Artboard mode="editor" unit={1} tokens={tokens} media={media} renderContent={renderContent}>
          <ScreenView screen={s} />
        </Artboard>,
      ),
    );
  draw(screen);
  return { drawn, draw, unmount: () => act(() => root.unmount()) };
}

describe('E-05 · перетаскивание не перерисовывает весь экран', () => {
  const blocks = Array.from({ length: 30 }, (_, i) => createBlock('shape', { id: `figura${String(i).padStart(2, '0')}`, frame: { x: 10, y: i * 20, w: 50, h: 18 } }));

  it('E-05: сдвиг одного блока перерисовывает только его; смена темы — все блоки', () => {
    const screen = screenOf(blocks);
    const { drawn, draw, unmount } = mount(screen);
    expect(drawn).toHaveLength(30);
    drawn.length = 0;
    // The store keeps unchanged blocks as the same objects (immer): only the moved one is new.
    const moved: Screen = { ...screen, blocks: screen.blocks.map((b, i) => (i === 7 ? { ...b, frame: { ...b.frame, x: b.frame.x + 5 } } : b)) };
    draw(moved);
    expect(drawn).toEqual(['figura07']);
    drawn.length = 0;
    draw(moved, DEV_THEMES.dark);
    expect(drawn).toHaveLength(30);
    unmount();
  });
});
