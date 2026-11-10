import { fileURLToPath } from 'node:url';
import QRCode from 'qrcode';
import * as jsqrModule from 'jsqr';
import sharp from 'sharp';
import { PDFDocument, rgb } from 'pdf-lib';

/** Q-03 · how a QR of an access point looks. It is kept with the access point, so every download and every print has the same look. */
export interface QrStyle {
  fg: string;
  bg: string;
  dots: 'square' | 'rounded' | 'circle';
  eyes: 'square' | 'rounded' | 'circle';
  /** A file of the creator's media library (an image) put in the centre. */
  logoMediaId: string | null;
  frame: boolean;
  caption: string;
}

export const DEFAULT_QR_STYLE: QrStyle = { fg: '#000000', bg: '#ffffff', dots: 'square', eyes: 'square', logoMediaId: null, frame: false, caption: '' };

export const QR_CAPTION_MAX = 40;
/** A scanner needs a clear difference between the dark and the light modules. */
export const QR_MIN_CONTRAST = 4;

const SHAPES = ['square', 'rounded', 'circle'] as const;
const HEX = /^#[0-9a-fA-F]{6}$/;

/** A problem with the input that the person can fix; the text is shown as it is. */
export class QrInputError extends Error {}

export function parseQrStyle(input: unknown): QrStyle {
  const raw = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>;
  const color = (v: unknown, fallback: string, name: string): string => {
    if (v === undefined || v === null || v === '') return fallback;
    if (typeof v !== 'string' || !HEX.test(v)) throw new QrInputError(`${name}: цвет задаётся в формате #RRGGBB`);
    return v.toLowerCase();
  };
  const shape = (v: unknown, name: string): QrStyle['dots'] => {
    if (v === undefined || v === null) return 'square';
    if (typeof v !== 'string' || !(SHAPES as readonly string[]).includes(v)) throw new QrInputError(`${name}: выберите квадратные, скруглённые или круглые`);
    return v as QrStyle['dots'];
  };
  const caption = typeof raw.caption === 'string' ? raw.caption.trim() : '';
  if ([...caption].length > QR_CAPTION_MAX) throw new QrInputError(`Подпись длиннее ${QR_CAPTION_MAX} символов`);
  if ([...caption].some((ch) => ch.charCodeAt(0) < 32 || ch === '<' || ch === '>')) throw new QrInputError('В подписи нельзя использовать управляющие символы и знаки < >');
  const logo = raw.logoMediaId;
  if (logo !== undefined && logo !== null && (typeof logo !== 'string' || logo.length < 6 || logo.length > 64 || !/^[A-Za-z0-9_-]+$/.test(logo))) throw new QrInputError('Логотип: выберите файл из своей медиатеки');
  return {
    fg: color(raw.fg, DEFAULT_QR_STYLE.fg, 'Цвет точек'),
    bg: color(raw.bg, DEFAULT_QR_STYLE.bg, 'Цвет фона'),
    dots: shape(raw.dots, 'Форма точек'),
    eyes: shape(raw.eyes, 'Форма «глазков»'),
    logoMediaId: typeof logo === 'string' ? logo : null,
    frame: raw.frame === true,
    caption,
  };
}

/** The style as it is kept: what the database has may be old or edited by hand, so it is read as carefully as the input. */
export function readStoredStyle(stored: unknown): QrStyle {
  try {
    return parseQrStyle(stored);
  } catch {
    return { ...DEFAULT_QR_STYLE };
  }
}

const channel = (v: number): number => {
  const s = v / 255;
  return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
};
const luminance = (hex: string): number => 0.2126 * channel(parseInt(hex.slice(1, 3), 16)) + 0.7152 * channel(parseInt(hex.slice(3, 5), 16)) + 0.0722 * channel(parseInt(hex.slice(5, 7), 16));

