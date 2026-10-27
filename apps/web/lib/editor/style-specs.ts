import { type StyleGroup } from './style-edit';

/**
 * What the inspector can change in each style group (S-02…S-11, S-18…S-20). The table is the interface and, at the same
 * time, the list the test compares with the keys of the schema (P3.4): a property that the schema has and the table
 * lacks fails the test.
 */
export type Field =
  | {
      t: 'num';
      key: string;
      label: string;
      min?: number;
      max?: number;
      step?: number;
      scale?: number;
      suffix?: string;
      slider?: boolean;
    }
  | { t: 'select'; key: string; label: string; options: ReadonlyArray<readonly [string, string]> }
  | { t: 'bool'; key: string; label: string }
  | { t: 'color'; key: string; label: string }
  /** A point inside the block, 0…1 on each axis, shown in percent: one object `{x, y}` or two fields (`keys`). */
  | { t: 'point'; key: string; label: string; keys?: readonly [string, string] }
  | { t: 'text'; key: string; label: string; max?: number }
  /** A reference to a file of the media library. */
  | { t: 'media'; key: string; label: string; kinds?: ReadonlyArray<'IMAGE' | 'GIF' | 'VIDEO' | 'AUDIO' | 'LOTTIE'> }
  /** Several of top / right / bottom / left. */
  | { t: 'edges'; key: string; label: string }
  /** Several of a fixed set of values (at least one). */
  | { t: 'multi'; key: string; label: string; options: ReadonlyArray<readonly [string, string]> }
  /** One of the variables of the document. */
  | { t: 'variable'; key: string; label: string; optional?: boolean }
  /** The options of a choice question: each is a block of its own (B-11, B-12). */
  | { t: 'choiceOptions'; key: string }
  /** One of the screens of the document. */
  | { t: 'screen'; key: string; label: string }
  /** A list of items with their own fields (gradient stops, fill layers, shadows). */
  | { t: 'list'; key: string; label: string; min: number; max: number; make: () => unknown; item: Field[] }
  /** A list of numbers (a dash pattern). */
  | { t: 'numlist'; key: string; label: string; max: number; min: number; maxValue: number }
  /** A part that may be absent (a shadow of the text, the outline): a switch and, when on, its fields. */
  | { t: 'optional'; key: string; label: string; make: () => unknown; fields: Field[] }
  /** An object that is one of several kinds: a selector by `kind` and the fields of the chosen kind. */
  | {
      t: 'variant';
      key: string;
      label: string;
      variants: Record<string, { title: string; make: () => unknown; fields: Field[] }>;
    };

const SOLID = { kind: 'solid', color: { token: 'primary', alpha: 1 } };
const STOPS = [
  { offset: 0, color: { token: 'primary', alpha: 1 } },
  { offset: 1, color: { token: 'accent', alpha: 1 } },
];
/** Stops of a gradient: one stop. */
export const STOP_FIELDS: Field[] = [
  { t: 'num', key: 'offset', label: 'Положение', min: 0, max: 1, step: 1, scale: 100, suffix: '%' },
  { t: 'color', key: 'color', label: 'Цвет' },
];
const stopsField: Field = {
  t: 'list',
  key: 'stops',
  label: 'Точки градиента',
  min: 2,
  max: 10,
  make: () => ({ offset: 1, color: { token: 'accent', alpha: 1 } }),
  item: STOP_FIELDS,
};

