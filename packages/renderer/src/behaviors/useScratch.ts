'use client';

import { type RuntimeEvent } from '@blokum/engine';
import { type CSSProperties, useEffect, useRef, useState } from 'react';
import { type PointerHandlers } from './pointer.js';

/** How often the mask of the layer is redrawn while scratching, ms. */
const MASK_EVERY_MS = 50;

/** Share of scratched pixels, checking every `step`-th pixel in both directions (alpha < 128 — scratched, counts antialiased edges). */
export function scratchedPercent(data: Uint8ClampedArray, width: number, height: number, step = 3): number {
  let total = 0;
  let clear = 0;
  for (let y = 0; y < height; y += step) {
    for (let x = 0; x < width; x += step) {
      total += 1;
      if ((data[(y * width + x) * 4 + 3] ?? 255) < 128) clear += 1;
    }
  }
  return total ? Math.round((clear / total) * 100) : 0;
}

/**
 * BH-03 «Стираемый слой»: the whole block (any fill, picture, text) is the layer. A canvas of the block's size
 * is its mask: the finger erases a line of the brush width, the block becomes transparent there and shows what
 * lies under it. The scratched share goes to the runtime (TR-14); past the threshold the layer fades away.
 */
export function useScratch(o: { enabled: boolean; instanceId: string; w: number; h: number; brush: number; threshold: number; dispatch: ((e: RuntimeEvent) => void) | undefined }): { handlers: PointerHandlers; style: CSSProperties } {
  const canvas = useRef<HTMLCanvasElement | null>(null);
  const last = useRef<{ id: number; x: number; y: number } | null>(null);
  const reported = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Cleanup for any active native listeners; called on component unmount.
  const nativeCleanup = useRef<(() => void) | null>(null);
  const [mask, setMask] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const { enabled, w, h } = o;

  useEffect(() => {
    if (!enabled || typeof document === 'undefined') return;
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.ceil(w));
    c.height = Math.max(1, Math.ceil(h));
    const g = c.getContext('2d');
    if (!g) return;
    g.fillStyle = '#000000';
    g.fillRect(0, 0, c.width, c.height);
    canvas.current = c;
    return () => {
      if (timer.current) clearTimeout(timer.current);
      nativeCleanup.current?.();
      canvas.current = null;
    };
  }, [enabled, w, h]);

  const refresh = () => {
    if (timer.current) return;
    timer.current = setTimeout(() => {
      timer.current = null;
      const c = canvas.current;
      const g = c?.getContext('2d');
      if (!c || !g) return;
      setMask(c.toDataURL());
      const percent = scratchedPercent(g.getImageData(0, 0, c.width, c.height).data, c.width, c.height);
      if (percent >= reported.current + 2 || (percent >= o.threshold && reported.current < o.threshold)) {
        reported.current = percent;
        o.dispatch?.({ type: 'scratched', blockId: o.instanceId, percent });
      }
      if (percent >= o.threshold) setDone(true);
    }, MASK_EVERY_MS);
  };

  const erase = (from: { x: number; y: number }, to: { x: number; y: number }) => {
    const g = canvas.current?.getContext('2d');
    if (!g) return;
    g.globalCompositeOperation = 'destination-out';
    g.lineCap = 'round';
    g.lineJoin = 'round';
    g.lineWidth = o.brush;
    g.beginPath();
    g.moveTo(from.x, from.y);
    g.lineTo(to.x + 0.01, to.y);
    g.stroke();
    refresh();
  };

  if (!enabled || !o.dispatch) return { handlers: {}, style: {} };
  return {
    handlers: {
      onPointerDown: (e) => {
        if (done) return;
        const el = e.currentTarget as HTMLElement;
        const r = el.getBoundingClientRect();
        const p = {
          x: r.width ? ((e.clientX - r.left) / r.width) * w : 0,
          y: r.height ? ((e.clientY - r.top) / r.height) * h : 0,
        };
        last.current = { id: e.pointerId, ...p };
        erase(p, p);

        // BH-03: use native window listeners instead of React handlers — React event delegation
        // does not fire onPointerMove after setPointerCapture in some environments (Playwright/Chromium).
        const onMove = (ev: PointerEvent) => {
          const l = last.current;
          if (!l || l.id !== ev.pointerId) return;
          const rect = el.getBoundingClientRect();
          const np = {
            x: rect.width ? ((ev.clientX - rect.left) / rect.width) * w : 0,
            y: rect.height ? ((ev.clientY - rect.top) / rect.height) * h : 0,
          };
          erase(l, np);
          last.current = { id: ev.pointerId, ...np };
        };
        const onUp = () => {
          last.current = null;
          nativeCleanup.current = null;
          window.removeEventListener('pointermove', onMove);
          window.removeEventListener('pointerup', onUp);
          window.removeEventListener('pointercancel', onUp);
        };
        nativeCleanup.current = onUp;
        window.addEventListener('pointermove', onMove);
        window.addEventListener('pointerup', onUp);
        window.addEventListener('pointercancel', onUp);
      },
    },
    style: {
      touchAction: 'none',
      ...(mask ? { maskImage: `url(${mask})`, WebkitMaskImage: `url(${mask})`, maskSize: '100% 100%', WebkitMaskSize: '100% 100%', maskRepeat: 'no-repeat' } : {}),
      ...(done ? { opacity: 0, transition: 'opacity 400ms ease', pointerEvents: 'none' } : {}),
    },
  };
}
