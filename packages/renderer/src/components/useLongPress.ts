import { type PointerEvent, useCallback, useEffect, useRef } from 'react';
import { type RuntimeEvent } from '@blokum/engine';

/** TR-03 · the shortest hold that is reported, and the longest one (after it the event is sent without waiting for the release). */
export const LONG_PRESS_MIN_MS = 300;
export const LONG_PRESS_MAX_MS = 3000;
/** A finger or a mouse that moved this far (pixels) is dragging, not holding. */
const MOVE_LIMIT = 12;

/**
 * Reports how long a block was held: once per press — when it is released, or after three seconds. A press that moved or was cut
 * short (the pointer left, the system took the touch) reports nothing. Rules choose by the time themselves (`ms` of the trigger).
 */
export function useLongPress({ enabled, instanceId, dispatch, now = () => performance.now() }: { enabled: boolean; instanceId: string; dispatch: ((event: RuntimeEvent) => void) | undefined; now?: () => number }) {
  const press = useRef<{ at: number; x: number; y: number; timer: ReturnType<typeof setTimeout>; sent: boolean } | null>(null);

  const clear = useCallback(() => {
    if (press.current) clearTimeout(press.current.timer);
    press.current = null;
  }, []);
  useEffect(() => clear, [clear]);

  const down = useCallback(
    (e: PointerEvent) => {
      if (!enabled || !dispatch || (e.pointerType === 'mouse' && e.button !== 0)) return;
      clear();
      const current = {
        at: now(),
        x: e.clientX,
        y: e.clientY,
        sent: false,
        timer: setTimeout(() => {
          if (press.current !== current) return;
          current.sent = true;
          dispatch({ type: 'longPress', blockId: instanceId, ms: LONG_PRESS_MAX_MS });
        }, LONG_PRESS_MAX_MS),
      };
      press.current = current;
    },
    [enabled, dispatch, instanceId, clear, now],
  );

  const up = useCallback(
    (e: PointerEvent) => {
      const current = press.current;
      if (!current) return;
      clear();
      if (current.sent || !dispatch) return;
      const moved = Math.hypot(e.clientX - current.x, e.clientY - current.y) > MOVE_LIMIT;
      const ms = now() - current.at;
      if (!moved && ms >= LONG_PRESS_MIN_MS) dispatch({ type: 'longPress', blockId: instanceId, ms: Math.min(ms, LONG_PRESS_MAX_MS) });
    },
    [dispatch, instanceId, clear, now],
  );

  return { down, up, cancel: clear };
}
