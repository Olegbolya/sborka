import { describe, expect, it } from 'vitest';
import { act, b, num, on, play, rule } from './runtime-helpers.js';

/**
 * SC-05: 200 moving copies with collision checks. The budget of the engine inside a 60 fps frame is 2 ms
 * (the rest is the renderer). The measured value is written to docs/PROGRESS.md.
 */
describe('SC-05: производительность движка', () => {
  it('SC-05: 200 движущихся копий с проверкой пересечений — tick быстрее 2 мс', () => {
    const o = play({
      seed: 5,
      vars: [num('schet01')],
      blocks: [b('shape', 'snezhok', { initiallyHidden: true, frame: { x: 0, y: 0, w: 20, h: 20 } }), b('zone', 'sugrob1', { frame: { x: 0, y: 700, w: 390, h: 100 } }), b('shape', 'stena01', { frame: { x: 380, y: 0, w: 10, h: 800 } })],
      rules: [
        rule(on.show(), [act.repeat(200, [act.spawn('snezhok', { kind: 'randomIn', area: { x: 0, y: 0, w: 390, h: 600 } }, 200)])]),
        rule(on.collideCopies('snezhok', 'sugrob1'), [act.add('schet01')]),
        rule(on.collideCopies('snezhok', 'stena01'), [act.add('schet01')]),
        rule(on.collideCopies('snezhok', 'stena01', 'end'), [act.add('schet01')]),
      ],
    });
    const copies = o.rt.views().filter((v) => v.copy);
    expect(copies).toHaveLength(200);
    copies.forEach((v, i) => o.rt.setMotion(v.id, { vx: ((i % 7) - 3) * 20, vy: 30 + (i % 5) * 10 }));
    for (let i = 0; i < 30; i++) o.rt.tick(16);
    const runs = 300;
    const started = performance.now();
    for (let i = 0; i < runs; i++) o.rt.tick(16);
    const perTick = (performance.now() - started) / runs;
    console.warn(`SC-05: tick с 200 копиями и 3 правилами пересечений — ${perTick.toFixed(3)} мс`);
    expect(perTick).toBeLessThan(2);
  });
});
