import { createBlock, textOf } from '@blokum/schema';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { Artboard, BlockView, DEV_THEMES, PLAYER_UNIT, ScreenView, childInstanceId } from '../src/index.js';
import { block, render, screenOf, styleOf, themes } from './helpers.js';

describe('E-01 · E-02: артборд и единица размера', () => {
  it('E-02: в плеере единица — CSS-переменная от ширины окна с колонкой 480 px, без transform: scale', () => {
    const host = render(<ScreenView screen={screenOf([block('text', { textLayer: textOf('Привет') })])} />, { mode: 'player', unit: undefined });
    const stage = host.querySelector('.bk-stage')!;
    const board = host.querySelector('.bk-artboard')!;
    expect(PLAYER_UNIT).toBe('calc(min(100vw, 480px) / 390)');
    expect(styleOf(stage)).toContain('--u:calc(min(100vw, 480px) / 390)');
    expect(styleOf(board)).toContain('width:calc(390 * var(--u))');
    for (const el of [stage, board, ...host.querySelectorAll('.bk-screen')]) expect(styleOf(el)).not.toMatch(/scale\(/);
    expect(styleOf(stage)).toContain(`background-color:${DEV_THEMES.light.colors.background}`);
  });

  it('E-02: в редакторе и миниатюре — единица в пикселях (масштаб холста)', () => {
    expect(styleOf(render(<span />, { mode: 'editor', unit: 1.5 }).querySelector('.bk-artboard'))).toContain('--u:1.5px');
    const thumb = render(<ScreenView screen={screenOf([block('shape')])} />, { mode: 'thumbnail', unit: 0.4 });
    expect(styleOf(thumb.querySelector('.bk-artboard'))).toContain('--u:0.4px');
    expect(styleOf(thumb.querySelector('.bk-block'))).toContain('pointer-events:none');
  });

  it('E-01: экран — 390 единиц шириной и своей высоты, фон темы или свой', () => {
    const host = render(<ScreenView screen={screenOf([], { height: 1200 })} />);
    expect(styleOf(host.querySelector('.bk-screen'))).toContain('height:calc(1200 * var(--u))');
    expect(styleOf(host.querySelector('.bk-screen-bg'))).toContain('linear-gradient(#F6F4EF, #F6F4EF)');
    const own = render(<ScreenView screen={screenOf([], { background: [{ kind: 'solid', color: { hex: '#000000' } }] })} />);
    expect(styleOf(own.querySelector('.bk-screen-bg'))).toContain('linear-gradient(#000000, #000000)');
    const video = render(<ScreenView screen={screenOf([], { background: [{ kind: 'media', media: { source: 'media', id: 'video00001' }, fit: 'cover', focal: { x: 0.5, y: 0.5 }, scale: 1 }] })} />);
    expect(video.querySelector('.bk-screen video')?.getAttribute('src')).toBe('https://media.blokum.ru/video00001.mp4');
  });

  it('E-02: фон темы вокруг колонки — и цветом, и видео', () => {
    const tokens = { ...themes.dark, background: [{ kind: 'media' as const, media: { source: 'media' as const, id: 'video00009' }, fit: 'cover' as const, focal: { x: 0.5, y: 0.5 }, scale: 1 }, { kind: 'solid' as const, color: { hex: '#00000080' } }] };
    const host = render(<span />, { mode: 'player', unit: undefined, tokens });
    expect(host.querySelector('.bk-stage > video')?.getAttribute('src')).toBe('https://media.blokum.ru/video00009.mp4');
    expect(styleOf(host.querySelectorAll('.bk-stage > div')[0])).toContain('position:fixed');
  });
});

describe('E-03: свободное позиционирование блоков', () => {
  it('E-03: абсолютные координаты и размер в единицах, поворот и отражение', () => {
    const b = block('shape', { frame: { x: 20, y: 40, w: 100, h: 60, rotation: 15, flipX: true, flipY: false } });
    const s = styleOf(render(<BlockView block={b} />).querySelector('.bk-block'));
    expect(s).toContain('position:absolute');
    expect(s).toContain('left:calc(20 * var(--u))');
    expect(s).toContain('top:calc(40 * var(--u))');
    expect(s).toContain('width:calc(100 * var(--u))');
    expect(s).toContain('height:calc(60 * var(--u))');
    expect(s).toContain('transform:rotate(15deg) scale(-1, 1)');
  });

  it('E-03: вложенные блоки рисуются внутри родителя, автовысота задаёт минимальную высоту', () => {
    const inner = createBlock('shape', { id: 'vnutri01', frame: { x: 5, y: 5, w: 10, h: 10 } });
    const box = block('container', { children: [inner], style: { autoHeight: true } });
    const host = render(<BlockView block={box} />);
    expect(host.querySelector('[data-type="container"] .bk-content [data-block-id="vnutri01"]')).not.toBeNull();
    expect(styleOf(host.querySelector('[data-type="container"]'))).toContain('min-height:calc(200 * var(--u))');
  });

  it.each(['image', 'zone', 'shape', 'video', 'container', 'button'] as const)('B-01: текстовый слой у блока «%s»', (type) => {
    const host = render(<BlockView block={block(type, { textLayer: { paragraphs: [{ kind: 'p', runs: [{ t: 'Ёлка', b: true }] }, { kind: 'bullet', runs: [{ t: 'Шар' }] }, { kind: 'bullet', runs: [{ t: 'Звезда', i: true, u: true, s: true }] }, { kind: 'ordered', runs: [{ t: 'Раз' }] }] } })} />);
    expect(host.querySelector('.bk-text strong')?.textContent).toBe('Ёлка');
    expect(host.querySelectorAll('.bk-text ul li')).toHaveLength(2);
    expect(host.querySelector('.bk-text ol li')?.textContent).toBe('Раз');
    expect(host.querySelector('.bk-text s u em')?.textContent ?? host.querySelector('.bk-text em')?.textContent).toBe('Звезда');
  });

  it('L-05: подстановки в редакторе видны как метки, в плеере — значениями; ссылки — только в плеере', () => {
    const text = { paragraphs: [{ kind: 'p' as const, runs: [{ sys: 'баллы' as const }, { v: 'peremen01' }, { answer: 'vopros001' }, { t: 'сайт', href: 'https://blokum.ru/' }] }] };
    const editor = render(<BlockView block={block('text', { textLayer: text })} />);
    expect(editor.querySelector('.bk-text')?.textContent).toBe('{{баллы}}{{переменная}}{{ответ}}сайт');
    expect(editor.querySelector('a')).toBeNull();
    const player = render(<BlockView block={block('text', { textLayer: text })} />, { mode: 'player', runText: (run) => ('sys' in run ? '7' : 'v' in run ? ' очков ' : null), linkHref: (u) => `/go?u=${encodeURIComponent(u)}` });
    expect(player.querySelector('.bk-text')?.textContent).toBe('7 очков сайт');
    expect(player.querySelector('a')?.getAttribute('href')).toBe('/go?u=https%3A%2F%2Fblokum.ru%2F');
    expect(player.querySelector('a')?.getAttribute('rel')).toBe('noopener noreferrer nofollow');
  });

  it('S-10: текст по дуге и по кругу — SVG с размером в единицах', () => {
    const arc = render(<BlockView block={block('text', { textLayer: textOf('С Новым годом'), style: { text: { path: { kind: 'arc', curvature: 0.5 }, size: 24 } } })} />);
    expect(arc.querySelector('svg textPath')?.textContent).toBe('С Новым годом');
    expect(arc.querySelector('svg text')?.getAttribute('font-size')).toBe('24');
    const circle = render(<BlockView block={block('text', { textLayer: textOf('Кругом'), style: { text: { path: { kind: 'circle' }, paint: { kind: 'linear', stops: [{ offset: 0, color: { hex: '#FF0000' } }, { offset: 1, color: { hex: '#00FF00' } }] } } } })} />);
    expect(circle.querySelector('svg path')?.getAttribute('d')).toContain(' a ');
    expect(circle.querySelector('svg text')?.getAttribute('fill')).toBe('transparent');
  });

  it('S-16 · S-17: скрытые блоки в редакторе и плеере', () => {
    const hidden = block('shape', { initiallyHidden: true });
    expect(styleOf(render(<BlockView block={hidden} />).querySelector('.bk-block'))).toContain('opacity:0.35');
    expect(render(<BlockView block={hidden} />, { mode: 'player' }).querySelector('.bk-block')).toBeNull();
    expect(render(<BlockView block={block('shape', { hiddenInEditor: true })} />).querySelector('.bk-block')).toBeNull();
    expect(render(<BlockView block={block('shape', { hiddenInEditor: true })} />, { mode: 'player' }).querySelector('.bk-block')).not.toBeNull();
  });

  it('S-17: подпись для доступности', () => {
    const el = render(<BlockView block={block('image', { a11y: { alt: 'Ёлка', label: 'Ёлка во дворе' } })} />).querySelector('.bk-block');
    expect(el?.getAttribute('aria-label')).toBe('Ёлка во дворе');
    expect(el?.getAttribute('role')).toBe('img');
  });

  it('S-15: состояние блока меняет вычисленный стиль', () => {
    const b = block('shape', { style: { fills: [{ kind: 'solid', color: { hex: '#111111' } }] }, states: { selected: { fills: [{ kind: 'solid', color: { hex: '#EEEEEE' } }] } } });
    expect(styleOf(render(<BlockView block={b} />).querySelector('.bk-fill'))).toContain('#111111');
    expect(styleOf(render(<BlockView block={b} state="selected" />).querySelector('.bk-fill'))).toContain('#EEEEEE');
  });

  it('P1.3: копии блока получают свои id, вложенные — с тем же номером', () => {
    expect(childInstanceId('zvezda~3', createBlock('shape', { id: 'luch0001' }))).toBe('luch0001~3');
    expect(childInstanceId('zvezda', createBlock('shape', { id: 'luch0001' }))).toBe('luch0001');
  });
});

describe('TH-06: смена темы и ручные правки', () => {
  const byTheme = (b: ReturnType<typeof block>, theme: 'light' | 'dark') => render(<BlockView block={b} />, { tokens: themes[theme] });

  it('TH-06: ручное свойство сохраняется при смене темы, токенное и тематическое — меняется', () => {
    const own = block('button', { style: { radius: { tl: 2, tr: 2, br: 2, bl: 2 } } });
    const [light, dark] = [byTheme(own, 'light'), byTheme(own, 'dark')];
    expect(styleOf(light.querySelector('.bk-surface'))).toContain('border-radius:calc(2 * var(--u))');
    expect(styleOf(dark.querySelector('.bk-surface'))).toContain('border-radius:calc(2 * var(--u))');
    expect(styleOf(light.querySelector('.bk-fill'))).toContain('#D9480F');
    expect(styleOf(dark.querySelector('.bk-fill'))).toContain('linear-gradient(135deg, #FF8A3D 0%, #5CC8FF 100%)');
  });

  it('TH-06: цвет токеном перекрашивается темой, цвет HEX — нет', () => {
    const token = block('shape', { style: { fills: [{ kind: 'solid', color: { token: 'accent' } }] } });
    const hex = block('shape', { style: { fills: [{ kind: 'solid', color: { hex: '#123456' } }] } });
    expect(styleOf(byTheme(token, 'light').querySelector('.bk-fill'))).toContain('#1971C2');
    expect(styleOf(byTheme(token, 'dark').querySelector('.bk-fill'))).toContain('#5CC8FF');
    expect(styleOf(byTheme(hex, 'dark').querySelector('.bk-fill'))).toContain('#123456');
  });

  it('TH-01: стиль по умолчанию для типа блока из темы', () => {
    expect(styleOf(byTheme(block('button', { textLayer: textOf('Дальше') }), 'light').querySelector('.bk-text'))).toContain('font-weight:700');
    expect(styleOf(byTheme(block('button'), 'dark').querySelector('.bk-surface'))).toContain('border-radius:calc(28 * var(--u))');
  });

  it('TH-01: без переданной темы используется светлая служебная', () => {
    const host = document.createElement('div');
    host.innerHTML = renderToStaticMarkup(
      <Artboard mode="player">
        <span />
      </Artboard>,
    );
    expect(styleOf(host.querySelector('.bk-stage'))).toContain(`background-color:${DEV_THEMES.light.colors.background}`);
  });
});
