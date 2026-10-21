import { BLOCK_PROPS, BLOCK_TYPES, BlockStyle, type BlockInput, type BlockType, createBlock, textOf } from '@blokum/schema';
import { describe, expect, it } from 'vitest';
import { BlockView } from '../src/index.js';
import { media, render, styleOf, themes } from './helpers.js';

/**
 * P1.5 · S-00: every property S-01…S-20 × every block type B-xx. For each pair the property is set on a block
 * of that type and the rendered DOM must change the expected way (compared with the same block without it).
 * The lists of checked properties and block types are compared with the schema, so nothing is skipped.
 */

type Mode = 'editor' | 'player';
type State = 'selected';
interface Rendered {
  host: HTMLElement;
  root: HTMLElement | null;
  /** First element of the selector that belongs to the block itself (not to a nested block). */
  own: (selector: string) => HTMLElement | null;
}
interface PropertySpec {
  id: string;
  /** Keys of the block schema (style groups or block fields) this property is made of. */
  keys: string[];
  /** What the creator sets. */
  input: Partial<BlockInput>;
  /** The block it is compared with (by default — the same type without the property). */
  control?: Partial<BlockInput>;
  mode?: Mode;
  state?: State;
  check: (changed: Rendered, control: Rendered) => void;
}

const u = (n: number) => `calc(${n} * var(--u))`;
const solid = (hex: string) => ({ kind: 'solid' as const, color: { hex } });
const video = [{ kind: 'media' as const, media: { source: 'media' as const, id: 'video-matrica' } }];

