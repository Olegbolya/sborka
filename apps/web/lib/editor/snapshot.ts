import { Artboard, ScreenView } from '@blokum/renderer';
import type { ProjectDocument } from '@blokum/schema';
import { toCanvas } from 'html-to-image';
import { type ComponentProps, createElement } from 'react';
import { flushSync } from 'react-dom';
import { createRoot } from 'react-dom/client';

/** PL-04 · картинка превью ссылки для мессенджеров: общепринятый размер Open Graph. */
export const OG_WIDTH = 1200;
export const OG_HEIGHT = 630;
const SCREEN_WIDTH = 390;

const nextFrame = (): Promise<void> => new Promise((resolve) => requestAnimationFrame(() => resolve()));

/** Цвет в левом верхнем углу снимка — им закрашиваются поля по бокам экрана в баннере. */
function cornerColor(canvas: HTMLCanvasElement): string {
  const ctx = canvas.getContext('2d');
  if (!ctx) return '#ffffff';
  const [r, g, b, a] = ctx.getImageData(2, 2, 1, 1).data as unknown as [number, number, number, number];
  return a === 0 ? '#ffffff' : `rgb(${r}, ${g}, ${b})`;
}

/**
 * PL-04 · снимок первого экрана: тот же рендерер, что на холсте и в плеере, рисуется за пределами окна и превращается
 * в картинку 1200×630 (экран по центру, поля — цветом фона экрана). `null`, если браузер не смог — публикации это не мешает.
 */
export async function snapshotFirstScreen(doc: ProjectDocument, media: ComponentProps<typeof Artboard>['media']): Promise<Blob | null> {
  const first = doc.screens[0];
  if (!first) return null;
  // Снимается внутренний блок: у внешнего стоит смещение за пределы окна, и оно попало бы в картинку.
  const outer = document.createElement('div');
  outer.setAttribute('aria-hidden', 'true');
  outer.style.cssText = 'position:fixed;left:-10000px;top:0;pointer-events:none';
  const host = document.createElement('div');
  host.style.cssText = `position:relative;width:${SCREEN_WIDTH}px;height:${first.height}px;overflow:hidden`;
  outer.appendChild(host);
  document.body.appendChild(outer);
  const root = createRoot(host);
  try {
    flushSync(() => root.render(createElement(Artboard, { mode: 'thumbnail', unit: 1, tokens: doc.theme.tokens, ...(media ? { media } : {}), children: createElement(ScreenView, { screen: first }) })));
    await nextFrame();
    await nextFrame();
    await Promise.all([...host.querySelectorAll('img')].map((img) => (img.complete ? Promise.resolve() : img.decode().catch(() => undefined))));
    if (document.fonts) await document.fonts.ready;
    const shot = await toCanvas(host, { width: SCREEN_WIDTH, height: first.height, pixelRatio: 2, cacheBust: false });
    const out = document.createElement('canvas');
    out.width = OG_WIDTH;
    out.height = OG_HEIGHT;
    const ctx = out.getContext('2d');
    if (!ctx) return null;
    ctx.fillStyle = cornerColor(shot);
    ctx.fillRect(0, 0, OG_WIDTH, OG_HEIGHT);
    // Экран крупнее, чем «целиком»: в карточке мессенджера мелкий текст не прочитать. Видна верхняя часть, остальное обрезано.
    const scale = Math.max(OG_HEIGHT / first.height, Math.min(1.6, OG_HEIGHT / SCREEN_WIDTH));
    const w = SCREEN_WIDTH * scale;
    const visibleH = Math.min(first.height * scale, OG_HEIGHT);
    const x = (OG_WIDTH - w) / 2;
    const y = (OG_HEIGHT - visibleH) / 2;
    ctx.save();
    ctx.shadowColor = 'rgba(0, 0, 0, 0.25)';
    ctx.shadowBlur = 24;
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(x, y, w, visibleH);
    ctx.restore();
    ctx.drawImage(shot, 0, 0, shot.width, (visibleH / scale) * (shot.height / first.height), x, y, w, visibleH);
    return await new Promise<Blob | null>((resolve) => out.toBlob(resolve, 'image/png'));
  } catch {
    return null;
  } finally {
    root.unmount();
    outer.remove();
  }
}
