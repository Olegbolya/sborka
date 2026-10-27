import { type Block, type ProjectDocument } from '@blokum/schema';
import { setFrames } from './commands';
import {
  type Handle,
  type Point,
  type Rect,
  boundsOf,
  center,
  handleAxes,
  intersects,
  absoluteFrames,
  rectFromPoints,
  resizeBox,
  resizeFrame,
  rotationFromPointer,
  scaleFrames,
  unionOf,
} from './geometry';
import { withGroupMates } from './arrange';
import { type Gap, type Guide, SNAP_PX, type SnapOptions, snapEdges, snapRect } from './snap';
import { type EditorStore } from './store';
import { findBlock } from './tree';

/** Movement under this many screen pixels is a click, not a drag. */
export const DRAG_THRESHOLD_PX = 3;

export interface Transient {
  guides: Guide[];
  gaps: Gap[];
  marquee: Rect | null;
}

export const NO_TRANSIENT: Transient = { guides: [], gaps: [], marquee: null };

export interface GestureEnv {
  store: EditorStore;
  /** Pixels per unit now. */
  unit: () => number;
  /** Pointer position in artboard units. */
  toUnits: (clientX: number, clientY: number) => Point;
  grid: () => boolean;
  snap: () => boolean;
  show: (t: Transient) => void;
}

interface Start {
  ids: string[];
  /** Frames in the units of each block's parent, as they were when the gesture began. */
  frames: Map<string, Block['frame']>;
  /** The same on the artboard. */
  boxes: Map<string, Rect>;
}

const screenOf = (doc: ProjectDocument, id: string) => doc.screens.find((s) => s.id === id) ?? doc.screens[0]!;

function descendantIds(blocks: readonly Block[], into = new Set<string>()): Set<string> {
  for (const b of blocks) {
    into.add(b.id);
    descendantIds(b.children, into);
  }
  return into;
}

/** Where the selected blocks are now (the gesture reads this once at the start). */
function readStart(store: EditorStore, ids: readonly string[]): Start {
  const { doc, selection } = store.getState();
  const screen = screenOf(doc, selection.screenId);
  const abs = absoluteFrames(screen.blocks);
  const frames = new Map<string, Block['frame']>();
  const boxes = new Map<string, Rect>();
  for (const id of ids) {
    const loc = findBlock(doc, id);
    if (!loc) continue;
    frames.set(id, structuredClone(loc.siblings[loc.index]!.frame));
    const a = abs.get(id);
    if (a) boxes.set(id, boundsOf(a));
  }
  return { ids: [...frames.keys()], frames, boxes };
}

/** Rectangles the moving blocks can be pulled to: every other visible block of the screen (not inside the moving ones). */
function snapTargets(store: EditorStore, moving: readonly string[]): Rect[] {
  const { doc, selection } = store.getState();
  const screen = screenOf(doc, selection.screenId);
  const skip = new Set<string>();
  for (const id of moving) {
    const loc = findBlock(doc, id);
    if (loc) descendantIds([loc.siblings[loc.index]!], skip);
  }
  const abs = absoluteFrames(screen.blocks);
  const out: Rect[] = [];
  const walk = (blocks: readonly Block[]) => {
    for (const b of blocks) {
      if (!skip.has(b.id) && !b.hiddenInEditor) out.push(boundsOf(abs.get(b.id)!));
      if (!skip.has(b.id)) walk(b.children);
    }
  };
  walk(screen.blocks);
  return out;
}

function optionsFor(env: GestureEnv, moving: readonly string[], height: number): SnapOptions {
  return { artboard: { w: 390, h: height }, others: snapTargets(env.store, moving), grid: env.grid(), threshold: SNAP_PX / env.unit() };
}

