import { type BlockStyle, type Fill, type MediaRef, type ThemeTokens } from '@blokum/schema';
import { type CSSProperties } from 'react';
import { cssColor } from '../theme/color.js';
import { cssFontFamily } from '../theme/fonts.js';
import { u } from '../units.js';

/** A resolved media file: where to load it from and how to show it. */
export interface MediaSource {
  url: string;
  kind: 'image' | 'video';
}

/** Turns a media reference into a URL (the player and the editor know the media domain; tests pass a stub). */
export type MediaResolver = (ref: MediaRef) => MediaSource | null;

export interface StyleContext {
  tokens: ThemeTokens;
  media: MediaResolver;
}

/** One fill layer of a block, bottom to top (S-04). */
export type FillLayer = { kind: 'paint'; style: CSSProperties } | { kind: 'video'; src: string; style: CSSProperties };

/** Everything the DOM of one block needs (see BlockView): the only output of style conversion. */
export interface BlockCss {
  /** Outer element: opacity, filters, blending (S-07, S-08). */
  root: CSSProperties;
  /** 3D part of the transform (S-18), composed by BlockView with rotation and flips (S-01). */
  transform3d: string;
  transformOrigin: string;
  /** Background plate: rounding, shadows, glow, backdrop blur (S-03, S-06, S-07). */
  surface: CSSProperties;
  layers: FillLayer[];
  /** Content box: padding, text alignment or auto-layout of nested blocks, clipping (S-09, S-19, S-20). */
  content: CSSProperties;
  /** Typography of the text layer (S-10). */
  text: CSSProperties;
  /** How media of the block is fitted (S-11). */
  media: CSSProperties;
}

type CssVars = CSSProperties & Record<`--${string}`, string>;

const pct = (v: number) => `${Math.round(v * 10000) / 100}%`;

function gradientStops(stops: Extract<Fill, { kind: 'linear' }>['stops'], ctx: StyleContext): string {
  return [...stops]
    .sort((a, b) => a.offset - b.offset)
    .map((s) => `${cssColor(s.color, ctx.tokens)} ${pct(s.offset)}`)
    .join(', ');
}

/** CSS image of a non-media paint (solid colours become a flat gradient so they can be layered). */
export function paintImage(fill: Exclude<Fill, { kind: 'media' | 'none' }>, ctx: StyleContext): string {
  switch (fill.kind) {
    case 'solid': {
      const c = cssColor(fill.color, ctx.tokens);
      return `linear-gradient(${c}, ${c})`;
    }
    case 'linear':
      return `linear-gradient(${fill.angle}deg, ${gradientStops(fill.stops, ctx)})`;
    case 'radial':
      return `radial-gradient(circle at ${pct(fill.cx)} ${pct(fill.cy)}, ${gradientStops(fill.stops, ctx)})`;
    case 'conic':
      return `conic-gradient(from ${fill.angle}deg at ${pct(fill.cx)} ${pct(fill.cy)}, ${gradientStops(fill.stops, ctx)})`;
  }
}

const cssUrl = (url: string) => `url("${url.replace(/["\\\n\r]/g, (ch) => encodeURIComponent(ch))}")`;

/** Fill layers bottom → top. Media fills keep focus and zoom; «плитка» repeats the file in 100-unit cells. */
export function fillLayers(fills: readonly Fill[], ctx: StyleContext): FillLayer[] {
  const layers: FillLayer[] = [];
  for (const fill of fills) {
    if (fill.kind === 'none') continue;
    if (fill.kind !== 'media') {
      layers.push({ kind: 'paint', style: { backgroundImage: paintImage(fill, ctx) } });
      continue;
    }
    const src = ctx.media(fill.media);
    if (!src) continue;
    const position = `${pct(fill.focal.x)} ${pct(fill.focal.y)}`;
    const zoom: CSSProperties = fill.scale === 1 ? {} : { transform: `scale(${fill.scale})`, transformOrigin: position };
    if (src.kind === 'video') {
      layers.push({ kind: 'video', src: src.url, style: { objectFit: fill.fit === 'tile' ? 'cover' : fill.fit, objectPosition: position, ...zoom } });
      continue;
    }
    const size = fill.fit === 'tile' ? `${u(100 * fill.scale)} auto` : fill.fit === 'fill' ? '100% 100%' : fill.fit;
    layers.push({
      kind: 'paint',
      style: {
        backgroundImage: cssUrl(src.url),
        backgroundSize: size,
        backgroundPosition: position,
        backgroundRepeat: fill.fit === 'tile' ? 'repeat' : 'no-repeat',
        ...(fill.fit === 'tile' ? {} : zoom),
      },
    });
  }
  return layers;
}

