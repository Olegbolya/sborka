import { type BlockInput, ProjectDocument, textOf } from '@blokum/schema';

type Style = NonNullable<BlockInput['style']>;

const gradient: Style['fills'] = [{ kind: 'linear', angle: 135, stops: [{ offset: 0, color: { token: 'primary' } }, { offset: 1, color: { token: 'accent' } }] }];
const photo: Style['fills'] = [{ kind: 'media', media: { source: 'media', id: 'dev-foto-zima' }, fit: 'cover' }];
const gif: Style['fills'] = [{ kind: 'media', media: { source: 'media', id: 'dev-gif-sneg' }, fit: 'cover' }];

const SHAPES: Array<[string, Style['shape']]> = [
  ['Прямоугольник', { kind: 'rect' }],
  ['Капсула', { kind: 'pill' }],
  ['Эллипс', { kind: 'ellipse' }],
  ['Шестиугольник', { kind: 'polygon', sides: 6 }],
  ['Звезда', { kind: 'star', points: 5, depth: 0.55 }],
  ['Сердце', { kind: 'heart' }],
  ['Клякса', { kind: 'blob', seed: 2027, complexity: 7 }],
  ['Облачко', { kind: 'bubble', tail: { x: 0.25, y: 1 } }],
  ['Стрелка', { kind: 'arrow', thickness: 0.45, head: 'triangle' }],
  ['Волна', { kind: 'wave', amplitude: 0.08, frequency: 4, edges: ['bottom'] }],
  ['Свой контур', { kind: 'path', d: 'M50 0L61 35L98 35L68 57L79 91L50 70L21 91L32 57L2 35L39 35Z' }],
  ['Зигзаг', { kind: 'wave', amplitude: 0.1, frequency: 5, zigzag: true, edges: ['top', 'bottom'] }],
];

/** Variants of S-03 (rounding), S-05 (stroke), S-06 (shadows), S-19 (masks) and S-18 (3D). */
const VARIANTS: Array<[string, Style]> = [
  ['Углы по одному', { radius: { tl: 40, tr: 4, br: 40, bl: 4 }, fills: gradient }],
  ['Скругление 50 %', { radius: { unit: '%', tl: 50, tr: 50, br: 50, bl: 50 }, fills: photo }],
  ['Мягкий 7-угольник', { shape: { kind: 'polygon', sides: 7, cornerRadius: 0.25 }, fills: gradient }],
  ['Мягкая звезда', { shape: { kind: 'star', points: 8, depth: 0.4, cornerRadius: 0.2 }, fills: gif }],
  ['Хвост справа', { shape: { kind: 'bubble', tail: { x: 1, y: 0.7 }, tailWidth: 0.25 }, fills: [{ kind: 'solid', color: { token: 'surface' } }], stroke: { width: 2, paint: { kind: 'solid', color: { token: 'text' } } } }],
  ['Круглая стрелка', { shape: { kind: 'arrow', head: 'round', thickness: 0.35 }, fills: gradient }],
  ['Стрелка-шеврон', { shape: { kind: 'arrow', head: 'chevron', thickness: 0.5 }, fills: [{ kind: 'solid', color: { token: 'success' } }] }],
  ['Обводка внутри', { shape: { kind: 'heart' }, fills: photo, stroke: { width: 6, align: 'inside', paint: { kind: 'solid', color: { hex: '#FFFFFF' } } } }],
  ['Обводка по центру', { shape: { kind: 'star' }, fills: gradient, stroke: { width: 4, align: 'center', style: 'dashed', paint: { kind: 'solid', color: { token: 'text' } } } }],
  ['Обводка снаружи', { shape: { kind: 'blob', seed: 5 }, fills: gif, stroke: { width: 5, align: 'outside', paint: { kind: 'conic', stops: [{ offset: 0, color: { hex: '#FF5F6D' } }, { offset: 0.5, color: { hex: '#FFC371' } }, { offset: 1, color: { hex: '#FF5F6D' } }] } } }],
  ['Точки', { shape: { kind: 'ellipse' }, fills: [{ kind: 'solid', color: { token: 'surface' } }], stroke: { width: 4, style: 'dotted', align: 'center', paint: { kind: 'solid', color: { token: 'primary' } } } }],
  ['Свой штрих', { radius: { tl: 16, tr: 16, br: 16, bl: 16 }, fills: [{ kind: 'solid', color: { token: 'surface' } }], stroke: { width: 3, style: 'dashed', dash: [14, 4, 2, 4], paint: { kind: 'linear', stops: [{ offset: 0, color: { token: 'primary' } }, { offset: 1, color: { token: 'accent' } }] } } }],
  ['Тень по контуру', { shape: { kind: 'star', points: 6 }, fills: [{ kind: 'solid', color: { token: 'surface' } }], shadows: [{ x: 4, y: 8, blur: 12, spread: 2, color: { hex: '#0000004D' } }] }],
  ['Внутренняя тень', { shape: { kind: 'heart' }, fills: [{ kind: 'solid', color: { token: 'error' } }], shadows: [{ x: 0, y: 6, blur: 10, spread: 0, inset: true, color: { hex: '#00000066' } }] }],
  ['Свечение', { shape: { kind: 'blob', seed: 77 }, fills: gradient, glow: { color: { token: 'accent' }, size: 16 } }],
  ['Маска-картинка', { fills: photo, mask: { image: { source: 'media', id: 'dev-maska-zvezda' } } }],
  ['Затухание краёв', { fills: gif, mask: { fade: { edges: ['bottom', 'right'], size: 0.4 } } }],
  ['3D-наклон', { radius: { tl: 12, tr: 12, br: 12, bl: 12 }, fills: photo, transform3d: { rotateX: 20, rotateY: -25, perspective: 400 } }],
  ['За курсором', { radius: { tl: 12, tr: 12, br: 12, bl: 12 }, fills: gradient, transform3d: { tiltFollow: true, tiltStrength: 25, perspective: 500 }, shadows: [{ y: 10, blur: 20, color: { hex: '#00000040' } }] }],
  ['Без обрезки', { shape: { kind: 'ellipse' }, fills: gradient, mask: { clipToShape: false } }],
  ['Своя форма + GIF', { shape: { kind: 'path', d: 'M0 50C0 20 20 0 50 0C80 0 100 20 100 50C100 80 70 75 50 100C30 75 0 80 0 50Z' }, fills: gif, stroke: { width: 3, align: 'outside', paint: { kind: 'solid', color: { token: 'accent' } } } }],
];

