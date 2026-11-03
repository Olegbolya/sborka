'use client';
import { type RefObject, useCallback, useEffect, useRef, useState } from 'react';
import { type BlockStyle, normalizePath, parsePath, serializePath } from '@blokum/schema';
import { addBlock } from '../../lib/editor/commands';
import { absoluteFrames } from '../../lib/editor/geometry';
import { effectiveStyle, setStyleGroup } from '../../lib/editor/style-edit';
import { findBlock } from '../../lib/editor/tree';
import { useControlEnv, useEditor } from './context';

const ARTBOARD = 390;
const CLOSE_SNAP_PX = 10;

interface Pt { x: number; y: number }

// ── Shared helpers ────────────────────────────────────────────────────────────

function stageToArtboard(e: { clientX: number; clientY: number }, stageEl: HTMLElement, unit: number): Pt {
  const r = stageEl.getBoundingClientRect();
  return { x: (e.clientX - r.left) / unit, y: (e.clientY - r.top) / unit };
}

function buildPolyPath(pts: Pt[], close: boolean): string {
  if (pts.length < 1) return '';
  return 'M' + pts[0]!.x + ',' + pts[0]!.y +
    pts.slice(1).map(p => ` L${p.x},${p.y}`).join('') +
    (close ? ' Z' : '');
}

/** Douglas–Peucker path simplification. */
function simplify(pts: Pt[], eps: number): Pt[] {
  if (pts.length <= 2) return pts;
  const a = pts[0]!, b = pts[pts.length - 1]!;
  let maxD = 0, maxI = 0;
  for (let i = 1; i < pts.length - 1; i++) {
    const d = perpDist(pts[i]!, a, b);
    if (d > maxD) { maxD = d; maxI = i; }
  }
  if (maxD > eps) {
    const L = simplify(pts.slice(0, maxI + 1), eps);
    const R = simplify(pts.slice(maxI), eps);
    return [...L.slice(0, -1), ...R];
  }
  return [a, b];
}

function perpDist(p: Pt, a: Pt, b: Pt): number {
  const dx = b.x - a.x, dy = b.y - a.y;
  const len = Math.hypot(dx, dy);
  if (len === 0) return Math.hypot(p.x - a.x, p.y - a.y);
  return Math.abs(dx * (a.y - p.y) - (a.x - p.x) * dy) / len;
}

// ── Pen overlay ───────────────────────────────────────────────────────────────

/**
 * E-21 · Pen tool: click to add straight-line anchors on the artboard.
 * Close by clicking the first node (or pressing Enter). ESC cancels.
 */
