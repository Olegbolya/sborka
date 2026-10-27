import { describe, expect, it } from 'vitest';
import { BLOCK_TYPES, BlockStyle, createBlock, createDocument } from '@blokum/schema';
import { createEditorStore } from '../lib/editor/store';
import { common, effectiveStyle, isOwn, ownGroups, resetStyleGroup, same, setAnimation, setStyleGroup, STYLE_GROUPS } from '../lib/editor/style-edit';
import { findBlock } from '../lib/editor/tree';

const make = (type: Parameters<typeof createBlock>[0] = 'shape') => {
  const block = createBlock(type);
  const doc = createDocument();
  doc.screens[0]!.blocks.push(block);
  const store = createEditorStore(doc);
  return { block, store, tokens: () => store.getState().doc.theme.tokens, get: () => findBlock(store.getState().doc, block.id)!.siblings[0]! };
};

describe('E-15 · правка стиля: «своё» и тема (TH-06)', () => {
  it('TH-06 · блок без своих значений берёт стиль из темы; правка группы делает её «своей» целиком', () => {
    const t = make();
    expect(isOwn(t.get(), 'radius', null)).toBe(false);
    t.store.getState().apply(setStyleGroup([t.block.id], 'radius', t.tokens(), null, (r) => ({ ...r, tl: 12 })), { label: 'x' });
    const radius = t.get().style.radius!;
    expect(radius).toMatchObject({ tl: 12, tr: 0, br: 0, bl: 0, unit: 'u' });
    expect(isOwn(t.get(), 'radius', null)).toBe(true);
    expect(ownGroups([t.get()], null)).toEqual(['radius']);
  });

  it('TH-06 · значение из темы по умолчанию попадает в «своё» вместе с правкой одного поля', () => {
    const t = make();
    const tokens = structuredClone(t.tokens());
    tokens.blockDefaults = { shape: { radius: { unit: 'u', tl: 20, tr: 20, br: 20, bl: 20 } } } as never;
    t.store.getState().apply(setStyleGroup([t.block.id], 'radius', tokens, null, (r) => ({ ...r, tl: 4 })), { label: 'x' });
    expect(t.get().style.radius).toMatchObject({ tl: 4, tr: 20, br: 20, bl: 20 });
    expect(effectiveStyle(t.get(), tokens, null).radius.tr).toBe(20);
  });

  it('TH-06 · «Сбросить к теме» возвращает группу к теме и убирает отметку', () => {
    const t = make();
    t.store.getState().apply(setStyleGroup([t.block.id], 'effects', t.tokens(), null, (e) => ({ ...e, opacity: 0.5 })), { label: 'x' });
    t.store.getState().apply(setStyleGroup([t.block.id], 'filters', t.tokens(), null, (f) => ({ ...f, sepia: 1 })), { label: 'x' });
    t.store.getState().apply(resetStyleGroup([t.block.id], ['effects'], null), { label: 'x' });
    expect(isOwn(t.get(), 'effects', null)).toBe(false);
    expect(isOwn(t.get(), 'filters', null)).toBe(true);
    t.store.getState().apply(resetStyleGroup([t.block.id], null, null), { label: 'x' });
    expect(t.get().style).toEqual({});
    expect(t.store.getState().apply(resetStyleGroup([t.block.id], null, null), { label: 'x' })).toBe(false);
  });

  it('S-15 · правка в состоянии пишется в состояние, обычный вид не трогается; сброс чистит состояние', () => {
    const t = make();
    t.store.getState().apply(setStyleGroup([t.block.id], 'effects', t.tokens(), 'hover', (e) => ({ ...e, opacity: 0.4 })), { label: 'x' });
    expect(t.get().states?.hover?.effects?.opacity).toBe(0.4);
    expect(t.get().style.effects).toBeUndefined();
    expect(effectiveStyle(t.get(), t.tokens(), 'hover').effects.opacity).toBe(0.4);
    expect(effectiveStyle(t.get(), t.tokens(), null).effects.opacity).toBe(1);
    expect(isOwn(t.get(), 'effects', 'hover')).toBe(true);
    expect(isOwn(t.get(), 'effects', null)).toBe(false);
    t.store.getState().apply(setStyleGroup([t.block.id], 'radius', t.tokens(), 'hover', (r) => ({ ...r, tl: 5 })), { label: 'x' });
    t.store.getState().apply(resetStyleGroup([t.block.id], ['effects'], 'hover'), { label: 'x' });
    expect(Object.keys(t.get().states?.hover ?? {})).toEqual(['radius']);
    t.store.getState().apply(resetStyleGroup([t.block.id], null, 'hover'), { label: 'x' });
    expect(t.get().states).toBeUndefined();
    expect(t.store.getState().apply(resetStyleGroup([t.block.id], null, 'pressed'), { label: 'x' })).toBe(false);
  });

  it('E-15 · значение, которое схема не принимает, не записывается', () => {
    const t = make();
    expect(t.store.getState().apply(setStyleGroup([t.block.id], 'effects', t.tokens(), null, (e) => ({ ...e, opacity: 7 })), { label: 'x' })).toBe(false);
    expect(t.store.getState().apply(setStyleGroup([t.block.id], 'radius', t.tokens(), null, (r) => ({ ...r, unit: '%', tl: 80 })), { label: 'x' })).toBe(false);
    expect(t.get().style).toEqual({});
  });

  it('E-15 · правка нескольких блоков за один шаг; блоки с разными значениями приводятся к одному', () => {
    const a = createBlock('shape');
    const b = createBlock('text');
    const doc = createDocument();
    doc.screens[0]!.blocks.push(a, b);
    const store = createEditorStore(doc);
    const tokens = store.getState().doc.theme.tokens;
    store.getState().apply(setStyleGroup([a.id], 'padding', tokens, null, (p) => ({ ...p, t: 10 })), { label: 'x' });
    const steps = store.getState().past.length;
    store.getState().apply(setStyleGroup([a.id, b.id], 'padding', tokens, null, (p) => ({ ...p, l: 3 })), { label: 'x' });
    expect(store.getState().past.length).toBe(steps + 1);
    const blocks = store.getState().doc.screens[0]!.blocks;
    expect(blocks[0]!.style.padding).toMatchObject({ t: 10, l: 3 });
    expect(blocks[1]!.style.padding).toMatchObject({ t: 0, l: 3 });
    expect(common([1, 1, 1])).toBe(1);
    expect(common([1, 2])).toBeNull();
    expect(common([])).toBeNull();
    expect(same({ a: [1] }, { a: [1] })).toBe(true);
  });

  it('E-15 · несуществующий блок пропускается', () => {
    const t = make();
    expect(t.store.getState().apply(setStyleGroup(['нет'], 'radius', t.tokens(), null, (r) => ({ ...r, tl: 1 })), { label: 'x' })).toBe(false);
    expect(t.store.getState().apply(resetStyleGroup(['нет'], null, null), { label: 'x' })).toBe(false);
    expect(t.store.getState().apply(setAnimation(['нет'], 'enter', undefined), { label: 'x' })).toBe(false);
  });

  it('S-12 · анимация появления, постоянная и на нажатие ставятся и снимаются по отдельности', () => {
    const t = make();
    const ids = [t.block.id];
    t.store.getState().apply(setAnimation(ids, 'enter', { kind: 'fade', direction: 'up', durationMs: 600, delayMs: 0, easing: { kind: 'preset', name: 'easeOut' } }), { label: 'x' });
    t.store.getState().apply(setAnimation(ids, 'loop', { kind: 'pulse', speed: 1, amplitude: 1, pauseMs: 0 }), { label: 'x' });
    expect(Object.keys(t.get().animation ?? {}).sort()).toEqual(['enter', 'loop']);
    t.store.getState().apply(setAnimation(ids, 'enter', undefined), { label: 'x' });
    t.store.getState().apply(setAnimation(ids, 'loop', undefined), { label: 'x' });
    expect(t.get().animation).toBeUndefined();
  });

  it('S-00 · группы стиля — ровно ключи схемы BlockStyle', () => {
    expect(STYLE_GROUPS).toEqual(Object.keys(BlockStyle.shape));
    expect(BLOCK_TYPES).toHaveLength(22);
  });
});