const COLS = [15, 140, 265];
const CELL = 110;
const SIZE = 100;

function grid(items: Array<[string, Style]>, top: number, prefix: string): { blocks: BlockInput[]; bottom: number } {
  const blocks: BlockInput[] = [];
  items.forEach(([label, style], i) => {
    const x = COLS[i % 3]!;
    const y = top + Math.floor(i / 3) * (CELL + 30);
    const id = `${prefix}-${String(i).padStart(2, '0')}`;
    const children: BlockInput[] =
      label === 'Без обрезки' ? [{ id: `${id}-vnutri`, type: 'shape', name: 'Выступ', frame: { x: 60, y: -10, w: 50, h: 50 }, style: { radius: { unit: '%', tl: 50, tr: 50, br: 50, bl: 50 }, fills: [{ kind: 'solid', color: { token: 'error' } }] } }] : [];
    blocks.push({ id, type: 'shape', name: label, frame: { x, y, w: SIZE, h: label.includes('Стрелка') || label === 'Круглая стрелка' ? 60 : SIZE }, style, children });
    blocks.push({ id: `${id}-podpis`, type: 'text', name: `Подпись ${label}`, frame: { x: x - 5, y: y + CELL - 4, w: SIZE + 10, h: 22 }, textLayer: textOf(label), style: { text: { size: 12, align: 'center', paint: { kind: 'solid', color: { token: 'muted' } } } } });
  });
  return { blocks, bottom: top + Math.ceil(items.length / 3) * (CELL + 30) };
}

const heading = (id: string, text: string, y: number): BlockInput => ({
  id,
  type: 'text',
  name: text,
  frame: { x: 15, y, w: 360, h: 30 },
  textLayer: textOf(text),
  style: { text: { size: 18, weight: 700, font: { kind: 'theme', role: 'heading' } } },
});

function build(): ProjectDocument {
  // A screen holds at most 100 blocks (with captions), so the gallery is two screens shown one under another.
  const screens: Array<{ id: string; name: string; height: number; blocks: BlockInput[] }> = [];
  const sections: Array<[string, string, Style['fills']]> = [
    ['gradient', 'Формы с градиентом и пунктиром', gradient],
    ['foto', 'Формы с фото и тенью', photo],
    ['gif', 'Формы с GIF и обводкой точками', gif],
  ];
  let blocks: BlockInput[] = [];
  let y = 16;
  for (const [prefix, title, fills] of sections) {
    blocks.push(heading(`zag-${prefix}`, title, y));
    const styled: Array<[string, Style]> = SHAPES.map(([label, shape]) => [
      label,
      {
        shape,
        fills,
        ...(prefix === 'gradient' ? { stroke: { width: 2, style: 'dashed', align: 'center', paint: { kind: 'solid', color: { token: 'text' } } } } : {}),
        ...(prefix === 'foto' ? { shadows: [{ x: 0, y: 6, blur: 12, spread: 0, color: { hex: '#00000059' } }] } : {}),
        ...(prefix === 'gif' ? { stroke: { width: 3, style: 'dotted', align: 'inside', paint: { kind: 'solid', color: { hex: '#FFFFFF' } } } } : {}),
      },
    ]);
    const g = grid(styled, y + 40, prefix);
    blocks.push(...g.blocks);
    y = g.bottom + 10;
    if (prefix === 'foto') {
      screens.push({ id: 'galereya-1', name: 'Формы 1', height: y, blocks });
      blocks = [];
      y = 16;
    }
  }
  blocks.push(heading('zag-varianty', 'Скругление, обводка, тени, маски, 3D', y));
  const v = grid(VARIANTS, y + 40, 'var');
  blocks.push(...v.blocks);
  screens.push({ id: 'galereya-2', name: 'Формы 2', height: v.bottom + 20, blocks });
  return ProjectDocument.parse({ schemaVersion: 1, meta: { title: 'Галерея форм' }, screens });
}

/** Service gallery of P1.6: every shape with gradient, photo and GIF fills, strokes, shadows, masks and 3D. */
export const SHAPES_GALLERY = build();
