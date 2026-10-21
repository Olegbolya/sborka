import { createRng } from '@blokum/engine';
import { ParticlesConfig } from '@blokum/schema';
import { describe, expect, it, vi } from 'vitest';
import { type AudioLike, DENSITY_AREA, MAX_PARTICLES, ParticleSystem, SoundManager, particleOptions, particleTarget } from '../src/index.js';

const area = { x: 0, y: 0, w: 390, h: 844 };
const system = (cfg: Record<string, unknown>, seed = 1) => new ParticleSystem(particleOptions(ParticlesConfig.parse(cfg), area), createRng(seed));
const run = (s: ParticleSystem, seconds: number) => {
  for (let i = 0; i < seconds * 60; i++) s.step(1000 / 60);
};

describe('P-01…P-08: частицы', () => {
  it('P-01: плотность — на площадь: полный экран вмещает 200 частиц, окно поменьше — пропорционально меньше', () => {
    expect(DENSITY_AREA).toBe(390 * 844);
    expect(particleTarget(1, { x: 0, y: 0, w: 390, h: 844 })).toBe(MAX_PARTICLES);
    expect(particleTarget(1, { x: 0, y: 0, w: 390, h: 2000 })).toBe(MAX_PARTICLES);
    expect(particleTarget(0.5, { x: 0, y: 0, w: 195, h: 422 })).toBe(25);
    expect(particleTarget(0.01, { x: 0, y: 0, w: 10, h: 10 })).toBe(1);
    expect(particleTarget(0, { x: 0, y: 0, w: 390, h: 844 })).toBe(0);
    expect(particleTarget(1, { x: 0, y: 0, w: -5, h: 100 })).toBe(1);
    const small = new ParticleSystem(particleOptions(ParticlesConfig.parse({ preset: 'snow', density: 1 }), { x: 0, y: 0, w: 175, h: 150 }), createRng(1));
    expect(small.particles).toHaveLength(16);
  });

  it.each([
    ['P-01', 'snow', 'circle', 'down'],
    ['P-02', 'confetti', 'rect', 'down'],
    ['P-03', 'hearts', 'heart', 'up'],
    ['P-04', 'sparkles', 'sparkle', 'still'],
    ['P-05', 'bubbles', 'bubble', 'up'],
    ['P-06', 'leaves', 'leaf', 'down'],
    ['P-07', 'petals', 'petal', 'down'],
  ] as const)('%s: «%s» — своя форма, направление и постоянное число частиц', (_id, preset, shape, dir) => {
    const s = system({ preset, density: 0.5 });
    expect(s.particles).toHaveLength(100);
    expect(new Set(s.particles.map((p) => p.shape))).toEqual(new Set([shape]));
    const vy = s.particles.reduce((sum, p) => sum + p.vy, 0) / s.particles.length;
    if (dir === 'down') expect(vy).toBeGreaterThan(0);
    if (dir === 'up') expect(vy).toBeLessThan(0);
    if (dir === 'still') expect(vy).toBe(0);
    run(s, 20);
    expect(s.particles).toHaveLength(100);
    for (const p of s.particles) expect(p.x).toBeGreaterThan(-60);
  });

  it('P-08: свои картинки (до 5) — частицы рисуют их по очереди', () => {
    const images = [1, 2, 3].map((n) => ({ source: 'media', id: `kartinka0${n}` }));
    const s = system({ preset: 'custom', images, density: 0.3 });
    expect(new Set(s.particles.map((p) => p.shape))).toEqual(new Set(['image']));
    expect(new Set(s.particles.map((p) => p.image))).toEqual(new Set([0, 1, 2]));
    expect(ParticlesConfig.safeParse({ preset: 'custom', images: [] }).success).toBe(false);
  });

  it('P-01: плотность задаёт число частиц, не больше 200', () => {
    expect(system({ preset: 'snow', density: 0 }).particles).toHaveLength(0);
    expect(system({ preset: 'snow', density: 1 }).particles).toHaveLength(MAX_PARTICLES);
  });

  it('P-04: искры мерцают — прозрачность меняется', () => {
    const s = system({ preset: 'sparkles', density: 0.2 });
    run(s, 0.3);
    expect(new Set(s.particles.map((p) => Math.round(p.opacity * 10))).size).toBeGreaterThan(2);
  });

  it('P-01: ветер сносит частицы, скорость ускоряет падение, размер — масштаб', () => {
    const calm = system({ preset: 'snow', density: 0.3 }, 5);
    const windy = system({ preset: 'snow', density: 0.3, wind: 1 }, 5);
    const x0 = windy.particles[0]!.x;
    calm.step(100);
    windy.step(100);
    expect(windy.particles[0]!.x - x0).toBeGreaterThan(calm.particles[0]!.x - x0);
    expect(system({ preset: 'snow', speed: 3 }, 5).particles[0]!.vy).toBeCloseTo(system({ preset: 'snow' }, 5).particles[0]!.vy * 3);
    expect(system({ preset: 'snow', size: 2 }, 5).particles[0]!.size).toBeCloseTo(system({ preset: 'snow' }, 5).particles[0]!.size * 2);
  });

  it('P-01: «только в начале» — частицы улетают и не появляются снова', () => {
    const s = system({ preset: 'snow', density: 0.3, onlyAtStart: true });
    run(s, 40);
    expect(s.particles).toHaveLength(0);
  });

  it('P-01: без вращения частицы не крутятся; одинаковое зерно — одинаковые частицы', () => {
    expect(system({ preset: 'confetti', rotation: false }).particles.every((p) => p.vr === 0)).toBe(true);
    expect(JSON.stringify(system({ preset: 'leaves' }, 9).particles)).toBe(JSON.stringify(system({ preset: 'leaves' }, 9).particles));
  });

  it('AC-07: конфетти и всплеск разлетаются, падают и гаснут; общий лимит 200', () => {
    const s = system({ preset: 'snow', density: 0.5 });
    s.burst(195, 300, 300, 'confetti');
    expect(s.particles).toHaveLength(MAX_PARTICLES);
    const burst = s.particles.filter((p) => !p.ambient);
    expect(burst).toHaveLength(100);
    run(s, 0.5);
    expect(burst.every((p) => p.opacity < 1)).toBe(true);
    run(s, 3);
    expect(s.particles.filter((p) => !p.ambient)).toHaveLength(0);
    s.burst(10, 10, 5, 'burst', ['#123456']);
    expect(s.particles.filter((p) => !p.ambient).map((p) => p.color)).toEqual(Array(5).fill('#123456'));
  });

  it('T-07: области частиц задаются экраном или своим прямоугольником', () => {
    const own = particleOptions(ParticlesConfig.parse({ preset: 'snow', area: { x: 10, y: 20, w: 100, h: 50 } }), area);
    expect(own.area).toEqual({ x: 10, y: 20, w: 100, h: 50 });
    expect(particleOptions(ParticlesConfig.parse({ preset: 'snow' }), area).area).toEqual(area);
  });
});