export function PenOverlay({
  unit,
  stageRef,
  screenId,
  screenHeight,
  onDone,
}: {
  unit: number;
  stageRef: RefObject<HTMLDivElement | null>;
  screenId: string;
  screenHeight: number;
  /** The contour is drawn and selected: the editor goes back to «Выбор», so the new shape can be edited at once. */
  onDone?: () => void;
}) {
  const { store } = useControlEnv();
  const [nodes, setNodes] = useState<Pt[]>([]);
  const [cursor, setCursor] = useState<Pt | null>(null);
  const nodesRef = useRef<Pt[]>([]);
  nodesRef.current = nodes;

  const commit = useCallback((pts: Pt[]) => {
    if (pts.length < 3) return;
    const d = buildPolyPath(pts, true);
    try {
      const normalised = normalizePath(d);
      const xs = pts.map(p => p.x), ys = pts.map(p => p.y);
      const x0 = Math.min(...xs), y0 = Math.min(...ys);
      const w = Math.max(1, Math.max(...xs) - x0);
      const h = Math.max(1, Math.max(...ys) - y0);
      let createdId: string | undefined;
      store.getState().apply(
        addBlock(screenId, 'shape', null, (ids) => { createdId = ids[0]; }, {
          frame: { x: Math.round(x0), y: Math.round(y0), w: Math.round(w), h: Math.round(h) },
          style: { shape: { kind: 'path', d: normalised, closed: true } },
        }),
        { label: 'Нарисовать контур' },
      );
      if (createdId) store.getState().select(screenId, [createdId]);
      onDone?.();
    } catch { /* flat or invalid — discard silently */ }
  }, [screenId, store, onDone]);

  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;

    const onMove = (e: PointerEvent) => setCursor(stageToArtboard(e, stage, unit));

    const onDown = (e: PointerEvent) => {
      if (e.button !== 0) return;
      e.preventDefault();
      e.stopPropagation();
      const pt = stageToArtboard(e, stage, unit);
      const prev = nodesRef.current;
      if (prev.length >= 2) {
        const first = prev[0]!;
        if (Math.hypot((pt.x - first.x) * unit, (pt.y - first.y) * unit) < CLOSE_SNAP_PX) {
          commit(prev);
          setNodes([]);
          return;
        }
      }
      setNodes(n => [...n, pt]);
    };

    const onKey = (e: KeyboardEvent) => {
      if (e.code === 'Escape') { setNodes([]); return; }
      if (e.code === 'Enter') {
        // Фокус остаётся на кнопке «Перо»: без этого Enter ещё и «нажмёт» её и снова включит перо.
        e.preventDefault();
        commit(nodesRef.current);
        setNodes([]);
      }
      if (e.code === 'Backspace') setNodes(n => n.slice(0, -1));
    };

    stage.addEventListener('pointermove', onMove);
    stage.addEventListener('pointerdown', onDown);
    window.addEventListener('keydown', onKey);
    return () => {
      stage.removeEventListener('pointermove', onMove);
      stage.removeEventListener('pointerdown', onDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [stageRef, unit, commit]);

  const w = unit * ARTBOARD;
  const h = unit * screenHeight;
  const previewPts = cursor ? [...nodes, cursor] : nodes;
  const previewD = previewPts.length >= 2 ? previewPts.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x * unit},${p.y * unit}`).join('') : null;

  return (
    <svg
      data-testid="pen-overlay"
      style={{ position: 'absolute', inset: 0, pointerEvents: 'all', cursor: 'crosshair', overflow: 'visible' }}
      width={w}
      height={h}
      aria-hidden
    >
      {previewD && <path d={previewD} fill="none" stroke="#0069ff" strokeWidth={1.5 / unit} strokeDasharray={`${4 / unit} ${3 / unit}`} />}
      {nodes.map((nd, i) => {
        const isFirst = i === 0 && nodes.length >= 2 && cursor &&
          Math.hypot((cursor.x - nd.x) * unit, (cursor.y - nd.y) * unit) < CLOSE_SNAP_PX;
        return (
          <circle
            key={i}
            data-testid={`pen-node-${i}`}
            cx={nd.x * unit}
            cy={nd.y * unit}
            r={i === 0 ? 6 : 4}
            fill={isFirst ? '#0069ff' : (i === 0 ? '#fff' : '#fff')}
            stroke="#0069ff"
            strokeWidth={1.5}
          />
        );
      })}
    </svg>
  );
}

// ── Pencil overlay ────────────────────────────────────────────────────────────

/**
 * E-21 · Pencil tool: drag to draw a freehand stroke; on pointer-up the simplified
 * polyline becomes a path block. ESC cancels.
 */
export function PencilOverlay({
  unit,
  stageRef,
  screenId,
  screenHeight,
  onDone,
}: {
  unit: number;
  stageRef: RefObject<HTMLDivElement | null>;
  screenId: string;
  screenHeight: number;
  /** The contour is drawn and selected: the editor goes back to «Выбор», so the new shape can be edited at once. */
  onDone?: () => void;
}) {
  const { store } = useControlEnv();
  const [pts, setPts] = useState<Pt[]>([]);
  const drawing = useRef(false);

  const commit = useCallback((raw: Pt[]) => {
    if (raw.length < 2) return;
    const simplified = simplify(raw, 2 / unit);
    if (simplified.length < 2) return;
    const d = buildPolyPath(simplified, false);
    try {
      const normalised = normalizePath(d);
      const xs = simplified.map(p => p.x), ys = simplified.map(p => p.y);
      const x0 = Math.min(...xs), y0 = Math.min(...ys);
      const w = Math.max(1, Math.max(...xs) - x0);
      const h = Math.max(1, Math.max(...ys) - y0);
      let createdId: string | undefined;
      store.getState().apply(
        addBlock(screenId, 'shape', null, (ids) => { createdId = ids[0]; }, {
          frame: { x: Math.round(x0), y: Math.round(y0), w: Math.round(w), h: Math.round(h) },
          style: { shape: { kind: 'path', d: normalised, closed: false } },
        }),
        { label: 'Нарисовать карандашом' },
      );
      if (createdId) store.getState().select(screenId, [createdId]);
      onDone?.();
    } catch { /* flat stroke — discard */ }
  }, [screenId, store, unit, onDone]);

  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;

    const onDown = (e: PointerEvent) => {
      if (e.button !== 0) return;
      e.preventDefault();
      drawing.current = true;
      stage.setPointerCapture(e.pointerId);
      setPts([stageToArtboard(e, stage, unit)]);
    };
    const onMove = (e: PointerEvent) => {
      if (!drawing.current) return;
      const pt = stageToArtboard(e, stage, unit);
      setPts(prev => {
        const last = prev[prev.length - 1];
        if (last && Math.hypot(pt.x - last.x, pt.y - last.y) < 1 / unit) return prev;
        return [...prev, pt];
      });
    };
    const onUp = (_e: PointerEvent) => {
      if (!drawing.current) return;
      drawing.current = false;
      setPts(prev => { commit(prev); return []; });
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.code === 'Escape') { setPts([]); drawing.current = false; }
    };

    stage.addEventListener('pointerdown', onDown);
    stage.addEventListener('pointermove', onMove);
    stage.addEventListener('pointerup', onUp);
    stage.addEventListener('pointercancel', onUp);
    window.addEventListener('keydown', onKey);
    return () => {
      stage.removeEventListener('pointerdown', onDown);
      stage.removeEventListener('pointermove', onMove);
      stage.removeEventListener('pointerup', onUp);
      stage.removeEventListener('pointercancel', onUp);
      window.removeEventListener('keydown', onKey);
    };
  }, [stageRef, unit, commit]);

  const pathD = pts.length >= 2 ? pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x * unit},${p.y * unit}`).join('') : null;

  return (
    <svg
      data-testid="pencil-overlay"
      style={{ position: 'absolute', inset: 0, pointerEvents: 'all', cursor: 'crosshair', overflow: 'visible' }}
      width={unit * ARTBOARD}
      height={unit * screenHeight}
      aria-hidden
    >
      {pathD && <path d={pathD} fill="none" stroke="#333" strokeWidth={2 / unit} />}
    </svg>
  );
}

