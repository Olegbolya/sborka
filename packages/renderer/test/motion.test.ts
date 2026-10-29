import { describe, expect, it } from 'vitest';
import { MotionDetector, type Motion, SHAKE_COOLDOWN_MS, SHAKE_WINDOW_MS } from '../src/player/motion.js';

function detector() {
  let t = 0;
  const seen: Motion[] = [];
  const d = new MotionDetector((m) => seen.push(m), () => t);
  return { d, seen, at: (ms: number) => (t = ms) };
}
const jerk = { x: 20, y: 0, z: 0 };
const still = { x: 0, y: 0, z: 9.81 };

describe('P3.8 · TR-15 · датчики: встряхивание и наклоны превращаются в события движка', () => {
  it('TR-15 · встряхивание — два рывка подряд; один рывок и покой — не встряхивание', () => {
    const { d, seen, at } = detector();
    d.onMotion(jerk, false);
    d.onMotion(still, true);
    expect(seen).toEqual([]);
    at(300);
    d.onMotion(jerk, false);
    expect(seen).toEqual(['shake']);
  });

  it('TR-15 · два рывка с большим промежутком — не встряхивание; после встряхивания пауза', () => {
    const { d, seen, at } = detector();
    d.onMotion(jerk, false);
    at(SHAKE_WINDOW_MS + 100);
    d.onMotion(jerk, false);
    expect(seen).toEqual([]);
    at(SHAKE_WINDOW_MS + 200);
    d.onMotion(jerk, false);
    expect(seen).toEqual(['shake']);
    at(SHAKE_WINDOW_MS + 300);
    d.onMotion(jerk, false);
    d.onMotion(jerk, false);
    expect(seen).toEqual(['shake']);
    at(SHAKE_WINDOW_MS + 200 + SHAKE_COOLDOWN_MS + 10);
    d.onMotion(jerk, false);
    d.onMotion(jerk, false);
    expect(seen).toEqual(['shake', 'shake']);
  });

  it('TR-15 · показание с силой тяжести: покой не рывок, а резкий всплеск — рывок', () => {
    const { d, seen, at } = detector();
    d.onMotion({ x: 0, y: 9.9, z: 0.5 }, true);
    expect(seen).toEqual([]);
    d.onMotion({ x: 25, y: 9.8, z: 0 }, true);
    at(100);
    d.onMotion({ x: -25, y: 9.8, z: 0 }, true);
    expect(seen).toEqual(['shake']);
  });

  it('TR-15 · пустые показания датчика ничего не делают', () => {
    const { d, seen } = detector();
    d.onMotion({ x: null, y: null, z: null }, false);
    d.onOrientation(null, null);
    expect(seen).toEqual([]);
  });

  it('TR-15 · наклоны считаются от положения, в котором показан экран; повтор — только после возврата', () => {
    const { d, seen } = detector();
    d.onOrientation(70, 2); // the first reading is the starting position
    d.onOrientation(70, -10);
    expect(seen).toEqual([]);
    d.onOrientation(70, -30);
    expect(seen).toEqual(['tiltLeft']);
    d.onOrientation(70, -45);
    expect(seen).toEqual(['tiltLeft']);
    d.onOrientation(70, 0);
    d.onOrientation(70, -30);
    expect(seen).toEqual(['tiltLeft', 'tiltLeft']);
    d.onOrientation(70, 40);
    expect(seen.at(-1)).toBe('tiltRight');
    d.onOrientation(40, 2);
    expect(seen.at(-1)).toBe('tiltForward');
    d.onOrientation(70, 2);
    d.onOrientation(100, 2);
    expect(seen.at(-1)).toBe('tiltBack');
  });

  it('TR-15 · rebase: новое положение телефона становится точкой отсчёта', () => {
    const { d, seen } = detector();
    d.onOrientation(70, 0);
    d.rebase();
    d.onOrientation(70, -40);
    d.onOrientation(70, -80);
    expect(seen).toEqual(['tiltLeft']);
  });
});