describe('TH-01 · AC-06: звуки только после первого действия', () => {
  const fakeAudio = () => {
    const made: Array<AudioLike & { src: string; plays: number }> = [];
    const factory = (src: string) => {
      const a = { src, plays: 0, loop: false, volume: 1, currentTime: 5, play: vi.fn(() => Promise.resolve()), pause: vi.fn() };
      a.play.mockImplementation(() => {
        a.plays += 1;
        return Promise.resolve();
      });
      made.push(a);
      return a;
    };
    return { made, factory };
  };
  const media = (ref: { id: string }) => (ref.id === 'netfaila' ? null : { url: `/zvuki/${ref.id}.mp3`, kind: 'image' as const });
  const ref = (id: string) => ({ source: 'media' as const, id });

  it('AC-06: до первого нажатия звук не играет, после — играет с начала', () => {
    const { made, factory } = fakeAudio();
    const s = new SoundManager(media, true, factory);
    expect(s.play(ref('shchelchok'))).toBe(false);
    s.unlock();
    s.unlock();
    expect(s.isUnlocked).toBe(true);
    expect(s.play(ref('shchelchok'), 3)).toBe(true);
    expect(made[0]).toMatchObject({ src: '/zvuki/shchelchok.mp3', plays: 1, volume: 1, currentTime: 0 });
    s.play(ref('shchelchok'), 0.5);
    expect(made).toHaveLength(1);
    expect(made[0]!.volume).toBe(0.5);
    expect(s.play(undefined)).toBe(false);
    expect(s.play(ref('netfaila'))).toBe(false);
  });

  it('TH-01: фоновый звук темы начинается после первого действия, тот же не перезапускается, выключение — пауза', () => {
    const { made, factory } = fakeAudio();
    const s = new SoundManager(media, true, factory);
    s.background(ref('fon-zima'));
    expect(made).toHaveLength(0);
    s.unlock();
    expect(made[0]).toMatchObject({ src: '/zvuki/fon-zima.mp3', loop: true, volume: 0.5, plays: 1 });
    s.background(ref('fon-zima'));
    expect(made).toHaveLength(1);
    s.setMuted(true);
    expect(s.isMuted).toBe(true);
    expect(made[0]!.pause).toHaveBeenCalled();
    expect(s.play(ref('shchelchok'))).toBe(false);
    s.setMuted(false);
    expect(made[0]!.plays).toBe(2);
    s.background(null);
    s.background(ref('netfaila'));
    s.stop();
  });

  it('TH-01: создатель выключил звук по умолчанию', () => {
    const { factory } = fakeAudio();
    const s = new SoundManager(media, false, factory);
    s.unlock();
    expect(s.isMuted).toBe(true);
    expect(s.play(ref('shchelchok'))).toBe(false);
  });
});
