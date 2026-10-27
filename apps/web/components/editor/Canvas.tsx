'use client';
import { Artboard, ScreenView } from '@blokum/renderer';
import { type Block } from '@blokum/schema';
import { type KeyboardEvent, type PointerEvent as ReactPointerEvent, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { withGroupMates } from '../../lib/editor/arrange';
import { type Handle, HANDLES, absoluteFrames, boundsOf, unionOf } from '../../lib/editor/geometry';
import { type GestureEnv, NO_TRANSIENT, type Transient, startMarquee, startMove, startResize, startRotate } from '../../lib/editor/gestures';
import { drawOrder } from '../../lib/editor/tree';
import { useEditor, useEnv } from './context';

const ARTBOARD = 390;
export const ZOOM_STEPS = [0.25, 0.33, 0.5, 0.67, 0.75, 1, 1.25, 1.5, 2, 3, 4] as const;
export const MIN_ZOOM = 0.25;
export const MAX_ZOOM = 4;
const PAD = 32;

/** E-10 · next zoom step up or down from the current value. */
export function stepZoom(current: number, direction: 1 | -1): number {
  if (direction > 0) return ZOOM_STEPS.find((z) => z > current + 1e-6) ?? MAX_ZOOM;
  return [...ZOOM_STEPS].reverse().find((z) => z < current - 1e-6) ?? MIN_ZOOM;
}

export const clampZoom = (z: number): number => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, z));

type View = { mode: 'width' } | { mode: 'screen' } | { mode: 'custom'; zoom: number };

const HANDLE_CURSOR: Record<Handle, string> = { n: 'ns-resize', s: 'ns-resize', e: 'ew-resize', w: 'ew-resize', ne: 'nesw-resize', sw: 'nesw-resize', nw: 'nwse-resize', se: 'nwse-resize' };
const HANDLE_POS: Record<Handle, [string, string]> = {
  nw: ['0%', '0%'],
  n: ['50%', '0%'],
  ne: ['100%', '0%'],
  e: ['100%', '50%'],
  se: ['100%', '100%'],
  s: ['50%', '100%'],
  sw: ['0%', '100%'],
  w: ['0%', '50%'],
};

/**
 * E-01…E-10 · the working screen: drawn by the same renderer as the player (one render), with a layer of hit areas, the
 * box with handles around the selection and the guides above it. Everything the pointer does is a gesture of
 * `lib/editor/gestures.ts`; here are the views, the zoom and the panning.
 */
