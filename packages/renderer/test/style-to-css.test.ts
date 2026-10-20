import { BlockStyle, ThemeTokens } from '@blokum/schema';
import { describe, expect, it } from 'vitest';
import { contrastRatio, cssColor, cssFontFamily, fontFamilyName, styleToCss, SYSTEM_FONTS, DEV_THEMES } from '../src/index.js';
import { media } from './helpers.js';

const ctx = { tokens: DEV_THEMES.light, media };
const css = (style: Parameters<typeof BlockStyle.parse>[0]) => styleToCss(BlockStyle.parse(style), ctx);

describe('TH-01: цвета и шрифты темы', () => {
  it('TH-01: HEX остаётся, токен берётся из темы с прозрачностью', () => {
    expect(cssColor({ hex: '#123456' }, DEV_THEMES.light)).toBe('#123456');
    expect(cssColor({ token: 'primary', alpha: 1 }, DEV_THEMES.light)).toBe('#D9480F');
    expect(cssColor({ token: 'primary', alpha: 0.5 }, DEV_THEMES.light)).toBe('rgba(217, 72, 15, 0.5)');
    expect(cssColor({ token: 'primary', alpha: 1 }, DEV_THEMES.dark)).toBe('#FF8A3D');
  });

  it('TH-01: свой цвет темы и неизвестный токен', () => {
    const tokens = ThemeTokens.parse({ colors: { ...DEV_THEMES.light.colors, snow: '#E7F5FF80' } });
    expect(cssColor({ token: 'snow', alpha: 0.5 }, tokens)).toBe('rgba(231, 245, 255, 0.251)');
    expect(cssColor({ token: 'net', alpha: 1 }, tokens)).toBe(tokens.colors.text);
  });

  it('TH-01: шрифты — роли темы, системные, свои', () => {
    expect(cssFontFamily({ kind: 'theme', role: 'heading' }, DEV_THEMES.light)).toBe(SYSTEM_FONTS.rounded);
    expect(cssFontFamily({ kind: 'theme', role: 'accent' }, DEV_THEMES.light)).toBe(SYSTEM_FONTS.rounded);
    expect(cssFontFamily({ kind: 'system', name: 'mono' }, DEV_THEMES.light)).toBe(SYSTEM_FONTS.mono);
    expect(cssFontFamily({ kind: 'font', id: 'shrift001' }, DEV_THEMES.light)).toBe(`"${fontFamilyName('shrift001')}", ${SYSTEM_FONTS.sans}`);
    expect(cssFontFamily({ kind: 'theme', role: 'body' }, { fonts: { heading: { kind: 'theme', role: 'body' }, body: { kind: 'theme', role: 'heading' } } })).toBe(SYSTEM_FONTS.sans);
  });

  it('TH-02: контраст по WCAG', () => {
    expect(contrastRatio('#000000', '#FFFFFF')).toBeCloseTo(21, 1);
    expect(contrastRatio('#777777', '#777777')).toBe(1);
    expect(contrastRatio(DEV_THEMES.light.colors.text!, DEV_THEMES.light.colors.background!)).toBeGreaterThan(4.5);
    expect(contrastRatio(DEV_THEMES.dark.colors.text!, DEV_THEMES.dark.colors.background!)).toBeGreaterThan(4.5);
  });
});