/** Runs a pointer gesture: `move` on every movement, `end` on release; listeners are removed by themselves. */
export function track(pointerId: number, onMove: (e: PointerEvent) => void, onEnd: (e: PointerEvent | null) => void): void {
  // Another finger on the screen (two-finger pan or pinch) does not drive this gesture.
  const move = (e: PointerEvent) => {
    if (e.pointerId === pointerId) onMove(e);
  };
  const up = (e: PointerEvent) => {
    if (e.pointerId !== pointerId) return;
    cleanup();
    onEnd(e);
  };
  const cancel = () => {
    cleanup();
    onEnd(null);
  };
  const cleanup = () => {
    window.removeEventListener('pointermove', move);
    window.removeEventListener('pointerup', up);
    window.removeEventListener('pointercancel', cancel);
  };
  window.addEventListener('pointermove', move);
  window.addEventListener('pointerup', up);
  window.addEventListener('pointercancel', cancel);
}

/**
 * E-05 · drag the selected blocks. Everything between the first movement and the release is one step of the history;
 * the blocks are pulled to the artboard, to the other blocks and the grid (Alt off), Shift keeps the movement on one axis.
 */
export function startMove(env: GestureEnv, e: PointerEvent, ids: readonly string[], onClick: () => void): void {
  const start = readStart(env.store, ids);
  const movable = start.ids.filter((id) => !findBlock(env.store.getState().doc, id)!.siblings.find((b) => b.id === id)!.locked);
  const p0 = { x: e.clientX, y: e.clientY };
  const u0 = env.toUnits(e.clientX, e.clientY);
  let began = false;
  track(
    e.pointerId,
    (ev) => {
      if (!began) {
        if (Math.hypot(ev.clientX - p0.x, ev.clientY - p0.y) < DRAG_THRESHOLD_PX) return;
        if (movable.length === 0) return;
        began = true;
        env.store.getState().beginGesture('Перетащить');
      }
      const u = env.toUnits(ev.clientX, ev.clientY);
      let dx = u.x - u0.x;
      let dy = u.y - u0.y;
      if (ev.shiftKey) {
        if (Math.abs(dx) >= Math.abs(dy)) dy = 0;
        else dx = 0;
      }
      const state = env.store.getState();
      const box = unionOf(movable.map((id) => start.boxes.get(id)!))!;
      let guides: Guide[] = [];
      let gaps: Gap[] = [];
      if (env.snap() && !ev.altKey) {
        const height = screenOf(state.doc, state.selection.screenId).height;
        const r = snapRect({ ...box, x: box.x + dx, y: box.y + dy }, optionsFor(env, movable, height));
        // Shift keeps the axis: the other one is not pulled sideways.
        if (!ev.shiftKey || dx !== 0) dx += r.dx;
        if (!ev.shiftKey || dy !== 0) dy += r.dy;
        guides = r.guides;
        gaps = r.gaps;
      }
      const next = new Map(movable.map((id) => [id, { ...start.frames.get(id)!, x: start.frames.get(id)!.x + dx, y: start.frames.get(id)!.y + dy }]));
      state.apply(setFrames(next), { label: 'Перетащить' });
      env.show({ guides, gaps, marquee: null });
    },
    () => {
      if (began) env.store.getState().endGesture();
      else onClick();
      env.show(NO_TRANSIENT);
    },
  );
}

