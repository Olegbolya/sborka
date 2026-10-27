import { type BlockType, createId } from '@blokum/schema';
import { type Field } from './style-specs';

/** One entry of the list of block kinds: «Добавить» offers them by group (E-14). */
export interface CatalogEntry {
  type: BlockType;
  title: string;
  hint: string;
  group: 'content' | 'questions' | 'control';
}

export const GROUP_TITLES: Record<CatalogEntry['group'], string> = {
  content: 'Содержимое',
  questions: 'Вопросы и ввод',
  control: 'Оформление и управление',
};

/** B-01…B-23: what «Добавить» shows. The consent block (B-20) is not here: it comes with contact data (B-19). */
export const CATALOG: CatalogEntry[] = [
  { type: 'text', title: 'Текст', hint: 'Надпись с форматированием и переменными', group: 'content' },
  { type: 'image', title: 'Изображение', hint: 'Фото из медиатеки', group: 'content' },
  { type: 'gif', title: 'GIF', hint: 'Короткая анимация', group: 'content' },
  { type: 'video', title: 'Видео', hint: 'Ролик из медиатеки', group: 'content' },
  { type: 'audio', title: 'Звук', hint: 'Музыка или звуковой эффект', group: 'content' },
  { type: 'animation', title: 'Анимация, стикер', hint: 'Lottie, WebP, APNG, WebM', group: 'content' },
  { type: 'shape', title: 'Фигура', hint: 'Любая форма, заливка, обводка', group: 'control' },
  { type: 'button', title: 'Кнопка', hint: 'Нажали — следующий экран', group: 'control' },
  { type: 'container', title: 'Контейнер', hint: 'Группа блоков с раскладкой', group: 'control' },
  { type: 'zone', title: 'Зона', hint: 'Область для событий', group: 'control' },
  { type: 'timer', title: 'Таймер', hint: 'Обратный отсчёт', group: 'control' },
  { type: 'progress', title: 'Прогресс', hint: 'Полоса, точки, «экран N из M»', group: 'control' },
  { type: 'value', title: 'Значение', hint: 'Показывает переменную', group: 'control' },
  { type: 'singleChoice', title: 'Выбор одного варианта', hint: '2–30 вариантов', group: 'questions' },
  { type: 'multiChoice', title: 'Выбор нескольких', hint: 'С минимумом и максимумом', group: 'questions' },
  { type: 'textInput', title: 'Текстовый ответ', hint: 'Короткий или длинный', group: 'questions' },
  { type: 'scale', title: 'Шкала, рейтинг', hint: 'Звёзды, числа, ползунок', group: 'questions' },
  { type: 'swipe', title: 'Свайп-карточка', hint: 'Да или нет смахиванием', group: 'questions' },
  { type: 'ranking', title: 'Ранжирование', hint: 'Расставить по порядку', group: 'questions' },
  { type: 'date', title: 'Дата и время', hint: 'Выбор даты или времени', group: 'questions' },
  { type: 'contacts', title: 'Контактные данные', hint: 'Имя, телефон, email, город', group: 'questions' },
];

const media = (label: string, kinds: ReadonlyArray<'IMAGE' | 'GIF' | 'VIDEO' | 'AUDIO' | 'LOTTIE'>): Field => ({
  t: 'media',
  key: 'media',
  label,
  kinds,
});
const required: Field = { t: 'bool', key: 'required', label: 'Обязательный вопрос' };
const optionalNumber = (key: string, label: string, min: number, max: number, make: number, step = 1): Field => ({
  t: 'optional',
  key,
  label,
  make: () => make,
  fields: [{ t: 'num', key: '', label, min, max, step }],
});

export interface PropsSpec {
  fields: Field[];
  /** Keys the structure keeps itself (identifiers of options and items): not for a person to edit. */
  managed?: string[];
}

