import { type BlockInput, type MediaOverlay, ParticlesConfig, PARTICLE_PRESETS, ProjectDocument, type Transition, TRANSITION_KINDS, textOf } from '@blokum/schema';

type Animation = NonNullable<BlockInput['animation']>;
type Style = NonNullable<BlockInput['style']>;

const card: Style = {
  radius: { tl: 16, tr: 16, br: 16, bl: 16 },
  fills: [{ kind: 'linear', angle: 135, stops: [{ offset: 0, color: { token: 'primary' } }, { offset: 1, color: { token: 'accent' } }] }],
  text: { size: 12, weight: 700, align: 'center', verticalAlign: 'middle', paint: { kind: 'solid', color: { hex: '#FFFFFF' } } },
  padding: { t: 6, r: 6, b: 6, l: 6 },
};

/** S-12: every kind of «появление», own keyframes included (position, turn, opacity and fill colour). */
const ENTER: Array<[string, Animation['enter']]> = [
  ['Проявление', { kind: 'fade' }],
  ['Выезд снизу-слева', { kind: 'slide', direction: 'downLeft' }],
  ['Увеличение', { kind: 'zoom' }],
  ['Отскок', { kind: 'bounce' }],
  ['Переворот', { kind: 'flip' }],
  ['Вращение', { kind: 'rotate' }],
  ['Печатная машинка', { kind: 'typewriter', durationMs: 1200 }],
  ['Снежинкой', { kind: 'snowflake', durationMs: 1400 }],
  [
    'Свои кадры',
    {
      kind: 'keyframes',
      durationMs: 1500,
      keyframes: [
        { at: 0, props: { x: -60, rotation: -30, opacity: 0 }, fill: { hex: '#2E86AB' } },
        { at: 0.6, props: { x: 10, rotation: 10, opacity: 1 }, fill: { hex: '#F2C14E' } },
        { at: 1, props: { x: 0, rotation: 0, opacity: 1 }, fill: { hex: '#E4572E' } },
      ],
    },
  ],
];

/** S-13: every «постоянная» animation, the path and own keyframes in a loop included. */
const LOOP: Array<[string, Animation['loop']]> = [
  ['Пульсация', { kind: 'pulse' }],
  ['Покачивание', { kind: 'sway' }],
  ['Парение', { kind: 'float' }],
  ['Вращение', { kind: 'spin', speed: 0.5 }],
  ['Тряска', { kind: 'shake', pauseMs: 1200 }],
  ['Мерцание', { kind: 'blink' }],
  ['Сердцебиение', { kind: 'heartbeat', amplitude: 1.5 }],
  ['По контуру', { kind: 'followPath', path: 'M0 0 C 30 -30 60 30 90 0 C 60 -30 30 30 0 0' }],
  [
    'Свои кадры по кругу',
    {
      kind: 'keyframes',
      keyframes: [
        { at: 0, props: { scale: 1, hueRotate: 0 } },
        { at: 0.5, props: { scale: 1.15, hueRotate: 90 } },
        { at: 1, props: { scale: 1, hueRotate: 0 } },
      ],
    },
  ],
];

/** S-14: reactions to a press (and hover on a computer). */
const PRESS: Array<[string, Animation['press']]> = [
  ['Увеличение', { kind: 'grow' }],
  ['Уменьшение', { kind: 'shrink' }],
  ['Свечение', { kind: 'glow' }],
  ['Подпрыгивание', { kind: 'bounce' }],
  ['Вибрация', { kind: 'vibrate' }],
  [
    'Своя',
    {
      kind: 'keyframes',
      keyframes: [
        { at: 0, props: { rotation: 0 } },
        { at: 0.5, props: { rotation: 20, scale: 1.1 } },
        { at: 1, props: { rotation: 0, scale: 1 } },
      ],
    },
  ],
];

const COLS = [15, 140, 265];

function grid(prefix: string, items: Array<[string, Animation]>): BlockInput[] {
  return items.map(([label, animation], i) => ({
    id: `${prefix}-${String(i).padStart(2, '0')}`,
    type: 'shape',
    name: label,
    frame: { x: COLS[i % 3]!, y: 60 + Math.floor(i / 3) * 120, w: 110, h: 90 },
    style: card,
    textLayer: textOf(label),
    animation,
  }));
}

const title = (id: string, text: string): BlockInput => ({
  id,
  type: 'text',
  name: text,
  frame: { x: 15, y: 16, w: 360, h: 32 },
  style: { text: { size: 20, weight: 800, paint: { kind: 'solid', color: { token: 'text' } } } },
  textLayer: textOf(text),
});

const rows = (n: number) => Math.max(400, 60 + Math.ceil(n / 3) * 120 + 10);

