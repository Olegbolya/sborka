import { type BlockView as RuntimeView, type Runtime, type RuntimeEffect, type RuntimeEvent, type StepResult } from '@blokum/engine';

export interface FrameScheduler {
  request: (cb: (time: number) => void) => number;
  cancel: (handle: number) => void;
}

const browserScheduler = (): FrameScheduler => ({
  request: (cb) => requestAnimationFrame(cb),
  cancel: (h) => cancelAnimationFrame(h),
});

/** Moves the element of a block to a place (artboard units, the parent's coordinates). */
export type PositionSink = (x: number, y: number) => void;

const SAME_EXCEPT_PLACE: ReadonlyArray<keyof RuntimeView> = ['id', 'protoId', 'copy', 'parentId', 'visible', 'animateVisibility', 'interactive', 'dragging', 'zoneId', 'selected', 'w', 'h', 'rotation', 'z', 'overrides', 'anim', 'media', 'flipped'];

/**
 * The view changed only its place (overrides and anim are new objects only when they change). A block that is
 * reported changed but stands still changed something else — an answer, a variable — and needs a render.
 */
export const onlyMoved = (a: RuntimeView, b: RuntimeView): boolean => (a.x !== b.x || a.y !== b.y) && SAME_EXCEPT_PLACE.every((k) => a[k] === b[k]);

/** Longest step of time per frame: after a background tab the game does not jump far ahead. */
export const MAX_FRAME_MS = 100;

/**
 * Adapter between the scenario runtime (P1.3) and React: one `tick` per animation frame, changes of all
 * events and ticks of a frame are applied together, React re-renders only when something changed.
 */
export class RuntimeStore {
  private viewMap = new Map<string, RuntimeView>();
  private version = 0;
  private readonly listeners = new Set<() => void>();
  private readonly effectListeners = new Set<(effects: RuntimeEffect[]) => void>();
  private handle: number | null = null;
  private last: number | null = null;
  private readonly scheduler: FrameScheduler;

  constructor(
    readonly runtime: Runtime,
    private readonly onEffects: (effects: RuntimeEffect[]) => void = () => undefined,
    scheduler?: FrameScheduler,
  ) {
    this.scheduler = scheduler ?? browserScheduler();
  }

  get views(): ReadonlyMap<string, RuntimeView> {
    return this.viewMap;
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getSnapshot = (): number => this.version;

  /** Effects for the player itself (particles, sounds, media inserts); the host gets all of them too. */
  subscribeEffects = (listener: (effects: RuntimeEffect[]) => void): (() => void) => {
    this.effectListeners.add(listener);
    return () => this.effectListeners.delete(listener);
  };

  /** Shows a screen and rebuilds every view. */
  enter(screenId: string): void {
    const result = this.runtime.enterScreen(screenId);
    this.viewMap = new Map(this.runtime.views().map((v) => [v.id, v]));
    this.publish(result, true);
  }

  leave(): void {
    this.publish(this.runtime.leaveScreen(), false);
  }

  dispatch = (event: RuntimeEvent): void => {
    this.publish(this.runtime.dispatch(event), false);
  };

  /** Starts the frame loop (player and preview); idempotent. */
  start(): void {
    if (this.handle !== null) return;
    const frame = (time: number) => {
      const dt = this.last === null ? 0 : Math.min(MAX_FRAME_MS, Math.max(0, time - this.last));
      this.last = time;
      this.publish(this.runtime.tick(dt), false);
      this.handle = this.scheduler.request(frame);
    };
    this.handle = this.scheduler.request(frame);
  }

  stop(): void {
    if (this.handle !== null) this.scheduler.cancel(this.handle);
    this.handle = null;
    this.last = null;
  }

  /** Elements that apply a new position themselves (see `PositionSink`). */
  private readonly sinks = new Map<string, PositionSink>();

  /**
   * A drawn block registers how to move its element. When a frame only moves blocks, the store moves them
   * directly and React does not re-render the screen (SC-05: 50 moving blocks at ≥ 50 fps on a slow phone).
   */
  registerPosition = (id: string, sink: PositionSink): (() => void) => {
    this.sinks.set(id, sink);
    return () => {
      if (this.sinks.get(id) === sink) this.sinks.delete(id);
    };
  };

  private publish(result: StepResult, force: boolean): void {
    let structural = false;
    if (result.changed.length > 0) {
      const next = new Map(this.viewMap);
      const moves: Array<[PositionSink, RuntimeView]> = [];
      for (const id of result.changed) {
        const v = this.runtime.view(id);
        const prev = this.viewMap.get(id);
        const sink = this.sinks.get(id);
        if (v && prev && sink && onlyMoved(prev, v)) moves.push([sink, v]);
        else structural = true;
        if (v) next.set(id, v);
        else next.delete(id);
      }
      this.viewMap = next;
      for (const [sink, v] of moves) sink(v.x, v.y);
    }
    if (force || structural) {
      this.version += 1;
      for (const l of this.listeners) l();
    }
    if (result.effects.length) {
      this.onEffects(result.effects);
      for (const l of this.effectListeners) l(result.effects);
    }
  }
}
