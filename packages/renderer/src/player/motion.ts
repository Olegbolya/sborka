import { type RuntimeEvent } from '@blokum/engine';

/**
 * TR-15 · the sensors of a phone as the events of the runtime: a shake and the tilts (left, right, away from oneself, towards
 * oneself). The classification is pure (no browser): the host feeds it the readings of `devicemotion` and `deviceorientation`.
 */
export type Motion = Extract<RuntimeEvent, { type: 'deviceMotion' }>['motion'];

export const SHAKE_DELTA = 12; // m/s² beyond the pull of gravity that count as a jerk
export const SHAKE_WINDOW_MS = 700; // two jerks this close are a shake
export const SHAKE_COOLDOWN_MS = 1000;
export const TILT_ON = 25; // degrees from the position the screen was shown in
export const TILT_OFF = 12; // back inside this many degrees the tilt may happen again

const GRAVITY = 9.81;

export class MotionDetector {
  private jerks: number[] = [];
  private lastShake = Number.NEGATIVE_INFINITY;
  private base: { beta: number; gamma: number } | null = null;
  private armed: Record<'tiltLeft' | 'tiltRight' | 'tiltForward' | 'tiltBack', boolean> = { tiltLeft: true, tiltRight: true, tiltForward: true, tiltBack: true };

  constructor(
    private readonly emit: (motion: Motion) => void,
    private readonly now: () => number = () => Date.now(),
  ) {}

  /** The position the tilts are measured from: how the person holds the phone when the screen opens. */
  rebase(): void {
    this.base = null;
    this.armed = { tiltLeft: true, tiltRight: true, tiltForward: true, tiltBack: true };
  }

  /** `acceleration` without gravity when the device gives it, else the one with gravity (its length is about 9.81 at rest). */
  onMotion(reading: { x: number | null; y: number | null; z: number | null }, includesGravity: boolean): void {
    const { x, y, z } = reading;
    if (x === null || y === null || z === null) return;
    const length = Math.hypot(x, y, z);
    const jerk = includesGravity ? Math.abs(length - GRAVITY) : length;
    if (jerk < SHAKE_DELTA) return;
    const t = this.now();
    if (t - this.lastShake < SHAKE_COOLDOWN_MS) return;
    this.jerks = [...this.jerks.filter((j) => t - j <= SHAKE_WINDOW_MS), t];
    if (this.jerks.length >= 2) {
      this.jerks = [];
      this.lastShake = t;
      this.emit('shake');
    }
  }

  /**
   * `beta` — the tilt front to back (0 flat, 90 upright; less than before = the top goes away from the person), `gamma` —
   * left to right (negative = to the left).
   */
  onOrientation(beta: number | null, gamma: number | null): void {
    if (beta === null || gamma === null) return;
    if (!this.base) {
      this.base = { beta, gamma };
      return;
    }
    const db = beta - this.base.beta;
    const dg = gamma - this.base.gamma;
    const check = (key: keyof MotionDetector['armed'], value: number, motion: Motion) => {
      if (this.armed[key] && value >= TILT_ON) {
        this.armed[key] = false;
        this.emit(motion);
      } else if (!this.armed[key] && value < TILT_OFF) this.armed[key] = true;
    };
    check('tiltLeft', -dg, 'tiltLeft');
    check('tiltRight', dg, 'tiltRight');
    check('tiltForward', -db, 'tiltForward');
    check('tiltBack', db, 'tiltBack');
  }
}
