import { type Block, Block as BlockSchema, type BlockInput, type BlockType } from './blocks.js';
import { type ProjectDocument, ProjectDocument as DocumentSchema, type Screen, Screen as ScreenSchema } from './document.js';
import { createId } from './ids.js';
import { type Action, type Rule, Rule as RuleSchema, type RuleInput, type Trigger, type Variable, Variable as VariableSchema } from './scenario.js';
import { textOf } from './text.js';
import { type ThemeTokens } from './theme.js';

/** Default size of a new block on the 390-unit artboard. */
const SIZES: Partial<Record<BlockType, [number, number]>> = {
  text: [326, 60],
  button: [240, 56],
  singleChoice: [326, 200],
  multiChoice: [326, 200],
  textInput: [326, 56],
  scale: [326, 56],
  swipe: [300, 380],
  ranking: [326, 240],
  timer: [160, 48],
  progress: [326, 12],
  zone: [200, 200],
  value: [120, 48],
  contacts: [326, 220],
  consent: [326, 48],
};

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
  container: 'Контейнер',
  zone: 'Зона',
  value: 'Значение',
  singleChoice: 'Вопрос с одним ответом',
  multiChoice: 'Вопрос с несколькими ответами',
  textInput: 'Текстовый ответ',
  scale: 'Шкала',
  swipe: 'Свайп-карточка',
  ranking: 'Ранжирование',
  date: 'Дата',
  button: 'Кнопка',
  contacts: 'Контакты',
  consent: 'Согласие на обработку ПД',
};

function optionChild(index: number, y: number): BlockInput {
  return {
    id: createId(),
    type: 'shape',
    name: `Вариант ${index}`,
    frame: { x: 0, y, w: 326, h: 56 },
    textLayer: textOf(`Вариант ${index}`),
    props: {},
  };
}

function defaultProps(type: BlockType, children: BlockInput[]): Record<string, unknown> {
  switch (type) {
    case 'singleChoice':
    case 'multiChoice':
      return { options: children.map((c) => ({ id: createId(), blockId: c.id })) };
    case 'ranking':
      return { items: [1, 2, 3].map((n) => ({ id: createId(), label: `Пункт ${n}` })) };
    case 'contacts':
      return { fields: ['name', 'phone'] };
    case 'value':
      return { variableId: 'variable_unset' };
    default:
      return {};
  }
}

/** A new valid block of the given type with sensible defaults; `overrides` are merged on top. */
export function createBlock(type: BlockType, overrides: Partial<BlockInput> = {}): Block {
  const [w, h] = SIZES[type] ?? [200, 200];
  const children: BlockInput[] = type === 'singleChoice' || type === 'multiChoice' ? [optionChild(1, 0), optionChild(2, 72)] : [];
  const withText = ['text', 'button'].includes(type);
  const input = {
    id: createId(),
    type,
    name: LABELS[type],
    frame: { x: Math.round((390 - w) / 2), y: 100, w, h },
    ...(withText ? { textLayer: textOf(type === 'button' ? 'Дальше' : 'Текст') } : {}),
    props: defaultProps(type, children),
    children,
    ...overrides,
  };
  if (type === 'button' && !overrides.rules) {
    // The button's own rule listens to taps on itself.
    (input as { rules: RuleInput[] }).rules = [
      { id: createId(), when: { kind: 'tap', source: { kind: 'block', blockId: input.id } }, do: [{ kind: 'goTo', to: 'next' }] },
    ];
  }
  return BlockSchema.parse(input);
}

export function createScreen(name = 'Экран', overrides: Partial<Screen> = {}): Screen {
  return ScreenSchema.parse({ id: createId(), name, blocks: [], ...overrides });
}

export function createRule(when: Trigger, actions: Action[], overrides: Partial<RuleInput> = {}): Rule {
  return RuleSchema.parse({ id: createId(), when, do: actions, ...overrides });
}

export function createVariable(name: string, type: Variable['type'], initial: Variable['initial'], saveToAnswers = false): Variable {
  return VariableSchema.parse({ id: createId(), name, type, initial, saveToAnswers });
}

/** A new document with one empty screen; the theme tokens are copied into it (TH-01). */
export function createDocument(options: { title?: string; themeId?: string; tokens?: Partial<ThemeTokens> } = {}): ProjectDocument {
  return DocumentSchema.parse({
    schemaVersion: 1,
    meta: { title: options.title ?? 'Новая сборка' },
    theme: { themeId: options.themeId, tokens: options.tokens ?? {} },
    screens: [{ id: createId(), name: 'Экран 1', blocks: [] }],
  });
}
