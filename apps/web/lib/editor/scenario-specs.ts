import { type ANIMATABLE, type Block, type ProjectDocument, type SETTABLE_PROPERTIES, walkBlocks } from '@blokum/schema';

/**
 * P3.8 · SC-02 · what the editor of scenarios offers. Every trigger, action, behaviour and type of a variable of the
 * schema is a line here, with its name in plain Russian and the fields that set it; the test of this file compares the lists
 * and the fields with the keys of the schema, so a part the schema has and the editor lacks fails it (the same guarantee as
 * for the style, P3.4). A line also knows how to make a new valid part, which the editor puts in the rule when it is chosen.
 */
export type SField =
  /** What a trigger listens to: a block, the copies of a block, a group. */
  | { t: 'source'; key: string; label: string }
  /** The screen as a whole, or a source (a swipe). */
  | { t: 'screenOrSource'; key: string; label: string }
  /** What an action changes: a block, the block that fired the rule, the copies of a block. */
  | { t: 'target'; key: string; label: string; optional?: boolean }
  | { t: 'targets'; key: string; label: string }
  | { t: 'block'; key: string; label: string; types?: readonly string[]; optional?: boolean }
  | { t: 'blocks'; key: string; label: string }
  | { t: 'variable'; key: string; label: string }
  | { t: 'screen'; key: string; label: string }
  | { t: 'num'; key: string; label: string; min: number; max: number; step?: number; suffix?: string; optional?: boolean }
  | { t: 'text'; key: string; label: string; max: number; optional?: boolean }
  | { t: 'select'; key: string; label: string; options: ReadonlyArray<readonly [string, string]>; optional?: boolean }
  | { t: 'bool'; key: string; label: string }
  /** A number, a text or a yes/no. */
  | { t: 'scalar'; key: string; label: string; optional?: boolean }
  | { t: 'number'; key: string; label: string; optional?: boolean }
  | { t: 'easing'; key: string; label: string }
  | { t: 'destination'; key: string; label: string }
  | { t: 'rect'; key: string; label: string; optional?: boolean }
  | { t: 'transition'; key: string; label: string }
  | { t: 'overlay'; key: string; label: string }
  | { t: 'media'; key: string; label: string; kinds?: ReadonlyArray<'IMAGE' | 'GIF' | 'VIDEO' | 'AUDIO' | 'LOTTIE'> }
  | { t: 'condition'; key: string; label: string; optional?: boolean }
  | { t: 'actions'; key: string; label: string }
  /** The property to change and its new value (the value depends on the property): two keys of the action. */
  | { t: 'propertyValue'; key: 'property'; keys: readonly ['property', 'value']; label: string }
  /** What to write into the answers: a variable or a text (AC-14). */
  | { t: 'recordValue'; key: 'value'; label: string }
  /** Sectors of a wheel of fortune (BH-06). */
  | { t: 'sectors'; key: string; label: string }
  /** One option of a question block. */
  | { t: 'optionOf'; key: string; label: string; questionKey: string; optional?: boolean }
  /** Zones that a dragged block snaps to (BH-01). */
  | { t: 'zones'; key: string; label: string }
  /** The path of a motion (BH-04): drawn with the pen. */
  | { t: 'pathText'; key: string; label: string; optional?: boolean };

export interface MakeContext {
  doc: ProjectDocument;
  /** The block the rule or behaviour belongs to. */
  self: string;
  screenId: string;
}

export interface PartSpec {
  kind: string;
  title: string;
  hint: string;
  group?: string;
  fields: SField[];
  make: (ctx: MakeContext) => Record<string, unknown>;
  /** Puts a value changed in the form in order (fields that depend on each other); the value of a chosen kind stays as it is otherwise. */
  normalize?: (value: Record<string, unknown>, ctx: MakeContext) => Record<string, unknown>;
}

