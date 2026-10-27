import { type Block, type BlockType, type ProjectDocument, type ThemeTokens, createBlock, createDocument, textOf } from '@blokum/schema';

/** The blocks the sample screen shows, in the order a person meets them (TH-02: «образцовый экран со всеми типами блоков»). */
const SAMPLE_TYPES: BlockType[] = [
  'text',
  'button',
  'shape',
  'image',
  'singleChoice',
  'multiChoice',
  'textInput',
  'scale',
  'swipe',
  'ranking',
  'date',
  'contacts',
  'consent',
  'timer',
  'progress',
  'value',
  'container',
  'zone',
  'gif',
  'video',
  'audio',
  'animation',
];

const GAP = 16;

/** The sample screen: every type of block under the other, with the theme's tokens in the document. */
export function sampleDocument(tokens: ThemeTokens): ProjectDocument {
  const doc = createDocument({ title: 'Образец' });
  doc.theme = { tokens };
  let y = GAP;
  const blocks: Block[] = SAMPLE_TYPES.map((type) => {
    const block = createBlock(type);
    block.frame.y = y;
    y += block.frame.h + GAP;
    if (type === 'text') block.textLayer = textOf('Заголовок и обычный текст темы');
    if (type === 'shape') block.textLayer = textOf('Фигура с подписью');
    return block;
  });
  const screen = doc.screens[0]!;
  screen.blocks = blocks;
  screen.height = Math.min(5000, Math.max(400, y));
  return doc;
}
