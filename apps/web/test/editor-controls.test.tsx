import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { BLOCK_TYPES, type Block, BlockAnimation, BlockStyle, Color, MediaRef, UnitPoint, createBlock, createDocument } from '@blokum/schema';
import { type ReactNode } from 'react';
import { EditorProvider } from '../components/editor/context';
import { AnimationInspector, StyleInspector, groupsFor } from '../components/editor/StylePanels';
import { MediaCatalog } from '../lib/editor/media';
import { type Saver } from '../lib/editor/saver';
import { createEditorStore } from '../lib/editor/store';
import { STYLE_GROUPS } from '../lib/editor/style-edit';
import { ANIMATION_SPEC, GROUP_SPECS, MEDIA_TYPES, animationKeys, specKeys } from '../lib/editor/style-specs';

interface ZodLike {
  def?: { type: string; innerType?: ZodLike; shape?: Record<string, ZodLike>; options?: ZodLike[]; element?: ZodLike };
  _zod?: { def: NonNullable<ZodLike['def']> };
}
const defOf = (s: ZodLike) => s._zod?.def ?? s.def!;
const unwrap = (s: ZodLike): ZodLike => {
  let cur = s;
  while (['default', 'prefault', 'optional', 'nullable', 'readonly'].includes(defOf(cur).type)) cur = defOf(cur).innerType!;
  return cur;
};

/** The keys of a style group as the schema names them: every field down to a colour, a point or a file reference. */
function schemaKeys(schema: ZodLike, prefix: string, out = new Set<string>()): Set<string> {
  const s = unwrap(schema);
  const leaves = [Color, UnitPoint, MediaRef] as unknown as ZodLike[];
  const d = defOf(s);
  if (leaves.includes(s)) out.add(prefix);
  else if (d.type === 'object') for (const [k, v] of Object.entries(d.shape!)) schemaKeys(v, prefix === '' ? k : `${prefix}.${k}`, out);
  else if (d.type === 'union') for (const o of d.options!) schemaKeys(o, prefix, out);
  else if (d.type === 'array') {
    const el = unwrap(d.element!);
    if (defOf(el).type === 'object' || defOf(el).type === 'union') schemaKeys(el, prefix, out);
    else out.add(prefix);
  } else out.add(prefix);
  return out;
}

const env = () => {
  const store = createEditorStore(createDocument());
  return { store, saver: {} as Saver, projectId: 'proekt', media: new MediaCatalog(), flash: () => undefined, loadDocument: () => undefined };
};

const withBlock = (block: Block): string => {
  const e = env();
  e.store.getState().apply((d) => void d.screens[0]!.blocks.push(block), { label: 'x' });
  const tree: ReactNode = (
    <EditorProvider value={e}>
      <StyleInspector blocks={[e.store.getState().doc.screens[0]!.blocks[0]!]} />
    </EditorProvider>
  );
  return renderToStaticMarkup(tree);
};

