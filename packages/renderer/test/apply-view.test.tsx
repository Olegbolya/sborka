import { type BlockView as RuntimeView } from '@blokum/engine';
import { BlockStyle } from '@blokum/schema';
import { describe, expect, it } from 'vitest';
import { BlockView, applyRuntimeView } from '../src/index.js';
import { block, render, styleOf } from './helpers.js';

const view = (patch: Partial<RuntimeView>): RuntimeView => ({
  id: 'blok-shape',
  protoId: 'blok-shape',
  copy: false,
  parentId: null,
  visible: true,
  animateVisibility: false,
  interactive: true,
  dragging: false,
  zoneId: null,
  selected: false,
  x: 0,
  y: 0,
  w: 50,
  h: 50,
  rotation: 0,
  z: 0,
  overrides: {},
  anim: {},
  media: null,
  flipped: false,
  ...patch,
});

describe('AC-02: изменения из сценариев попадают в стиль', () => {
  it('AC-02: группы стиля заменяются, анимированные числа накладываются', () => {
    const base = BlockStyle.parse({ effects: { opacity: 1, blur: 0 }, filters: { brightness: 1 }, transform3d: { rotateX: 0 } });
    const s = applyRuntimeView(base, view({ overrides: { 'style.radius': BlockStyle.shape.radius.parse({ tl: 9 }), textLayer: null }, anim: { opacity: 0.3, blur: 2, backdropBlur: 4, brightness: 1.5, hueRotate: 30, rotateX: 12, rotateY: -3 } }));
    expect(s.radius.tl).toBe(9);
    expect(s.effects).toMatchObject({ opacity: 0.3, blur: 2, backdropBlur: 4 });
    expect(s.filters).toMatchObject({ brightness: 1.5, hueRotate: 30, contrast: 1 });
    expect(s.transform3d).toMatchObject({ rotateX: 12, rotateY: -3 });
    expect(applyRuntimeView(base, undefined)).toBe(base);
    expect(applyRuntimeView(base, view({}))).toEqual(base);
  });

  it('AC-02 · AC-03 · AC-18: позиция, размер, масштаб, текст, отражение и запрет нажатий из движка', () => {
    const b = block('shape', { textLayer: { paragraphs: [{ kind: 'p', runs: [{ t: 'было' }] }] } });
    const views = new Map([[b.id, view({ id: b.id, x: 70, y: 80, w: 30, h: 40, rotation: 90, interactive: false, overrides: { textLayer: { paragraphs: [{ kind: 'p', runs: [{ t: 'стало' }] }] }, 'frame.flipY': true }, anim: { scale: 2 } })]]);
    const host = render(<BlockView block={b} />, { mode: 'player', views });
    const s = styleOf(host.querySelector('.bk-block'));
    // The place from the document plus the shift from the engine (translate — without layout, SC-05).
    expect(s).toContain(`left:calc(${b.frame.x} * var(--u))`);
    expect(s).toContain(`translate:calc(${70 - b.frame.x} * var(--u)) calc(${80 - b.frame.y} * var(--u))`);
    expect(s).toContain('height:calc(40 * var(--u))');
    expect(s).toContain('transform:rotate(90deg) scale(1, -1) scale(2)');
    expect(s).toContain('pointer-events:none');
    expect(host.querySelector('.bk-text')?.textContent).toBe('стало');
  });

  it('CN-03 · S-15: выбранный, перетаскиваемый и лежащий на зоне блок получает своё состояние', () => {
    const b = block('shape', { states: { selected: { effects: { opacity: 0.1 } }, dragging: { effects: { opacity: 0.2 } }, overZone: { effects: { opacity: 0.3 } } } });
    const at = (patch: Partial<RuntimeView>) => render(<BlockView block={b} />, { mode: 'player', views: new Map([[b.id, view({ id: b.id, ...patch })]]) }).querySelector('.bk-block');
    expect(at({ selected: true })?.getAttribute('data-state')).toBe('selected');
    expect(styleOf(at({ dragging: true }))).toContain('opacity:0.2');
    expect(styleOf(at({ zoneId: 'korzina' }))).toContain('opacity:0.3');
    expect(at({ visible: false })).toBeNull();
  });
});
