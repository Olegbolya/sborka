import { type ParticlesConfig, TRANSITION_KINDS } from '@blokum/schema';
import { type Field, EASING_VARIANT, GROUP_SPECS } from './style-specs';

/** E-13, L-06 · what is set on a screen: the table is the interface of the panel «Экран» and the list the test checks against the schema. */
export interface ScreenSection {
  id: string;
  title: string;
  fields: Field[];
}

const TRANSITION_TITLES: Record<(typeof TRANSITION_KINDS)[number], string> = {
  none: 'Без перехода',
  fade: 'Растворение',
  slide: 'Сдвиг',
  zoom: 'Масштаб',
  flip: 'Переворот',
  blinds: 'Жалюзи',
  particles: 'Частицы',
  page: 'Страница',
};

const DIRECTIONS: ReadonlyArray<readonly [string, string]> = [
  ['left', 'Справа налево'],
  ['right', 'Слева направо'],
  ['up', 'Снизу вверх'],
  ['down', 'Сверху вниз'],
  ['upLeft', 'К верхнему левому углу'],
  ['upRight', 'К верхнему правому углу'],
  ['downLeft', 'К нижнему левому углу'],
  ['downRight', 'К нижнему правому углу'],
];

const basicTransition = (kind: (typeof TRANSITION_KINDS)[number]) => ({
  title: TRANSITION_TITLES[kind],
  make: () => ({ kind, direction: 'left', durationMs: 400, delayMs: 0, easing: { kind: 'preset', name: 'easeOut' }, blur: 0, scale: 1 }),
  fields:
    kind === 'none'
      ? []
      : ([
          { t: 'select', key: 'direction', label: 'Направление', options: DIRECTIONS },
          { t: 'num', key: 'durationMs', label: 'Длительность, мс', min: 50, max: 3000, step: 50 },
          { t: 'num', key: 'delayMs', label: 'Задержка, мс', min: 0, max: 3000, step: 50 },
          EASING_VARIANT,
          { t: 'num', key: 'blur', label: 'Размытие', min: 0, max: 40, step: 1 },
          { t: 'num', key: 'scale', label: 'Масштаб', min: 0.2, max: 3, step: 0.1 },
        ] satisfies Field[]),
});

/** The built-in transitions as the variants of a choice (T-01…T-08); a theme keeps its own presets of them (T-32). */
export const BASIC_TRANSITIONS: Record<string, { title: string; make: () => unknown; fields: Field[] }> = Object.fromEntries(TRANSITION_KINDS.map((k) => [k, basicTransition(k)]));

const MEDIA_TRANSITION = {
  title: 'Вставка из медиатеки',
  make: () => ({ kind: 'media', overlay: { media: { source: 'media', id: 'media_unset' }, seconds: 1.5, skippable: true } }),
  fields: [
    { t: 'media', key: 'overlay.media', label: 'Файл вставки', kinds: ['IMAGE', 'GIF', 'VIDEO'] },
    { t: 'num', key: 'overlay.seconds', label: 'Сколько показывать, с', min: 0.3, max: 10, step: 0.1 },
    { t: 'bool', key: 'overlay.skippable', label: 'Можно пропустить' },
    {
      t: 'optional',
      key: 'overlay.caption',
      label: 'Подпись поверх',
      make: () => ({ text: 'Подпись', position: 'bottom', size: 36, color: { hex: '#FFFFFF' }, outline: 3 }),
      fields: [
        { t: 'text', key: 'text', label: 'Текст подписи', max: 200 },
        { t: 'select', key: 'position', label: 'Где', options: [['top', 'Сверху'], ['bottom', 'Снизу']] },
        { t: 'num', key: 'size', label: 'Размер', min: 10, max: 120, step: 1 },
        { t: 'color', key: 'color', label: 'Цвет' },
        { t: 'num', key: 'outline', label: 'Обводка', min: 0, max: 12, step: 1 },
      ],
    },
    {
      t: 'optional',
      key: 'overlay.sound',
      label: 'Звук вставки',
      make: () => ({ source: 'media', id: 'media_unset' }),
      fields: [{ t: 'media', key: '', label: 'Файл звука', kinds: ['AUDIO'] }],
    },
  ],
} satisfies { title: string; make: () => unknown; fields: Field[] };

const PARTICLE_TITLES: ReadonlyArray<readonly [ParticlesConfig['preset'], string]> = [
  ['snow', 'Снег'],
  ['confetti', 'Конфетти'],
  ['hearts', 'Сердечки'],
  ['sparkles', 'Искры'],
  ['bubbles', 'Пузыри'],
  ['leaves', 'Листья'],
  ['petals', 'Лепестки'],
  ['custom', 'Свои картинки'],
];