/** B-01…B-23 · what is set in each type of block (`Block.props`): the table is the interface and the list the test compares with the schema. */
export const PROP_SPECS: Record<BlockType, PropsSpec> = {
  text: { fields: [] },
  image: {
    fields: [
      media('Изображение', ['IMAGE']),
      {
        t: 'optional',
        key: 'caption',
        label: 'Подпись',
        make: () => '',
        fields: [{ t: 'text', key: '', label: 'Подпись', max: 300 }],
      },
    ],
  },
  gif: { fields: [media('GIF', ['GIF'])] },
  video: {
    fields: [
      media('Видео', ['VIDEO']),
      { t: 'bool', key: 'nextOnEnd', label: 'Дальше, когда ролик закончился' },
      { t: 'bool', key: 'trackCompletion', label: 'Запоминать, что досмотрел' },
    ],
  },
  audio: {
    fields: [
      media('Звук', ['AUDIO']),
      {
        t: 'select',
        key: 'role',
        label: 'Роль',
        options: [
          ['effect', 'Звуковой эффект'],
          ['background', 'Фоновая музыка'],
        ],
      },
      { t: 'num', key: 'volume', label: 'Громкость', min: 0, max: 1, step: 5, scale: 100, suffix: '%', slider: true },
    ],
  },
  shape: { fields: [] },
  animation: {
    fields: [
      media('Файл анимации', ['LOTTIE', 'GIF', 'IMAGE', 'VIDEO']),
      optionalNumber('frame', 'Остановить на кадре', 0, 100000, 0),
    ],
  },
  timer: {
    fields: [
      {
        t: 'select',
        key: 'mode',
        label: 'Отсчёт',
        options: [
          ['duration', 'На столько-то секунд'],
          ['until', 'До даты'],
        ],
      },
      { t: 'num', key: 'seconds', label: 'Секунд', min: 1, max: 86400, step: 1 },
      {
        t: 'optional',
        key: 'until',
        label: 'Дата окончания (ГГГГ-ММ-ДДTЧЧ:ММ:ССZ)',
        make: () => new Date(Date.now() + 86400000).toISOString().replace(/\.\d+Z$/, 'Z'),
        fields: [{ t: 'text', key: '', label: 'Дата окончания', max: 40 }],
      },
      {
        t: 'select',
        key: 'format',
        label: 'Вид',
        options: [
          ['mm:ss', 'мм:сс'],
          ['hh:mm:ss', 'чч:мм:сс'],
          ['seconds', 'Секунды'],
          ['words', 'Словами'],
        ],
      },
      { t: 'bool', key: 'autoStart', label: 'Запускать сразу' },
    ],
  },
  progress: {
    fields: [
      {
        t: 'select',
        key: 'variant',
        label: 'Вид',
        options: [
          ['bar', 'Полоса'],
          ['dots', 'Точки'],
          ['fraction', 'Экран N из M'],
          ['variable', 'Значение переменной'],
        ],
      },
      { t: 'variable', key: 'variableId', label: 'Переменная', optional: true },
      optionalNumber('max', 'Наибольшее значение', 1, 100000, 10),
    ],
  },
  container: { fields: [] },
  zone: { fields: [{ t: 'bool', key: 'visible', label: 'Видна на экране' }] },
  value: {
    fields: [
      { t: 'variable', key: 'variableId', label: 'Переменная' },
      {
        t: 'select',
        key: 'format',
        label: 'Вид',
        options: [
          ['number', 'Число'],
          ['text', 'Текст'],
          ['icons', 'Значки'],
          ['time', 'Время'],
          ['fraction', 'Дробь'],
        ],
      },
      {
        t: 'optional',
        key: 'icon',
        label: 'Значок',
        make: () => '❤',
        fields: [{ t: 'text', key: '', label: 'Значок', max: 8 }],
      },
      optionalNumber('max', 'Наибольшее значение', 1, 100000, 10),
    ],
  },
  singleChoice: {
    fields: [
      required,
      { t: 'bool', key: 'shuffle', label: 'Перемешивать варианты' },
      { t: 'bool', key: 'autoAdvance', label: 'Дальше сразу после выбора' },
      { t: 'choiceOptions', key: 'options' },
    ],
    managed: ['options.id', 'options.blockId'],
  },
  multiChoice: {
    fields: [
      required,
      { t: 'bool', key: 'shuffle', label: 'Перемешивать варианты' },
      { t: 'num', key: 'minSelected', label: 'Выбрать не меньше', min: 0, max: 30, step: 1 },
      optionalNumber('maxSelected', 'Выбрать не больше', 1, 30, 3),
      { t: 'choiceOptions', key: 'options' },
    ],
    managed: ['options.id', 'options.blockId'],
  },
  textInput: {
    fields: [
      { t: 'bool', key: 'multiline', label: 'Длинный ответ' },
      { t: 'text', key: 'placeholder', label: 'Подсказка в поле', max: 200 },
      { t: 'num', key: 'minLength', label: 'Не короче, символов', min: 0, max: 5000, step: 1 },
      { t: 'num', key: 'maxLength', label: 'Не длиннее, символов', min: 1, max: 5000, step: 1 },
      {
        t: 'select',
        key: 'mask',
        label: 'Что вводят',
        options: [
          ['none', 'Любой текст'],
          ['number', 'Число'],
          ['date', 'Дата'],
        ],
      },
      required,
      {
        t: 'select',
        key: 'semantic',
        label: 'Смысл поля',
        options: [
          ['none', 'Обычный ответ'],
          ['name', 'Имя'],
          ['phone', 'Телефон'],
          ['email', 'Email'],
          ['city', 'Город'],
        ],
      },
    ],
  },
  scale: {
    fields: [
      {
        t: 'select',
        key: 'variant',
        label: 'Вид',
        options: [
          ['stars', 'Звёзды'],
          ['hearts', 'Сердечки'],
          ['emoji', 'Эмодзи'],
          ['images', 'Свои картинки'],
          ['numbers', 'Числа'],
          ['slider', 'Ползунок'],
        ],
      },
      { t: 'num', key: 'min', label: 'Наименьшее', min: 0, max: 100, step: 1 },
      { t: 'num', key: 'max', label: 'Наибольшее', min: 1, max: 100, step: 1 },
      { t: 'num', key: 'step', label: 'Шаг', min: 0.1, max: 100, step: 0.1 },
      {
        t: 'optional',
        key: 'labels.min',
        label: 'Подпись у наименьшего',
        make: () => 'Плохо',
        fields: [{ t: 'text', key: '', label: 'Подпись у наименьшего', max: 60 }],
      },
      {
        t: 'optional',
        key: 'labels.max',
        label: 'Подпись у наибольшего',
        make: () => 'Отлично',
        fields: [{ t: 'text', key: '', label: 'Подпись у наибольшего', max: 60 }],
      },
      {
        t: 'list',
        key: 'icons',
        label: 'Свои значки',
        min: 0,
        max: 10,
        make: () => ({ source: 'media', id: 'media_unset' }),
        item: [{ t: 'media', key: '', label: 'Значок', kinds: ['IMAGE'] }],
      },
      required,
    ],
  },
  swipe: {
    fields: [
      { t: 'text', key: 'leftLabel', label: 'Слева', max: 40 },
      { t: 'text', key: 'rightLabel', label: 'Справа', max: 40 },
      { t: 'bool', key: 'buttons', label: 'Кнопки «да» и «нет»' },
      required,
    ],
  },
  ranking: {
    fields: [
      {
        t: 'list',
        key: 'items',
        label: 'Пункты',
        min: 2,
        max: 15,
        make: () => ({ id: createId(), label: 'Новый пункт' }),
        item: [{ t: 'text', key: 'label', label: 'Название пункта', max: 200 }],
      },
      required,
    ],
    managed: ['items.id'],
  },
  date: {
    fields: [
      {
        t: 'select',
        key: 'mode',
        label: 'Что выбирают',
        options: [
          ['date', 'Дату'],
          ['time', 'Время'],
          ['datetime', 'Дату и время'],
        ],
      },
      {
        t: 'optional',
        key: 'min',
        label: 'Не раньше',
        make: () => '',
        fields: [{ t: 'text', key: '', label: 'Не раньше', max: 40 }],
      },
      {
        t: 'optional',
        key: 'max',
        label: 'Не позже',
        make: () => '',
        fields: [{ t: 'text', key: '', label: 'Не позже', max: 40 }],
      },
      required,
    ],
  },
  button: { fields: [{ t: 'bool', key: 'requiresAnswers', label: 'Ждёт ответов на обязательные вопросы' }] },
  contacts: {
    fields: [
      {
        t: 'multi',
        key: 'fields',
        label: 'Что спрашивать',
        options: [
          ['name', 'Имя'],
          ['phone', 'Телефон'],
          ['email', 'Email'],
          ['city', 'Город'],
        ],
      },
      { t: 'bool', key: 'required', label: 'Обязательно' },
    ],
  },
  consent: { fields: [{ t: 'text', key: 'linkText', label: 'Текст согласия', max: 200 }] },
};

/** Keys a table of fields sets, as the schema names them (paths with «.»); what the structure keeps itself is added by the caller. */
export function fieldKeys(fields: Field[]): string[] {
  const out = new Set<string>();
  const join = (a: string, b: string) => (a === '' ? b : b === '' ? a : `${a}.${b}`);
  const walk = (list: Field[], prefix: string) => {
    for (const f of list) {
      if (f.t === 'choiceOptions') {
        for (const k of ['correct', 'score', 'resultTags']) out.add(`options.${k}`);
        continue;
      }
      const here = join(prefix, f.key);
      if (f.t === 'optional') walk(f.fields, here);
      else if (f.t === 'list') walk(f.item, here);
      else if (f.t === 'variant') {
        out.add(join(here, 'kind'));
        for (const v of Object.values(f.variants)) walk(v.fields, here);
      } else out.add(here);
    }
  };
  walk(fields, '');
  return [...out];
}

/** Keys of the props the table lists for a type, as the schema names them. */
export function propKeys(type: BlockType): string[] {
  return [...new Set([...fieldKeys(PROP_SPECS[type].fields), ...(PROP_SPECS[type].managed ?? [])])];
}