const own = (ctx: MakeContext) => ({ kind: 'block', blockId: ctx.self });
const firstVariable = (ctx: MakeContext) => ctx.doc.variables[0]?.id ?? 'variable_unset';
const firstOfType = (ctx: MakeContext, types: readonly string[]): string => {
  for (const s of ctx.doc.screens) for (const b of walkBlocks(s.blocks)) if (types.includes(b.type)) return b.id;
  return ctx.self;
};
export const blockNames = (doc: ProjectDocument): Map<string, string> => {
  const names = new Map<string, string>();
  for (const s of doc.screens) for (const b of walkBlocks(s.blocks)) names.set(b.id, b.name);
  return names;
};
export const allBlocks = (doc: ProjectDocument): Array<{ block: Block; screenId: string; screenName: string }> =>
  doc.screens.flatMap((s) => [...walkBlocks(s.blocks)].map((block) => ({ block, screenId: s.id, screenName: s.name })));

const PHASE_ENTER: ReadonlyArray<readonly [string, string]> = [
  ['enter', 'навели'],
  ['leave', 'убрали'],
];

// ── TR-01…TR-16 ───────────────────────────────────────────────────────────────
export const TRIGGERS: readonly PartSpec[] = [
  { kind: 'tap', title: 'Нажали', hint: 'Нажатие или щелчок по блоку', fields: [{ t: 'source', key: 'source', label: 'На что нажали' }], make: (c) => ({ kind: 'tap', source: own(c) }) },
  { kind: 'doubleTap', title: 'Нажали дважды', hint: 'Два быстрых нажатия', fields: [{ t: 'source', key: 'source', label: 'На что нажали' }], make: (c) => ({ kind: 'doubleTap', source: own(c) }) },
  {
    kind: 'longPress',
    title: 'Нажали и держат',
    hint: 'Палец или кнопка мыши не отпускаются',
    fields: [
      { t: 'source', key: 'source', label: 'На что нажали' },
      { t: 'num', key: 'ms', label: 'Как долго держат', min: 300, max: 3000, step: 100, suffix: 'мс' },
    ],
    make: (c) => ({ kind: 'longPress', source: own(c), ms: 600 }),
  },
  {
    kind: 'hover',
    title: 'Навели курсор или палец',
    hint: 'Курсор подошёл к блоку или ушёл с него',
    fields: [
      { t: 'source', key: 'source', label: 'Над чем' },
      { t: 'select', key: 'phase', label: 'Когда', options: PHASE_ENTER },
    ],
    make: (c) => ({ kind: 'hover', source: own(c), phase: 'enter' }),
  },
  {
    kind: 'drag',
    title: 'Потащили',
    hint: 'Блок начали тащить или отпустили',
    fields: [
      { t: 'source', key: 'source', label: 'Что тащат' },
      { t: 'select', key: 'phase', label: 'Когда', options: [['start', 'начали тащить'], ['end', 'отпустили']] },
    ],
    make: (c) => ({ kind: 'drag', source: own(c), phase: 'start' }),
  },
  {
    kind: 'drop',
    title: 'Положили на место',
    hint: 'Перетащенный блок отпустили над зоной или блоком',
    fields: [
      { t: 'source', key: 'source', label: 'Что кладут' },
      { t: 'source', key: 'target', label: 'Куда кладут' },
    ],
    make: (c) => ({ kind: 'drop', source: own(c), target: { kind: 'block', blockId: firstOfType(c, ['zone']) } }),
  },
  {
    kind: 'collide',
    title: 'Столкнулись',
    hint: 'Два блока коснулись друг друга или разошлись',
    fields: [
      { t: 'source', key: 'source', label: 'Первый блок' },
      { t: 'source', key: 'target', label: 'Второй блок' },
      { t: 'select', key: 'phase', label: 'Когда', options: [['start', 'коснулись'], ['end', 'разошлись']] },
    ],
    make: (c) => ({ kind: 'collide', source: own(c), target: own(c), phase: 'start' }),
  },
  {
    kind: 'swipe',
    title: 'Смахнули',
    hint: 'Движение пальцем в сторону',
    fields: [
      { t: 'select', key: 'direction', label: 'Куда', options: [['left', 'влево'], ['right', 'вправо'], ['up', 'вверх'], ['down', 'вниз']] },
      { t: 'screenOrSource', key: 'on', label: 'Где' },
    ],
    make: () => ({ kind: 'swipe', direction: 'left', on: 'screen' }),
  },
  {
    kind: 'screen',
    title: 'Экран открылся или закрывается',
    hint: 'Срабатывает при показе экрана или уходе с него',
    fields: [{ t: 'select', key: 'phase', label: 'Когда', options: [['show', 'экран открылся'], ['leave', 'экран закрывается']] }],
    make: () => ({ kind: 'screen', phase: 'show' }),
  },
  {
    kind: 'timer',
    title: 'Прошло время',
    hint: 'Через время, каждые несколько секунд или когда закончился таймер',
    fields: [
      { t: 'select', key: 'mode', label: 'Как', options: [['after', 'один раз через'], ['every', 'каждые'], ['timerEnd', 'когда закончился таймер']] },
      { t: 'num', key: 'seconds', label: 'Секунд', min: 0.05, max: 3600, step: 0.5 },
      { t: 'block', key: 'timerBlockId', label: 'Какой таймер', types: ['timer'] },
    ],
    make: () => ({ kind: 'timer', mode: 'after', seconds: 3 }),
    // «Через» and «каждые» need seconds, «когда закончился таймер» needs a timer block; the form keeps exactly what the mode needs.
    normalize: (v, c) => {
      const { seconds, timerBlockId, ...rest } = v as { mode?: string; seconds?: number; timerBlockId?: string };
      return rest.mode === 'timerEnd' ? { ...rest, timerBlockId: timerBlockId ?? firstOfType(c, ['timer']) } : { ...rest, seconds: seconds ?? 3 };
    },
  },
  { kind: 'variableChange', title: 'Изменилась переменная', hint: 'Значение переменной стало другим', fields: [{ t: 'variable', key: 'variableId', label: 'Какая переменная' }], make: (c) => ({ kind: 'variableChange', variableId: firstVariable(c) }) },
  { kind: 'answer', title: 'Ответили на вопрос', hint: 'Участник выбрал или ввёл ответ', fields: [{ t: 'block', key: 'questionBlockId', label: 'На какой вопрос', types: ['singleChoice', 'multiChoice', 'textInput', 'scale', 'swipe', 'ranking', 'date', 'contacts'] }], make: (c) => ({ kind: 'answer', questionBlockId: firstOfType(c, ['singleChoice', 'multiChoice', 'textInput', 'scale', 'swipe', 'ranking', 'date', 'contacts']) }) },
  { kind: 'mediaEnd', title: 'Закончилось видео или звук', hint: 'Ролик или звук доиграл до конца', fields: [{ t: 'source', key: 'source', label: 'Какой блок' }], make: (c) => ({ kind: 'mediaEnd', source: own(c) }) },
  {
    kind: 'scratched',
    title: 'Стёрли',
    hint: 'Участник стёр заданную долю покрытия',
    fields: [
      { t: 'source', key: 'source', label: 'Что стирают' },
      { t: 'num', key: 'percent', label: 'Сколько стёрто', min: 1, max: 100, step: 5, suffix: '%' },
    ],
    make: (c) => ({ kind: 'scratched', source: own(c), percent: 60 }),
  },
  {
    kind: 'deviceMotion',
    title: 'Встряхнули или наклонили телефон',
    hint: 'Работает на телефонах с датчиками',
    fields: [{ t: 'select', key: 'motion', label: 'Что сделали', options: [['shake', 'встряхнули'], ['tiltLeft', 'наклонили влево'], ['tiltRight', 'наклонили вправо'], ['tiltForward', 'наклонили от себя'], ['tiltBack', 'наклонили к себе']] }],
    make: () => ({ kind: 'deviceMotion', motion: 'shake' }),
  },
  { kind: 'key', title: 'Нажали клавишу', hint: 'Клавиша на клавиатуре компьютера', fields: [{ t: 'text', key: 'key', label: 'Какая клавиша', max: 20 }], make: () => ({ kind: 'key', key: 'Enter' }) },
];