const PAINT_FIELDS = (media: boolean): Record<string, { title: string; make: () => unknown; fields: Field[] }> => ({
  solid: { title: 'Цвет', make: () => ({ ...SOLID }), fields: [{ t: 'color', key: 'color', label: 'Цвет' }] },
  linear: {
    title: 'Линейный градиент',
    make: () => ({ kind: 'linear', angle: 180, stops: STOPS }),
    fields: [{ t: 'num', key: 'angle', label: 'Угол', min: 0, max: 360, step: 1, suffix: '°' }, stopsField],
  },
  radial: {
    title: 'Радиальный градиент',
    make: () => ({ kind: 'radial', cx: 0.5, cy: 0.5, stops: STOPS }),
    fields: [{ t: 'point', key: 'center', label: 'Центр', keys: ['cx', 'cy'] }, stopsField],
  },
  conic: {
    title: 'Конический градиент',
    make: () => ({ kind: 'conic', angle: 0, cx: 0.5, cy: 0.5, stops: STOPS }),
    fields: [
      { t: 'num', key: 'angle', label: 'Угол', min: 0, max: 360, step: 1, suffix: '°' },
      { t: 'point', key: 'center', label: 'Центр', keys: ['cx', 'cy'] },
      stopsField,
    ],
  },
  ...(media
    ? {
        media: {
          title: 'Фото, GIF или видео',
          make: () => ({
            kind: 'media',
            media: { source: 'media', id: 'media_unset' },
            fit: 'cover',
            focal: { x: 0.5, y: 0.5 },
            scale: 1,
          }),
          fields: [
            { t: 'media', key: 'media', label: 'Файл' },
            {
              t: 'select',
              key: 'fit',
              label: 'Вписывание',
              options: [
                ['cover', 'Заполнить'],
                ['contain', 'Вписать'],
                ['fill', 'Растянуть'],
                ['tile', 'Замостить'],
              ],
            },
            { t: 'point', key: 'focal', label: 'Фокус-точка' },
            { t: 'num', key: 'scale', label: 'Масштаб', min: 0.1, max: 10, step: 0.1 },
          ],
        },
      }
    : {}),
});

const SHADOW_FIELDS: Field[] = [
  { t: 'num', key: 'x', label: 'Смещение по X', min: -500, max: 500, step: 1 },
  { t: 'num', key: 'y', label: 'Смещение по Y', min: -500, max: 500, step: 1 },
  { t: 'num', key: 'blur', label: 'Размытие', min: 0, max: 500, step: 1 },
  { t: 'num', key: 'spread', label: 'Растяжение', min: -200, max: 200, step: 1 },
  { t: 'color', key: 'color', label: 'Цвет' },
  { t: 'bool', key: 'inset', label: 'Внутренняя' },
];

export const EDGES: ReadonlyArray<readonly [string, string]> = [
  ['top', 'Сверху'],
  ['right', 'Справа'],
  ['bottom', 'Снизу'],
  ['left', 'Слева'],
];

