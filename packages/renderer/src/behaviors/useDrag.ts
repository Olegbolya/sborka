'use client';

import { type RuntimeEvent } from '@blokum/engine';
import { useRef } from 'react';
import { type PointerHandlers, pxPerUnit } from './pointer.js';

/** Movement (units) after which a press becomes a drag and no longer counts as a tap. */
export const DRAG_SLOP = 3;

/**
 * BH-01 in the player: Pointer Events with capture — the block keeps its finger or mouse even outside it, and
 * every block holds its own pointer, so several blocks can be dragged with several fingers at once. The runtime
 * applies the axis, bounds, zones and «вернуть на место»; the block only reports where the pointer took it.
 */
export function useDrag(o: { enabled: boolean; instanceId: string; x: number; y: number; dispatch: ((e: RuntimeEvent) => void) | undefined }): PointerHandlers {
  const active = useRef<{ id: number; sx: number; sy: number; bx: number; by: number; unit: number; moved: boolean } | null>(null);
  const swallowClick = useRef(false);
  if (!o.enabled || !o.dispatch) return {};
  const dispatch = o.dispatch;
  const at = (clientX: number, clientY: number) => {
    const s = active.current!;
    return { x: s.bx + (clientX - s.sx) / s.unit, y: s.by + (clientY - s.sy) / s.unit };
  };
  const finish = (e: { pointerId: number; clientX: number; clientY: number }, cancelled: boolean) => {
    const s = active.current;
    if (!s || s.id !== e.pointerId) return;
    const end = at(e.clientX, e.clientY);
    active.current = null;
    swallowClick.current = s.moved;
    dispatch(cancelled ? { type: 'dragEnd', blockId: o.instanceId } : { type: 'dragEnd', blockId: o.instanceId, ...end });
  };
  return {
    onPointerDown: (e) => {
      if (active.current || (e.pointerType === 'mouse' && e.button !== 0)) return;
      e.stopPropagation();
      e.currentTarget.setPointerCapture?.(e.pointerId);
      active.current = { id: e.pointerId, sx: e.clientX, sy: e.clientY, bx: o.x, by: o.y, unit: pxPerUnit(e.currentTarget), moved: false };
      swallowClick.current = false;
      dispatch({ type: 'dragStart', blockId: o.instanceId });
    },
    onPointerMove: (e) => {
      const s = active.current;
      if (!s || s.id !== e.pointerId) return;
      const p = at(e.clientX, e.clientY);
      if (!s.moved && Math.hypot(p.x - s.bx, p.y - s.by) > DRAG_SLOP) s.moved = true;
      if (s.moved) dispatch({ type: 'dragMove', blockId: o.instanceId, ...p });
    },
    onPointerUp: (e) => finish(e, false),
    onPointerCancel: (e) => finish(e, true),
    // A drag is not a tap: the click that follows releasing the block is swallowed.
    onClickCapture: (e) => {
      if (!swallowClick.current) return;
      swallowClick.current = false;
      e.stopPropagation();
    },
  };
}
