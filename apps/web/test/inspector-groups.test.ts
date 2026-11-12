import { describe, expect, it } from 'vitest';
import { BLOCK_TYPES, BlockStyle, createBlock, createDocument, ProjectDocument, type BlockType } from '@blokum/schema';
import { orderBlocks } from '../lib/editor/arrange';
import { patchBlocks, setFrame } from '../lib/editor/commands';
import { createEditorStore } from '../lib/editor/store';
import { effectiveStyle, setStyleGroup, type StyleGroup } from '../lib/editor/style-edit';
import { GROUP_SPECS, specKeys } from '../lib/editor/style-specs';
import { findBlock } from '../lib/editor/tree';

/**
 * P3.4 · S-00…S-20: по одному значению каждой группы свойств ставится через те же правки, что и инспектор, на каждый из
 * 22 типов блока; результат читается обратно и проходит схему целого документа.
 */
const build = (type: BlockType) => {
  const block = createBlock(type);
  const doc = createDocument();
  doc.screens[0]!.blocks.push(block);
  const store = createEditorStore(doc);
  const tokens = () => store.getState().doc.theme.tokens;
  const get = () => findBlock(store.getState().doc, block.id)!.siblings[0]!;
  return { block, store, tokens, get };
};

type Case = { id: string; group: StyleGroup; value: unknown; check: (v: Record<string, unknown>) => void };
const color = { token: 'primary', alpha: 1 };

const CASES: Case[] = [
  { id: 'S-02', group: 'shape', value: { kind: 'star', points: 7, depth: 0.4, cornerRadius: 0 }, check: (v) => expect(v).toMatchObject({ kind: 'star', points: 7 }) },
  { id: 'S-03', group: 'radius', value: { unit: 'u', tl: 12, tr: 0, br: 30, bl: 0 }, check: (v) => expect(v).toMatchObject({ tl: 12, br: 30 }) },
  { id: 'S-04', group: 'fills', value: [{ kind: 'solid', color }, { kind: 'linear', angle: 45, stops: [{ offset: 0, color }, { offset: 1, color: { token: 'accent', alpha: 1 } }] }], check: (v) => expect(v).toHaveLength(2) },
  { id: 'S-05', group: 'stroke', value: { width: 4, style: 'dashed', paint: { kind: 'solid', color }, align: 'center' }, check: (v) => expect(v).toMatchObject({ width: 4, style: 'dashed', align: 'center' }) },
  { id: 'S-06', group: 'shadows', value: [{ x: 2, y: 4, blur: 8, spread: 1, color: { token: 'text', alpha: 0.4 }, inset: false }, { x: 0, y: 0, blur: 6, spread: 0, color: { token: 'text', alpha: 0.4 }, inset: true }], check: (v) => expect(v).toHaveLength(2) },
  { id: 'S-07', group: 'effects', value: { opacity: 0.5, blur: 4, backdropBlur: 3, blendMode: 'multiply' }, check: (v) => expect(v).toMatchObject({ opacity: 0.5, blendMode: 'multiply' }) },
  { id: 'S-08', group: 'filters', value: { brightness: 1.2, contrast: 1.1, saturate: 0.8, grayscale: 0.5, sepia: 0.3, hueRotate: 40, invert: 0.1 }, check: (v) => expect(v).toMatchObject({ brightness: 1.2, hueRotate: 40 }) },
  { id: 'S-09', group: 'padding', value: { t: 5, r: 10, b: 15, l: 20 }, check: (v) => expect(v).toEqual({ t: 5, r: 10, b: 15, l: 20 }) },
  { id: 'S-10', group: 'text', value: { ...BlockStyle.shape.text.parse({}), size: 24, weight: 700, italic: true, align: 'center' }, check: (v) => expect(v).toMatchObject({ size: 24, weight: 700, italic: true, align: 'center' }) },
  { id: 'S-11', group: 'media', value: { ...BlockStyle.shape.media.parse({}), fit: 'contain', loop: false, speed: 2 }, check: (v) => expect(v).toMatchObject({ fit: 'contain', loop: false, speed: 2 }) },
  { id: 'S-18', group: 'transform3d', value: { ...BlockStyle.shape.transform3d.parse({}), rotateX: 20, rotateY: -30, perspective: 800, tiltFollow: true }, check: (v) => expect(v).toMatchObject({ rotateX: 20, rotateY: -30, perspective: 800, tiltFollow: true }) },
  { id: 'S-19', group: 'mask', value: { clipToShape: false }, check: (v) => expect(v).toMatchObject({ clipToShape: false }) },
  { id: 'S-20', group: 'layout', value: { ...BlockStyle.shape.layout.parse({}), mode: 'grid', columns: 3, gap: 12 }, check: (v) => expect(v).toMatchObject({ mode: 'grid', columns: 3, gap: 12 }) },
];

