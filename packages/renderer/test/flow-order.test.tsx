import { type BlockView as RuntimeView } from '@blokum/engine';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';
import { Artboard, BlockView, DEV_THEMES } from '../src/index.js';
import { block, media } from './helpers.js';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
afterEach(() => (document.body.innerHTML = ''));

const view = (id: string, patch: Partial<RuntimeView> = {}): RuntimeView => ({ id, protoId: id, copy: false, parentId: null, visible: true, animateVisibility: false, interactive: true, dragging: false, zoneId: null, selected: false, x: 0, y: 0, w: 100, h: 80, rotation: 0, z: 0, overrides: {}, anim: {}, media: null, flipped: false, ...patch });

describe('AC-20 · порядок блоков сетки после «Перемешать» доходит до экрана', () => {
  it('AC-20 · блок в потоке получает CSS-порядок из состояния движка; без порядка — стоит по документу', () => {
    const host = document.createElement('div');
    document.body.append(host);
    const a = block('shape', { id: 'kartaa' });
    const c = block('shape', { id: 'kartac' });
    act(() =>
      createRoot(host).render(
        <Artboard mode="player" tokens={DEV_THEMES.light} media={media} views={new Map([['kartaa', view('kartaa', { order: 3 })], ['kartac', view('kartac')]])}>
          <BlockView block={a} inFlow />
          <BlockView block={c} inFlow />
        </Artboard>,
      ),
    );
    expect(host.querySelector<HTMLElement>('[data-block-id="kartaa"]')!.style.order).toBe('3');
    expect(host.querySelector<HTMLElement>('[data-block-id="kartac"]')!.style.order).toBe('');
  });
});
