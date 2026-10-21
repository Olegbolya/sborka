import { type BlockStyle } from '@blokum/schema';
import { type BlockView as RuntimeView } from '@blokum/engine';

/**
 * Style after scenario changes (AC-02): overridden style groups replace the resolved ones, animated
 * numbers (opacity, blur, filters, 3D) patch them. Scale and frame values are applied by BlockView.
 */
export function applyRuntimeView(style: BlockStyle, view: Pick<RuntimeView, 'overrides' | 'anim'> | undefined): BlockStyle {
  // Nothing changed by scenarios — the same object, so the block's CSS stays cached (SC-05 frame budget).
  if (!view || (Object.keys(view.overrides).length === 0 && Object.keys(view.anim).length === 0)) return style;
  const next: BlockStyle = { ...style };
  for (const [path, value] of Object.entries(view.overrides)) {
    if (path.startsWith('style.')) (next as Record<string, unknown>)[path.slice('style.'.length)] = value;
  }
  const a = view.anim;
  if (a.opacity !== undefined || a.blur !== undefined || a.backdropBlur !== undefined) {
    next.effects = { ...next.effects, ...(a.opacity !== undefined ? { opacity: a.opacity } : {}), ...(a.blur !== undefined ? { blur: a.blur } : {}), ...(a.backdropBlur !== undefined ? { backdropBlur: a.backdropBlur } : {}) };
  }
  const filterKeys = ['brightness', 'contrast', 'saturate', 'grayscale', 'hueRotate'] as const;
  if (filterKeys.some((k) => a[k] !== undefined)) {
    next.filters = { ...next.filters, ...Object.fromEntries(filterKeys.filter((k) => a[k] !== undefined).map((k) => [k, a[k]])) };
  }
  if (a.rotateX !== undefined || a.rotateY !== undefined) {
    next.transform3d = { ...next.transform3d, ...(a.rotateX !== undefined ? { rotateX: a.rotateX } : {}), ...(a.rotateY !== undefined ? { rotateY: a.rotateY } : {}) };
  }
  return next;
}