/** E-05 · a handle of the box around the selection is dragged. */
export function startResize(env: GestureEnv, e: PointerEvent, ids: readonly string[], handle: Handle, lockAspect: boolean): void {
  const start = readStart(env.store, ids);
  const movable = start.ids.filter((id) => !findBlock(env.store.getState().doc, id)!.siblings.find((b) => b.id === id)!.locked);
  if (movable.length === 0) return;
  const u0 = env.toUnits(e.clientX, e.clientY);
  const { sx, sy } = handleAxes(handle);
  env.store.getState().beginGesture('Изменить размер');
  track(
    e.pointerId,
    (ev) => {
      const u = env.toUnits(ev.clientX, ev.clientY);
      const delta = { x: u.x - u0.x, y: u.y - u0.y };
      const opts = { keepAspect: ev.shiftKey || lockAspect, fromCenter: ev.altKey };
      const state = env.store.getState();
      let guides: Guide[] = [];
      let next: Map<string, Block['frame']>;
      if (movable.length === 1) {
        const id = movable[0]!;
        const f = start.frames.get(id)!;
        // Straight blocks are pulled to lines by the edge being moved.
        if (env.snap() && !ev.altKey && f.rotation === 0 && !opts.keepAspect) {
          const height = screenOf(state.doc, state.selection.screenId).height;
          const o = optionsFor(env, movable, height);
          const origin = start.boxes.get(id)!;
          const edgeX = sx === 0 ? [] : [(sx > 0 ? origin.x + origin.w : origin.x) + delta.x];
          const edgeY = sy === 0 ? [] : [(sy > 0 ? origin.y + origin.h : origin.y) + delta.y];
          const gx = snapEdges('x', edgeX, o);
          const gy = snapEdges('y', edgeY, o);
          delta.x += gx.shift;
          delta.y += gy.shift;
          guides = [...gx.guides, ...gy.guides];
        }
        next = new Map([[id, resizeFrame(f, handle, delta, opts)]]);
      } else {
        const from = unionOf(movable.map((id) => start.boxes.get(id)!))!;
        const to = resizeBox(from, handle, delta, opts);
        const scaled = scaleFrames(
          movable.map((id) => ({ ...start.boxes.get(id)!, id })),
          from,
          to,
        );
        // Frames are in the parent's units: the change of each box is applied to its own frame.
        next = new Map(
          movable.map((id, i) => {
            const f = start.frames.get(id)!;
            const b = start.boxes.get(id)!;
            const s = scaled[i]!;
            return [id, { ...f, x: f.x + (s.x - b.x), y: f.y + (s.y - b.y), w: s.w, h: s.h }];
          }),
        );
      }
      state.apply(setFrames(next), { label: 'Изменить размер' });
      env.show({ guides, gaps: [], marquee: null });
    },
    () => {
      env.store.getState().endGesture();
      env.show(NO_TRANSIENT);
    },
  );
}

/** E-05 · the rotation handle of a block is dragged (Shift — 15° steps). */
export function startRotate(env: GestureEnv, e: PointerEvent, id: string): void {
  const start = readStart(env.store, [id]);
  const f = start.frames.get(id);
  const box = absoluteFrames(screenOf(env.store.getState().doc, env.store.getState().selection.screenId).blocks).get(id);
  if (!f || !box || findBlock(env.store.getState().doc, id)!.siblings.find((b) => b.id === id)!.locked) return;
  const c = center(box);
  const p0 = env.toUnits(e.clientX, e.clientY);
  env.store.getState().beginGesture('Повернуть');
  track(
    e.pointerId,
    (ev) => {
      const rotation = rotationFromPointer(c, f.rotation, p0, env.toUnits(ev.clientX, ev.clientY), ev.shiftKey);
      env.store.getState().apply(setFrames(new Map([[id, { ...f, rotation }]])), { label: 'Повернуть' });
    },
    () => env.store.getState().endGesture(),
  );
}

/** E-04 · a frame dragged over empty space picks the top-level blocks it touches; Shift adds to the selection. */
export function startMarquee(env: GestureEnv, e: PointerEvent, additive: boolean): void {
  const state = env.store.getState();
  const screenId = state.selection.screenId;
  const base = additive ? state.selection.blockIds : [];
  const p0 = { x: e.clientX, y: e.clientY };
  const u0 = env.toUnits(e.clientX, e.clientY);
  if (!additive) state.select(screenId, []);
  let began = false;
  track(
    e.pointerId,
    (ev) => {
      if (!began && Math.hypot(ev.clientX - p0.x, ev.clientY - p0.y) < DRAG_THRESHOLD_PX) return;
      began = true;
      const rect = rectFromPoints(u0, env.toUnits(ev.clientX, ev.clientY));
      const st = env.store.getState();
      const screen = screenOf(st.doc, screenId);
      const hit = screen.blocks.filter((b) => !b.hiddenInEditor && intersects(rect, boundsOf(b.frame))).map((b) => b.id);
      st.select(screenId, withGroupMates(st.doc, [...base, ...hit]));
      env.show({ guides: [], gaps: [], marquee: rect });
    },
    () => env.show(NO_TRANSIENT),
  );
}