const controlsIn = (html: string): Set<string> => new Set([...html.matchAll(/data-control="([^"]+)"/g)].map((m) => m[1]!).map((c) => c.replace(/#.*/, '')));

const color = { token: 'primary', alpha: 1 };
const stops = [{ offset: 0, color }, { offset: 1, color }];
const media = { source: 'media', id: 'media_demo' };
const shadow = { x: 0, y: 2, blur: 4, spread: 0, color: { hex: '#00000066' }, inset: false };

/** Styles that make every kind-dependent control appear: each shape, fill, paint, font and optional part. */
const VARIANTS: Array<Record<string, unknown>> = [
  { shape: { kind: 'polygon', sides: 6, cornerRadius: 0 }, fills: [{ kind: 'none' }, { kind: 'solid', color }, { kind: 'linear', angle: 90, stops }, { kind: 'radial', cx: 0.5, cy: 0.5, stops }] },
  { shape: { kind: 'star', points: 5, depth: 0.5, cornerRadius: 0 }, fills: [{ kind: 'conic', angle: 0, cx: 0.5, cy: 0.5, stops }, { kind: 'media', media, fit: 'cover', focal: { x: 0.5, y: 0.5 }, scale: 1 }] },
  { shape: { kind: 'blob', seed: 1, complexity: 6 }, stroke: { width: 2, style: 'dashed', dash: [8, 4], paint: { kind: 'linear', angle: 0, stops }, align: 'inside' } },
  { shape: { kind: 'bubble', tail: { x: 0.2, y: 1 }, tailWidth: 0.15 }, stroke: { width: 2, style: 'solid', paint: { kind: 'radial', cx: 0.5, cy: 0.5, stops }, align: 'center' } },
  { shape: { kind: 'arrow', thickness: 0.4, head: 'triangle' }, stroke: { width: 2, style: 'dotted', paint: { kind: 'conic', angle: 0, cx: 0.5, cy: 0.5, stops }, align: 'outside' } },
  { shape: { kind: 'wave', amplitude: 0.1, frequency: 6, zigzag: false, edges: ['bottom'] }, shadows: [shadow], glow: { color, size: 16 } },
  { shape: { kind: 'path', d: 'M 0 0 L 100 0 L 100 100 Z', closed: true }, text: { font: { kind: 'font', id: 'shrift_demo' }, paint: { kind: 'media', media, fit: 'cover', focal: { x: 0.5, y: 0.5 }, scale: 1 }, shadow, outline: { width: 1, color }, path: { kind: 'arc', curvature: 0.5 } } },
  { shape: { kind: 'heart' }, text: { font: { kind: 'system', name: 'serif' }, paint: { kind: 'conic', angle: 0, cx: 0.5, cy: 0.5, stops }, path: { kind: 'circle', curvature: 0.5 } } },
  { shape: { kind: 'pill' }, text: { font: { kind: 'theme', role: 'heading' }, paint: { kind: 'radial', cx: 0.5, cy: 0.5, stops } } },
  { shape: { kind: 'ellipse' }, text: { paint: { kind: 'linear', angle: 0, stops } }, media: { crop: { x: 0, y: 0, w: 1, h: 1 }, poster: media }, mask: { clipToShape: true, image: media, fade: { edges: ['top'], size: 0.2 } } },
  { shape: { kind: 'rect' } },
];

describe('P3.4 · контролы инспектора против схемы', () => {
  it.each(STYLE_GROUPS)('S-00 · %s: таблица контролов совпадает с ключами схемы', (group) => {
    const schema = BlockStyle.shape[group] as unknown as ZodLike;
    expect([...schemaKeys(schema, group)].sort()).toEqual([...new Set(specKeys(group))].sort());
  });

  it('S-00 · у каждой группы схемы есть заголовок и описание полей', () => {
    for (const g of STYLE_GROUPS) {
      expect(GROUP_SPECS[g].title).not.toBe('');
      expect(GROUP_SPECS[g].fields.length).toBeGreaterThan(0);
    }
    expect(Object.keys(GROUP_SPECS).sort()).toEqual([...STYLE_GROUPS].sort());
  });

  it('S-00 · какие группы нужны блоку: все — каждому типу, кроме медиа (файлы) и раскладки (вложенные блоки)', () => {
    for (const type of BLOCK_TYPES) {
      const groups = groupsFor(createBlock(type));
      const expected = STYLE_GROUPS.filter((g) => {
        if (g === 'media') return (MEDIA_TYPES as readonly string[]).includes(type);
        if (g === 'layout') return ['container', 'singleChoice', 'multiChoice'].includes(type);
        return true;
      });
      expect(groups, type).toEqual(expected);
    }
    // A block with inner blocks always has the layout, whatever its type.
    const withChild = createBlock('text');
    withChild.children.push(createBlock('shape'));
    expect(groupsFor(withChild)).toContain('layout');
  });

  it.each(BLOCK_TYPES)('S-00 · %s: на странице есть контрол для каждого ключа схемы', (type) => {
    const wanted = new Set<string>();
    for (const g of groupsFor(createBlock(type))) for (const k of specKeys(g)) wanted.add(k);
    const seen = new Set<string>();
    for (const style of VARIANTS) {
      const block = createBlock(type);
      block.style = style;
      for (const c of controlsIn(withBlock(block))) seen.add(c);
    }
    const missing = [...wanted].filter((k) => !seen.has(k));
    expect(missing, `для типа «${type}» нет контролов: ${missing.join(', ')}`).toEqual([]);
  });

  it('E-15 · блок с «своим» значением помечен «своё», без — нет; «Сбросить к теме» только у своих групп', () => {
    const plain = withBlock(createBlock('shape'));
    expect(plain).not.toContain('data-testid="own-');
    expect(plain).not.toContain('Сбросить к теме:');
    const own = createBlock('shape');
    own.style = { effects: { opacity: 0.5, blur: 0, backdropBlur: 0, blendMode: 'normal' } } as never;
    const html = withBlock(own);
    expect(html).toContain('data-testid="own-effects"');
    expect(html).toContain('aria-label="Сбросить к теме: Эффекты"');
    expect(html).not.toContain('data-testid="own-filters"');
  });

  it('S-15 · выбор состояния блока предлагает все восемь состояний', () => {
    const html = withBlock(createBlock('shape'));
    for (const title of ['Обычное', 'Наведение', 'Нажато', 'Выбрано', 'Правильно', 'Неправильно', 'Недоступно', 'Перетаскивается', 'Над зоной']) expect(html).toContain(title);
  });

  it('S-12…S-14 · анимации: контролы покрывают все ключи схемы, кроме ключевых кадров и контура движения (их редакторы позже)', () => {
    const later = (k: string) => /(^|\.)keyframes(\.|$)/.test(k) || k === 'loop.path';
    const schema = [...schemaKeys(BlockAnimation as unknown as ZodLike, '')].filter((k) => !later(k)).sort();
    expect(schema).toEqual([...new Set(animationKeys())].sort());
    expect(ANIMATION_SPEC).toHaveLength(3);
  });

  it.each(BLOCK_TYPES)('S-12…S-14 · %s: на странице есть контрол для каждого ключа анимации', (type) => {
    const easings = [{ kind: 'preset', name: 'easeOut' }, { kind: 'spring', stiffness: 170, damping: 26 }, { kind: 'bezier', x1: 0.25, y1: 0.1, x2: 0.25, y2: 1 }];
    const seen = new Set<string>();
    for (const easing of easings) {
      const block = createBlock(type);
      block.animation = { enter: { kind: 'slide', direction: 'up', durationMs: 600, delayMs: 0, easing }, loop: { kind: 'pulse', speed: 1, amplitude: 1, pauseMs: 0 }, press: { kind: 'grow' } } as never;
      const e = env();
      e.store.getState().apply((d) => void d.screens[0]!.blocks.push(block), { label: 'x' });
      const html = renderToStaticMarkup(
        <EditorProvider value={e}>
          <AnimationInspector blocks={[e.store.getState().doc.screens[0]!.blocks[0]!]} />
        </EditorProvider>,
      );
      for (const c of controlsIn(html)) seen.add(c);
    }
    expect([...new Set(animationKeys())].filter((k) => !seen.has(k))).toEqual([]);
  });
});