/** CSS `border-radius` (S-03): units or percent of the block size. */
export function cssRadius(r: BlockStyle['radius']): string {
  const v = (n: number) => (r.unit === '%' ? `${n}%` : u(n));
  return [r.tl, r.tr, r.br, r.bl].map(v).join(' ');
}

function cssShadows(style: BlockStyle, ctx: StyleContext): string | undefined {
  const parts = style.shadows.map((s) => `${s.inset ? 'inset ' : ''}${u(s.x)} ${u(s.y)} ${u(s.blur)} ${u(s.spread)} ${cssColor(s.color, ctx.tokens)}`);
  if (style.glow && style.glow.size > 0) parts.push(`0px 0px ${u(style.glow.size)} ${u(style.glow.size / 4)} ${cssColor(style.glow.color, ctx.tokens)}`);
  return parts.length ? parts.join(', ') : undefined;
}

/** CSS `filter` of the block (S-07 blur and S-08 filters); only values that differ from neutral. */
export function cssFilter(style: BlockStyle): string | undefined {
  const f = style.filters;
  const parts: string[] = [];
  if (style.effects.blur > 0) parts.push(`blur(${u(style.effects.blur)})`);
  if (f.brightness !== 1) parts.push(`brightness(${f.brightness})`);
  if (f.contrast !== 1) parts.push(`contrast(${f.contrast})`);
  if (f.saturate !== 1) parts.push(`saturate(${f.saturate})`);
  if (f.grayscale !== 0) parts.push(`grayscale(${f.grayscale})`);
  if (f.sepia !== 0) parts.push(`sepia(${f.sepia})`);
  if (f.hueRotate !== 0) parts.push(`hue-rotate(${f.hueRotate}deg)`);
  if (f.invert !== 0) parts.push(`invert(${f.invert})`);
  return parts.length ? parts.join(' ') : undefined;
}

const JUSTIFY: Record<BlockStyle['layout']['justify'], string> = { start: 'flex-start', center: 'center', end: 'flex-end', between: 'space-between', around: 'space-around' };
const ALIGN: Record<BlockStyle['layout']['align'], string> = { start: 'flex-start', center: 'center', end: 'flex-end', stretch: 'stretch' };
const VERTICAL: Record<BlockStyle['text']['verticalAlign'], string> = { top: 'flex-start', middle: 'center', bottom: 'flex-end' };

function contentCss(style: BlockStyle): CSSProperties {
  const { padding: p, layout } = style;
  const css: CSSProperties = {
    position: 'absolute',
    inset: 0,
    boxSizing: 'border-box',
    padding: [p.t, p.r, p.b, p.l].map(u).join(' '),
    overflow: style.mask.clipToShape ? 'hidden' : 'visible',
    borderRadius: cssRadius(style.radius),
  };
  if (layout.mode === 'free') return { ...css, display: 'flex', flexDirection: 'column', justifyContent: VERTICAL[style.text.verticalAlign] };
  const scroll: CSSProperties = layout.scroll ? { overflow: 'auto' } : {};
  if (layout.mode === 'grid') {
    return { ...css, ...scroll, display: 'grid', gridTemplateColumns: `repeat(${layout.columns}, minmax(0, 1fr))`, gap: u(layout.gap), alignItems: ALIGN[layout.align], justifyItems: ALIGN[layout.align], alignContent: JUSTIFY[layout.justify] };
  }
  return {
    ...css,
    ...scroll,
    display: 'flex',
    flexDirection: layout.mode,
    flexWrap: layout.wrap ? 'wrap' : 'nowrap',
    gap: u(layout.gap),
    alignItems: ALIGN[layout.align],
    justifyContent: JUSTIFY[layout.justify],
  };
}