const SPECS: PropertySpec[] = [
  {
    id: 'S-01',
    keys: ['frame', 'autoHeight', 'lockAspect'],
    input: { frame: { x: 12, y: 34, w: 56, h: 78, rotation: 30, flipX: true }, style: { autoHeight: true, lockAspect: true } },
    check: ({ root }) => {
      const s = styleOf(root);
      for (const part of [`left:${u(12)}`, `top:${u(34)}`, `width:${u(56)}`, `min-height:${u(78)}`, 'rotate(30deg)', 'scale(-1, 1)']) expect(s).toContain(part);
      expect(s).not.toMatch(/(^|;)height:/);
    },
  },
  {
    id: 'S-02',
    keys: ['shape'],
    input: { style: { shape: { kind: 'star', points: 6 } } },
    check: (c, base) => {
      expect(styleOf(c.own('.bk-surface'))).toContain('mask-image:url("data:image/svg+xml');
      expect(styleOf(base.own('.bk-surface'))).not.toContain('mask-image');
    },
  },
  {
    id: 'S-03',
    keys: ['radius'],
    input: { style: { shape: { kind: 'rect' }, radius: { tl: 7.5, tr: 6.5, br: 5.5, bl: 4.5 } } },
    check: (c) => expect(styleOf(c.own('.bk-surface'))).toContain(`border-radius:${u(7.5)} ${u(6.5)} ${u(5.5)} ${u(4.5)}`),
  },
  {
    id: 'S-04',
    keys: ['fills'],
    input: { style: { fills: [{ kind: 'linear', angle: 45, stops: [{ offset: 0, color: { hex: '#123456' } }, { offset: 1, color: { hex: '#654321' } }] }] } },
    check: (c, base) => {
      expect(styleOf(c.own('.bk-fill'))).toContain('linear-gradient(45deg');
      expect(styleOf(c.own('.bk-fill'))).toContain('#123456');
      expect(styleOf(base.own('.bk-fill'))).not.toContain('#123456');
    },
  },
  {
    id: 'S-05',
    keys: ['stroke'],
    input: { style: { stroke: { width: 3, style: 'dashed', paint: solid('#A1B2C3') } } },
    check: (c) => {
      const stroke = c.own('.bk-stroke');
      expect(stroke).not.toBeNull();
      expect(styleOf(stroke)).toContain('#A1B2C3');
    },
  },
  {
    id: 'S-06',
    keys: ['shadows', 'glow'],
    input: { style: { shape: { kind: 'rect' }, shadows: [{ x: 3, y: 5, blur: 7, spread: 1, color: { hex: '#0A0B0C' } }], glow: { color: { hex: '#FFEE00' }, size: 12 } } },
    check: (c) => {
      const s = styleOf(c.own('.bk-surface'));
      expect(s).toContain(`box-shadow:${u(3)} ${u(5)} ${u(7)} ${u(1)} #0A0B0C`);
      expect(s).toContain(`${u(12)} ${u(3)} #FFEE00`);
    },
  },
  {
    id: 'S-07',
    keys: ['effects'],
    input: { style: { effects: { opacity: 0.4, blur: 2, backdropBlur: 6, blendMode: 'multiply' } } },
    check: (c) => {
      const s = styleOf(c.root);
      expect(s).toContain('opacity:0.4');
      expect(s).toContain('mix-blend-mode:multiply');
      expect(s).toContain(`blur(${u(2)})`);
      expect(styleOf(c.own('.bk-surface'))).toContain(`backdrop-filter:blur(${u(6)})`);
    },
  },
  {
    id: 'S-08',
    keys: ['filters'],
    input: { style: { filters: { brightness: 1.3, contrast: 0.8, saturate: 1.5, grayscale: 0.2, sepia: 0.4, hueRotate: 90, invert: 0.1 } } },
    check: (c, base) => {
      expect(styleOf(c.root)).toContain('filter:brightness(1.3) contrast(0.8) saturate(1.5) grayscale(0.2) sepia(0.4) hue-rotate(90deg) invert(0.1)');
      expect(styleOf(base.root)).not.toContain('filter:');
    },
  },
  {
    id: 'S-09',
    keys: ['padding'],
    input: { style: { padding: { t: 9, r: 8, b: 7, l: 6 } } },
    check: (c) => expect(styleOf(c.own('.bk-content'))).toContain(`padding:${u(9)} ${u(8)} ${u(7)} ${u(6)}`),
  },
  {
    id: 'S-10',
    keys: ['text', 'textLayer'],
    input: { textLayer: textOf('Матрица'), style: { text: { size: 31, weight: 800, italic: true, align: 'right', transform: 'uppercase', outline: { width: 1, color: { hex: '#102030' } } } } },
    check: (c) => {
      const text = c.own('.bk-text');
      expect(text?.textContent).toBe('Матрица');
      const s = styleOf(text);
      for (const part of [`font-size:${u(31)}`, 'font-weight:800', 'font-style:italic', 'text-align:right', 'text-transform:uppercase', '-webkit-text-stroke']) expect(s).toContain(part);
    },
  },
  {
    id: 'S-11',
    keys: ['media'],
    input: { style: { fills: video, media: { autoplay: false, loop: false, controls: true, speed: 2, poster: { source: 'media', id: 'oblozhka01' } } } },
    control: { style: { fills: video } },
    check: (c, base) => {
      const v = c.own('video')!;
      expect(v.getAttribute('data-speed')).toBe('2');
      expect(v.hasAttribute('loop')).toBe(false);
      expect(v.hasAttribute('autoplay')).toBe(false);
      expect(v.hasAttribute('controls')).toBe(true);
      expect(v.getAttribute('poster')).toContain('oblozhka01');
      const b = base.own('video')!;
      expect([b.getAttribute('data-speed'), b.hasAttribute('loop'), b.hasAttribute('autoplay'), b.hasAttribute('controls')]).toEqual(['1', true, true, false]);
    },
  },
  {
    id: 'S-12',
    keys: ['animation.enter'],
    mode: 'player',
    input: { animation: { enter: { kind: 'keyframes', keyframes: [{ at: 0, props: { x: -20 }, fill: { hex: '#FF0000' } }, { at: 1, props: { x: 0 }, fill: { hex: '#00FF00' } }] } } },
    check: (c, base) => {
      expect(styleOf(c.own('.bk-anim'))).toContain('var(--bk-ax, 0)');
      expect(c.own('.bk-tint')).not.toBeNull();
      expect(base.own('.bk-anim')).toBeNull();
    },
  },
  {
    id: 'S-13',
    keys: ['animation.loop'],
    mode: 'player',
    input: { animation: { loop: { kind: 'spin' } } },
    check: (c, base) => {
      expect(styleOf(c.own('.bk-anim'))).toContain('rotate(calc(var(--bk-ar, 0) * 1deg))');
      expect(base.own('.bk-anim')).toBeNull();
    },
  },
  {
    id: 'S-14',
    keys: ['animation.press'],
    mode: 'player',
    input: { animation: { press: { kind: 'glow' } } },
    check: (c, base) => {
      expect(styleOf(c.own('.bk-anim'))).toContain('drop-shadow(0 0 calc(var(--bk-aglow, 0) * var(--u))');
      expect(base.own('.bk-anim')).toBeNull();
    },
  },
  {
    id: 'S-15',
    keys: ['states'],
    state: 'selected',
    input: { states: { selected: { fills: [solid('#ABCDEF')], effects: { opacity: 0.7 } } } },
    check: (c, base) => {
      expect(c.root?.getAttribute('data-state')).toBe('selected');
      expect(styleOf(c.own('.bk-fill'))).toContain('#ABCDEF');
      expect(styleOf(c.root)).toContain('opacity:0.7');
      expect(styleOf(base.own('.bk-fill'))).not.toContain('#ABCDEF');
    },
  },
  {
    id: 'S-16',
    keys: ['visibleIf', 'initiallyHidden'],
    mode: 'player',
    input: { initiallyHidden: true, visibleIf: { kind: 'chance', percent: 50 } },
    check: (c, base) => {
      expect(c.root).toBeNull();
      expect(base.root).not.toBeNull();
    },
  },
  {
    id: 'S-17',
    keys: ['name', 'locked', 'hiddenInEditor', 'groupId', 'a11y', 'z'],
    input: { name: 'Снежок', locked: true, groupId: 'gruppa01', z: 7, a11y: { alt: 'Снежок на ветке', label: 'Снежок' } },
    check: (c) => {
      const s = styleOf(c.root);
      expect(s).toContain('z-index:7');
      expect(c.root?.getAttribute('aria-label')).toBe('Снежок');
      expect(c.root?.getAttribute('role')).toBe('img');
    },
  },
  {
    id: 'S-18',
    keys: ['transform3d'],
    input: { style: { transform3d: { rotateX: 20, rotateY: -10, perspective: 600, origin: { x: 0.25, y: 0.75 } } } },
    check: (c, base) => {
      const s = styleOf(c.root);
      expect(s).toContain(`perspective(${u(600)}) rotateX(20deg) rotateY(-10deg)`);
      expect(s).toContain('transform-origin:25% 75%');
      expect(styleOf(base.root)).not.toContain('perspective(');
    },
  },
  {
    id: 'S-19',
    keys: ['mask'],
    input: { style: { mask: { clipToShape: false, image: { source: 'media', id: 'maska-matrica' }, fade: { edges: ['bottom'], size: 0.3 } } } },
    check: (c) => {
      const s = styleOf(c.root);
      expect(s).toContain('maska-matrica');
      expect(s).toContain('linear-gradient(');
      expect(styleOf(c.own('.bk-content'))).toContain('overflow:visible');
    },
  },
  {
    id: 'S-20',
    keys: ['layout'],
    input: { style: { layout: { mode: 'grid', columns: 3, gap: 5, align: 'center' } } },
    check: (c, base) => {
      const s = styleOf(c.own('.bk-content'));
      expect(s).toContain('display:grid');
      expect(s).toContain('grid-template-columns:repeat(3, minmax(0, 1fr))');
      expect(s).toContain(`gap:${u(5)}`);
      expect(styleOf(base.own('.bk-content'))).not.toContain('display:grid');
    },
  },
];