/** What «Плавно изменить число» can move (AC-02); typed by the schema's list, so a new property must get a name. */
export const ANIMATABLE_TITLES: Record<(typeof ANIMATABLE)[number], string> = {
  x: 'Положение по горизонтали',
  y: 'Положение по вертикали',
  w: 'Ширина',
  h: 'Высота',
  rotation: 'Поворот',
  scale: 'Масштаб',
  opacity: 'Прозрачность',
  blur: 'Размытие',
  backdropBlur: 'Размытие фона',
  rotateX: 'Наклон вперёд',
  rotateY: 'Наклон вбок',
  brightness: 'Яркость',
  contrast: 'Контрастность',
  saturate: 'Насыщенность',
  grayscale: 'Чёрно-белое',
  hueRotate: 'Сдвиг цвета',
};

// ── AC-01…AC-20 ───────────────────────────────────────────────────────────────
const MODE: ReadonlyArray<readonly [string, string]> = [['show', 'показать'], ['hide', 'скрыть'], ['toggle', 'переключить']];
const duration = (label = 'Сколько длится'): SField => ({ t: 'num', key: 'durationMs', label, min: 0, max: 30000, step: 100, suffix: 'мс' });
const tgt = (c: MakeContext) => ({ kind: 'block', blockId: c.self });