export const SHAPE_VARIANTS: Record<string, { title: string; make: () => unknown; fields: Field[] }> = {
  rect: { title: 'Прямоугольник', make: () => ({ kind: 'rect' }), fields: [] },
  pill: { title: 'Капсула', make: () => ({ kind: 'pill' }), fields: [] },
  ellipse: { title: 'Круг / эллипс', make: () => ({ kind: 'ellipse' }), fields: [] },
  polygon: {
    title: 'Многоугольник',
    make: () => ({ kind: 'polygon', sides: 6, cornerRadius: 0 }),
    fields: [
      { t: 'num', key: 'sides', label: 'Сторон', min: 3, max: 24, step: 1 },
      {
        t: 'num',
        key: 'cornerRadius',
        label: 'Скругление вершин',
        min: 0,
        max: 0.5,
        step: 0.01,
        scale: 100,
        suffix: '%',
      },
    ],
  },
  star: {
    title: 'Звезда',
    make: () => ({ kind: 'star', points: 5, depth: 0.5, cornerRadius: 0 }),
    fields: [
      { t: 'num', key: 'points', label: 'Лучей', min: 3, max: 48, step: 1 },
      { t: 'num', key: 'depth', label: 'Глубина', min: 0.05, max: 0.95, step: 0.01, scale: 100, suffix: '%' },
      {
        t: 'num',
        key: 'cornerRadius',
        label: 'Скругление вершин',
        min: 0,
        max: 0.5,
        step: 0.01,
        scale: 100,
        suffix: '%',
      },
    ],
  },
  heart: { title: 'Сердце', make: () => ({ kind: 'heart' }), fields: [] },
  blob: {
    title: 'Клякса',
    make: () => ({ kind: 'blob', seed: 1, complexity: 6 }),
    fields: [
      { t: 'num', key: 'seed', label: 'Зерно', min: 0, max: 2147483647, step: 1 },
      { t: 'num', key: 'complexity', label: 'Сложность', min: 3, max: 16, step: 1 },
    ],
  },
  bubble: {
    title: 'Облачко-реплика',
    make: () => ({ kind: 'bubble', tail: { x: 0.2, y: 1 }, tailWidth: 0.15 }),
    fields: [
      { t: 'point', key: 'tail', label: 'Хвостик' },
      {
        t: 'num',
        key: 'tailWidth',
        label: 'Ширина хвостика',
        min: 0.05,
        max: 0.5,
        step: 0.01,
        scale: 100,
        suffix: '%',
      },
    ],
  },
  arrow: {
    title: 'Стрелка',
    make: () => ({ kind: 'arrow', thickness: 0.4, head: 'triangle' }),
    fields: [
      { t: 'num', key: 'thickness', label: 'Толщина', min: 0.1, max: 0.9, step: 0.01, scale: 100, suffix: '%' },
      {
        t: 'select',
        key: 'head',
        label: 'Наконечник',
        options: [
          ['triangle', 'Треугольник'],
          ['round', 'Круглый'],
          ['chevron', 'Уголок'],
        ],
      },
    ],
  },
  wave: {
    title: 'Волна / зигзаг',
    make: () => ({ kind: 'wave', amplitude: 0.1, frequency: 6, zigzag: false, edges: ['bottom'] }),
    fields: [
      { t: 'num', key: 'amplitude', label: 'Размах', min: 0, max: 0.5, step: 0.01, scale: 100, suffix: '%' },
      { t: 'num', key: 'frequency', label: 'Частота', min: 1, max: 40, step: 1 },
      { t: 'bool', key: 'zigzag', label: 'Зигзаг' },
      { t: 'edges', key: 'edges', label: 'Края' },
    ],
  },
  path: {
    title: 'Свой контур',
    make: () => ({ kind: 'path', d: 'M 0 0 L 100 0 L 100 100 L 0 100 Z', closed: true }),
    fields: [
      { t: 'text', key: 'd', label: 'Контур (SVG)', max: 20000 },
      { t: 'bool', key: 'closed', label: 'Замкнутый' },
    ],
  },
};

const TEXT_PAINT_VARIANTS = PAINT_FIELDS(true);

