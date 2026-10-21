import { type Rng } from '@blokum/engine';
import { type ParticlesConfig } from '@blokum/schema';

/**
 * Particles of screens and themes (P-01…P-08) and bursts of effects (AC-07, T-07) — a pure simulation in
 * artboard units, drawn by `ParticleLayer` on a canvas. The same seed gives the same particles.
 */

export type ParticleShape = 'circle' | 'rect' | 'heart' | 'sparkle' | 'bubble' | 'leaf' | 'petal' | 'image';

export interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  size: number;
  rot: number;
  vr: number;
  /** Seconds lived and the lifetime (Infinity for ambient particles that are recycled). */
  age: number;
  life: number;
  opacity: number;
  color: string;
  shape: ParticleShape;
  image: number;
  /** Phase of sway and twinkle. */
  phase: number;
  /** Ambient particles respawn at the start edge; burst particles fade out. */
  ambient: boolean;
  gravity: number;
}

export interface Area {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Most particles at once — the frame budget of a phone (SC-05 spirit). */
export const MAX_PARTICLES = 200;

/** Density is per area: a full phone screen (390 × 844 units) at density 1 holds MAX_PARTICLES. */
export const DENSITY_AREA = 390 * 844;

/** How many ambient particles a field of this size and density holds (at least one if density > 0). */
export function particleTarget(density: number, area: Area): number {
  if (density <= 0) return 0;
  const share = Math.min(1, (Math.max(0, area.w) * Math.max(0, area.h)) / DENSITY_AREA);
  return Math.max(1, Math.round(density * MAX_PARTICLES * share));
}

const PALETTES: Record<Exclude<ParticlesConfig['preset'], 'custom'>, string[]> = {
  snow: ['#FFFFFF', '#F1F8FF', '#E7F5FF'],
  confetti: ['#FF6B6B', '#FFD43B', '#51CF66', '#339AF0', '#CC5DE8', '#FF922B'],
  hearts: ['#FF6B6B', '#F06595', '#E64980', '#FF8787'],
  sparkles: ['#FFE066', '#FFFFFF', '#FFD43B'],
  bubbles: ['#A5D8FF', '#D0EBFF', '#99E9F2'],
  leaves: ['#E67700', '#D9480F', '#F59F00', '#2B8A3E', '#C92A2A'],
  petals: ['#FCC2D7', '#F783AC', '#FFDEEB', '#FAA2C1'],
};

const SHAPES: Record<ParticlesConfig['preset'], ParticleShape> = {
  snow: 'circle',
  confetti: 'rect',
  hearts: 'heart',
  sparkles: 'sparkle',
  bubbles: 'bubble',
  leaves: 'leaf',
  petals: 'petal',
  custom: 'image',
};

/** Where particles come from: falling ones at the top, rising ones at the bottom, twinkles anywhere. */
const direction = (preset: ParticlesConfig['preset']): 'down' | 'up' | 'still' => (preset === 'hearts' || preset === 'bubbles' ? 'up' : preset === 'sparkles' ? 'still' : 'down');

export type ParticleOptions = Pick<ParticlesConfig, 'preset' | 'density' | 'speed' | 'size' | 'rotation' | 'wind' | 'onlyAtStart'> & {
  area: Area;
  /** Number of own pictures (P-08), drawn in turn. */
  images: number;
};

export class ParticleSystem {
  readonly particles: Particle[] = [];
  private readonly target: number;

  constructor(
    private readonly options: ParticleOptions,
    private readonly rng: Rng,
  ) {
    this.target = particleTarget(options.density, options.area);
    for (let i = 0; i < this.target; i++) this.particles.push(this.spawn(true));
  }

  private color(): string {
    const p = this.options.preset;
    return p === 'custom' ? '#FFFFFF' : this.rng.pick(PALETTES[p]);
  }

