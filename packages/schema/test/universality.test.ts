import { describe, expect, it } from 'vitest';
import { BLOCK_TYPES, Block, BlockStyle, createBlock, type BlockStyleInput } from '../src/index.js';

/** Every style group set to a non-default value. */
const FULL_STYLE: BlockStyleInput = {
  autoHeight: true,
  lockAspect: true,
  shape: { kind: 'star', points: 7, depth: 0.4, cornerRadius: 0.1 },
  radius: { unit: 'u', tl: 12, tr: 4, br: 30, bl: 0 },
  fills: [
    { kind: 'linear', angle: 45, stops: [{ offset: 0, color: { hex: '#FF0000' } }, { offset: 1, color: { token: 'accent', alpha: 0.5 } }] },
    { kind: 'media', media: { source: 'media', id: 'mygiffile1' }, fit: 'tile' },
  ],
  stroke: { width: 3, style: 'dashed', dash: [6, 4], align: 'outside', paint: { kind: 'solid', color: { hex: '#000000' } } },
  shadows: [{ x: 2, y: 6, blur: 20, spread: 1, color: { hex: '#00000080' }, inset: true }],
  glow: { color: { token: 'primary' }, size: 24 },
  effects: { opacity: 0.8, blur: 2, backdropBlur: 10, blendMode: 'multiply' },
  filters: { brightness: 1.2, contrast: 0.9, saturate: 1.5, grayscale: 0.1, sepia: 0.2, hueRotate: 45, invert: 0 },
  padding: { t: 8, r: 12, b: 8, l: 12 },
  text: {
    font: { kind: 'font', id: 'myownfont01' },
    size: 32,
    weight: 800,
    italic: true,
    align: 'center',
    verticalAlign: 'middle',
    transform: 'uppercase',
    paint: { kind: 'media', media: { source: 'library', id: 'texture0001' } },
    outline: { width: 2, color: { hex: '#FFFFFF' } },
    path: { kind: 'arc', curvature: 0.7 },
  },
  media: { fit: 'contain', focal: { x: 0.3, y: 0.7 }, speed: 2, loop: false },
  transform3d: { rotateX: 20, rotateY: -15, perspective: 800, tiltFollow: true },
  mask: { clipToShape: true, image: { source: 'media', id: 'maskimage01' }, fade: { edges: ['bottom'], size: 0.3 } },
  layout: { mode: 'grid', gap: 12, columns: 3, align: 'center', justify: 'between', wrap: true, scroll: true },
};

describe('S-00: каждое свойство применимо к каждому типу блока', () => {
  it.each(BLOCK_TYPES)('S-00: блок «%s» принимает полный набор свойств S-01…S-20', (type) => {
    const base = createBlock(type);
    const b = Block.parse({ ...base, frame: { ...base.frame, rotation: 30, flipX: true }, style: FULL_STYLE, textLayer: { paragraphs: [{ runs: [{ t: 'Подпись' }] }] } });
    expect(b.style).toEqual(BlockStyle.parse(FULL_STYLE));
    expect(b.frame.rotation).toBe(30);
    expect(b.textLayer?.paragraphs[0]?.runs[0]).toEqual({ t: 'Подпись' });
  });

  it('S-00: у всех типов блоков одна и та же схема стиля', () => {
    const styles = BLOCK_TYPES.map((t) => JSON.stringify(Object.keys(createBlock(t).style)));
    expect(new Set(styles).size).toBe(1);
  });

  it('S-00: у любого блока могут быть правила, поведения и вложенные блоки', () => {
    const inner = createBlock('shape');
    const b = createBlock('image', {
      children: [inner],
      behaviors: [{ kind: 'drag' }],
      rules: [{ id: 'rule000001', when: { kind: 'tap', source: { kind: 'block', blockId: 'x00000' } }, do: [{ kind: 'goTo', to: 'next' }] }],
    });
    expect(b.children).toHaveLength(1);
    expect(b.behaviors[0]).toMatchObject({ kind: 'drag', axis: 'both', returnIfMissed: true });
  });
});

describe('ограничения стиля', () => {
  it.each([
    ['непрозрачность больше 1', { effects: { opacity: 1.5 } }],
    ['скругление больше 50 %', { radius: { unit: '%', tl: 60 } }],
    ['5 слоёв заливки', { fills: Array.from({ length: 5 }, () => ({ kind: 'none' })) }],
    ['7 теней', { shadows: Array.from({ length: 7 }, () => ({})) }],
    ['начертание 450', { text: { weight: 450 } }],
    ['цвет не HEX', { fills: [{ kind: 'solid', color: { hex: 'red' } }] }],
    ['опасный контур', { shape: { kind: 'path', d: 'M0 0 url(javascript:alert(1))' } }],
    ['неизвестное свойство', { glitter: true }],
  ])('отклоняет: %s', (_name, style) => {
    expect(BlockStyle.safeParse(style).success).toBe(false);
  });

  it('ошибки по-русски', () => {
    const r = BlockStyle.safeParse({ fills: [{ kind: 'solid', color: { hex: 'red' } }] });
    expect(r.error?.issues.map((i) => i.message).join(' ')).toMatch(/#RRGGBB|ожидал/);
  });
});

describe('свойства типа блока', () => {
  it('B-01: если у всех свойств типа есть значения по умолчанию, props можно не указывать', () => {
    expect(Block.parse({ id: 'tekst00001', type: 'text', name: 'Текст', frame: { x: 0, y: 0, w: 10, h: 10 } }).props).toEqual({});
    expect(Block.parse({ id: 'taimer0001', type: 'timer', name: 'Таймер', frame: { x: 0, y: 0, w: 10, h: 10 } }).props).toMatchObject({ seconds: 60, autoStart: true });
  });

  it('B-11: у вопроса варианты обязательны — без props понятная ошибка', () => {
    const r = Block.safeParse({ id: 'vopros0001', type: 'singleChoice', name: 'Вопрос', frame: { x: 0, y: 0, w: 10, h: 10 } });
    expect(r.error?.issues.map((i) => i.message)).toEqual(['Поле не заполнено']);
  });
});
