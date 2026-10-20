import { type BlockStyle } from '@blokum/schema';
import { type CSSProperties } from 'react';

/**
 * SVG pictures drawn along the contour of a block: the shape mask (S-02), the stroke (S-05), shadows and
 * inner shadows of non-rectangular shapes (S-06), all as `data:` URLs. Each picture uses the block's
 * own units in its viewBox, so it scales exactly with the artboard unit, and its ids are local to it.
 */

const fmt = (n: number) => String(Math.round(n * 100) / 100);

/** `url("data:image/svg+xml,…")` of an SVG document. */
export function svgUrl(svg: string): string {
  return `url("data:image/svg+xml,${encodeURIComponent(svg)}")`;
}

const svg = (vx: number, vy: number, vw: number, vh: number, body: string) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${fmt(vx)} ${fmt(vy)} ${fmt(vw)} ${fmt(vh)}" preserveAspectRatio="none">${body}</svg>`;

const escapeAttr = (s: string) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');

/** Mask that keeps only the inside of the contour. */
export function shapeMask(d: string, w: number, h: number): CSSProperties {
  const image = svgUrl(svg(0, 0, w, h, `<path d="${escapeAttr(d)}" fill="#fff"/>`));
  return { maskImage: image, WebkitMaskImage: image, maskSize: '100% 100%', WebkitMaskSize: '100% 100%', maskRepeat: 'no-repeat', WebkitMaskRepeat: 'no-repeat' };
}

/** Dash pattern of the stroke in units (S-05). */
export function dashArray(stroke: BlockStyle['stroke']): string | null {
  if (stroke.style === 'solid') return null;
  if (stroke.dash?.length) return stroke.dash.map(fmt).join(' ');
  return stroke.style === 'dotted' ? `0 ${fmt(stroke.width * 2)}` : `${fmt(stroke.width * 3)} ${fmt(stroke.width * 2)}`;
}

/** How far the stroke reaches outside the block: outside — full width, centre — half. */
export function strokeExtent(stroke: BlockStyle['stroke']): number {
  return stroke.align === 'outside' ? stroke.width : stroke.align === 'center' ? stroke.width / 2 : 0;
}

/**
 * The stroke as a layer: an element around the block painted with the stroke paint and masked by a ring
 * along the contour. Inside and outside strokes draw a double-width line and keep the half on their side.
 */
export function strokeLayer(stroke: BlockStyle['stroke'], d: string, w: number, h: number, paint: string): CSSProperties | null {
  if (stroke.width <= 0) return null;
  const e = strokeExtent(stroke);
  const dash = dashArray(stroke);
  const width = stroke.align === 'center' ? stroke.width : stroke.width * 2;
  const attrs = `d="${escapeAttr(d)}" fill="none" stroke="#fff" stroke-width="${fmt(width)}" stroke-linejoin="round"${dash ? ` stroke-dasharray="${dash}"` : ''}${stroke.style === 'dotted' ? ' stroke-linecap="round"' : ''}`;
  let body: string;
  if (stroke.align === 'inside') body = `<clipPath id="c"><path d="${escapeAttr(d)}"/></clipPath><path ${attrs} clip-path="url(#c)"/>`;
  else if (stroke.align === 'outside')
    body = `<mask id="m" maskUnits="userSpaceOnUse" x="${fmt(-e)}" y="${fmt(-e)}" width="${fmt(w + 2 * e)}" height="${fmt(h + 2 * e)}"><rect x="${fmt(-e)}" y="${fmt(-e)}" width="${fmt(w + 2 * e)}" height="${fmt(h + 2 * e)}" fill="#fff"/><path d="${escapeAttr(d)}" fill="#000"/></mask><path ${attrs} mask="url(#m)"/>`;
  else body = `<path ${attrs}/>`;
  const image = svgUrl(svg(-e, -e, w + 2 * e, h + 2 * e, body));
  return {
    position: 'absolute',
    inset: e === 0 ? 0 : `calc(${-e} * var(--u))`,
    pointerEvents: 'none',
    backgroundImage: paint,
    maskImage: image,
    WebkitMaskImage: image,
    maskSize: '100% 100%',
    WebkitMaskSize: '100% 100%',
  };
}

interface ShadowSpec {
  x: number;
  y: number;
  blur: number;
  spread: number;
  color: string;
}

const morph = (spread: number) => (spread === 0 ? '' : `<feMorphology operator="${spread > 0 ? 'dilate' : 'erode'}" radius="${fmt(Math.abs(spread))}"/>`);

/**
 * Outer shadow along the contour (S-06) for shapes CSS cannot shadow: dilated/eroded by the spread,
 * blurred, shifted, and cut out under the block — like `box-shadow`, it never shows through the fill.
 */
