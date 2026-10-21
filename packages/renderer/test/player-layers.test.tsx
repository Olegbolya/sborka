import { type MediaOverlay, ParticlesConfig, type Screen, type Transition } from '@blokum/schema';
import { act, createRef, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { EffectsHandle, ParticleLayerHandle } from '../src/index.js';
import { block, media, screenOf } from './helpers.js';

// Motion is replaced by a recorder: what is animated is checked here, how it looks — in e2e (P1.7 gallery).
const calls: Array<{ el: Element; keyframes: Record<string, unknown>; options: Record<string, unknown> }> = [];
vi.mock('motion', () => ({
  animate: vi.fn((el: Element, keyframes: Record<string, unknown>, options: Record<string, unknown>) => {
    calls.push({ el, keyframes, options });
    return { finished: Promise.resolve(), stop: vi.fn() };
  }),
}));

const {
  Artboard,
  BlockView,
  DEV_THEMES,
  EffectsLayer,
  MediaOverlayView,
  ParticleLayer,
  ScreenStage,
  ScreenView,
  SoundManager,
} = await import('../src/index.js');

const flush = () => act(async () => new Promise((r) => setTimeout(r, 0)));
const sound = () => {
  const s = new SoundManager(media, true, () => ({
    play: () => Promise.resolve(),
    pause: () => undefined,
    loop: false,
    volume: 1,
    currentTime: 0,
  }));
  vi.spyOn(s, 'play');
  return s;
};

function mount(
  node: (extra: { sound?: InstanceType<typeof SoundManager> }) => ReactNode,
  extra: { sound?: InstanceType<typeof SoundManager> } = {},
) {
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  const draw = (n: ReactNode) =>
    act(() =>
      root.render(
        <Artboard
          mode="player"
          tokens={DEV_THEMES.light}
          media={media}
          {...(extra.sound ? { sound: extra.sound } : {})}
        >
          {n}
        </Artboard>,
      ),
    );
  draw(node(extra));
  return { host, rerender: draw, unmount: () => act(() => root.unmount()) };
}

const reduceMotion = () =>
  vi.stubGlobal('matchMedia', (q: string) => ({
    matches: q.includes('reduce'),
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  }));

beforeEach(() => {
  calls.length = 0;
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
  document.body.innerHTML = '';
});

const a = screenOf([block('text', { textLayer: { paragraphs: [{ kind: 'p', runs: [{ t: 'А' }] }] } })], {
  id: 'ekran-aaa',
});
const b: Screen = {
  ...screenOf([block('text', { textLayer: { paragraphs: [{ kind: 'p', runs: [{ t: 'Б' }] }] } })], { id: 'ekran-bbb' }),
};
const stage = (screen: Screen, transition?: Transition, overlay?: MediaOverlay | null) => (
  <ScreenStage screen={screen} {...(transition ? { transition } : {})} overlay={overlay ?? null}>
    {(s) => <ScreenView screen={s} />}
  </ScreenStage>
);
const slide: Transition = {
  kind: 'slide',
  direction: 'left',
  durationMs: 300,
  delayMs: 0,
  easing: { kind: 'preset', name: 'easeOut' },
  blur: 0,
  scale: 1,
};
const meme: MediaOverlay = {
  media: { source: 'media', id: 'gifka00001' },
  seconds: 0.3,
  caption: {
    text: 'УРА',
    position: 'top',
    font: { kind: 'system', name: 'sans' },
    size: 30,
    color: { hex: '#FFFFFF' },
    outline: 2,
  },
  skippable: true,
};

describe('T-30 · T-31 · T-20: смена экранов', () => {
  it('T-30: первый экран без перехода; смена экрана анимирует уходящий и приходящий слои, потом старый удаляется', async () => {
    const s = sound();
    const view = mount(() => stage(a), { sound: s });
    expect(calls).toHaveLength(0);
    expect(view.host.querySelector('.bk-screen-in')?.getAttribute('data-transition')).toBe('none');
    view.rerender(stage(b, slide));
    expect(view.host.querySelector('.bk-screen-in')?.getAttribute('data-transition')).toBe('slide');
    expect(view.host.querySelector('.bk-screen-out')).not.toBeNull();
    expect(calls.map((c) => (c.el as HTMLElement).className).sort()).toEqual(['bk-screen-in', 'bk-screen-out']);
    expect(Object.keys(calls[0]!.keyframes)).toContain('--bk-ax');
    expect(s.play).toHaveBeenCalled();
    await flush();
    expect(view.host.querySelector('.bk-screen-out')).toBeNull();
    expect(view.host.querySelector('.bk-screen-in')?.textContent).toContain('Б');
    view.unmount();
  });

  it('T-31: при «уменьшить движение» любой переход — короткое проявление', async () => {
    reduceMotion();
    const view = mount(() => stage(a));
    view.rerender(stage(b, slide));
    expect(view.host.querySelector('.bk-screen-in')?.getAttribute('data-transition')).toBe('fade');
    expect(calls.every((c) => Object.keys(c.keyframes).every((k) => k === 'opacity'))).toBe(true);
    expect(calls[0]!.options.duration).toBeCloseTo(0.2);
    await flush();
    view.unmount();
  });

  it('T-20: медиа-переход показывается до нового экрана, нажатие пропускает его', async () => {
    const view = mount(() => stage(a));
    view.rerender(stage(b, { kind: 'media', overlay: meme }));
    const overlay = view.host.querySelector<HTMLElement>('.bk-media-overlay')!;
    expect(overlay.querySelector('.bk-meme-caption')?.textContent).toBe('УРА');
    expect(view.host.querySelector('.bk-screen-out')).toBeNull();
    expect(calls).toHaveLength(0);
    act(() => {
      overlay.click();
    });
    expect(view.host.querySelector('.bk-media-overlay')).toBeNull();
    // The meme is the transition itself: the new screen is already there, with no second animation.
    expect(view.host.querySelector('.bk-screen-in')?.textContent).toContain('Б');
    expect(view.host.querySelector('.bk-screen-out')).toBeNull();
    expect(calls).toHaveLength(0);
    await flush();
    view.unmount();
  });

  it('T-21: вставка по ответу приходит отдельно от перехода', async () => {
    const view = mount(() => stage(a));
    view.rerender(stage(b, undefined, meme));
    expect(view.host.querySelector('.bk-media-overlay')).not.toBeNull();
    await flush();
    view.unmount();
  });
});

describe('T-20 · AC-08: медиа-вставка', () => {
  it('T-20: уходит сама через заданное время и играет свой звук', () => {
    vi.useFakeTimers();
    const s = sound();
    const done = vi.fn();
    const withSound = { ...meme, sound: { source: 'media' as const, id: 'zvuk00001' } };
    const view = mount(() => <MediaOverlayView overlay={withSound} onDone={done} />, { sound: s });
    expect(s.play).toHaveBeenCalledWith(withSound.sound);
    expect(view.host.querySelector('[role="dialog"]')?.getAttribute('aria-label')).toBe('УРА');
    vi.advanceTimersByTime(299);
    expect(done).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(done).toHaveBeenCalledTimes(1);
    view.unmount();
  });

  it('T-20: видео-вставка, без подписи и без пропуска', () => {
    const done = vi.fn();
    const view = mount(() => (
      <MediaOverlayView
        overlay={{ media: { source: 'media', id: 'video00001' }, seconds: 2, skippable: false }}
        onDone={done}
      />
    ));
    expect(view.host.querySelector('video')?.getAttribute('src')).toContain('video00001.mp4');
    expect(view.host.querySelector('.bk-meme-caption')).toBeNull();
    expect(view.host.textContent).not.toContain('пропустить');
    act(() => {
      view.host.querySelector<HTMLElement>('.bk-media-overlay')!.click();
    });
    expect(done).not.toHaveBeenCalled();
    view.unmount();
  });
});

describe('P-01…P-08 · AC-07: слой частиц и эффекты', () => {
  const fakeContext = () => {
    const g = {
      setTransform: vi.fn(),
      clearRect: vi.fn(),
      drawImage: vi.fn(),
      translate: vi.fn(),
      beginPath: vi.fn(),
      arc: vi.fn(),
      fill: vi.fn(),
      stroke: vi.fn(),
      fillRect: vi.fn(),
      moveTo: vi.fn(),
      lineTo: vi.fn(),
      bezierCurveTo: vi.fn(),
      quadraticCurveTo: vi.fn(),
      ellipse: vi.fn(),
      closePath: vi.fn(),
      globalAlpha: 1,
      fillStyle: '',
      strokeStyle: '',
      lineWidth: 1,
    };
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(g as unknown as CanvasRenderingContext2D);
    return g;
  };

  it('P-01: в плеере частицы рисуются спрайтами — по одному drawImage на частицу', () => {
    vi.useFakeTimers({ toFake: ['requestAnimationFrame', 'cancelAnimationFrame', 'performance'] });
    const g = fakeContext();
    const view = mount(() => (
      <ParticleLayer config={ParticlesConfig.parse({ preset: 'confetti', density: 1 })} width={390} height={844} />
    ));
    expect(view.host.querySelector('canvas.bk-particles')).not.toBeNull();
    vi.advanceTimersByTime(40);
    expect(g.clearRect).toHaveBeenCalled();
    const frames = g.clearRect.mock.calls.length;
    expect(g.drawImage.mock.calls.length).toBe(frames * 200);
    view.unmount();
    vi.restoreAllMocks();
  });

  it('P-08: свои картинки рисуются, когда загрузились', () => {
    vi.useFakeTimers({ toFake: ['requestAnimationFrame', 'cancelAnimationFrame', 'performance'] });
    const g = fakeContext();
    Object.defineProperty(HTMLImageElement.prototype, 'complete', { configurable: true, get: () => true });
    Object.defineProperty(HTMLImageElement.prototype, 'naturalWidth', { configurable: true, get: () => 64 });
    const view = mount(() => (
      <ParticleLayer
        config={ParticlesConfig.parse({
          preset: 'custom',
          density: 0.1,
          images: [{ source: 'media', id: 'snezhinka1' }],
        })}
        width={390}
        height={844}
      />
    ));
    vi.advanceTimersByTime(20);
    const img = g.drawImage.mock.calls[0]?.[0] as HTMLImageElement;
    expect(img.src).toContain('snezhinka1.webp');
    view.unmount();
    delete (HTMLImageElement.prototype as unknown as Record<string, unknown>).complete;
    delete (HTMLImageElement.prototype as unknown as Record<string, unknown>).naturalWidth;
    vi.restoreAllMocks();
  });

  it('T-31: без частиц при «уменьшить движение» и вне плеера', () => {
    reduceMotion();
    const cfg = ParticlesConfig.parse({ preset: 'snow' });
    expect(
      mount(() => <ParticleLayer config={cfg} width={390} height={844} />).host.querySelector('canvas'),
    ).toBeNull();
  });

  it('AC-07: вибрация, вспышка, тряска и конфетти; при «уменьшить движение» — без тряски', () => {
    const vibrate = vi.fn();
    vi.stubGlobal('navigator', { ...navigator, vibrate });
    const target = { current: document.createElement('div') };
    const fx = createRef<EffectsHandle>();
    const view = mount(() => (
      <EffectsLayer width={390} height={844} shakeTarget={target} colors={['#FF0000']} ref={fx} />
    ));
    fx.current!.run({ effect: 'vibrate', intensity: 2 });
    expect(vibrate).toHaveBeenCalledWith(120);
    fx.current!.run({ effect: 'flash', intensity: 1 });
    expect((calls.at(-1)!.el as HTMLElement).className).toBe('bk-flash');
    fx.current!.run({ effect: 'shake', intensity: 1 });
    expect(calls.at(-1)!.el).toBe(target.current);
    fx.current!.run({ effect: 'confetti', intensity: 1 });
    fx.current!.run({ effect: 'burst', intensity: 1, at: { x: 10, y: 10 } });
    view.unmount();
    reduceMotion();
    calls.length = 0;
    const calm = createRef<EffectsHandle>();
    const v2 = mount(() => <EffectsLayer width={390} height={844} shakeTarget={target} colors={[]} ref={calm} />);
    calm.current!.run({ effect: 'shake', intensity: 1 });
    expect(calls).toHaveLength(0);
    calm.current!.run({ effect: 'flash', intensity: 1 });
    expect(calls[0]!.options.duration).toBeCloseTo(0.15);
    v2.unmount();
  });

  it('T-07: переход «в частицы» выпускает частицы из экрана', async () => {
    const handle = createRef<ParticleLayerHandle>();
    const view = mount(() => <ParticleLayer config={null} width={390} height={844} ref={handle} />);
    expect(() => handle.current!.burst(10, 10, 5, 'burst', ['#000000'])).not.toThrow();
    view.rerender(stage(a));
    view.rerender(stage(b, { ...slide, kind: 'particles' }));
    expect(view.host.querySelector('.bk-screen-in')?.getAttribute('data-transition')).toBe('particles');
    await flush();
    view.unmount();
  });
});

describe('S-12 · S-13 · S-14: анимации блока в плеере', () => {
  it('S-12: появление, затем постоянная; нажатие — реакция; уход — затухание', async () => {
    const animated = block('shape', {
      animation: { enter: { kind: 'zoom' }, loop: { kind: 'pulse' }, press: { kind: 'grow' } },
    });
    const view = mount(() => <BlockView block={animated} />);
    const layer = view.host.querySelector('.bk-anim')!;
    expect(calls[0]!.el).toBe(layer);
    expect(calls[0]!.keyframes).toHaveProperty('--bk-as');
    await flush();
    expect(calls.length).toBe(2);
    expect(calls[1]!.options.repeat).toBe(Infinity);
    const el = view.host.querySelector<HTMLElement>('.bk-block')!;
    act(() => {
      el.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }));
    });
    expect(calls.length).toBe(3);
    act(() => {
      el.dispatchEvent(new MouseEvent('pointerup', { bubbles: true }));
    });
    expect(calls.length).toBe(4);
    view.unmount();
  });

  it('S-14: короткая реакция (подпрыгивание) сама возвращает блок', async () => {
    const bouncy = block('shape', { animation: { press: { kind: 'bounce' } } });
    const view = mount(() => <BlockView block={bouncy} />);
    act(() => {
      view.host
        .querySelector<HTMLElement>('.bk-block')!
        .dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }));
    });
    await flush();
    expect(calls.length).toBe(2);
    expect(calls[1]!.options.duration).toBeCloseTo(0.12);
    view.unmount();
  });
});