/** P-01…P-08 · particles over a screen or behind every screen of a theme. */
export const PARTICLES_FIELD: Field = {
  t: 'optional',
  key: 'particles',
  label: 'Частицы на экране',
  make: () => ({ preset: 'snow', images: [], density: 0.5, speed: 1, size: 1, rotation: true, wind: 0, onlyAtStart: false }),
  fields: [
    { t: 'select', key: 'preset', label: 'Какие', options: PARTICLE_TITLES },
    { t: 'list', key: 'images', label: 'Свои картинки', min: 0, max: 5, make: () => ({ source: 'media', id: 'media_unset' }), item: [{ t: 'media', key: '', label: 'Картинка', kinds: ['IMAGE'] }] },
    { t: 'num', key: 'density', label: 'Густота', min: 0, max: 1, step: 5, scale: 100, suffix: '%', slider: true },
    { t: 'num', key: 'speed', label: 'Скорость', min: 0.1, max: 5, step: 0.1 },
    { t: 'num', key: 'size', label: 'Размер', min: 0.2, max: 5, step: 0.1 },
    { t: 'bool', key: 'rotation', label: 'Вращаются' },
    { t: 'num', key: 'wind', label: 'Ветер', min: -1, max: 1, step: 0.1 },
    { t: 'bool', key: 'onlyAtStart', label: 'Только при входе на экран' },
    {
      t: 'optional',
      key: 'area',
      label: 'Только в части экрана',
      make: () => ({ x: 0, y: 0, w: 390, h: 400 }),
      fields: [
        { t: 'num', key: 'x', label: 'Область: X', min: -10000, max: 10000, step: 1 },
        { t: 'num', key: 'y', label: 'Область: Y', min: -10000, max: 10000, step: 1 },
        { t: 'num', key: 'w', label: 'Область: ширина', min: 0, max: 10000, step: 1 },
        { t: 'num', key: 'h', label: 'Область: высота', min: 0, max: 10000, step: 1 },
      ],
    },
  ],
};

const BRANCH_TARGET: Field = {
  t: 'variant',
  key: 'onExpire',
  label: 'Когда время вышло',
  variants: {
    next: { title: 'Следующий экран', make: () => ({ kind: 'next' }), fields: [] },
    screen: { title: 'Перейти на экран', make: () => ({ kind: 'screen', screenId: 'screen_unset' }), fields: [{ t: 'screen', key: 'screenId', label: 'Экран' }] },
    finish: { title: 'Завершить сборку', make: () => ({ kind: 'finish' }), fields: [] },
  },
};

export const SCREEN_SECTIONS: ScreenSection[] = [
  {
    id: 'main',
    title: 'Экран',
    fields: [
      { t: 'text', key: 'name', label: 'Название экрана', max: 80 },
      { t: 'select', key: 'kind', label: 'Какой это экран', options: [['content', 'Обычный'], ['question', 'С вопросом'], ['result', 'Результат']] },
      { t: 'num', key: 'height', label: 'Высота экрана', min: 400, max: 5000, step: 1 },
    ],
  },
  { id: 'background', title: 'Фон', fields: [{ ...GROUP_SPECS.fills.fields[0]!, key: 'background', label: 'Слои фона' } as Field] },
  { id: 'particles', title: 'Частицы', fields: [PARTICLES_FIELD] },
  {
    id: 'transition',
    title: 'Переход на этот экран',
    fields: [
      {
        t: 'variant',
        key: 'transitionIn',
        label: 'Переход',
        variants: {
          ...BASIC_TRANSITIONS,
          media: MEDIA_TRANSITION,
          preset: { title: 'Из темы', make: () => ({ kind: 'preset', presetId: 'preset_unset' }), fields: [{ t: 'transitionPreset', key: 'presetId', label: 'Переход из темы' }] },
        },
      },
    ],
  },
  {
    id: 'timer',
    title: 'Таймер экрана',
    fields: [
      {
        t: 'optional',
        key: 'timer',
        label: 'Ограничить время на экране',
        make: () => ({ seconds: 30, onExpire: { kind: 'next' } }),
        fields: [{ t: 'num', key: 'seconds', label: 'Секунд на экране', min: 1, max: 3600, step: 1 }, BRANCH_TARGET],
      },
    ],
  },
];

/** The keys of a screen the panel sets (the rest — blocks, branches, rules, answers-media — have editors of their own). */
export const SCREEN_KEYS = ['name', 'kind', 'height', 'background', 'particles', 'transitionIn', 'timer'] as const;