export function contrastRatio(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

/** Q-03 · the colours are checked before anything is drawn: `null` when they read well, otherwise what to change. */
export function colourProblem(style: Pick<QrStyle, 'fg' | 'bg'>): string | null {
  if (luminance(style.fg) >= luminance(style.bg)) return 'Точки должны быть темнее фона: светлый код на тёмном многие камеры не читают.';
  const ratio = contrastRatio(style.fg, style.bg);
  if (ratio < QR_MIN_CONTRAST) return `Слишком мало контраста между точками и фоном (${ratio.toFixed(1)} из нужных ${QR_MIN_CONTRAST}). Сделайте точки темнее или фон светлее.`;
  return null;
}

interface Geometry {
  svg: string;
  /** Width and height of the picture in modules. */
  width: number;
  height: number;
  /** Where the caption goes (in modules), when the frame has one. */
  band: { y: number; h: number } | null;
}

const MARGIN = 4;
const BAND = 5;
const esc = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** The picture of a code as SVG. `text` puts the caption in as text; the PNG draws it separately with its own font. */
export function buildSvg(url: string, style: QrStyle, logo: { dataUri: string } | null, text: boolean): Geometry {
  const qr = QRCode.create(url, { errorCorrectionLevel: 'H' });
  const n = qr.modules.size;
  const data = qr.modules.data as unknown as ArrayLike<number>;
  const dark = (x: number, y: number): boolean => x >= 0 && y >= 0 && x < n && y < n && data[y * n + x] === 1;

  const inEye = (x: number, y: number): boolean => (x < 7 && y < 7) || (x >= n - 7 && y < 7) || (x < 7 && y >= n - 7);
  const logoSide = logo ? Math.max(5, Math.round(n * 0.2)) : 0;
  const logoFrom = Math.floor((n - logoSide) / 2);
  const inLogo = (x: number, y: number): boolean => logo !== null && x >= logoFrom - 1 && x < logoFrom + logoSide + 1 && y >= logoFrom - 1 && y < logoFrom + logoSide + 1;

  const hasCaption = style.frame && style.caption !== '';
  const side = n + MARGIN * 2;
  const height = side + (hasCaption ? BAND : 0);
  const parts: string[] = [];
  parts.push(`<rect width="${side}" height="${height}" fill="${style.bg}"/>`);
  if (style.frame) parts.push(`<rect x="0.4" y="0.4" width="${side - 0.8}" height="${height - 0.8}" rx="2" fill="none" stroke="${style.fg}" stroke-width="0.8"/>`);

  let path = '';
  const circles: string[] = [];
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      if (!dark(x, y) || inEye(x, y) || inLogo(x, y)) continue;
      const px = x + MARGIN;
      const py = y + MARGIN;
      if (style.dots === 'square') path += `M${px} ${py}h1v1h-1z`;
      else if (style.dots === 'rounded') parts.push(`<rect x="${px + 0.04}" y="${py + 0.04}" width="0.92" height="0.92" rx="0.32" fill="${style.fg}"/>`);
      else circles.push(`<circle cx="${px + 0.5}" cy="${py + 0.5}" r="0.46" fill="${style.fg}"/>`);
    }
  }
  if (path) parts.push(`<path d="${path}" fill="${style.fg}"/>`);
  parts.push(...circles);

  const eye = (ex: number, ey: number): void => {
    const x = ex + MARGIN;
    const y = ey + MARGIN;
    if (style.eyes === 'circle') {
      parts.push(`<circle cx="${x + 3.5}" cy="${y + 3.5}" r="3.5" fill="${style.fg}"/><circle cx="${x + 3.5}" cy="${y + 3.5}" r="2.5" fill="${style.bg}"/><circle cx="${x + 3.5}" cy="${y + 3.5}" r="1.5" fill="${style.fg}"/>`);
      return;
    }
    const r = style.eyes === 'rounded' ? [1.9, 1.2, 0.8] : [0, 0, 0];
    parts.push(
      `<rect x="${x}" y="${y}" width="7" height="7" rx="${r[0]}" fill="${style.fg}"/>`,
      `<rect x="${x + 1}" y="${y + 1}" width="5" height="5" rx="${r[1]}" fill="${style.bg}"/>`,
      `<rect x="${x + 2}" y="${y + 2}" width="3" height="3" rx="${r[2]}" fill="${style.fg}"/>`,
    );
  };
  eye(0, 0);
  eye(n - 7, 0);
  eye(0, n - 7);

  if (logo) {
    const x = logoFrom + MARGIN;
    parts.push(`<rect x="${x - 0.5}" y="${x - 0.5}" width="${logoSide + 1}" height="${logoSide + 1}" rx="1" fill="${style.bg}"/>`, `<image href="${logo.dataUri}" x="${x}" y="${x}" width="${logoSide}" height="${logoSide}" preserveAspectRatio="xMidYMid meet"/>`);
  }
  if (hasCaption && text) {
    parts.push(`<text x="${side / 2}" y="${side + BAND / 2 + 0.9}" font-family="DejaVu Sans, Arial, sans-serif" font-weight="bold" font-size="2.6" text-anchor="middle" fill="${style.fg}">${esc(style.caption)}</text>`);
  }
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${side} ${height}" width="${side * 20}" height="${height * 20}" shape-rendering="geometricPrecision">${parts.join('')}</svg>`;
  return { svg, width: side, height, band: hasCaption ? { y: side, h: BAND } : null };
}

const FONT = fileURLToPath(new URL('../../assets/fonts/DejaVuSans-Bold.ttf', import.meta.url));

/** A logo of the library as a small picture inside the SVG: only a raster picture, never a file that can carry a script. */
export async function logoFromFile(path: string): Promise<{ dataUri: string }> {
  const png = await sharp(path).resize(256, 256, { fit: 'inside' }).png().toBuffer();
  return { dataUri: `data:image/png;base64,${png.toString('base64')}` };
}

