import type { Page } from '@playwright/test';

export interface LowContrast {
  text: string;
  ratio: number;
  color: string;
  background: string;
  where: string;
}

/**
 * Every visible piece of interface text against the colour actually under it (the nearest painted background up the tree,
 * semi-transparent layers mixed in). The artboard of a work is skipped: its colours are the author's theme, not the interface.
 * Disabled controls are skipped too (WCAG 1.4.3 does not cover them).
 */
export async function lowContrast(page: Page, min = 3): Promise<LowContrast[]> {
  return page.evaluate((minRatio) => {
    type Rgba = [number, number, number, number];
    const parse = (c: string): Rgba | null => {
      const m = /rgba?\(([^)]+)\)/.exec(c);
      if (!m) return null;
      const p = m[1]!.split(/[ ,/]+/).filter(Boolean).map(Number);
      return [p[0]!, p[1]!, p[2]!, p[3] ?? 1];
    };
    const over = (top: Rgba, under: Rgba): Rgba => {
      const a = top[3] + under[3] * (1 - top[3]);
      if (a === 0) return [0, 0, 0, 0];
      const ch = (i: number) => (top[i]! * top[3] + under[i]! * under[3] * (1 - top[3])) / a;
      return [ch(0), ch(1), ch(2), a];
    };
    const lum = (c: Rgba) => {
      const f = (v: number) => {
        const s = v / 255;
        return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
      };
      return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]);
    };
    const backgroundOf = (el: Element): Rgba | null => {
      const layers: Rgba[] = [];
      for (let e: Element | null = el; e; e = e.parentElement) {
        const cs = getComputedStyle(e);
        if (cs.backgroundImage !== 'none' && !cs.backgroundImage.startsWith('url(')) return null;
        const bg = parse(cs.backgroundColor);
        if (bg && bg[3] > 0) {
          layers.push(bg);
          if (bg[3] >= 1) break;
        }
      }
      let result: Rgba = [255, 255, 255, 1];
      const root = parse(getComputedStyle(document.documentElement).backgroundColor);
      if (root && root[3] > 0) result = root;
      for (const l of layers.reverse()) result = over(l, result);
      return result;
    };
    const out: Array<{ text: string; ratio: number; color: string; background: string; where: string }> = [];
    const skip = '.bk-artboard, .bk-stage, .bk-screen, svg, canvas, [aria-hidden="true"], .ed-stage, .ed-phone, .ed-desktop, .ed-thumb';
    for (const el of document.querySelectorAll('body *')) {
      if (el.closest(skip)) continue;
      const own = [...el.childNodes].filter((n) => n.nodeType === Node.TEXT_NODE).map((n) => n.textContent ?? '').join('').trim();
      if (!own) continue;
      const r = el.getBoundingClientRect();
      if (r.width < 2 || r.height < 2) continue;
      const cs = getComputedStyle(el);
      if (cs.visibility === 'hidden' || Number(cs.opacity) === 0) continue;
      if ((el as HTMLButtonElement).disabled || el.closest('[disabled], [aria-disabled="true"]')) continue;
      const fg = parse(cs.color);
      const bg = backgroundOf(el);
      if (!fg || !bg) continue;
      const shown = over(fg, bg);
      const [a, b] = [lum(shown), lum(bg)];
      const ratio = (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
      if (ratio < minRatio) {
        const path = [el.tagName.toLowerCase(), el.getAttribute('data-testid') ? `[data-testid=${el.getAttribute('data-testid')}]` : '', el.className && typeof el.className === 'string' ? `.${el.className.split(' ')[0]}` : ''].join('');
        out.push({ text: own.slice(0, 40), ratio: Math.round(ratio * 100) / 100, color: cs.color, background: `rgb(${bg.slice(0, 3).map(Math.round).join(',')})`, where: path });
      }
    }
    return out;
  }, min);
}
