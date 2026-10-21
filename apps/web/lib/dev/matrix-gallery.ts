import { BLOCK_TYPE_IDS, BLOCK_TYPES, type BlockInput, type BlockType, ProjectDocument, createBlock, textOf } from '@blokum/schema';

type Style = NonNullable<BlockInput['style']>;

/** Key properties of the grid (P1.5): each column sets one, on every type of block. */
export const MATRIX_COLUMNS: Array<{ id: string; label: string; style: Style }> = [
  { id: 'forma', label: 'Форма', style: { shape: { kind: 'star', points: 6, depth: 0.5 }, fills: [{ kind: 'solid', color: { token: 'accent' } }] } },
  { id: 'zalivka', label: 'Заливка', style: { fills: [{ kind: 'linear', angle: 135, stops: [{ offset: 0, color: { token: 'primary' } }, { offset: 1, color: { token: 'accent' } }] }] } },
  { id: 'obvodka', label: 'Обводка', style: { radius: { tl: 14, tr: 14, br: 14, bl: 14 }, fills: [{ kind: 'solid', color: { token: 'surface' } }], stroke: { width: 3, style: 'dashed', paint: { kind: 'solid', color: { token: 'primary' } } } } },
  { id: 'ten', label: 'Тень', style: { radius: { tl: 10, tr: 10, br: 10, bl: 10 }, fills: [{ kind: 'solid', color: { token: 'surface' } }], shadows: [{ x: 0, y: 6, blur: 12, color: { hex: '#00000059' } }], glow: { color: { token: 'accent', alpha: 0.6 }, size: 6 } } },
  { id: 'tri-d', label: '3D', style: { radius: { tl: 8, tr: 8, br: 8, bl: 8 }, fills: [{ kind: 'media', media: { source: 'media', id: 'dev-foto-zima' }, fit: 'cover' }], transform3d: { rotateX: 25, rotateY: -25, perspective: 300 } } },
  { id: 'maska', label: 'Маска', style: { fills: [{ kind: 'media', media: { source: 'media', id: 'dev-gif-sneg' }, fit: 'cover' }], mask: { fade: { edges: ['bottom', 'right'], size: 0.45 } }, filters: { saturate: 1.6, hueRotate: 30 } } },
];

const LABELS: Record<BlockType, string> = {
  text: 'Текст',
  image: 'Изображение',
  gif: 'GIF',
  video: 'Видео',
  audio: 'Звук',
  shape: 'Фигура',
  animation: 'Анимация',
  timer: 'Таймер',
  progress: 'Прогресс',
  singleChoice: 'Один ответ',
  multiChoice: 'Несколько ответов',
  textInput: 'Текстовый ответ',
  scale: 'Шкала',
  swipe: 'Свайп-карточка',
  ranking: 'Ранжирование',
  date: 'Дата',
  button: 'Кнопка',
  contacts: 'Контакты',
  consent: 'Согласие',
  container: 'Контейнер',
  zone: 'Зона',
  value: 'Значение',
};

const CELL = 56;
const GAP = 8;
const LEFT = 15;
const ROW = 92;

/** Types per screen: a screen holds at most 100 blocks, nested ones included. */
const TYPES_PER_SCREEN = 4;
/** Rows go in the order of the specification: B-01…B-23. */
const ORDERED = [...BLOCK_TYPES].sort((a, b) => BLOCK_TYPE_IDS[a].localeCompare(BLOCK_TYPE_IDS[b]));

/** The grid «все блоки × ключевые свойства»: one row per block type, one column per property. */
export function buildMatrixDocument(): ProjectDocument {
  const screens: unknown[] = [];
  for (let start = 0; start < ORDERED.length; start += TYPES_PER_SCREEN) {
    const types = ORDERED.slice(start, start + TYPES_PER_SCREEN);
    const n = screens.length;
    const blocks: BlockInput[] = MATRIX_COLUMNS.map((c, i) => ({
      id: `kolonka-${n}-${c.id}`,
      type: 'text',
      name: c.label,
      frame: { x: LEFT + i * (CELL + GAP), y: 12, w: CELL + 4, h: 18 },
      style: { text: { size: 11, weight: 700, paint: { kind: 'solid', color: { token: 'muted' } } } },
      textLayer: textOf(c.label),
    }));
    types.forEach((type, row) => {
      const top = 40 + row * ROW;
      blocks.push({
        id: `podpis-${type}`.toLowerCase(),
        type: 'text',
        name: LABELS[type],
        frame: { x: LEFT, y: top, w: 360, h: 18 },
        style: { text: { size: 12, weight: 700, paint: { kind: 'solid', color: { token: 'text' } } } },
        textLayer: textOf(`${BLOCK_TYPE_IDS[type]} · ${LABELS[type]}`),
      });
      MATRIX_COLUMNS.forEach((column, col) => {
        blocks.push(
          createBlock(type, {
            id: `m-${type}-${column.id}`.toLowerCase(),
            name: `${LABELS[type]} · ${column.label}`,
            frame: { x: LEFT + col * (CELL + GAP), y: top + 22, w: CELL, h: CELL },
            style: { ...column.style, text: { size: 9, weight: 700, align: 'center', verticalAlign: 'middle' } },
            textLayer: textOf(LABELS[type]),
          }),
        );
      });
    });
    screens.push({ id: `matrica-${n}`, name: `Матрица ${n + 1}`, height: Math.max(400, 40 + types.length * ROW + 10), blocks });
  }
  return ProjectDocument.parse({ schemaVersion: 1, meta: { title: 'Матрица свойств' }, screens });
}