/** Screens of the gallery: blocks with every animation of S-12, S-13 and S-14. */
export const ANIMATIONS_GALLERY = ProjectDocument.parse({
  schemaVersion: 1,
  meta: { title: 'Галерея анимаций' },
  screens: [
    { id: 'galereya-enter', name: 'Появление', height: rows(ENTER.length), blocks: [title('enter-title', 'Появление (S-12)'), ...grid('enter', ENTER.map(([l, e]) => [l, { enter: e }]))] },
    { id: 'galereya-loop', name: 'Постоянные', height: rows(LOOP.length), blocks: [title('loop-title', 'Постоянные (S-13)'), ...grid('loop', LOOP.map(([l, e]) => [l, { loop: e }]))] },
    { id: 'galereya-press', name: 'Нажатие', height: rows(PRESS.length), blocks: [title('press-title', 'Нажатие и наведение (S-14)'), ...grid('press', PRESS.map(([l, e]) => [l, { press: e }]))] },
  ],
});

const meme: MediaOverlay = {
  media: { source: 'media', id: 'dev-gif-sneg' },
  seconds: 1.5,
  caption: { text: 'КОГДА ОТВЕТИЛ ВЕРНО', position: 'bottom', font: { kind: 'system', name: 'rounded' }, size: 34, color: { hex: '#FFFFFF' }, outline: 3 },
  skippable: true,
};

/** Own transition saved as a preset of the theme (T-32). */
export const GALLERY_PRESET = {
  id: 'preset-shtorka',
  name: 'Медленная шторка',
  transition: { kind: 'blinds', direction: 'down', durationMs: 900, delayMs: 0, easing: { kind: 'preset', name: 'easeInOut' }, blur: 0, scale: 1 },
} as const;

const base = { direction: 'left', durationMs: 600, delayMs: 0, easing: { kind: 'preset', name: 'easeOut' }, blur: 0, scale: 1 } as const;
const LABELS: Record<(typeof TRANSITION_KINDS)[number], string> = {
  none: 'Без перехода',
  fade: 'Проявление',
  slide: 'Сдвиг',
  zoom: 'Увеличение',
  flip: 'Переворот',
  blinds: 'Жалюзи',
  particles: 'В частицы',
  page: 'Перелистывание',
};

/** T-01…T-08, T-20 and T-32: buttons of the transitions part of the gallery. */
export const GALLERY_TRANSITIONS: Array<{ id: string; label: string; transition: Transition }> = [
  ...TRANSITION_KINDS.map((kind) => ({ id: kind, label: LABELS[kind], transition: { ...base, kind } })),
  { id: 'media', label: 'Мем-переход', transition: { kind: 'media', overlay: meme } },
  { id: 'preset', label: 'Свой пресет', transition: { kind: 'preset', presetId: GALLERY_PRESET.id } },
];

/** T-21: a media insert by the answer — the verdict comes from the server. */
export const GALLERY_MEDIA_BY_ANSWER = {
  questionBlockId: 'vopros-galerei',
  cases: [
    { when: { kind: 'correct' as const }, overlay: meme },
    { when: { kind: 'wrong' as const }, overlay: { ...meme, caption: { ...meme.caption!, text: 'НУ ПОЧТИ…', color: { hex: '#FFC371' } } } },
  ],
};

/** P-01…P-08: each preset in its own window; «свои» are made of the creator's picture. */
export const GALLERY_PARTICLES = PARTICLE_PRESETS.map((preset) =>
  ParticlesConfig.parse({ preset, density: 0.7, images: preset === 'custom' ? [{ source: 'media', id: 'dev-maska-zvezda' }] : [] }),
);

export const PARTICLE_LABELS: Record<(typeof PARTICLE_PRESETS)[number], string> = {
  snow: 'Снег',
  confetti: 'Конфетти',
  hearts: 'Сердечки',
  sparkles: 'Искры',
  bubbles: 'Пузыри',
  leaves: 'Листья',
  petals: 'Лепестки',
  custom: 'Свои картинки',
};

const demoScreen = (id: string, name: string, token: 'primary' | 'accent', label: string) => ({
  id,
  name,
  height: 400,
  background: [{ kind: 'solid' as const, color: { token } }],
  blocks: [
    {
      id: `${id}-tekst`,
      type: 'text' as const,
      name: label,
      frame: { x: 20, y: 170, w: 350, h: 60 },
      style: { text: { size: 34, weight: 800, align: 'center' as const, verticalAlign: 'middle' as const, paint: { kind: 'solid' as const, color: { hex: '#FFFFFF' } } } },
      textLayer: textOf(label),
    },
  ],
});

/** Two screens the transitions switch between. */
export const TRANSITION_SCREENS = ProjectDocument.parse({
  schemaVersion: 1,
  screens: [demoScreen('ekran-a', 'Экран А', 'primary', 'Экран А'), demoScreen('ekran-b', 'Экран Б', 'accent', 'Экран Б')],
}).screens;

/** The heaviest real case: a whole screen of snow at full density (MAX_PARTICLES on a phone screen). */
export const GALLERY_FULL_SCREEN = ParticlesConfig.parse({ preset: 'snow', density: 1 });