/** Style groups and what is changed in each; the keys are the keys of `BlockStyle`. */
export const GROUP_SPECS: Record<StyleGroup, { title: string; fields: Field[] }> = {
  autoHeight: { title: 'Размер', fields: [{ t: 'bool', key: '', label: 'Автовысота по содержимому' }] },
  lockAspect: { title: 'Размер', fields: [{ t: 'bool', key: '', label: 'Сохранять пропорции' }] },
  shape: { title: 'Форма', fields: [{ t: 'variant', key: '', label: 'Форма', variants: SHAPE_VARIANTS }] },
  radius: {
    title: 'Скругление',
    fields: [
      {
        t: 'select',
        key: 'unit',
        label: 'Единицы',
        options: [
          ['u', 'Единицы'],
          ['%', 'Проценты'],
        ],
      },
      { t: 'num', key: 'tl', label: 'Левый верхний угол', min: 0, max: 1500, step: 1 },
      { t: 'num', key: 'tr', label: 'Правый верхний угол', min: 0, max: 1500, step: 1 },
      { t: 'num', key: 'br', label: 'Правый нижний угол', min: 0, max: 1500, step: 1 },
      { t: 'num', key: 'bl', label: 'Левый нижний угол', min: 0, max: 1500, step: 1 },
    ],
  },
  // Lists have their own editor: the items are described by `FILL_ITEM`/`SHADOW_ITEM` below.
  fills: {
    title: 'Заливка',
    fields: [
      {
        t: 'list',
        key: '',
        label: 'Слои заливки',
        min: 0,
        max: 4,
        make: () => ({ ...SOLID }),
        item: [
          {
            t: 'variant',
            key: '',
            label: 'Слой',
            variants: { none: { title: 'Нет', make: () => ({ kind: 'none' }), fields: [] }, ...PAINT_FIELDS(true) },
          },
        ],
      },
    ],
  },
  stroke: {
    title: 'Обводка',
    fields: [
      { t: 'num', key: 'width', label: 'Толщина', min: 0, max: 60, step: 0.5 },
      {
        t: 'select',
        key: 'style',
        label: 'Вид',
        options: [
          ['solid', 'Сплошная'],
          ['dashed', 'Пунктир'],
          ['dotted', 'Точки'],
        ],
      },
      {
        t: 'optional',
        key: 'dash',
        label: 'Свой шаблон штриха',
        make: () => [8, 4],
        fields: [{ t: 'numlist', key: '', label: 'Штрих', max: 8, min: 0, maxValue: 200 }],
      },
      { t: 'variant', key: 'paint', label: 'Краска', variants: PAINT_FIELDS(false) },
      {
        t: 'select',
        key: 'align',
        label: 'Положение',
        options: [
          ['inside', 'Внутри'],
          ['center', 'По центру'],
          ['outside', 'Снаружи'],
        ],
      },
    ],
  },
  shadows: {
    title: 'Тени',
    fields: [
      {
        t: 'list',
        key: '',
        label: 'Тени',
        min: 0,
        max: 6,
        make: () => ({ x: 0, y: 4, blur: 12, spread: 0, color: { hex: '#00000033' }, inset: false }),
        item: SHADOW_FIELDS,
      },
    ],
  },
  glow: {
    title: 'Свечение',
    fields: [
      { t: 'color', key: 'color', label: 'Цвет' },
      { t: 'num', key: 'size', label: 'Размер', min: 0, max: 200, step: 1 },
    ],
  },
  effects: {
    title: 'Эффекты',
    fields: [
      {
        t: 'num',
        key: 'opacity',
        label: 'Прозрачность',
        min: 0,
        max: 1,
        step: 1,
        scale: 100,
        suffix: '%',
        slider: true,
      },
      { t: 'num', key: 'blur', label: 'Размытие', min: 0, max: 60, step: 1, slider: true },
      { t: 'num', key: 'backdropBlur', label: 'Размытие фона', min: 0, max: 60, step: 1, slider: true },
      {
        t: 'select',
        key: 'blendMode',
        label: 'Режим наложения',
        options: [
          ['normal', 'Обычный'],
          ['multiply', 'Умножение'],
          ['screen', 'Экран'],
          ['overlay', 'Перекрытие'],
          ['darken', 'Затемнение'],
          ['lighten', 'Осветление'],
          ['color-dodge', 'Осветление основы'],
          ['difference', 'Разница'],
        ],
      },
    ],
  },
  filters: {
    title: 'Фильтры',
    fields: [
      { t: 'num', key: 'brightness', label: 'Яркость', min: 0, max: 3, step: 1, scale: 100, suffix: '%', slider: true },
      { t: 'num', key: 'contrast', label: 'Контраст', min: 0, max: 3, step: 1, scale: 100, suffix: '%', slider: true },
      {
        t: 'num',
        key: 'saturate',
        label: 'Насыщенность',
        min: 0,
        max: 3,
        step: 1,
        scale: 100,
        suffix: '%',
        slider: true,
      },
      {
        t: 'num',
        key: 'grayscale',
        label: 'Чёрно-белый',
        min: 0,
        max: 1,
        step: 1,
        scale: 100,
        suffix: '%',
        slider: true,
      },
      { t: 'num', key: 'sepia', label: 'Сепия', min: 0, max: 1, step: 1, scale: 100, suffix: '%', slider: true },
      { t: 'num', key: 'hueRotate', label: 'Поворот оттенка', min: -180, max: 180, step: 1, suffix: '°', slider: true },
      { t: 'num', key: 'invert', label: 'Инверсия', min: 0, max: 1, step: 1, scale: 100, suffix: '%', slider: true },
    ],
  },
  padding: {
    title: 'Отступы',
    fields: [
      { t: 'num', key: 't', label: 'Сверху', min: 0, max: 500, step: 1 },
      { t: 'num', key: 'r', label: 'Справа', min: 0, max: 500, step: 1 },
      { t: 'num', key: 'b', label: 'Снизу', min: 0, max: 500, step: 1 },
      { t: 'num', key: 'l', label: 'Слева', min: 0, max: 500, step: 1 },
    ],
  },
  text: {
    title: 'Текст',
    fields: [
      {
        t: 'variant',
        key: 'font',
        label: 'Шрифт',
        variants: {
          theme: {
            title: 'Из темы',
            make: () => ({ kind: 'theme', role: 'body' }),
            fields: [
              {
                t: 'select',
                key: 'role',
                label: 'Роль',
                options: [
                  ['heading', 'Заголовок'],
                  ['body', 'Основной'],
                  ['accent', 'Акцентный'],
                ],
              },
            ],
          },
          system: {
            title: 'Системный',
            make: () => ({ kind: 'system', name: 'sans' }),
            fields: [
              {
                t: 'select',
                key: 'name',
                label: 'Гарнитура',
                options: [
                  ['sans', 'Без засечек'],
                  ['serif', 'С засечками'],
                  ['mono', 'Моноширинный'],
                  ['rounded', 'Округлый'],
                ],
              },
            ],
          },
          font: {
            title: 'Свой шрифт',
            make: () => ({ kind: 'font', id: 'font_unset' }),
            fields: [{ t: 'text', key: 'id', label: 'Идентификатор шрифта', max: 64 }],
          },
        },
      },
      { t: 'num', key: 'size', label: 'Размер', min: 6, max: 400, step: 1 },
      {
        t: 'select',
        key: 'weight',
        label: 'Начертание',
        options: [
          ['100', '100 · тонкое'],
          ['200', '200'],
          ['300', '300 · лёгкое'],
          ['400', '400 · обычное'],
          ['500', '500'],
          ['600', '600 · полужирное'],
          ['700', '700 · жирное'],
          ['800', '800'],
          ['900', '900 · сверхжирное'],
        ],
      },
      { t: 'bool', key: 'italic', label: 'Курсив' },
      { t: 'num', key: 'lineHeight', label: 'Межстрочный интервал', min: 0.5, max: 4, step: 0.05 },
      { t: 'num', key: 'letterSpacing', label: 'Межбуквенный интервал', min: -0.5, max: 2, step: 0.01 },
      {
        t: 'select',
        key: 'align',
        label: 'По горизонтали',
        options: [
          ['left', 'Слева'],
          ['center', 'По центру'],
          ['right', 'Справа'],
          ['justify', 'По ширине'],
        ],
      },
      {
        t: 'select',
        key: 'verticalAlign',
        label: 'По вертикали',
        options: [
          ['top', 'Сверху'],
          ['middle', 'По середине'],
          ['bottom', 'Снизу'],
        ],
      },
      {
        t: 'select',
        key: 'transform',
        label: 'Регистр',
        options: [
          ['none', 'Как набрано'],
          ['uppercase', 'ВЕРХНИЙ'],
          ['lowercase', 'нижний'],
          ['capitalize', 'Каждое Слово'],
        ],
      },
      { t: 'variant', key: 'paint', label: 'Краска текста', variants: TEXT_PAINT_VARIANTS },
      {
        t: 'optional',
        key: 'shadow',
        label: 'Тень текста',
        make: () => ({ x: 0, y: 2, blur: 4, spread: 0, color: { hex: '#00000066' }, inset: false }),
        fields: SHADOW_FIELDS,
      },
      {
        t: 'optional',
        key: 'outline',
        label: 'Контур текста',
        make: () => ({ width: 1, color: { token: 'text', alpha: 1 } }),
        fields: [
          { t: 'num', key: 'width', label: 'Толщина', min: 0, max: 20, step: 0.5 },
          { t: 'color', key: 'color', label: 'Цвет' },
        ],
      },
      {
        t: 'variant',
        key: 'path',
        label: 'Текст по контуру',
        variants: {
          none: { title: 'Нет', make: () => ({ kind: 'none', curvature: 0.5 }), fields: [] },
          circle: {
            title: 'По кругу',
            make: () => ({ kind: 'circle', curvature: 0.5 }),
            fields: [{ t: 'num', key: 'curvature', label: 'Изгиб', min: -1, max: 1, step: 0.05 }],
          },
          arc: {
            title: 'По дуге',
            make: () => ({ kind: 'arc', curvature: 0.5 }),
            fields: [{ t: 'num', key: 'curvature', label: 'Изгиб', min: -1, max: 1, step: 0.05 }],
          },
        },
      },
    ],
  },
  media: {
    title: 'Медиа',
    fields: [
      {
        t: 'select',
        key: 'fit',
        label: 'Вписывание',
        options: [
          ['cover', 'Заполнить'],
          ['contain', 'Вписать'],
          ['fill', 'Растянуть'],
        ],
      },
      {
        t: 'optional',
        key: 'crop',
        label: 'Кадрирование',
        make: () => ({ x: 0, y: 0, w: 1, h: 1 }),
        fields: [
          { t: 'num', key: 'x', label: 'Слева', min: 0, max: 1, step: 1, scale: 100, suffix: '%' },
          { t: 'num', key: 'y', label: 'Сверху', min: 0, max: 1, step: 1, scale: 100, suffix: '%' },
          { t: 'num', key: 'w', label: 'Ширина', min: 0.01, max: 1, step: 1, scale: 100, suffix: '%' },
          { t: 'num', key: 'h', label: 'Высота', min: 0.01, max: 1, step: 1, scale: 100, suffix: '%' },
        ],
      },
      { t: 'point', key: 'focal', label: 'Фокус-точка' },
      { t: 'bool', key: 'autoplay', label: 'Автозапуск' },
      { t: 'bool', key: 'muted', label: 'Без звука' },
      { t: 'bool', key: 'loop', label: 'По кругу' },
      { t: 'bool', key: 'controls', label: 'Кнопки управления' },
      {
        t: 'optional',
        key: 'poster',
        label: 'Обложка',
        make: () => ({ source: 'media', id: 'media_unset' }),
        fields: [{ t: 'media', key: '', label: 'Файл обложки' }],
      },
      { t: 'num', key: 'speed', label: 'Скорость', min: 0.25, max: 4, step: 0.25 },
    ],
  },
  transform3d: {
    title: '3D',
    fields: [
      { t: 'num', key: 'rotateX', label: 'Наклон по X', min: -80, max: 80, step: 1, suffix: '°', slider: true },
      { t: 'num', key: 'rotateY', label: 'Наклон по Y', min: -80, max: 80, step: 1, suffix: '°', slider: true },
      { t: 'num', key: 'perspective', label: 'Перспектива', min: 100, max: 5000, step: 50 },
      { t: 'point', key: 'origin', label: 'Точка опоры' },
      { t: 'bool', key: 'tiltFollow', label: 'Наклон за пальцем или курсором' },
      { t: 'num', key: 'tiltStrength', label: 'Сила наклона', min: 0, max: 40, step: 1 },
    ],
  },
  mask: {
    title: 'Маска',
    fields: [
      { t: 'bool', key: 'clipToShape', label: 'Обрезать формой блока' },
      {
        t: 'optional',
        key: 'image',
        label: 'Маска по картинке',
        make: () => ({ source: 'media', id: 'media_unset' }),
        fields: [{ t: 'media', key: '', label: 'Файл маски' }],
      },
      {
        t: 'optional',
        key: 'fade',
        label: 'Затухание краёв',
        make: () => ({ edges: ['bottom'], size: 0.2 }),
        fields: [
          { t: 'edges', key: 'edges', label: 'Края' },
          { t: 'num', key: 'size', label: 'Размер', min: 0, max: 0.5, step: 1, scale: 100, suffix: '%' },
        ],
      },
    ],
  },
  layout: {
    title: 'Раскладка вложенных блоков',
    fields: [
      {
        t: 'select',
        key: 'mode',
        label: 'Режим',
        options: [
          ['free', 'Свободно'],
          ['row', 'В строку'],
          ['column', 'В столбец'],
          ['grid', 'Сетка'],
        ],
      },
      { t: 'num', key: 'gap', label: 'Промежуток', min: 0, max: 500, step: 1 },
      {
        t: 'select',
        key: 'align',
        label: 'Выравнивание',
        options: [
          ['start', 'К началу'],
          ['center', 'По центру'],
          ['end', 'К концу'],
          ['stretch', 'Растянуть'],
        ],
      },
      {
        t: 'select',
        key: 'justify',
        label: 'Распределение',
        options: [
          ['start', 'К началу'],
          ['center', 'По центру'],
          ['end', 'К концу'],
          ['between', 'Между'],
          ['around', 'Вокруг'],
        ],
      },
      { t: 'bool', key: 'wrap', label: 'Перенос' },
      { t: 'num', key: 'columns', label: 'Столбцов', min: 1, max: 12, step: 1 },
      { t: 'bool', key: 'scroll', label: 'Прокрутка содержимого' },
    ],
  },
};

