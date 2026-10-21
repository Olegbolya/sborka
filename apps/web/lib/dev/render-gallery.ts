import { type BLOCK_STATES, BLOCK_TYPE_IDS, BLOCK_TYPES, type Block, Block as BlockSchema, type BlockInput, type BlockType, ProjectDocument, textOf } from '@blokum/schema';

type Style = NonNullable<BlockInput['style']>;

/** Every state of S-15 looks different, so the grid shows that each one applies to every type. */
const STATES: NonNullable<BlockInput['states']> = {
  hover: { stroke: { width: 2, paint: { kind: 'solid', color: { token: 'accent' } } } },
  pressed: { effects: { opacity: 0.75 }, transform3d: { rotateX: 12 } },
  selected: { stroke: { width: 3, paint: { kind: 'solid', color: { token: 'primary' } } }, glow: { color: { token: 'primary', alpha: 0.5 }, size: 8 } },
  correct: { fills: [{ kind: 'solid', color: { token: 'success', alpha: 0.25 } }], stroke: { width: 3, paint: { kind: 'solid', color: { token: 'success' } } } },
  wrong: { fills: [{ kind: 'solid', color: { token: 'error', alpha: 0.2 } }], stroke: { width: 3, paint: { kind: 'solid', color: { token: 'error' } } } },
  disabled: { effects: { opacity: 0.45 }, filters: { grayscale: 1 } },
  dragging: { shadows: [{ x: 0, y: 12, blur: 24, color: { hex: '#00000059' } }] },
  overZone: { stroke: { width: 3, style: 'dashed', paint: { kind: 'solid', color: { token: 'accent' } } } },
};

export const STATE_LABELS: Record<(typeof BLOCK_STATES)[number] | 'normal', string> = {
  normal: 'Обычное',
  hover: 'Наведение',
  pressed: 'Нажато',
  selected: 'Выбрано',
  correct: 'Правильно',
  wrong: 'Неправильно',
  disabled: 'Недоступно',
  dragging: 'Перетаскивается',
  overZone: 'Над зоной',
};