/** The code as PNG, `size` pixels wide. */
export async function renderPng(url: string, style: QrStyle, logo: { dataUri: string } | null, size: number): Promise<Buffer> {
  const g = buildSvg(url, style, logo, false);
  const height = Math.round((size * g.height) / g.width);
  let image = sharp(Buffer.from(g.svg), { density: 72 }).resize(size, height, { fit: 'fill' });
  if (g.band) {
    const bandHeight = Math.round((size * g.band.h) / g.width);
    const top = Math.round((size * g.band.y) / g.width);
    const label = await sharp({
      text: { text: `<span foreground="${style.fg}">${esc(style.caption)}</span>`, font: 'DejaVu Sans Bold', fontfile: FONT, rgba: true, width: Math.round(size * 0.86), height: Math.round(bandHeight * 0.5), align: 'centre' },
    })
      .png()
      .toBuffer();
    const meta = await sharp(label).metadata();
    image = image.composite([{ input: label, left: Math.max(0, Math.round((size - (meta.width ?? 0)) / 2)), top: top + Math.max(0, Math.round((bandHeight - (meta.height ?? 0)) / 2)) }]);
  }
  return image.png().toBuffer();
}

/**
 * Q-05 · the picture is read the way a phone reads it: `true` only when the text comes out as the address of the access point.
 * A camera never sees the picture pixel-perfect, so it is tried at several sizes and with a light blur that closes the gaps between
 * round dots — the same things a phone does before it decodes.
 */
export async function reads(png: Buffer, url: string): Promise<boolean> {
  for (const side of [480, 640, 320, 800]) {
    for (const blur of [0, 1]) {
      let image = sharp(png).flatten({ background: '#ffffff' }).resize(side, side, { fit: 'inside' });
      if (blur > 0) image = image.blur(blur);
      const { data, info } = await image.ensureAlpha().raw().toBuffer({ resolveWithObject: true });
      const found = jsQR(new Uint8ClampedArray(data.buffer, data.byteOffset, data.byteLength), info.width, info.height, { inversionAttempts: 'dontInvert' });
      if (found?.data === url) return true;
    }
  }
  return false;
}

export type PrintLayout = 'a4' | 'a6' | 'cards';
export const PRINT_LAYOUTS: readonly PrintLayout[] = ['a4', 'a6', 'cards'];

/** jsQR is a CommonJS package: under ESM its function is the `default` of the namespace (and in some loaders the namespace itself). */
type JsQr = (data: Uint8ClampedArray, width: number, height: number, options?: { inversionAttempts?: 'dontInvert' | 'onlyInvert' | 'attemptBoth' | 'invertFirst' }) => { data: string } | null;
const jsQR: JsQr = (jsqrModule as unknown as { default?: JsQr }).default ?? (jsqrModule as unknown as JsQr);

const MM = 72 / 25.4;

/** Q-04 · a sheet for print: A4 with one code, A4 with a grid of A6 (4), or business cards 85×55 (10). Marks show where to cut. */
export async function renderPdf(png: Buffer, layout: PrintLayout): Promise<Buffer> {
  const pdf = await PDFDocument.create();
  pdf.setTitle('QR-код');
  pdf.setCreator('Блоккер');
  const page = pdf.addPage([210 * MM, 297 * MM]);
  const image = await pdf.embedPng(png);
  const ratio = image.height / image.width;
  const black = rgb(0, 0, 0);
  const line = (x1: number, y1: number, x2: number, y2: number): void => page.drawLine({ start: { x: x1 * MM, y: y1 * MM }, end: { x: x2 * MM, y: y2 * MM }, thickness: 0.4, color: black });
  const put = (cx: number, cy: number, width: number): void => {
    const h = width * ratio;
    page.drawImage(image, { x: (cx - width / 2) * MM, y: (cy - h / 2) * MM, width: width * MM, height: h * MM });
  };
  /** Cut marks in the corners of a cell, outside it by `gap` mm. */
  const marks = (x: number, y: number, w: number, h: number, gap: number, len: number): void => {
    for (const [cx, cy, dx, dy] of [[x, y, -1, -1], [x + w, y, 1, -1], [x, y + h, -1, 1], [x + w, y + h, 1, 1]] as const) {
      line(cx + dx * gap, cy, cx + dx * (gap + len), cy);
      line(cx, cy + dy * gap, cx, cy + dy * (gap + len));
    }
  };
  if (layout === 'a4') {
    put(105, 148.5, 160);
  } else if (layout === 'a6') {
    // Four A6 sheets: the cut goes along the middle lines of the page; ticks at the edges and in the centre show them.
    for (const col of [0, 1]) for (const row of [0, 1]) put(52.5 + col * 105, 74.25 + row * 148.5, 80);
    line(105, 0, 105, 6);
    line(105, 291, 105, 297);
    line(0, 148.5, 6, 148.5);
    line(204, 148.5, 210, 148.5);
    line(99, 148.5, 111, 148.5);
    line(105, 142.5, 105, 154.5);
  } else {
    // Cards 85×55 mm, two columns by five rows with a 6 mm field around each one for the cut.
    const cw = 85;
    const ch = 55;
    const x0 = (210 - cw * 2) / 2;
    const y0 = (297 - ch * 5) / 2;
    for (let col = 0; col < 2; col++) {
      for (let row = 0; row < 5; row++) {
        const x = x0 + col * cw;
        const y = y0 + row * ch;
        put(x + cw / 2, y + ch / 2, 46);
        marks(x, y, cw, ch, 1.5, 3);
      }
    }
  }
  return Buffer.from(await pdf.save());
}