/** Which groups a block type has no use for (S-00 says all apply to all; media settings only make sense for files). */
export const MEDIA_TYPES = ['image', 'gif', 'video', 'audio', 'animation'] as const;

/** The keys the table lists for a group, as the schema names them (`fills.stops.offset`, `stroke.paint.cx`…). */
export function specKeys(group: StyleGroup): string[] {
  const out = new Set<string>();
  const join = (a: string, b: string) => (a === '' ? b : b === '' ? a : `${a}.${b}`);
  const walk = (fields: Field[], prefix: string) => {
    for (const f of fields) {
      const here = join(prefix, f.key);
      if (f.t === 'point' && f.keys) for (const k of f.keys) out.add(join(prefix, k));
      else if (f.t === 'optional') {
        if (f.fields.length === 0) out.add(here);
        else walk(f.fields, here);
        // A switch that adds or removes the part (the part itself is a key when its fields are one value).
        if (f.fields.every((x) => x.key === '')) out.add(here);
      } else if (f.t === 'variant') {
        out.add(join(here, 'kind'));
        for (const v of Object.values(f.variants)) walk(v.fields, here);
      } else if (f.t === 'list') walk(f.item, here);
      else out.add(here);
    }
  };
  walk(GROUP_SPECS[group].fields, group);
  return [...out];
}