/** Block fields that are not visual properties: identity, type content, nesting and scenarios. */
const NOT_STYLE = ['id', 'type', 'props', 'children', 'behaviors', 'rules'];

const frame = { x: 10, y: 10, w: 120, h: 90 };

function draw(type: BlockType, input: Partial<BlockInput>, mode: Mode, theme: 'light' | 'dark', state?: State): Rendered {
  const b = createBlock(type, { id: 'matrica-blok', frame, ...input });
  const host = render(<BlockView block={b} {...(state ? { state } : {})} />, { mode, tokens: themes[theme], media });
  const root = host.querySelector<HTMLElement>('[data-block-id="matrica-blok"]');
  return {
    host,
    root,
    own: (selector) => (root ? ([...root.querySelectorAll<HTMLElement>(selector)].find((el) => el.closest('.bk-block') === root) ?? null) : null),
  };
}

describe('P1.5 · S-00: матрица «свойство × тип блока» сверена со схемой', () => {
  it('S-00: проверены все свойства S-01…S-20 и ни одного лишнего', () => {
    expect(SPECS.map((s) => s.id)).toEqual(Array.from({ length: 20 }, (_, i) => `S-${String(i + 1).padStart(2, '0')}`));
  });

  it('S-00: проверены все типы блоков схемы — 22 типа B-01…B-23', () => {
    expect([...BLOCK_TYPES].sort()).toEqual(Object.keys(BLOCK_PROPS).sort());
    expect(BLOCK_TYPES).toHaveLength(22);
  });

  it('S-00: каждая группа стиля и каждое поле блока относится к какому-то свойству', () => {
    const claimed = new Set(SPECS.flatMap((s) => s.keys));
    expect(Object.keys(BlockStyle.shape).filter((k) => !claimed.has(k))).toEqual([]);
    const fields = Object.keys(createBlock('shape')).filter((k) => !NOT_STYLE.includes(k) && k !== 'style');
    // Optional fields (animation, states, visibleIf, groupId, textLayer) are absent on a fresh block — list them from the specs.
    const all = new Set([...fields, ...SPECS.flatMap((s) => s.keys).filter((k) => !(k in BlockStyle.shape))]);
    expect([...all].filter((k) => !claimed.has(k) && !claimed.has(`${k}.enter`))).toEqual([]);
  });
});

for (const theme of ['light', 'dark'] as const) {
  describe(`S-00: каждое свойство меняет вид каждого типа блока (тема ${theme === 'light' ? 'светлая' : 'тёмная'})`, () => {
    for (const spec of SPECS) {
      it.each(BLOCK_TYPES)(`${spec.id} × %s`, (type) => {
        const mode = spec.mode ?? 'editor';
        const changed = draw(type, spec.input, mode, theme, spec.state);
        const control = draw(type, spec.control ?? {}, mode, theme, spec.state);
        spec.check(changed, control);
      });
    }
  });
}

describe('S-17: скрытие в редакторе работает у любого типа', () => {
  it.each(BLOCK_TYPES)('S-17 × %s: скрытый в редакторе блок не рисуется на холсте, но есть в плеере', (type) => {
    expect(draw(type, { hiddenInEditor: true }, 'editor', 'light').root).toBeNull();
    expect(draw(type, { hiddenInEditor: true }, 'player', 'light').root).not.toBeNull();
  });
});