describe('P3.4 · каждое свойство каждой группы ставится на каждый тип блока', () => {
  for (const c of CASES) {
    it(`${c.id} · группа «${c.group}»: значение ставится на все ${BLOCK_TYPES.length} типов блока, читается обратно и проходит схему документа`, () => {
      for (const type of BLOCK_TYPES) {
        const t = build(type);
        t.store.getState().apply(setStyleGroup([t.block.id], c.group, t.tokens(), null, () => c.value as never), { label: c.id });
        c.check(effectiveStyle(t.get(), t.tokens(), null)[c.group] as never);
        expect(ProjectDocument.safeParse(t.store.getState().doc).success, `${type}`).toBe(true);
      }
    });

    it(`${c.id} · группа «${c.group}»: инспектор показывает поля этой группы (${GROUP_SPECS[c.group].title}), все ключи есть в схеме`, () => {
      const shape = (BlockStyle.shape[c.group] as { shape?: Record<string, unknown> }).shape;
      const keys = specKeys(c.group);
      expect(GROUP_SPECS[c.group].fields.length).toBeGreaterThan(0);
      if (shape && !Array.isArray(shape)) for (const k of keys) expect(Object.keys(shape), k).toContain(k.split('.')[0]!);
    });
  }

  it('S-01 · положение и размер: x, y, ширина, высота, поворот и отражение правятся на любом типе блока', () => {
    for (const type of BLOCK_TYPES) {
      const t = build(type);
      t.store.getState().apply(setFrame([t.block.id], { x: -2000, y: 7000, w: 1, h: 3000 }), { label: 'S-01' });
      t.store.getState().apply(patchBlocks([t.block.id], (b) => void Object.assign(b.frame, { rotation: 45, flipX: true })), { label: 'S-01' });
      expect(t.get().frame).toMatchObject({ x: -2000, y: 7000, w: 1, h: 3000, rotation: 45, flipX: true });
      expect(ProjectDocument.safeParse(t.store.getState().doc).success, type).toBe(true);
    }
  });

  it('S-17 · служебные: имя, блокировка, скрытие в редакторе, альтернативный текст и порядок слоя правятся на любом типе блока', () => {
    for (const type of BLOCK_TYPES) {
      const t = build(type);
      const other = createBlock('shape');
      t.store.getState().apply((doc) => void doc.screens[0]!.blocks.push(other), { label: 'x' });
      t.store.getState().apply(patchBlocks([t.block.id], (b) => void Object.assign(b, { name: 'Кнопка_играть', locked: true, hiddenInEditor: true })), { label: 'S-17' });
      t.store.getState().apply(patchBlocks([t.block.id], (b) => void (b.a11y.alt = 'Описание')), { label: 'S-17' });
      expect(t.get()).toMatchObject({ name: 'Кнопка_играть', locked: true, hiddenInEditor: true, a11y: { alt: 'Описание' } });
      t.store.getState().apply(orderBlocks([t.block.id], 'front'), { label: 'S-17' });
      const blocks = t.store.getState().doc.screens[0]!.blocks;
      expect(blocks.find((b) => b.id === t.block.id)!.z).toBeGreaterThan(blocks.find((b) => b.id === other.id)!.z);
      expect(ProjectDocument.safeParse(t.store.getState().doc).success, type).toBe(true);
    }
  });
});