export const BLOCK_LABELS: Record<BlockType, string> = {
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

const card: Style = { radius: { tl: 14, tr: 14, br: 14, bl: 14 }, fills: [{ kind: 'solid', color: { token: 'surface' } }], padding: { t: 10, r: 12, b: 10, l: 12 }, text: { size: 16, paint: { kind: 'solid', color: { token: 'text' } } } };
const option = (id: string, label: string, y: number): BlockInput => ({
  id,
  type: 'shape',
  name: label,
  frame: { x: 0, y, w: 326, h: 52 },
  style: { ...card, stroke: { width: 1, paint: { kind: 'solid', color: { token: 'muted', alpha: 0.6 } } }, text: { size: 16, verticalAlign: 'middle', paint: { kind: 'solid', color: { token: 'text' } } } },
  states: { selected: { fills: [{ kind: 'solid', color: { token: 'primary' } }], text: { size: 16, verticalAlign: 'middle', weight: 700, paint: { kind: 'solid', color: { hex: '#FFFFFF' } } } } },
  textLayer: textOf(label),
});

/** A realistic live block of each type (P1.8): with files, options, variables and sensible sizes. */
function liveBlock(type: BlockType): { block: BlockInput; h: number } {
  const id = `zhivoi-${type}`.toLowerCase();
  const base = { id, name: BLOCK_LABELS[type], frame: { x: 32, y: 16, w: 326, h: 120 } };
  switch (type) {
    case 'text':
      return { h: 120, block: { ...base, type, style: card, textLayer: { paragraphs: [{ kind: 'p', runs: [{ t: 'Текст с ', b: false }, { t: 'жирным', b: true }, { t: ', ' }, { t: 'курсивом', i: true }, { t: ' и ' }, { t: 'ссылкой', href: 'https://blokum.ru', u: true }, { t: ' 🎄' }] }, { kind: 'bullet', runs: [{ t: 'Список — тоже' }] }] } } };
    case 'image':
      return { h: 200, block: { ...base, type, frame: { ...base.frame, h: 200 }, style: { radius: { tl: 16, tr: 16, br: 16, bl: 16 } }, a11y: { alt: 'Зимний вечер: луна над ёлками' }, props: { media: { source: 'media', id: 'dev-foto-zima' }, caption: 'Подпись к фото' } } };
    case 'gif':
      return { h: 180, block: { ...base, type, frame: { x: 105, y: 16, w: 180, h: 180 }, style: { radius: { tl: 90, tr: 90, br: 90, bl: 90 } }, a11y: { alt: 'Снегопад' }, props: { media: { source: 'media', id: 'dev-gif-sneg' } } } };
    case 'video':
      return { h: 245, block: { ...base, type, frame: { ...base.frame, h: 245 }, style: { radius: { tl: 12, tr: 12, br: 12, bl: 12 }, media: { controls: true } }, a11y: { alt: 'Видео: падает снег' }, props: { media: { source: 'media', id: 'dev-video-sneg' } } } };
    case 'audio':
      return { h: 72, block: { ...base, type, name: 'Бубенцы', frame: { x: 159, y: 16, w: 72, h: 72 }, style: { shape: { kind: 'ellipse' }, fills: [{ kind: 'solid', color: { token: 'primary' } }], text: { paint: { kind: 'solid', color: { hex: '#FFFFFF' } } }, media: { autoplay: false } }, props: { media: { source: 'media', id: 'dev-zvuk-bubency' } } } };
    case 'shape':
      return { h: 140, block: { ...base, type, frame: { x: 125, y: 16, w: 140, h: 140 }, style: { shape: { kind: 'star', points: 5, depth: 0.5 }, fills: [{ kind: 'linear', angle: 135, stops: [{ offset: 0, color: { token: 'primary' } }, { offset: 1, color: { token: 'accent' } }] }] }, a11y: { alt: 'Звезда' } } };
    case 'animation':
      return { h: 160, block: { ...base, type, frame: { x: 115, y: 16, w: 160, h: 160 }, a11y: { alt: 'Прыгающий снежок' }, props: { media: { source: 'media', id: 'dev-lottie-snezhok' } } } };
    case 'timer':
      return { h: 64, block: { ...base, type, frame: { x: 115, y: 16, w: 160, h: 64 }, style: { ...card, text: { size: 32, weight: 800, align: 'center', paint: { kind: 'solid', color: { token: 'text' } } } }, props: { seconds: 90, format: 'mm:ss' } } };
    case 'progress':
      return { h: 14, block: { ...base, type, frame: { ...base.frame, h: 14 }, style: { radius: { tl: 7, tr: 7, br: 7, bl: 7 } }, props: { variant: 'bar' } } };
    case 'singleChoice':
    case 'multiChoice':
      return {
        h: 180,
        block: {
          ...base,
          type,
          frame: { ...base.frame, h: 180 },
          props: { options: ['Ёлка', 'Снеговик', 'Подарки'].map((_, i) => ({ id: `${id}-otvet${i}`, blockId: `${id}-variant${i}` })), ...(type === 'multiChoice' ? { maxSelected: 2 } : {}) },
          children: ['Ёлка', 'Снеговик', 'Подарки'].map((l, i) => option(`${id}-variant${i}`, l, i * 62)),
        },
      };
    case 'textInput':
      return { h: 52, block: { ...base, type, name: 'Как зовут оленя', frame: { ...base.frame, h: 52 }, style: { ...card, stroke: { width: 1, paint: { kind: 'solid', color: { token: 'muted' } } }, text: { size: 16, verticalAlign: 'middle', paint: { kind: 'solid', color: { token: 'text' } } } }, props: { placeholder: 'Например, Рудольф' } } };
    case 'scale':
      return { h: 56, block: { ...base, type, name: 'Оценка праздника', frame: { ...base.frame, h: 56 }, style: { text: { paint: { kind: 'solid', color: { token: 'text' } } } }, props: { min: 1, max: 5 } } };
    case 'swipe':
      return { h: 260, block: { ...base, type, name: 'Любите снег?', frame: { x: 45, y: 16, w: 300, h: 260 }, style: { ...card, text: { size: 22, weight: 700, align: 'center', verticalAlign: 'middle', paint: { kind: 'solid', color: { token: 'text' } } } }, textLayer: textOf('Любите снег?') } };
    case 'ranking':
      return { h: 170, block: { ...base, type, name: 'Порядок подарков', frame: { ...base.frame, h: 170 }, style: { text: { size: 15, paint: { kind: 'solid', color: { token: 'text' } } } }, props: { items: [{ id: 'punkt-sanki', label: 'Санки' }, { id: 'punkt-konki', label: 'Коньки' }, { id: 'punkt-lyzhi', label: 'Лыжи' }] } } };
    case 'date':
      return { h: 52, block: { ...base, type, name: 'Дата праздника', frame: { ...base.frame, h: 52 }, style: { ...card, stroke: { width: 1, paint: { kind: 'solid', color: { token: 'muted' } } }, text: { size: 16, verticalAlign: 'middle', paint: { kind: 'solid', color: { token: 'text' } } } }, props: { min: '2026-12-01', max: '2027-01-14' } } };
    case 'button':
      return { h: 56, block: { ...base, type, frame: { x: 75, y: 16, w: 240, h: 56 }, textLayer: textOf('Дальше'), rules: [{ id: `${id}-pravilo`, when: { kind: 'tap', source: { kind: 'block', blockId: id } }, do: [{ kind: 'effect', effect: 'confetti', intensity: 1 }] }] } };
    case 'contacts':
      return { h: 200, block: { ...base, type, frame: { ...base.frame, h: 200 }, style: { text: { size: 15, paint: { kind: 'solid', color: { token: 'text' } } } }, props: { fields: ['name', 'phone', 'email'] } } };
    case 'consent':
      return { h: 48, block: { ...base, type, frame: { ...base.frame, h: 48 }, style: { text: { size: 14, paint: { kind: 'solid', color: { token: 'text' } } } } } };
    case 'container':
      return {
        h: 90,
        block: {
          ...base,
          type,
          frame: { ...base.frame, h: 90 },
          style: { ...card, layout: { mode: 'row', gap: 10, align: 'center', justify: 'center' } },
          children: ['🎁', '⛄', '🎄'].map((e, i) => ({ id: `${id}-kartochka${i}`, type: 'shape' as const, name: `Карточка ${i + 1}`, frame: { x: 0, y: 0, w: 64, h: 64 }, style: { radius: { tl: 12, tr: 12, br: 12, bl: 12 }, fills: [{ kind: 'solid' as const, color: { token: 'accent', alpha: 0.2 } }], text: { size: 30, align: 'center' as const, verticalAlign: 'middle' as const } }, textLayer: textOf(e) })),
        },
      };
    case 'zone':
      return { h: 110, block: { ...base, type, frame: { x: 95, y: 16, w: 200, h: 110 }, style: { radius: { tl: 16, tr: 16, br: 16, bl: 16 } }, props: { visible: true } } };
    case 'value':
      return { h: 56, block: { ...base, type, frame: { x: 95, y: 16, w: 200, h: 56 }, style: { text: { size: 30, align: 'center', paint: { kind: 'solid', color: { token: 'error' } } } }, a11y: { label: 'Жизни' }, props: { variableId: 'zhizni-galerei', format: 'icons', icon: '❤', max: 5 } } };
  }
}

export interface GallerySection {
  type: BlockType;
  id: string;
  label: string;
  doc: ProjectDocument;
  /** The same block as a small card for the grid of states. */
  stateBlock: Block;
}

const STATE_CELL = { w: 110, h: 80 };

/** Built on the server (nested blocks of questions get random ids, the browser must get the same document). */
export function buildRenderGallery(): GallerySection[] {
  const ordered = [...BLOCK_TYPES].sort((a, b) => BLOCK_TYPE_IDS[a].localeCompare(BLOCK_TYPE_IDS[b]));
  return ordered.map((type) => {
    const { block, h } = liveBlock(type);
    const doc = ProjectDocument.parse({
      schemaVersion: 1,
      meta: { title: `Галерея: ${BLOCK_LABELS[type]}` },
      variables: [{ id: 'zhizni-galerei', name: 'жизни', type: 'number', initial: 3 }],
      screens: [{ id: `ekran-${type}`.toLowerCase(), name: BLOCK_LABELS[type], height: Math.max(400, h + 32), background: [{ kind: 'none' }], blocks: [{ ...block, states: { ...STATES, ...(block.states ?? {}) } }] }],
    });
    // The small copy for the grid: the same block (options and nested blocks included) with its own ids.
    const copy = JSON.parse(JSON.stringify({ ...block, frame: { x: 0, y: 0, ...STATE_CELL }, states: STATES }).replaceAll('zhivoi-', 'sostoyanie-')) as BlockInput;
    const stateBlock = BlockSchema.parse(copy);
    return { type, id: BLOCK_TYPE_IDS[type], label: BLOCK_LABELS[type], doc, stateBlock };
  });
}

export const STATE_GRID_CELL = STATE_CELL;