describe('styleToCss — единственное место перевода стиля в CSS', () => {
  it('нейтральный стиль: ни фильтров, ни теней, ни 3D', () => {
    const c = css({});
    expect(c.root).toEqual({ opacity: 1 });
    expect(c.transform3d).toBe('');
    expect(c.layers).toEqual([]);
    expect(c.surface.boxShadow).toBeUndefined();
  });

  it('заливки снизу вверх: цвет, градиенты, картинка с фокусом и масштабом, плитка, видео', () => {
    const c = css({
      fills: [
        { kind: 'solid', color: { token: 'surface' } },
        { kind: 'linear', angle: 90, stops: [{ offset: 1, color: { hex: '#000000' } }, { offset: 0, color: { hex: '#FFFFFF' } }] },
        { kind: 'radial', cx: 0.2, cy: 0.8, stops: [{ offset: 0, color: { hex: '#FF0000' } }, { offset: 1, color: { hex: '#0000FF' } }] },
        { kind: 'conic', angle: 45, stops: [{ offset: 0, color: { hex: '#FF0000' } }, { offset: 1, color: { hex: '#0000FF' } }] },
      ],
    });
    expect(c.layers.map((l) => (l.kind === 'paint' ? l.style.backgroundImage : ''))).toEqual([
      'linear-gradient(#FFFFFF, #FFFFFF)',
      'linear-gradient(90deg, #FFFFFF 0%, #000000 100%)',
      'radial-gradient(circle at 20% 80%, #FF0000 0%, #0000FF 100%)',
      'conic-gradient(from 45deg at 50% 50%, #FF0000 0%, #0000FF 100%)',
    ]);
    const m = css({
      fills: [
        { kind: 'media', media: { source: 'media', id: 'foto000001' }, fit: 'cover', focal: { x: 0.3, y: 0.6 }, scale: 1.5 },
        { kind: 'media', media: { source: 'library', id: 'uzor000001' }, fit: 'tile', scale: 0.5 },
        { kind: 'media', media: { source: 'media', id: 'foto000002' }, fit: 'fill' },
        { kind: 'media', media: { source: 'media', id: 'video00001' }, fit: 'contain' },
      ],
    });
    expect(css({ fills: [{ kind: 'none' }, { kind: 'media', media: { source: 'media', id: 'video00002' }, fit: 'tile', scale: 2 }] }).layers).toEqual([
      { kind: 'video', src: 'https://media.blokum.ru/video00002.mp4', style: { objectFit: 'cover', objectPosition: '50% 50%', transform: 'scale(2)', transformOrigin: '50% 50%' } },
    ]);
    expect(m.layers).toEqual([
      { kind: 'paint', style: { backgroundImage: 'url("https://media.blokum.ru/foto000001.webp")', backgroundSize: 'cover', backgroundPosition: '30% 60%', backgroundRepeat: 'no-repeat', transform: 'scale(1.5)', transformOrigin: '30% 60%' } },
      { kind: 'paint', style: { backgroundImage: 'url("https://media.blokum.ru/uzor000001.webp")', backgroundSize: 'calc(50 * var(--u)) auto', backgroundPosition: '50% 50%', backgroundRepeat: 'repeat' } },
      { kind: 'paint', style: { backgroundImage: 'url("https://media.blokum.ru/foto000002.webp")', backgroundSize: '100% 100%', backgroundPosition: '50% 50%', backgroundRepeat: 'no-repeat' } },
      { kind: 'video', src: 'https://media.blokum.ru/video00001.mp4', style: { objectFit: 'contain', objectPosition: '50% 50%' } },
    ]);
  });

  it('медиа без адреса пропускается, кавычки в адресе экранируются', () => {
    const none = styleToCss(BlockStyle.parse({ fills: [{ kind: 'media', media: { source: 'media', id: 'foto000001' } }] }), { ...ctx, media: () => null });
    expect(none.layers).toEqual([]);
    const evil = styleToCss(BlockStyle.parse({ fills: [{ kind: 'media', media: { source: 'media', id: 'foto000001' } }] }), { ...ctx, media: () => ({ url: 'https://x/a"b\\c', kind: 'image' }) });
    expect(evil.layers[0]).toMatchObject({ style: { backgroundImage: 'url("https://x/a%22b%5Cc")' } });
  });

  it('скругление в единицах и процентах', () => {
    expect(css({ radius: { tl: 4, tr: 8, br: 12, bl: 0 } }).surface.borderRadius).toBe('calc(4 * var(--u)) calc(8 * var(--u)) calc(12 * var(--u)) 0px');
    expect(css({ radius: { unit: '%', tl: 50, tr: 50, br: 50, bl: 50 } }).content.borderRadius).toBe('50% 50% 50% 50%');
  });

  it('тени, внутренняя тень и свечение', () => {
    const c = css({ shadows: [{ x: 1, y: 2, blur: 3, spread: 0, color: { hex: '#00000080' } }, { inset: true, color: { token: 'primary' } }], glow: { color: { hex: '#FFD43B' }, size: 20 } });
    expect(c.surface.boxShadow).toBe(
      'calc(1 * var(--u)) calc(2 * var(--u)) calc(3 * var(--u)) 0px #00000080, inset 0px calc(4 * var(--u)) calc(12 * var(--u)) 0px #D9480F, 0px 0px calc(20 * var(--u)) calc(5 * var(--u)) #FFD43B',
    );
  });

  it('эффекты и фильтры: только отличные от нейтральных', () => {
    const c = css({ effects: { opacity: 0.5, blur: 2, backdropBlur: 6, blendMode: 'multiply' }, filters: { brightness: 1.2, contrast: 0.8, saturate: 2, grayscale: 0.5, sepia: 0.3, hueRotate: -40, invert: 1 } });
    expect(c.root).toEqual({
      opacity: 0.5,
      filter: 'blur(calc(2 * var(--u))) brightness(1.2) contrast(0.8) saturate(2) grayscale(0.5) sepia(0.3) hue-rotate(-40deg) invert(1)',
      mixBlendMode: 'multiply',
    });
    expect(c.surface.backdropFilter).toBe('blur(calc(6 * var(--u)))');
  });

  it('отступы, выравнивание текста по вертикали, обрезка по форме', () => {
    const c = css({ padding: { t: 8, r: 12, b: 8, l: 12 }, text: { verticalAlign: 'bottom' }, mask: { clipToShape: false } });
    expect(c.content).toMatchObject({ padding: 'calc(8 * var(--u)) calc(12 * var(--u)) calc(8 * var(--u)) calc(12 * var(--u))', display: 'flex', justifyContent: 'flex-end', overflow: 'visible' });
  });

  it('S-20: автораскладка — ряд, колонка, сетка, прокрутка', () => {
    expect(css({ layout: { mode: 'row', gap: 10, align: 'center', justify: 'between', wrap: true } }).content).toMatchObject({ display: 'flex', flexDirection: 'row', flexWrap: 'wrap', gap: 'calc(10 * var(--u))', alignItems: 'center', justifyContent: 'space-between' });
    expect(css({ layout: { mode: 'column', scroll: true } }).content).toMatchObject({ flexDirection: 'column', overflow: 'auto', flexWrap: 'nowrap' });
    expect(css({ layout: { mode: 'grid', columns: 3, justify: 'around', align: 'stretch' } }).content).toMatchObject({ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', alignItems: 'stretch', alignContent: 'space-around' });
  });

  it('текст: шрифт, размер в единицах, начертание, интервалы, регистр, цвет', () => {
    const t = css({ text: { font: { kind: 'theme', role: 'heading' }, size: 32, weight: 800, italic: true, lineHeight: 1.1, letterSpacing: 0.05, align: 'center', transform: 'uppercase', paint: { kind: 'solid', color: { token: 'accent' } } } }).text;
    expect(t).toMatchObject({ fontFamily: SYSTEM_FONTS.rounded, fontSize: 'calc(32 * var(--u))', fontWeight: 800, fontStyle: 'italic', lineHeight: 1.1, letterSpacing: '0.05em', textAlign: 'center', textTransform: 'uppercase', color: '#1971C2' });
  });

  it('текст градиентом и картинкой, обводка и тень букв', () => {
    const g = css({ text: { paint: { kind: 'linear', stops: [{ offset: 0, color: { hex: '#FF0000' } }, { offset: 1, color: { hex: '#0000FF' } }] }, outline: { width: 2, color: { hex: '#FFFFFF' } }, shadow: { x: 0, y: 2, blur: 4, color: { hex: '#000000' } } } }).text;
    expect(g).toMatchObject({ backgroundImage: 'linear-gradient(180deg, #FF0000 0%, #0000FF 100%)', color: 'transparent', backgroundClip: 'text', WebkitTextStroke: 'calc(2 * var(--u)) #FFFFFF', textShadow: '0px calc(2 * var(--u)) calc(4 * var(--u)) #000000' });
    const m = css({ text: { paint: { kind: 'media', media: { source: 'media', id: 'foto000001' }, scale: 2 } } }).text;
    expect(m).toMatchObject({ backgroundImage: 'url("https://media.blokum.ru/foto000001.webp")', WebkitBackgroundClip: 'text' });
    expect(m.transform).toBeUndefined();
    const lost = styleToCss(BlockStyle.parse({ text: { paint: { kind: 'media', media: { source: 'media', id: 'foto000001' } } } }), { ...ctx, media: () => null }).text;
    expect(lost.backgroundImage).toBe('none');
  });

  it('S-11: вписывание медиа и фокус', () => {
    expect(css({ media: { fit: 'contain', focal: { x: 0, y: 1 } } }).media).toMatchObject({ objectFit: 'contain', objectPosition: '0% 100%' });
  });

  it('S-18: 3D-наклон с перспективой и точкой вращения', () => {
    const c = css({ transform3d: { rotateX: 20, rotateY: -10, perspective: 800, origin: { x: 0, y: 0.5 } } });
    expect(c.transform3d).toBe('perspective(calc(800 * var(--u))) rotateX(20deg) rotateY(-10deg)');
    expect(c.transformOrigin).toBe('0% 50%');
  });
});
