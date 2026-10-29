import { type Block, type ThemeTokens, type ProjectDocument, ProjectDocument as DocumentSchema, createBlock, createDocument, createId, createScreen, createVariable, textOf } from '@blokum/schema';

/**
 * P10.1 · the live pieces of the landing and of «Примеры». They are ordinary documents made of ordinary blocks, rules and
 * behaviours — the same a creator makes in the editor; the player plays them as it plays any assembly (nothing here is a special case).
 */
export interface Demo {
  id: string;
  title: string;
  about: string;
  doc: ProjectDocument;
}

const say = (text: string, y: number, extra: Partial<Parameters<typeof createBlock>[1]> = {}): Block =>
  createBlock('text', { frame: { x: 32, y, w: 326, h: 80 }, textLayer: textOf(text), ...extra });

/** What the schema accepts for the tokens: the groups of a style are completed by its own defaults when the document is parsed. */
type ThemeTokensInput = Partial<ThemeTokens>;

const round = (r: number) => ({ unit: 'u' as const, tl: r, tr: r, br: r, bl: r });
const solid = (token: 'primary' | 'accent' | 'surface') => [{ kind: 'solid' as const, color: { token, alpha: 1 } }];

/** The look of the demos is the theme's work (TH-06), like for any assembly: the blocks themselves carry no colours. */
const DEMO_TOKENS = {
  blockDefaults: {
    text: { text: { size: 24, weight: 700, align: 'center' as const, verticalAlign: 'middle' as const, lineHeight: 1.25 } },
    button: { fills: solid('primary'), radius: round(18), text: { size: 20, weight: 800, align: 'center' as const, verticalAlign: 'middle' as const, paint: { kind: 'solid' as const, color: { token: 'surface' as const, alpha: 1 } } } },
    shape: { fills: solid('accent'), radius: round(28) },
    value: { text: { size: 64, weight: 900, align: 'center' as const, verticalAlign: 'middle' as const } },
  },
};

function single(title: string, blocks: Block[], variables: ReturnType<typeof createVariable>[] = []): ProjectDocument {
  const base = createDocument({ title, tokens: DEMO_TOKENS as unknown as ThemeTokensInput });
  return DocumentSchema.parse({ ...base, variables, screens: [createScreen('Экран', { blocks })] });
}

function catchTheButton(): ProjectDocument {
  const button = createBlock('button', { name: 'Кнопка', frame: { x: 75, y: 300, w: 240, h: 64 }, textLayer: textOf('Нажми меня') });
  const caught = say('Поймали! Так за минуту получается мини-игра.', 220, { name: 'Поймали', initiallyHidden: true });
  const withRule = {
    ...button,
    behaviors: [{ kind: 'flee' as const, distance: 120, speed: 1.4, times: 4 }],
    rules: [
      {
        id: createId(),
        when: { kind: 'tap' as const, source: { kind: 'block' as const, blockId: button.id } },
        do: [
          { kind: 'visibility' as const, targets: [{ kind: 'block' as const, blockId: caught.id }], mode: 'show' as const, animate: true },
          { kind: 'visibility' as const, targets: [{ kind: 'block' as const, blockId: button.id }], mode: 'hide' as const, animate: true },
        ],
      },
    ],
  };
  return single('Поймай кнопку', [say('Попробуй нажать на кнопку', 120, { name: 'Подсказка' }), withRule as Block, caught]);
}

function clicker(): ProjectDocument {
  const counter = createVariable('Нажатия', 'number', 0);
  const button = createBlock('button', { name: 'Жми', frame: { x: 75, y: 330, w: 240, h: 64 }, textLayer: textOf('Жми!') });
  const shown = createBlock('value', { name: 'Счёт', frame: { x: 95, y: 180, w: 200, h: 90 }, props: { variableId: counter.id, format: 'number' } });
  const done = say('Пять! Условия и действия — вот и вся магия.', 430, { name: 'Готово', initiallyHidden: true });
  const withRules = {
    ...button,
    rules: [
      {
        id: createId(),
        when: { kind: 'tap' as const, source: { kind: 'block' as const, blockId: button.id } },
        do: [{ kind: 'setVariable' as const, variableId: counter.id, op: 'add' as const, value: 1 }],
      },
      {
        id: createId(),
        when: { kind: 'variableChange' as const, variableId: counter.id },
        if: { kind: 'variable' as const, variableId: counter.id, op: 'gte' as const, value: 5 },
        do: [{ kind: 'visibility' as const, targets: [{ kind: 'block' as const, blockId: done.id }], mode: 'show' as const, animate: true }],
      },
    ],
  };
  return single('Кликер', [say('Нажми пять раз', 90, { name: 'Подсказка' }), shown, withRules as Block, done], [counter]);
}

function dragMe(): ProjectDocument {
  const gift = createBlock('shape', { name: 'Подарок', frame: { x: 145, y: 380, w: 100, h: 100 }, behaviors: [{ kind: 'drag', axis: 'both', snapToZones: [], returnIfMissed: false, onePerZone: false }] });
  return single('Потяни', [say('Возьми подарок и унеси, куда хочешь', 120, { name: 'Подсказка' }), gift]);
}

/** Built on demand (the first one is on the home page; the rest only on «Примеры»). */
export function makeDemos(): Demo[] {
  return [
    { id: 'catch', title: 'Поймай кнопку', about: 'Кнопка убегает, пока её не поймаешь, — одно поведение «Убегает» и одно правило.', doc: catchTheButton() },
    { id: 'clicker', title: 'Кликер', about: 'Переменная, правило «Когда нажали — прибавить» и условие «если пять — показать».', doc: clicker() },
    { id: 'drag', title: 'Потяни', about: 'Любой блок можно сделать перетаскиваемым — одним поведением.', doc: dragMe() },
  ];
}
