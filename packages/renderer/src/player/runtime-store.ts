import { type BlockView as RuntimeView, type Runtime, type RuntimeEffect, type RuntimeEvent, type StepResult } from '@blokum/engine';

export interface FrameScheduler {
  request: (cb: (time: number) => void) => number;
  cancel: (handle: number) => void;
}

const browserScheduler = (): FrameScheduler => ({
  request: (cb) => requestAnimationFrame(cb),
  cancel: (h) => cancelAnimationFrame(h),
});

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

  private publish(result: StepResult, force: boolean): void {
    if (result.changed.length > 0) {
      const next = new Map(this.viewMap);
      for (const id of result.changed) {
        const v = this.runtime.view(id);
        if (v) next.set(id, v);
        else next.delete(id);
      }
      this.viewMap = next;
    }
    if (force || result.changed.length > 0) {
      this.version += 1;
      for (const l of this.listeners) l();
    }
    if (result.effects.length) {
      this.onEffects(result.effects);
      for (const l of this.effectListeners) l(result.effects);
    }
  }
}