// ── Node editor ───────────────────────────────────────────────────────────────

/**
 * E-21 · Node editor: double-clicking a path-shaped block shows draggable
 * anchor nodes. Drag a node to reposition it; ESC exits node editing.
 */
export function NodeEditor({
  blockId,
  unit,
  stageRef,
  screenId,
  onDone,
}: {
  blockId: string;
  unit: number;
  stageRef: RefObject<HTMLDivElement | null>;
  screenId: string;
  onDone: () => void;
}) {
  const { store } = useControlEnv();
  const doc = useEditor(s => s.doc);
  const screen = doc.screens.find(s => s.id === screenId) ?? doc.screens[0]!;
  const abs = absoluteFrames(screen.blocks);
  const frame = abs.get(blockId);

  const loc = findBlock(doc, blockId);
  const block = loc?.siblings[loc.index];
  const shape = block ? effectiveStyle(block, doc.theme.tokens, null).shape : null;

  const anchorNodes: Pt[] = [];
  if (shape?.kind === 'path' && frame) {
    try {
      for (const s of parsePath(shape.d)) {
        if (s.c === 'Z') continue;
        anchorNodes.push({
          x: frame.x + (s.x / 100) * frame.w,
          y: frame.y + (s.y / 100) * frame.h,
        });
      }
    } catch { /* ignore */ }
  }

  const dragging = useRef<{ idx: number } | null>(null);

  const updateNode = useCallback((idx: number, clientX: number, clientY: number) => {
    const stage = stageRef.current;
    if (!stage || !frame) return;
    const r = stage.getBoundingClientRect();
    const ax = (clientX - r.left) / unit;
    const ay = (clientY - r.top) / unit;
    const nx = Math.max(0, Math.min(100, ((ax - frame.x) / frame.w) * 100));
    const ny = Math.max(0, Math.min(100, ((ay - frame.y) / frame.h) * 100));

    const state = store.getState();
    const l = findBlock(state.doc, blockId);
    const b = l?.siblings[l.index];
    const sh = b ? effectiveStyle(b, state.doc.theme.tokens, null).shape : null;
    if (sh?.kind !== 'path') return;

    try {
      const segs = parsePath(sh.d);
      let ni = 0;
      const updated = segs.map(s => {
        if (s.c === 'Z') return s;
        const isIt = ni++ === idx;
        return isIt ? { ...s, x: nx, y: ny } : s;
      });
      const newD = serializePath(updated);
      state.apply(
        setStyleGroup([blockId], 'shape', state.doc.theme.tokens, null, (cur: BlockStyle['shape']) => ({ ...cur, d: newD })),
        { label: 'Переместить узел', mergeKey: `node-${blockId}-${idx}` },
      );
    } catch { /* ignore */ }
  }, [blockId, frame, stageRef, store, unit]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.code === 'Escape') onDone();
    };
    const onUp = () => { dragging.current = null; };
    const onMove = (e: PointerEvent) => {
      if (dragging.current) updateNode(dragging.current.idx, e.clientX, e.clientY);
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointermove', onMove);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointermove', onMove);
    };
  }, [onDone, updateNode]);

  if (!frame) return null;

  return (
    <svg
      data-testid="node-editor"
      style={{ position: 'absolute', inset: 0, pointerEvents: 'none', overflow: 'visible' }}
      width={unit * ARTBOARD}
      height={unit * screen.height}
      aria-hidden
    >
      {anchorNodes.map((nd, i) => (
        <circle
          key={i}
          data-testid={`node-${i}`}
          cx={nd.x * unit}
          cy={nd.y * unit}
          r={5}
          fill="white"
          stroke="#0069ff"
          strokeWidth={1.5}
          style={{ pointerEvents: 'all', cursor: 'move' }}
          onPointerDown={(e) => {
            if (e.button !== 0) return;
            e.preventDefault();
            e.stopPropagation();
            e.currentTarget.setPointerCapture(e.pointerId);
            dragging.current = { idx: i };
          }}
        />
      ))}
    </svg>
  );
}