export const ACTIONS: readonly PartSpec[] = [
  {
    kind: 'visibility',
    title: 'Показать или скрыть',
    hint: 'Появление и исчезновение блоков',
    fields: [
      { t: 'select', key: 'mode', label: 'Что сделать', options: MODE },
      { t: 'targets', key: 'targets', label: 'Какие блоки' },
      { t: 'bool', key: 'animate', label: 'Плавно' },
    ],
    make: (c) => ({ kind: 'visibility', targets: [tgt(c)], mode: 'hide', animate: true }),
  },
  {
    kind: 'setProperty',
    title: 'Изменить свойство',
    hint: 'Цвет, размер, положение, текст, картинка',
    fields: [{ t: 'target', key: 'target', label: 'У какого блока' }, { t: 'propertyValue', key: 'property', keys: ['property', 'value'], label: 'Что изменить' }, duration('За какое время'), { t: 'easing', key: 'easing', label: 'Как ускоряется' }],
    make: (c) => ({ kind: 'setProperty', target: tgt(c), property: 'frame.rotation', value: 15, durationMs: 300 }),
  },
  {
    kind: 'animateProperty',
    title: 'Плавно изменить число',
    hint: 'Прозрачность, поворот, масштаб, размытие — плавно до значения',
    fields: [
      { t: 'target', key: 'target', label: 'У какого блока' },
      { t: 'select', key: 'property', label: 'Что менять', options: Object.entries(ANIMATABLE_TITLES) },
      { t: 'number', key: 'to', label: 'До какого значения' },
      duration(),
      { t: 'easing', key: 'easing', label: 'Как ускоряется' },
    ],
    make: (c) => ({ kind: 'animateProperty', target: tgt(c), property: 'opacity', to: 0.5, durationMs: 300 }),
  },
  {
    kind: 'move',
    title: 'Переместить',
    hint: 'Сдвинуть блок в точку, к другому блоку или в случайное место',
    fields: [{ t: 'target', key: 'target', label: 'Какой блок' }, { t: 'destination', key: 'to', label: 'Куда' }, duration(), { t: 'easing', key: 'easing', label: 'Как ускоряется' }],
    make: (c) => ({ kind: 'move', target: tgt(c), to: { kind: 'by', dx: 0, dy: 40 }, durationMs: 300 }),
  },
  {
    kind: 'setVariable',
    title: 'Изменить переменную',
    hint: 'Записать, прибавить, умножить, выбрать случайное',
    fields: [
      { t: 'variable', key: 'variableId', label: 'Какую переменную' },
      { t: 'select', key: 'op', label: 'Что сделать', options: [['set', 'записать'], ['add', 'прибавить'], ['sub', 'вычесть'], ['mul', 'умножить на'], ['div', 'разделить на'], ['random', 'случайное число'], ['pickRandom', 'случайный элемент списка'], ['append', 'добавить в список'], ['remove', 'убрать из списка'], ['toggle', 'переключить да/нет']] },
      { t: 'scalar', key: 'value', label: 'Значение', optional: true },
      { t: 'number', key: 'min', label: 'Не меньше', optional: true },
      { t: 'number', key: 'max', label: 'Не больше', optional: true },
    ],
    make: (c) => ({ kind: 'setVariable', variableId: firstVariable(c), op: 'add', value: 1 }),
  },
  {
    kind: 'goTo',
    title: 'Перейти',
    hint: 'На следующий, предыдущий или выбранный экран',
    fields: [
      { t: 'select', key: 'to', label: 'Куда', options: [['next', 'на следующий экран'], ['back', 'назад'], ['screen', 'на выбранный экран'], ['branch', 'по ветвлению']] },
      { t: 'screen', key: 'screenId', label: 'Какой экран' },
      { t: 'transition', key: 'transition', label: 'Переход' },
    ],
    make: () => ({ kind: 'goTo', to: 'next' }),
  },
  {
    kind: 'media',
    title: 'Управлять видео или звуком',
    hint: 'Включить, поставить на паузу, остановить',
    fields: [{ t: 'target', key: 'target', label: 'Какой блок' }, { t: 'select', key: 'command', label: 'Что сделать', options: [['play', 'включить'], ['pause', 'пауза'], ['stop', 'остановить'], ['restart', 'сначала']] }],
    make: (c) => ({ kind: 'media', target: { kind: 'block', blockId: firstOfType(c, ['video', 'audio', 'gif']) }, command: 'play' }),
  },
  {
    kind: 'effect',
    title: 'Эффект',
    hint: 'Конфетти, взрыв, тряска, вспышка, вибрация',
    fields: [
      { t: 'select', key: 'effect', label: 'Какой', options: [['confetti', 'конфетти'], ['burst', 'взрыв'], ['shake', 'тряска'], ['flash', 'вспышка'], ['vibrate', 'вибрация телефона']] },
      { t: 'num', key: 'intensity', label: 'Сила', min: 0.1, max: 3, step: 0.1 },
      { t: 'target', key: 'at', label: 'Где', optional: true },
    ],
    make: () => ({ kind: 'effect', effect: 'confetti', intensity: 1 }),
  },
  { kind: 'mediaOverlay', title: 'Вставка на весь экран', hint: 'Картинка или видео с подписью поверх экрана', fields: [{ t: 'overlay', key: 'overlay', label: 'Вставка' }], make: () => ({ kind: 'mediaOverlay', overlay: { media: { source: 'media', id: 'media_unset' } } }) },
  {
    kind: 'spawn',
    title: 'Создать копию',
    hint: 'Новая копия блока в точке',
    fields: [{ t: 'block', key: 'prototypeId', label: 'Какого блока' }, { t: 'destination', key: 'at', label: 'Где' }, { t: 'num', key: 'max', label: 'Не больше копий', min: 1, max: 200 }],
    make: (c) => ({ kind: 'spawn', prototypeId: c.self, at: { kind: 'by', dx: 0, dy: 0 }, max: 50 }),
  },
  { kind: 'destroy', title: 'Удалить блок', hint: 'Убрать блок или копию с экрана', fields: [{ t: 'target', key: 'target', label: 'Какой блок' }], make: (c) => ({ kind: 'destroy', target: tgt(c) }) },
  { kind: 'wait', title: 'Подождать', hint: 'Пауза перед следующими действиями', fields: [{ t: 'num', key: 'ms', label: 'Сколько', min: 0, max: 60000, step: 100, suffix: 'мс' }], make: () => ({ kind: 'wait', ms: 500 }) },
  { kind: 'timer', title: 'Управлять таймером', hint: 'Запустить, остановить или сбросить таймер', fields: [{ t: 'block', key: 'timerBlockId', label: 'Какой таймер', types: ['timer'] }, { t: 'select', key: 'command', label: 'Что сделать', options: [['start', 'запустить'], ['stop', 'остановить'], ['reset', 'сбросить']] }], make: (c) => ({ kind: 'timer', timerBlockId: firstOfType(c, ['timer']), command: 'start' }) },
  {
    kind: 'record',
    title: 'Записать в ответы',
    hint: 'Добавить значение в ответы участника',
    fields: [{ t: 'text', key: 'label', label: 'Название записи', max: 60 }, { t: 'recordValue', key: 'value', label: 'Что записать' }],
    make: (c) => ({ kind: 'record', label: 'Запись', value: { variableId: firstVariable(c) } }),
  },
  { kind: 'finish', title: 'Завершить прохождение', hint: 'Закончить и показать результат', fields: [{ t: 'text', key: 'resultKey', label: 'Ключ результата', max: 60, optional: true }], make: () => ({ kind: 'finish' }) },
  { kind: 'openLink', title: 'Открыть ссылку', hint: 'Только по нажатию участника', fields: [{ t: 'text', key: 'url', label: 'Адрес', max: 2000 }], make: () => ({ kind: 'openLink', url: 'https://' }) },
  { kind: 'copyText', title: 'Скопировать текст', hint: 'Положить текст в буфер обмена по нажатию', fields: [{ t: 'text', key: 'text', label: 'Что скопировать', max: 2000 }], make: () => ({ kind: 'copyText', text: '' }) },
  { kind: 'interaction', title: 'Включить или выключить нажатия', hint: 'Блок перестаёт или начинает отвечать на касания', fields: [{ t: 'target', key: 'target', label: 'Какой блок' }, { t: 'bool', key: 'enabled', label: 'Отвечает на нажатия' }], make: (c) => ({ kind: 'interaction', target: tgt(c), enabled: false }) },
  {
    kind: 'answer',
    title: 'Выбрать ответ',
    hint: 'Выбрать вариант или очистить ответ вместо участника',
    fields: [
      { t: 'block', key: 'questionBlockId', label: 'Вопрос', types: ['singleChoice', 'multiChoice', 'textInput', 'scale', 'swipe', 'ranking', 'date', 'contacts'] },
      { t: 'select', key: 'command', label: 'Что сделать', options: [['select', 'выбрать вариант'], ['reset', 'очистить ответ']] },
      { t: 'optionOf', key: 'optionId', label: 'Вариант', questionKey: 'questionBlockId', optional: true },
    ],
    make: (c) => ({ kind: 'answer', questionBlockId: firstOfType(c, ['singleChoice', 'multiChoice']), command: 'reset' }),
  },
  { kind: 'shuffle', title: 'Перемешать блоки', hint: 'Поменять блоки местами случайно', fields: [{ t: 'blocks', key: 'blockIds', label: 'Какие блоки (не меньше двух)' }], make: (c) => ({ kind: 'shuffle', blockIds: [c.self, c.self] }) },
  { kind: 'playSound', title: 'Сыграть звук', hint: 'Звук из медиатеки без блока на экране', fields: [{ t: 'media', key: 'media', label: 'Звук', kinds: ['AUDIO'] }], make: () => ({ kind: 'playSound', media: { source: 'media', id: 'media_unset' } }) },
  {
    kind: 'if',
    title: 'Если … то … иначе',
    hint: 'Выполнить разные действия в зависимости от условия',
    fields: [{ t: 'condition', key: 'if', label: 'Если' }, { t: 'actions', key: 'then', label: 'То' }, { t: 'actions', key: 'else', label: 'Иначе' }],
    make: (c) => ({ kind: 'if', if: { kind: 'variable', variableId: firstVariable(c), op: 'gte', value: 1 }, then: [], else: [] }),
  },
  {
    kind: 'repeat',
    title: 'Повторить',
    hint: 'Несколько раз или пока выполняется условие',
    fields: [{ t: 'num', key: 'times', label: 'Сколько раз', min: 1, max: 10000, optional: true }, { t: 'condition', key: 'while', label: 'Пока выполняется', optional: true }, { t: 'actions', key: 'do', label: 'Что повторять' }],
    make: () => ({ kind: 'repeat', times: 3, do: [{ kind: 'wait', ms: 100 }] }),
    // «Повторить» needs a number of times or a condition: with neither, three times.
    normalize: (v) => (v.times === undefined && v.while === undefined ? { ...v, times: 3 } : v),
  },
];

