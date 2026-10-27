import { createId } from '@blokum/schema';
import { BASIC_TRANSITIONS, PARTICLES_FIELD } from '../editor/screen-specs';
import { type Field, GROUP_SPECS } from '../editor/style-specs';

/**
 * TH-01 · what a theme holds, apart from the palette and the styles of the blocks (they have editors of their own):
 * the table is the interface and the list the test checks against the keys of `ThemeTokens`.
 */
export interface ThemeSection {
  id: string;
  title: string;
  fields: Field[];
}

const FONTS: ReadonlyArray<readonly [string, string]> = [
  ['sans', 'Без засечек'],
  ['serif', 'С засечками'],
  ['mono', 'Моноширинный'],
  ['rounded', 'Скруглённый'],
];

const FILL_LIST = GROUP_SPECS.fills.fields[0];
if (FILL_LIST?.t !== 'list') throw new Error('Заливка описана списком слоёв');
const fill = (key: string, label: string): Field => ({ ...FILL_LIST, key, label });

const SOUNDS: ReadonlyArray<readonly [string, string]> = [
  ['tap', 'Нажатие'],
  ['success', 'Верный ответ'],
  ['error', 'Неверный ответ'],
  ['transition', 'Переход между экранами'],
  ['background', 'Фоновая музыка'],
];

const systemScreen = (key: string, title: string): Field[] => [
  fill(`systemScreens.${key}.background`, `${title}: фон`),
  { t: 'optional', key: `systemScreens.${key}.title`, label: `${title}: заголовок`, make: () => 'Заголовок', fields: [{ t: 'text', key: '', label: `${title}: заголовок`, max: 200 }] },
  { t: 'optional', key: `systemScreens.${key}.text`, label: `${title}: текст`, make: () => 'Текст', fields: [{ t: 'text', key: '', label: `${title}: текст`, max: 1000 }] },
];

export const THEME_SECTIONS: ThemeSection[] = [
  {
    id: 'fonts',
    title: 'Шрифты',
    fields: [
      { t: 'select', key: 'fonts.heading.name', label: 'Шрифт заголовков', options: FONTS },
      { t: 'select', key: 'fonts.body.name', label: 'Шрифт текста', options: FONTS },
      { t: 'optional', key: 'fonts.accent', label: 'Акцентный шрифт', make: () => ({ kind: 'system', name: 'serif' }), fields: [{ t: 'select', key: 'name', label: 'Акцентный шрифт', options: FONTS }] },
    ],
  },
  { id: 'background', title: 'Фон', fields: [fill('background', 'Слои фона')] },
  { id: 'particles', title: 'Частицы', fields: [PARTICLES_FIELD] },
  {
    id: 'transitions',
    title: 'Переходы',
    fields: [
      {
        t: 'list',
        key: 'transitions',
        label: 'Свои переходы',
        min: 0,
        max: 20,
        make: () => ({ id: createId(), name: 'Свой переход', transition: (BASIC_TRANSITIONS.fade as { make: () => unknown }).make() }),
        item: [
          { t: 'text', key: 'name', label: 'Название перехода', max: 60 },
          { t: 'variant', key: 'transition', label: 'Вид перехода', variants: Object.fromEntries(Object.entries(BASIC_TRANSITIONS)) },
        ],
      },
    ],
  },
  {
    id: 'decor',
    title: 'Декор',
    fields: [{ t: 'list', key: 'decor', label: 'Картинки декора', min: 0, max: 100, make: () => ({ source: 'media', id: 'media_unset' }), item: [{ t: 'media', key: '', label: 'Файл', kinds: ['IMAGE', 'GIF', 'LOTTIE'] }] }],
  },
  {
    id: 'sounds',
    title: 'Звуки',
    fields: SOUNDS.map(([key, title]): Field => ({ t: 'optional', key: `sounds.${key}`, label: title, make: () => ({ source: 'media', id: 'media_unset' }), fields: [{ t: 'media', key: '', label: `${title}: файл`, kinds: ['AUDIO'] }] })),
  },
  {
    id: 'system',
    title: 'Служебные экраны',
    fields: [...systemScreen('closed', 'Сборка закрыта'), ...systemScreen('password', 'Пароль'), ...systemScreen('age18', '18+')],
  },
];

/** Top-level keys of the tokens the table and the two special editors (colours, styles of blocks) set. */
export const THEME_KEYS = ['colors', 'blockDefaults', ...new Set(THEME_SECTIONS.flatMap((s) => s.fields.map((f) => f.key.split('.')[0]!)))] as const;