/** Typography (S-10). Gradient and media paint clip to the letters. */
export function textCss(text: BlockStyle['text'], ctx: StyleContext): CSSProperties {
  const css: CSSProperties = {
    fontFamily: cssFontFamily(text.font, ctx.tokens),
    fontSize: u(text.size),
    fontWeight: text.weight,
    fontStyle: text.italic ? 'italic' : 'normal',
    lineHeight: text.lineHeight,
    letterSpacing: text.letterSpacing === 0 ? 'normal' : `${text.letterSpacing}em`,
    textAlign: text.align,
    textTransform: text.transform,
    overflowWrap: 'anywhere',
    whiteSpace: 'pre-wrap',
  };
  if (text.paint.kind === 'solid') css.color = cssColor(text.paint.color, ctx.tokens);
  else {
    const layer = fillLayers([text.paint], ctx)[0];
    const bg = layer?.kind === 'paint' ? layer.style : { backgroundImage: 'none' };
    Object.assign(css, bg, { color: 'transparent', WebkitTextFillColor: 'transparent', backgroundClip: 'text', WebkitBackgroundClip: 'text' });
    delete css.transform;
  }
  if (text.shadow) css.textShadow = `${u(text.shadow.x)} ${u(text.shadow.y)} ${u(text.shadow.blur)} ${cssColor(text.shadow.color, ctx.tokens)}`;
  if (text.outline && text.outline.width > 0) {
    (css as CssVars).WebkitTextStroke = `${u(text.outline.width)} ${cssColor(text.outline.color, ctx.tokens)}`;
    css.paintOrder = 'stroke fill';
  }
  return css;
}

/**
 * The ONLY place where a block style becomes CSS (P1.4): the editor, the player and thumbnails all go
 * through it. `style` is already resolved (theme defaults, own groups, state — `resolveBlockStyle`).
 * Shapes, contour strokes and masks by image are added by the shape module (P1.6).
 */
export function styleToCss(style: BlockStyle, ctx: StyleContext): BlockCss {
  const t = style.transform3d;
  const has3d = t.rotateX !== 0 || t.rotateY !== 0;
  const filter = cssFilter(style);
  const root: CSSProperties = {
    opacity: style.effects.opacity,
    ...(filter ? { filter } : {}),
    ...(style.effects.blendMode !== 'normal' ? { mixBlendMode: style.effects.blendMode } : {}),
  };
  const shadow = cssShadows(style, ctx);
  const surface: CSSProperties = {
    position: 'absolute',
    inset: 0,
    borderRadius: cssRadius(style.radius),
    overflow: 'hidden',
    ...(shadow ? { boxShadow: shadow } : {}),
    ...(style.effects.backdropBlur > 0 ? { backdropFilter: `blur(${u(style.effects.backdropBlur)})`, WebkitBackdropFilter: `blur(${u(style.effects.backdropBlur)})` } : {}),
  };
  const m = style.media;
  return {
    root,
    transform3d: has3d ? `perspective(${u(t.perspective)}) rotateX(${t.rotateX}deg) rotateY(${t.rotateY}deg)` : '',
    transformOrigin: `${pct(t.origin.x)} ${pct(t.origin.y)}`,
    surface,
    layers: fillLayers(style.fills, ctx),
    content: contentCss(style),
    text: textCss(style.text, ctx),
    media: {
      width: '100%',
      height: '100%',
      display: 'block',
      objectFit: m.fit,
      objectPosition: `${pct(m.focal.x)} ${pct(m.focal.y)}`,
    },
  };
}