export function Canvas() {
  const { store } = useEnv();
  const doc = useEditor((s) => s.doc);
  const selection = useEditor((s) => s.selection);
  const screen = doc.screens.find((s) => s.id === selection.screenId) ?? doc.screens[0]!;
  const wrap = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: ARTBOARD + 2 * PAD, h: 900 });
  const [view, setView] = useState<View>({ mode: 'width' });
  const [grid, setGrid] = useState(false);
  const [snap, setSnap] = useState(true);
  const [transient, setTransient] = useState<Transient>(NO_TRANSIENT);
  const [panning, setPanning] = useState(false);
  const space = useRef(false);

  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setSize({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    setSize({ w: el.clientWidth, h: el.clientHeight });
    return () => ro.disconnect();
  }, []);

  const fitWidth = clampZoom(Math.min(1.5, (size.w - PAD) / ARTBOARD));
  const fitScreen = clampZoom(Math.min((size.w - PAD) / ARTBOARD, (size.h - PAD) / screen.height));
  const unit = view.mode === 'custom' ? view.zoom : view.mode === 'screen' ? fitScreen : fitWidth;
  const unitRef = useRef(unit);
  unitRef.current = unit;

  /** The point of the artboard that must stay under a point of the window while the zoom changes (E-10). */
  const anchorRef = useRef<{ ux: number; uy: number; ax: number; ay: number } | null>(null);

  /** Zoom around a point of the viewport, so the thing under the pointer stays under it (E-10). */
  const zoomTo = useCallback((next: number, anchor?: { x: number; y: number }) => {
    const el = wrap.current;
    const stage = stageRef.current;
    const z = clampZoom(next);
    if (el && stage) {
      const rect = stage.getBoundingClientRect();
      const box = el.getBoundingClientRect();
      const a = anchor ?? { x: box.left + el.clientWidth / 2, y: box.top + el.clientHeight / 2 };
      anchorRef.current = { ux: (a.x - rect.left) / unitRef.current, uy: (a.y - rect.top) / unitRef.current, ax: a.x, ay: a.y };
    }
    setView({ mode: 'custom', zoom: z });
  }, []);

  // After the new size is drawn the same point of the artboard is put back under the anchor.
  useLayoutEffect(() => {
    const p = anchorRef.current;
    const el = wrap.current;
    const stage = stageRef.current;
    anchorRef.current = null;
    if (!p || !el || !stage) return;
    const r = stage.getBoundingClientRect();
    el.scrollLeft += r.left + p.ux * unit - p.ax;
    el.scrollTop += r.top + p.uy * unit - p.ay;
  }, [unit]);

  const toUnits = useCallback((clientX: number, clientY: number) => {
    const r = stageRef.current!.getBoundingClientRect();
    return { x: (clientX - r.left) / unitRef.current, y: (clientY - r.top) / unitRef.current };
  }, []);

  const gridRef = useRef(grid);
  gridRef.current = grid;
  const snapRef = useRef(snap);
  snapRef.current = snap;
  const env: GestureEnv = useMemo(() => ({ store, unit: () => unitRef.current, toUnits, grid: () => gridRef.current, snap: () => snapRef.current, show: setTransient }), [store, toUnits]);

  // E-10 · Ctrl + wheel zooms (a normal wheel scrolls), space and the middle button pan.
  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      e.preventDefault();
      zoomTo(unitRef.current * Math.exp(-e.deltaY / 300), { x: e.clientX, y: e.clientY });
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [zoomTo]);

  useEffect(() => {
    const typing = (t: EventTarget | null) => {
      const el = t as HTMLElement | null;
      return !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable);
    };
    const down = (e: globalThis.KeyboardEvent) => {
      if (document.querySelector('[role="dialog"]') || typing(e.target)) return;
      if (e.code === 'Space') {
        space.current = true;
        setPanning(true);
        if (e.target === document.body) e.preventDefault();
        return;
      }
      if (!(e.ctrlKey || e.metaKey)) return;
      if (e.key === '+' || e.key === '=') {
        e.preventDefault();
        zoomTo(stepZoom(unitRef.current, 1));
      } else if (e.key === '-') {
        e.preventDefault();
        zoomTo(stepZoom(unitRef.current, -1));
      } else if (e.key === '0') {
        e.preventDefault();
        setView({ mode: 'screen' });
      } else if (e.key === '1') {
        e.preventDefault();
        zoomTo(1);
      }
    };
    const up = (e: globalThis.KeyboardEvent) => {
      if (e.code !== 'Space') return;
      space.current = false;
      setPanning(false);
    };
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
    };
  }, [zoomTo]);

  /** E-10 · dragging the canvas itself: scroll by the movement of the pointer. */
  const startPan = (e: ReactPointerEvent) => {
    const el = wrap.current!;
    const from = { x: e.clientX, y: e.clientY, left: el.scrollLeft, top: el.scrollTop };
    setPanning(true);
    const id = e.pointerId;
    const move = (ev: PointerEvent) => {
      if (ev.pointerId !== id) return;
      el.scrollLeft = from.left - (ev.clientX - from.x);
      el.scrollTop = from.top - (ev.clientY - from.y);
    };
    const end = (ev: PointerEvent) => {
      if (ev.pointerId !== id) return;
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', end);
      window.removeEventListener('pointercancel', end);
      setPanning(space.current);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', end);
    window.addEventListener('pointercancel', end);
  };

  // E-10 · two fingers: pan with the middle of the pair, zoom with the distance between them.
  const touches = useRef(new Map<number, { x: number; y: number }>());
  const pair = useRef<{ mid: { x: number; y: number }; dist: number } | null>(null);
  const onTouchDown = (e: ReactPointerEvent) => {
    if (e.pointerType !== 'touch') return;
    touches.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (touches.current.size === 2) pair.current = pairOf(touches.current);
  };
  const onTouchMove = (e: ReactPointerEvent) => {
    if (e.pointerType !== 'touch' || !touches.current.has(e.pointerId)) return;
    touches.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (touches.current.size !== 2 || !pair.current) return;
    const now = pairOf(touches.current);
    const el = wrap.current!;
    el.scrollLeft -= now.mid.x - pair.current.mid.x;
    el.scrollTop -= now.mid.y - pair.current.mid.y;
    if (pair.current.dist > 0 && now.dist > 0) zoomTo(unitRef.current * (now.dist / pair.current.dist), now.mid);
    pair.current = now;
  };
  const onTouchUp = (e: ReactPointerEvent) => {
    touches.current.delete(e.pointerId);
    pair.current = touches.current.size === 2 ? pairOf(touches.current) : null;
  };

  const blocksById = useMemo(() => new Map([...drawOrder(screen.blocks)].map((b) => [b.id, b])), [screen.blocks]);
  const frames = useMemo(() => absoluteFrames(screen.blocks), [screen.blocks]);
  const hits = useMemo(() => drawOrder(screen.blocks).filter((b) => !b.hiddenInEditor), [screen.blocks]);
  const selected = new Set(selection.blockIds);
  const picked = selection.blockIds.map((id) => blocksById.get(id)).filter((b): b is Block => b !== undefined);

  /** A press on the canvas must not start a text selection or a native drag, and takes the focus out of a field. */
  const claim = (e: ReactPointerEvent) => {
    e.preventDefault();
    (document.activeElement as HTMLElement | null)?.blur?.();
  };

  const pick = (block: Block, e: ReactPointerEvent) => {
    claim(e);
    if (e.button === 1 || space.current) {
      e.preventDefault();
      startPan(e);
      return;
    }
    if (e.button !== 0) return;
    e.stopPropagation();
    onTouchDown(e);
    if (touches.current.size > 1) return;
    const st = store.getState();
    const additive = e.shiftKey || e.metaKey || e.ctrlKey;
    // E-09: picking a member of a group picks the group; Alt picks the member itself.
    const ids = e.altKey ? [block.id] : withGroupMates(st.doc, [block.id]);
    if (additive) {
      const all = ids.every((id) => selected.has(id));
      st.select(screen.id, all ? selection.blockIds.filter((id) => !ids.includes(id)) : [...new Set([...selection.blockIds, ...ids])]);
      return;
    }
    if (selected.has(block.id)) {
      // Part of the current selection: it is dragged together; a plain click narrows the selection to this block.
      startMove(env, e.nativeEvent, selection.blockIds, () => store.getState().select(screen.id, ids));
      return;
    }
    st.select(screen.id, ids);
    startMove(env, e.nativeEvent, ids, () => undefined);
  };

  const onStageDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    claim(e);
    if (e.button === 1 || space.current) {
      e.preventDefault();
      startPan(e);
      return;
    }
    if (e.button !== 0) return;
    onTouchDown(e);
    if (touches.current.size > 1) return;
    startMarquee(env, e.nativeEvent, e.shiftKey || e.metaKey || e.ctrlKey);
  };

  const onKey = (e: KeyboardEvent, block: Block) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      const ids = withGroupMates(store.getState().doc, [block.id]);
      store.getState().select(screen.id, e.shiftKey ? [...new Set([...selection.blockIds, ...ids])] : ids);
    }
  };

  const box = (() => {
    if (picked.length === 0) return null;
    if (picked.length === 1) {
      const f = frames.get(picked[0]!.id);
      return f ? { x: f.x, y: f.y, w: f.w, h: f.h, rotation: f.rotation, single: picked[0]! } : null;
    }
    const u = unionOf(picked.map((b) => boundsOf(frames.get(b.id)!)));
    return u ? { ...u, rotation: 0, single: null } : null;
  })();
  const allLocked = picked.length > 0 && picked.every((b) => b.locked);

  const percent = Math.round(unit * 100);
  const px = (n: number) => n * unit;

  return (
    <div className="ed-center">
      <div className="ed-viewbar" role="toolbar" aria-label="Вид">
        <button type="button" className="ed-btn small" aria-label="Отдалить" onClick={() => zoomTo(stepZoom(unit, -1))} disabled={unit <= MIN_ZOOM + 1e-6}>
          −
        </button>
        <button type="button" className="ed-btn small" aria-label="Масштаб 100%" title="Масштаб 100% (Ctrl+1)" onClick={() => zoomTo(1)} data-testid="zoom">
          {percent}%
        </button>
        <button type="button" className="ed-btn small" aria-label="Приблизить" onClick={() => zoomTo(stepZoom(unit, 1))} disabled={unit >= MAX_ZOOM - 1e-6}>
          +
        </button>
        <button type="button" className="ed-btn small" title="Вписать экран целиком (Ctrl+0)" onClick={() => setView({ mode: 'screen' })}>
          Вписать
        </button>
        <button type="button" className="ed-btn small" aria-pressed={grid} onClick={() => setGrid((g) => !g)}>
          Сетка
        </button>
        <button type="button" className="ed-btn small" aria-pressed={snap} title="Прилипание (Alt при перетаскивании отключает)" onClick={() => setSnap((s) => !s)}>
          Прилипание
        </button>
      </div>
      <div
        className="ed-canvas"
        ref={wrap}
        data-testid="canvas"
        data-panning={panning}
        onPointerMove={onTouchMove}
        onPointerUp={onTouchUp}
        onPointerCancel={onTouchUp}
      >
        <div
          className="ed-stage"
          ref={stageRef}
          data-testid="stage"
          data-screen-id={screen.id}
          data-unit={unit}
          style={{ width: px(ARTBOARD), height: px(screen.height) }}
          onPointerDown={(e) => {
            if (e.target === e.currentTarget || (e.target as HTMLElement).closest('.bk-artboard')) onStageDown(e);
          }}
        >
          <Artboard mode="editor" unit={unit} tokens={doc.theme.tokens}>
            <ScreenView screen={screen} />
          </Artboard>
          {grid && unit * 8 >= 4 && (
            <div
              aria-hidden
              data-testid="grid"
              style={{
                position: 'absolute',
                inset: 0,
                pointerEvents: 'none',
                backgroundImage: 'linear-gradient(to right, rgb(0 0 0 / 9%) 1px, transparent 1px), linear-gradient(to bottom, rgb(0 0 0 / 9%) 1px, transparent 1px)',
                backgroundSize: `${px(8)}px ${px(8)}px`,
              }}
            />
          )}
          {hits.map((block) => {
            const f = frames.get(block.id)!;
            return (
              <button
                key={block.id}
                type="button"
                className="ed-hit"
                aria-label={block.name}
                aria-pressed={selected.has(block.id)}
                data-block-id={block.id}
                data-locked={block.locked}
                style={{ left: px(f.x), top: px(f.y), width: px(f.w), height: px(f.h), transform: f.rotation ? `rotate(${f.rotation}deg)` : undefined }}
                onPointerDown={(e) => pick(block, e)}
                onKeyDown={(e) => onKey(e, block)}
              />
            );
          })}
          {box && (
            <div
              className="ed-selbox"
              data-testid="selection-box"
              style={{ left: px(box.x), top: px(box.y), width: px(box.w), height: px(box.h), transform: box.rotation ? `rotate(${box.rotation}deg)` : undefined }}
            >
              {!allLocked &&
                HANDLES.map((h) => (
                  <span
                    key={h}
                    className="ed-handle"
                    role="button"
                    aria-label={`Маркер размера ${h}`}
                    data-handle={h}
                    style={{ left: HANDLE_POS[h][0], top: HANDLE_POS[h][1], cursor: HANDLE_CURSOR[h] }}
                    onPointerDown={(e) => {
                      if (e.button !== 0) return;
                      claim(e);
                      e.stopPropagation();
                      startResize(env, e.nativeEvent, selection.blockIds, h, box.single?.style.lockAspect === true);
                    }}
                  />
                ))}
              {!allLocked && box.single && (
                <span
                  className="ed-handle rotate"
                  role="button"
                  aria-label="Маркер поворота"
                  data-handle="rotate"
                  onPointerDown={(e) => {
                    if (e.button !== 0) return;
                    claim(e);
                    e.stopPropagation();
                    startRotate(env, e.nativeEvent, box.single.id);
                  }}
                />
              )}
            </div>
          )}
          {transient.guides.map((g, i) => (
            <div
              key={`g${i}`}
              className="ed-guide"
              data-testid="guide"
              data-axis={g.axis}
              data-at={g.at}
              data-kind={g.kind}
              style={g.axis === 'x' ? { left: px(g.at), top: px(g.from), width: 1, height: px(g.to - g.from) } : { top: px(g.at), left: px(g.from), height: 1, width: px(g.to - g.from) }}
            />
          ))}
          {transient.gaps.map((g, i) => (
            <div
              key={`d${i}`}
              className="ed-gap"
              data-testid="gap"
              data-axis={g.axis}
              data-value={g.value}
              style={
                g.axis === 'x'
                  ? { left: px(g.from.x), top: px(g.from.y), width: px(g.to.x - g.from.x), height: 1 }
                  : { left: px(g.from.x), top: px(g.from.y), width: 1, height: px(g.to.y - g.from.y) }
              }
            >
              <span>{g.value}</span>
            </div>
          ))}
          {transient.marquee && (
            <div
              className="ed-marquee"
              data-testid="marquee"
              style={{ left: px(transient.marquee.x), top: px(transient.marquee.y), width: px(transient.marquee.w), height: px(transient.marquee.h) }}
            />
          )}
        </div>
      </div>
    </div>
  );
}

function pairOf(map: Map<number, { x: number; y: number }>): { mid: { x: number; y: number }; dist: number } {
  const [a, b] = [...map.values()];
  return { mid: { x: (a!.x + b!.x) / 2, y: (a!.y + b!.y) / 2 }, dist: Math.hypot(a!.x - b!.x, a!.y - b!.y) };
}
