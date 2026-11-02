import { Injectable } from '@nestjs/common';
import { normalizePath } from '@blokum/schema';
import { fail } from '../admin/errors.js';

const MAX_SVG_BYTES = 1_048_576;

/** Tags whose geometry we extract (whitelist). */
const GEOMETRIC = new Set(['path', 'rect', 'circle', 'ellipse', 'line', 'polyline', 'polygon']);

export interface SvgPath {
  d: string;
  closed: boolean;
}

/**
 * TS-27 · Strict SVG parser: extracts only geometric contours.
 * Scripts, foreignObject, use, image, style and all event handlers are
 * never stored — only the normalised path `d` string is returned.
 */
@Injectable()
export class SvgImportService {
  import(svgBuffer: Buffer): SvgPath[] {
    if (svgBuffer.length > MAX_SVG_BYTES) throw fail(422, 'FILE_TOO_LARGE', 'SVG слишком большой (максимум 1 МБ)');

    const svg = svgBuffer.toString('utf8');
    // Strip XML comments and CDATA — they can contain anything
    const clean = svg.replace(/<!--[\s\S]*?-->/g, '').replace(/<!\[CDATA\[[\s\S]*?\]\]>/g, '');

    const results: SvgPath[] = [];

    for (const { name, attrs } of parseTags(clean)) {
      // Only process whitelisted geometric tags — everything else is silently ignored.
      if (!GEOMETRIC.has(name)) continue;

      // Derive path data only from geometric attributes; all other attrs (event handlers,
      // fill, href, filter, etc.) are never read, so they can never affect stored data.
      const d = shapeToPath(name, attrs);
      if (!d) continue;

      try {
        const normalised = normalizePath(d);
        // A Z in the normalised data indicates a closed contour.
        const closed = normalised.toUpperCase().includes('Z');
        results.push({ d: normalised, closed });
      } catch {
        // skip un-parseable paths
      }
    }

    if (results.length === 0) throw fail(422, 'NO_PATHS', 'SVG не содержит геометрических контуров');
    return results;
  }
}

/** Yield every opening tag in the SVG as { name (lower-case), attrs }. */
function* parseTags(svg: string): Generator<{ name: string; attrs: Record<string, string> }> {
  let i = 0;
  while (i < svg.length) {
    const lt = svg.indexOf('<', i);
    if (lt === -1) break;
    i = lt + 1;

    // Skip comments (already stripped), declarations and processing instructions
    const ch = svg[i] ?? '';
    if (ch === '!' || ch === '?') {
      const gt = svg.indexOf('>', i);
      i = gt === -1 ? svg.length : gt + 1;
      continue;
    }
    // Skip closing tags
    if (ch === '/') {
      const gt = svg.indexOf('>', i);
      i = gt === -1 ? svg.length : gt + 1;
      continue;
    }

    // Read tag name (may include namespace prefix like svg: — strip the prefix)
    let raw = '';
    while (i < svg.length && /[\w:-]/.test(svg[i]!)) raw += svg[i++];
    if (!raw) continue;
    const name = raw.toLowerCase().replace(/^[a-z]+:/, '');

    // Read attributes until >
    let attrsStr = '';
    while (i < svg.length && svg[i] !== '>') {
      if (svg[i] === '"') {
        const end = svg.indexOf('"', i + 1);
        if (end === -1) { i = svg.length; break; }
        attrsStr += svg.slice(i, end + 1);
        i = end + 1;
      } else if (svg[i] === "'") {
        const end = svg.indexOf("'", i + 1);
        if (end === -1) { i = svg.length; break; }
        attrsStr += svg.slice(i, end + 1);
        i = end + 1;
      } else {
        attrsStr += svg[i++];
      }
    }
    i++; // skip >

    yield { name, attrs: parseAttrs(attrsStr) };
  }
}