export function outerShadowLayer(s: ShadowSpec, d: string, w: number, h: number): CSSProperties {
  const sigma = s.blur / 2;
  const e = Math.ceil(3 * sigma + Math.abs(s.spread) + Math.max(Math.abs(s.x), Math.abs(s.y)) + 1);
  const box = `x="${fmt(-e)}" y="${fmt(-e)}" width="${fmt(w + 2 * e)}" height="${fmt(h + 2 * e)}"`;
  // An SVG filter without primitives makes its element transparent, so an empty filter is not attached.
  const primitives = `${morph(s.spread)}${sigma > 0 ? `<feGaussianBlur stdDeviation="${fmt(sigma)}"/>` : ''}`;
  const body =
    (primitives ? `<filter id="f" filterUnits="userSpaceOnUse" ${box}>${primitives}</filter>` : '') +
    // The cut-out under the block is half a unit smaller than the shape: two anti-aliased edges in the same
    // place would otherwise leave a thin seam of background between the shadow and the block.
    `<mask id="m" maskUnits="userSpaceOnUse" ${box}><rect ${box} fill="#fff"/><path d="${escapeAttr(d)}" fill="#000" stroke="#fff" stroke-width="1"/></mask>` +
    `<g mask="url(#m)"><path d="${escapeAttr(d)}" fill="${escapeAttr(s.color)}" transform="translate(${fmt(s.x)} ${fmt(s.y)})"${primitives ? ' filter="url(#f)"' : ''}/></g>`;
  return { position: 'absolute', inset: `calc(${-e} * var(--u))`, pointerEvents: 'none', backgroundImage: svgUrl(svg(-e, -e, w + 2 * e, h + 2 * e, body)), backgroundSize: '100% 100%' };
}

/** Inner shadow along the contour (S-06): the outside of the shape, shifted and blurred into it. */
export function innerShadowLayer(s: ShadowSpec, d: string, w: number, h: number): CSSProperties {
  const sigma = s.blur / 2;
  const e = Math.ceil(3 * sigma + Math.abs(s.spread) + Math.max(Math.abs(s.x), Math.abs(s.y)) + 1);
  const box = `x="${fmt(-e)}" y="${fmt(-e)}" width="${fmt(w + 2 * e)}" height="${fmt(h + 2 * e)}"`;
  // Spread pushes the shadow further in: the hole (the shape) shrinks. Empty filters are not attached.
  const hole = morph(-s.spread);
  const blur = sigma > 0 ? `<feGaussianBlur stdDeviation="${fmt(sigma)}"/>` : '';
  const body =
    (hole ? `<filter id="hole" filterUnits="userSpaceOnUse" ${box}>${hole}</filter>` : '') +
    (blur ? `<filter id="f" filterUnits="userSpaceOnUse" ${box}>${blur}</filter>` : '') +
    `<mask id="m" maskUnits="userSpaceOnUse" ${box}><rect ${box} fill="#fff"/><path d="${escapeAttr(d)}" fill="#000"${hole ? ' filter="url(#hole)"' : ''}/></mask>` +
    `<clipPath id="c"><path d="${escapeAttr(d)}"/></clipPath>` +
    `<g clip-path="url(#c)"><g${blur ? ' filter="url(#f)"' : ''}><rect ${box} fill="${escapeAttr(s.color)}" mask="url(#m)" transform="translate(${fmt(s.x)} ${fmt(s.y)})"/></g></g>`;
  return { position: 'absolute', inset: `calc(${-e} * var(--u))`, pointerEvents: 'none', backgroundImage: svgUrl(svg(-e, -e, w + 2 * e, h + 2 * e, body)), backgroundSize: '100% 100%' };
}

const FADE_DIRECTION: Record<'top' | 'right' | 'bottom' | 'left', string> = { top: 'to bottom', right: 'to left', bottom: 'to top', left: 'to right' };

/**
 * Masks of the whole block (S-19): an image by its alpha channel and fading edges. Several masks
 * intersect. `image` is the URL of the mask picture, if any.
 */
export function blockMask(mask: BlockStyle['mask'], image: string | null): CSSProperties {
  const layers: string[] = [];
  if (image) layers.push(`url("${image.replace(/["\\\n\r]/g, (ch) => encodeURIComponent(ch))}")`);
  for (const edge of mask.fade?.edges ?? []) layers.push(`linear-gradient(${FADE_DIRECTION[edge]}, transparent 0%, #000 ${fmt((mask.fade?.size ?? 0) * 100)}%)`);
  if (layers.length === 0) return {};
  const value = layers.join(', ');
  const sizes = layers.map((l) => (l.startsWith('url(') ? 'contain' : '100% 100%')).join(', ');
  return {
    maskImage: value,
    WebkitMaskImage: value,
    maskSize: sizes,
    WebkitMaskSize: sizes,
    maskRepeat: 'no-repeat',
    WebkitMaskRepeat: 'no-repeat',
    maskPosition: 'center',
    WebkitMaskPosition: 'center',
    ...(layers.length > 1 ? { maskComposite: 'intersect', WebkitMaskComposite: 'source-in' } : {}),
  };
}
