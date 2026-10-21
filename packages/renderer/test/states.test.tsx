import { type BlockView as RuntimeView } from '@blokum/engine';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Artboard, BlockView, DEV_THEMES, STATE_TRANSITION } from '../src/index.js';
import { block, media, render, styleOf } from './helpers.js';

const fill = (hex: string) => ({ fills: [{ kind: 'solid' as const, color: { hex } }] });
const styled = block('shape', {
  style: fill('#111111'),
  states: {
    hover: fill('#222222'),
    pressed: fill('#333333'),
    disabled: { ...fill('#444444'), effects: { opacity: 0.5 } },
  },
});

const view = (patch: Partial<RuntimeView>): RuntimeView => ({
  id: styled.id,
  protoId: styled.id,
  copy: false,
  parentId: null,
  visible: true,
  animateVisibility: false,
  interactive: true,
  dragging: false,
  zoneId: null,
  selected: false,
  x: 0,
  y: 0,
  w: 50,
  h: 50,
  rotation: 0,
  z: 0,
  overrides: {},
  anim: {},
  media: null,
  flipped: false,
  ...patch,
});

function mount(node: React.ReactNode) {
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  act(() => root.render(node));
  return { host, unmount: () => act(() => root.unmount()) };
}

const pointer = (type: string, pointerType: string) => {
  const e = new MouseEvent(type, { bubbles: true });
  Object.defineProperty(e, 'pointerType', { value: pointerType });
  return e;
};
const fillOf = (host: HTMLElement) => styleOf(host.querySelector('.bk-fill'));
/** The live DOM writes colours as rgb(); the static markup keeps HEX. */
const rgb = (hex: string) => `rgb(${[1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)).join(', ')})`;

afterEach(() => {
  vi.unstubAllGlobals();
  document.body.innerHTML = '';
});

describe('S-15: состояния в плеере', () => {
  it('S-15: наведение курсора и нажатие включают свои переопределения и снимаются', () => {
    const { host, unmount } = mount(
      <Artboard mode="player" tokens={DEV_THEMES.light} media={media}>
        <BlockView block={styled} />
      </Artboard>,
    );
    const el = host.querySelector<HTMLElement>('.bk-block')!;
    expect(fillOf(host)).toContain(rgb('#111111'));
    act(() => {
      el.dispatchEvent(pointer('pointerover', 'mouse'));
    });
    expect(el.dataset.state).toBe('hover');
    expect(fillOf(host)).toContain(rgb('#222222'));
    act(() => {
      el.dispatchEvent(pointer('pointerdown', 'mouse'));
    });
    expect(el.dataset.state).toBe('pressed');
    expect(fillOf(host)).toContain(rgb('#333333'));
    act(() => {
      el.dispatchEvent(pointer('pointerup', 'mouse'));
    });
    expect(el.dataset.state).toBe('hover');
    act(() => {
      el.dispatchEvent(new MouseEvent('pointerout', { bubbles: true, relatedTarget: document.body }));
    });
    expect(el.dataset.state).toBeUndefined();
    unmount();
  });

  it('S-15: касание пальцем — «нажато», без «наведения»', () => {
    const { host, unmount } = mount(
      <Artboard mode="player" tokens={DEV_THEMES.light} media={media}>
        <BlockView block={styled} />
      </Artboard>,
    );
    const el = host.querySelector<HTMLElement>('.bk-block')!;
    act(() => {
      el.dispatchEvent(pointer('pointerover', 'touch'));
    });
    expect(el.dataset.state).toBeUndefined();
    act(() => {
      el.dispatchEvent(pointer('pointerdown', 'touch'));
    });
    expect(el.dataset.state).toBe('pressed');
    act(() => {
      el.dispatchEvent(pointer('pointercancel', 'touch'));
    });
    expect(el.dataset.state).toBeUndefined();
    unmount();
  });

  it('S-15: блок, которому сценарий запретил взаимодействие (AC-18), — «недоступно»', () => {
    const views = new Map([[styled.id, view({ interactive: false })]]);
    const host = render(<BlockView block={styled} />, { mode: 'player', views });
    expect(host.querySelector('.bk-block')?.getAttribute('data-state')).toBe('disabled');
    expect(fillOf(host)).toContain('#444444');
    expect(styleOf(host.querySelector('.bk-block'))).toContain('opacity:0.5');
  });

  it('S-15: смена состояния плавная, кроме «уменьшить движение» и блоков без состояний', () => {
    expect(styleOf(render(<BlockView block={styled} />, { mode: 'player' }).querySelector('.bk-surface'))).toContain(
      'transition:opacity 160ms ease',
    );
    expect(STATE_TRANSITION).not.toContain('transform');
    expect(
      styleOf(render(<BlockView block={block('shape')} />, { mode: 'player' }).querySelector('.bk-block')),
    ).not.toContain('transition');
    // In the editor states are previewed by the panel, not by the pointer.
    expect(styleOf(render(<BlockView block={styled} />).querySelector('.bk-block'))).not.toContain('transition');
    vi.stubGlobal('matchMedia', (q: string) => ({
      matches: q.includes('reduce'),
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    }));
    expect(styleOf(render(<BlockView block={styled} />, { mode: 'player' }).querySelector('.bk-block'))).not.toContain(
      'transition',
    );
  });
});