  /** A new ambient particle; at the start it may appear anywhere, later at its start edge. */
  private spawn(anywhere: boolean): Particle {
    const { area, preset, speed, size, rotation } = this.options;
    const r = this.rng;
    const dir = direction(preset);
    const s = (preset === 'confetti' ? 4 + r.next() * 5 : preset === 'sparkles' ? 5 + r.next() * 7 : preset === 'custom' ? 14 + r.next() * 14 : 3 + r.next() * 6) * size;
    const x = area.x + r.next() * area.w;
    const y = anywhere || dir === 'still' ? area.y + r.next() * area.h : dir === 'down' ? area.y - s * 2 : area.y + area.h + s * 2;
    const base = preset === 'confetti' ? 90 : preset === 'snow' || preset === 'petals' ? 35 : preset === 'leaves' ? 50 : preset === 'custom' ? 45 : 40;
    const v = (base + r.next() * base * 0.8) * speed;
    return {
      x,
      y,
      vx: 0,
      vy: dir === 'down' ? v : dir === 'up' ? -v : 0,
      size: s,
      rot: r.next() * 360,
      vr: rotation ? (r.next() - 0.5) * (preset === 'confetti' ? 540 : 120) : 0,
      age: 0,
      life: dir === 'still' ? 0.6 + r.next() * 0.9 : Infinity,
      opacity: preset === 'bubbles' ? 0.7 : 1,
      color: this.color(),
      shape: SHAPES[preset],
      image: this.options.images > 0 ? r.int(0, this.options.images - 1) : 0,
      phase: r.next() * Math.PI * 2,
      ambient: true,
      gravity: 0,
    };
  }

  /**
   * A one-off burst (AC-07 «конфетти», «всплеск частиц», T-07): particles fly out of a point and fall
   * under gravity, fading out. Bursts share the 200-particle budget with ambient particles.
   */
  burst(x: number, y: number, count: number, kind: 'confetti' | 'burst', colors?: string[]): void {
    const r = this.rng;
    const free = Math.max(0, MAX_PARTICLES - this.particles.length);
    for (let i = 0; i < Math.min(count, free); i++) {
      const angle = kind === 'confetti' ? -Math.PI / 2 + (r.next() - 0.5) * 1.6 : r.next() * Math.PI * 2;
      const v = kind === 'confetti' ? 350 + r.next() * 350 : 120 + r.next() * 260;
      this.particles.push({
        x,
        y,
        vx: Math.cos(angle) * v,
        vy: Math.sin(angle) * v,
        size: kind === 'confetti' ? 4 + r.next() * 5 : 2 + r.next() * 4,
        rot: r.next() * 360,
        vr: (r.next() - 0.5) * 720,
        age: 0,
        life: 1.2 + r.next() * 1,
        opacity: 1,
        color: r.pick(colors?.length ? colors : PALETTES.confetti),
        shape: kind === 'confetti' ? 'rect' : 'circle',
        image: 0,
        phase: r.next() * Math.PI * 2,
        ambient: false,
        gravity: 700,
      });
    }
  }

  /** Advances the simulation by `dtMs` (capped at 100 ms per step). */
  step(dtMs: number): void {
    const dt = Math.min(0.1, Math.max(0, dtMs / 1000));
    const { area, wind, preset, onlyAtStart } = this.options;
    const sway = preset === 'snow' || preset === 'petals' || preset === 'leaves' || preset === 'bubbles' || preset === 'custom';
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i]!;
      p.age += dt;
      p.phase += dt * 2;
      p.vy += p.gravity * dt;
      if (!p.ambient) p.vx *= 1 - Math.min(1, dt * 1.5);
      p.x += (p.vx + wind * 60 + (p.ambient && sway ? Math.sin(p.phase) * 18 : 0)) * dt;
      p.y += p.vy * dt;
      p.rot += p.vr * dt;
      if (p.shape === 'sparkle') p.opacity = Math.max(0, Math.sin((p.age / p.life) * Math.PI));
      if (!p.ambient) p.opacity = Math.max(0, 1 - p.age / p.life);
      const gone = p.age >= p.life || p.y > area.y + area.h + p.size * 3 || p.y < area.y - p.size * 3 - (direction(preset) === 'up' ? 0 : 1e9);
      const outside = p.ambient && (p.x < area.x - 40 || p.x > area.x + area.w + 40);
      if (gone || outside) {
        if (p.ambient && !onlyAtStart) this.particles[i] = this.spawn(false);
        else this.particles.splice(i, 1);
      }
    }
  }
}

/** Options of a screen or theme particle field (P-01…P-08) for an area of the artboard. */
export function particleOptions(config: ParticlesConfig, area: Area): ParticleOptions {
  return { preset: config.preset, density: config.density, speed: config.speed, size: config.size, rotation: config.rotation, wind: config.wind, onlyAtStart: config.onlyAtStart, area: config.area ?? area, images: config.images.length };
}