/** Parse SVG attribute string into a key→value map (all keys lowercased). */
function parseAttrs(s: string): Record<string, string> {
  const result: Record<string, string> = {};
  let i = 0;
  while (i < s.length) {
    while (i < s.length && /\s/.test(s[i]!)) i++;
    if (i >= s.length || s[i] === '/') break;
    // Attribute name
    let name = '';
    while (i < s.length && /[^\s=>/]/.test(s[i]!)) name += s[i++];
    if (!name) { i++; continue; }
    while (i < s.length && /\s/.test(s[i]!)) i++;
    if (s[i] !== '=') { result[name.toLowerCase()] = ''; continue; }
    i++; // skip =
    while (i < s.length && /\s/.test(s[i]!)) i++;
    let value = '';
    if (s[i] === '"' || s[i] === "'") {
      const q = s[i++]!;
      while (i < s.length && s[i] !== q) value += s[i++];
      i++;
    } else {
      while (i < s.length && !/[\s>]/.test(s[i]!)) value += s[i++];
    }
    result[name.toLowerCase()] = value;
  }
  return result;
}

const n = (v: string | undefined, fallback = 0): number => {
  const f = parseFloat(v ?? '');
  return Number.isFinite(f) ? f : fallback;
};

/** Convert a geometric SVG shape element to a path `d` string, or null if invalid. */
function shapeToPath(tag: string, a: Record<string, string>): string | null {
  switch (tag) {
    case 'path':
      return a['d'] ?? null;

    case 'rect': {
      const x = n(a['x']), y = n(a['y']), w = n(a['width']), h = n(a['height']);
      if (w <= 0 || h <= 0) return null;
      const rx = Math.min(n(a['rx'] !== undefined ? a['rx'] : a['ry']), w / 2, h / 2);
      const ry = Math.min(n(a['ry'] !== undefined ? a['ry'] : a['rx']), w / 2, h / 2);
      if (rx > 0 && ry > 0) {
        return `M${x + rx},${y}H${x + w - rx}A${rx},${ry} 0 0 1 ${x + w},${y + ry}V${y + h - ry}A${rx},${ry} 0 0 1 ${x + w - rx},${y + h}H${x + rx}A${rx},${ry} 0 0 1 ${x},${y + h - ry}V${y + ry}A${rx},${ry} 0 0 1 ${x + rx},${y}Z`;
      }
      return `M${x},${y}H${x + w}V${y + h}H${x}Z`;
    }

    case 'circle': {
      const cx = n(a['cx']), cy = n(a['cy']), r = n(a['r']);
      if (r <= 0) return null;
      return `M${cx - r},${cy}A${r},${r} 0 0 1 ${cx + r},${cy}A${r},${r} 0 0 1 ${cx - r},${cy}Z`;
    }

    case 'ellipse': {
      const cx = n(a['cx']), cy = n(a['cy']), rx = n(a['rx']), ry = n(a['ry']);
      if (rx <= 0 || ry <= 0) return null;
      return `M${cx - rx},${cy}A${rx},${ry} 0 0 1 ${cx + rx},${cy}A${rx},${ry} 0 0 1 ${cx - rx},${cy}Z`;
    }

    case 'line': {
      const x1 = n(a['x1']), y1 = n(a['y1']), x2 = n(a['x2']), y2 = n(a['y2']);
      if (x1 === x2 && y1 === y2) return null;
      return `M${x1},${y1}L${x2},${y2}`;
    }

    case 'polyline':
    case 'polygon': {
      const raw = (a['points'] ?? '').trim();
      if (!raw) return null;
      const nums = raw.split(/[\s,]+/).map(Number).filter((v) => Number.isFinite(v));
      if (nums.length < 4) return null;
      let d = `M${nums[0]},${nums[1]}`;
      for (let i = 2; i + 1 < nums.length; i += 2) d += `L${nums[i]},${nums[i + 1]}`;
      if (tag === 'polygon') d += 'Z';
      return d;
    }

    default:
      return null;
  }
}