export const EASING_VARIANT: Field = {
  t: 'variant',
  key: 'easing',
  label: 'Плавность',
  variants: {
    preset: {
      title: 'Стандартная',
      make: () => ({ kind: 'preset', name: 'easeOut' }),
      fields: [
        {
          t: 'select',
          key: 'name',
          label: 'Вид',
          options: [
            ['linear', 'Равномерно'],
            ['ease', 'Плавно'],
            ['easeIn', 'С разгоном'],
            ['easeOut', 'С торможением'],
            ['easeInOut', 'С разгоном и торможением'],
          ],
        },
      ],
    },
    spring: {
      title: 'Пружина',
      make: () => ({ kind: 'spring', stiffness: 170, damping: 26 }),
      fields: [
        { t: 'num', key: 'stiffness', label: 'Жёсткость', min: 10, max: 1000, step: 10 },
        { t: 'num', key: 'damping', label: 'Затухание', min: 1, max: 100, step: 1 },
      ],
    },
    bezier: {
      title: 'Своя кривая',
      make: () => ({ kind: 'bezier', x1: 0.25, y1: 0.1, x2: 0.25, y2: 1 }),
      fields: [
        { t: 'num', key: 'x1', label: 'x1', min: 0, max: 1, step: 0.05 },
        { t: 'num', key: 'y1', label: 'y1', min: -2, max: 3, step: 0.05 },
        { t: 'num', key: 'x2', label: 'x2', min: 0, max: 1, step: 0.05 },
        { t: 'num', key: 'y2', label: 'y2', min: -2, max: 3, step: 0.05 },
      ],
    },
  },
};