// ── BH-01…BH-08 ───────────────────────────────────────────────────────────────
export const BEHAVIORS: readonly PartSpec[] = [
  {
    kind: 'drag',
    title: 'Перетаскивается',
    hint: 'Участник может тащить блок пальцем или мышью',
    fields: [
      { t: 'select', key: 'axis', label: 'Куда можно тащить', options: [['both', 'куда угодно'], ['x', 'только по горизонтали'], ['y', 'только по вертикали']] },
      { t: 'rect', key: 'bounds', label: 'Границы', optional: true },
      { t: 'zones', key: 'snapToZones', label: 'Прилипает к зонам' },
      { t: 'bool', key: 'returnIfMissed', label: 'Возвращается, если мимо' },
      { t: 'bool', key: 'onePerZone', label: 'Одна штука на зону' },
    ],
    make: () => ({ kind: 'drag', axis: 'both', snapToZones: [], returnIfMissed: true, onePerZone: false }),
  },
  {
    kind: 'flee',
    title: 'Убегает',
    hint: 'Блок уворачивается от пальца или курсора',
    fields: [
      { t: 'num', key: 'distance', label: 'На сколько убегает', min: 10, max: 500, step: 10 },
      { t: 'num', key: 'speed', label: 'Скорость', min: 0.1, max: 10, step: 0.1 },
      { t: 'num', key: 'times', label: 'Сколько раз', min: 1, max: 100 },
      { t: 'rect', key: 'area', label: 'Где можно бегать', optional: true },
    ],
    make: () => ({ kind: 'flee', distance: 80, speed: 1, times: 5 }),
  },
  {
    kind: 'scratch',
    title: 'Стирается',
    hint: 'Как скретч-карта: участник стирает покрытие',
    fields: [{ t: 'num', key: 'brush', label: 'Размер кисти', min: 5, max: 200, step: 5 }, { t: 'num', key: 'threshold', label: 'Сколько стереть до открытия', min: 1, max: 100, step: 5, suffix: '%' }],
    make: () => ({ kind: 'scratch', brush: 40, threshold: 60 }),
  },
  {
    kind: 'move',
    title: 'Движется',
    hint: 'Блок летит сам: прямо, по дуге или по контуру',
    fields: [
      { t: 'num', key: 'angle', label: 'Направление', min: 0, max: 360, step: 5, suffix: '°' },
      { t: 'num', key: 'speed', label: 'Скорость', min: 0, max: 2000, step: 10 },
      { t: 'num', key: 'spread', label: 'Разброс направления', min: 0, max: 180, step: 5, suffix: '°' },
      { t: 'num', key: 'gravity', label: 'Притяжение вниз', min: -2000, max: 2000, step: 10 },
      { t: 'select', key: 'edge', label: 'У края экрана', options: [['bounce', 'отскакивает'], ['destroy', 'исчезает'], ['wrap', 'появляется с другой стороны'], ['stop', 'останавливается']] },
      { t: 'pathText', key: 'path', label: 'Контур движения', optional: true },
    ],
    make: () => ({ kind: 'move', angle: 90, speed: 120, spread: 0, gravity: 0, edge: 'destroy' }),
  },
  {
    kind: 'spawner',
    title: 'Выпускает копии',
    hint: 'Новые копии блока появляются по расписанию',
    fields: [
      { t: 'block', key: 'prototypeId', label: 'Чьи копии' },
      { t: 'num', key: 'everyMs', label: 'Как часто', min: 50, max: 60000, step: 50, suffix: 'мс' },
      { t: 'rect', key: 'area', label: 'Где появляются' },
      { t: 'num', key: 'max', label: 'Не больше копий', min: 1, max: 200 },
      { t: 'bool', key: 'autoStart', label: 'Начинает сам' },
    ],
    make: (c) => ({ kind: 'spawner', prototypeId: c.self, everyMs: 800, area: { x: 0, y: 0, w: 390, h: 40 }, max: 30, autoStart: true }),
  },
  {
    kind: 'wheel',
    title: 'Колесо удачи',
    hint: 'Сектор выбирает сервер, результат честный',
    fields: [{ t: 'sectors', key: 'sectors', label: 'Сектора' }, { t: 'num', key: 'spinMs', label: 'Сколько крутится', min: 1000, max: 15000, step: 500, suffix: 'мс' }],
    make: (c) => ({ kind: 'wheel', sectors: [{ blockId: c.self, weight: 1 }, { blockId: c.self, weight: 1 }], spinMs: 4000 }),
  },
  {
    kind: 'flip',
    title: 'Переворачивается',
    hint: 'Карточка с двумя сторонами',
    fields: [
      { t: 'block', key: 'frontId', label: 'Лицевая сторона' },
      { t: 'block', key: 'backId', label: 'Обратная сторона' },
      { t: 'select', key: 'on', label: 'Когда', options: [['tap', 'по нажатию'], ['action', 'по действию правила']] },
      { t: 'num', key: 'durationMs', label: 'Сколько длится', min: 100, max: 3000, step: 100, suffix: 'мс' },
    ],
    make: (c) => ({ kind: 'flip', frontId: c.self, backId: c.self, on: 'tap', durationMs: 500 }),
  },
  { kind: 'follow', title: 'Следует за пальцем', hint: 'Блок едет за пальцем или курсором', fields: [{ t: 'num', key: 'lagMs', label: 'Отставание', min: 0, max: 2000, step: 10, suffix: 'мс' }, { t: 'rect', key: 'bounds', label: 'Границы', optional: true }], make: () => ({ kind: 'follow', lagMs: 80 }) },
];

// ── VR-01…VR-04 ───────────────────────────────────────────────────────────────
export const VARIABLE_TYPES: ReadonlyArray<{ type: 'number' | 'text' | 'bool' | 'list'; title: string; initial: () => unknown }> = [
  { type: 'number', title: 'Число', initial: () => 0 },
  { type: 'text', title: 'Текст', initial: () => '' },
  { type: 'bool', title: 'Да или нет', initial: () => false },
  { type: 'list', title: 'Список', initial: () => [] },
];

/** All properties the action «Изменить свойство» can set (AC-02), with the names the editor shows. */
export const PROPERTY_TITLES: Record<(typeof SETTABLE_PROPERTIES)[number], string> = {
  'frame.x': 'Положение по горизонтали',
  'frame.y': 'Положение по вертикали',
  'frame.w': 'Ширина',
  'frame.h': 'Высота',
  'frame.rotation': 'Поворот',
  'frame.flipX': 'Отражение по горизонтали',
  'frame.flipY': 'Отражение по вертикали',
  'style.shape': 'Форма',
  'style.radius': 'Скругление',
  'style.fills': 'Заливка',
  'style.stroke': 'Обводка',
  'style.shadows': 'Тени',
  'style.glow': 'Свечение',
  'style.effects': 'Эффекты',
  'style.filters': 'Фильтры',
  'style.padding': 'Внутренние отступы',
  'style.text': 'Оформление текста',
  'style.media': 'Настройки картинки или видео',
  'style.transform3d': 'Объёмный наклон',
  'style.mask': 'Маска',
  'style.layout': 'Раскладка',
  textLayer: 'Текст',
  'props.media': 'Картинка или видео',
};

export const specOf = (list: readonly PartSpec[], kind: string): PartSpec | undefined => list.find((s) => s.kind === kind);