/** S-12…S-14 · animations of a block: appearance, constant and on press. Own keyframes and a path to follow come with their editors. */
export const ANIMATION_SPEC: Field[] = [
  {
    t: 'optional',
    key: 'enter',
    label: 'Анимация появления',
    make: () => ({
      kind: 'fade',
      direction: 'up',
      durationMs: 600,
      delayMs: 0,
      easing: { kind: 'preset', name: 'easeOut' },
    }),
    fields: [
      {
        t: 'select',
        key: 'kind',
        label: 'Вид',
        options: [
          ['fade', 'Проявление'],
          ['slide', 'Выезд'],
          ['zoom', 'Увеличение'],
          ['bounce', 'Отскок'],
          ['flip', 'Переворот'],
          ['rotate', 'Вращение'],
          ['typewriter', 'Печатная машинка'],
          ['snowflake', 'Падение снежинкой'],
        ],
      },
      {
        t: 'select',
        key: 'direction',
        label: 'Направление',
        options: [
          ['up', 'Снизу'],
          ['down', 'Сверху'],
          ['left', 'Справа'],
          ['right', 'Слева'],
          ['upLeft', 'Снизу справа'],
          ['upRight', 'Снизу слева'],
          ['downLeft', 'Сверху справа'],
          ['downRight', 'Сверху слева'],
        ],
      },
      { t: 'num', key: 'durationMs', label: 'Длительность, мс', min: 50, max: 10000, step: 50 },
      { t: 'num', key: 'delayMs', label: 'Задержка, мс', min: 0, max: 30000, step: 50 },
      EASING_VARIANT,
    ],
  },
  {
    t: 'optional',
    key: 'loop',
    label: 'Постоянная анимация',
    make: () => ({ kind: 'pulse', speed: 1, amplitude: 1, pauseMs: 0 }),
    fields: [
      {
        t: 'select',
        key: 'kind',
        label: 'Вид',
        options: [
          ['pulse', 'Пульсация'],
          ['sway', 'Покачивание'],
          ['float', 'Парение'],
          ['spin', 'Вращение'],
          ['shake', 'Тряска'],
          ['blink', 'Мерцание'],
          ['heartbeat', 'Сердцебиение'],
        ],
      },
      { t: 'num', key: 'speed', label: 'Скорость', min: 0.1, max: 10, step: 0.1 },
      { t: 'num', key: 'amplitude', label: 'Размах', min: 0, max: 10, step: 0.1 },
      { t: 'num', key: 'pauseMs', label: 'Пауза между повторами, мс', min: 0, max: 30000, step: 100 },
    ],
  },
  {
    t: 'optional',
    key: 'press',
    label: 'Реакция на нажатие',
    make: () => ({ kind: 'grow' }),
    fields: [
      {
        t: 'select',
        key: 'kind',
        label: 'Вид',
        options: [
          ['grow', 'Увеличение'],
          ['shrink', 'Уменьшение'],
          ['glow', 'Свечение'],
          ['bounce', 'Подпрыгивание'],
          ['vibrate', 'Вибрация телефона'],
        ],
      },
    ],
  },
];

/** Keys of `BlockAnimation` the table lists (`enter.kind`, `loop.speed`…). */
export function animationKeys(): string[] {
  const out = new Set<string>();
  const walk = (fields: Field[], prefix: string) => {
    for (const f of fields) {
      const here = prefix === '' ? f.key : f.key === '' ? prefix : `${prefix}.${f.key}`;
      if (f.t === 'optional') walk(f.fields, here);
      else if (f.t === 'variant') {
        out.add(`${here}.kind`);
        for (const v of Object.values(f.variants)) walk(v.fields, here);
      } else out.add(here);
    }
  };
  walk(ANIMATION_SPEC, '');
  return [...out];
}
