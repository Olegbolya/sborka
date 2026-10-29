import { type Block, type ProjectDocument, createBlock, plainText, textOf, walkBlocks } from '@blokum/schema';

/**
 * P10.2 · the first assembly in five steps. Everything the wizard makes is an ordinary document of ordinary blocks: it fills
 * the first screen with a picture, a heading and a text, or changes the texts and the picture of a template. Nothing here
 * depends on there being templates in the gallery.
 */
export interface Occasion {
  id: string;
  label: string;
  /** What to suggest in the fields (the creator rewrites it); the category is how the gallery of templates is narrowed. */
  title: string;
  heading: string;
  text: string;
  category: string;
}

export const OCCASIONS: readonly Occasion[] = [
  { id: 'birthday', label: 'День рождения', title: 'С днём рождения', heading: 'С днём рождения!', text: 'Пусть сбывается всё, о чём мечтаешь.', category: 'Праздники' },
  { id: 'holiday', label: 'Праздник', title: 'Праздничная открытка', heading: 'С праздником!', text: 'Тепла, радости и хорошего настроения.', category: 'Праздники' },
  { id: 'invite', label: 'Приглашение', title: 'Приглашение', heading: 'Приглашаем вас', text: 'Дата, время и место — расскажите, куда прийти.', category: 'Приглашения' },
  { id: 'survey', label: 'Опрос или анкета', title: 'Опрос', heading: 'Ответьте на несколько вопросов', text: 'Это займёт не больше минуты.', category: 'Опросы' },
  { id: 'quiz', label: 'Тест или квиз', title: 'Квиз', heading: 'Проверьте себя', text: 'Отвечайте на вопросы и узнайте результат.', category: 'Тесты' },
  { id: 'game', label: 'Игра', title: 'Мини-игра', heading: 'Сыграем?', text: 'Правила игры в двух словах.', category: 'Игры' },
  { id: 'other', label: 'Другое', title: 'Новая сборка', heading: 'Заголовок', text: 'Текст сборки.', category: '' },
];

export interface EditableText {
  id: string;
  name: string;
  value: string;
}

const MAX_TEXTS = 8;

/** The texts a person would want to change in a template: the text blocks of its first screen, top to bottom. */
export function editableTexts(doc: ProjectDocument): EditableText[] {
  const screen = doc.screens[0];
  if (!screen) return [];
  return [...walkBlocks(screen.blocks)]
    .filter((b) => b.type === 'text' && b.textLayer)
    .sort((a, b) => a.frame.y - b.frame.y)
    .slice(0, MAX_TEXTS)
    .map((b) => ({ id: b.id, name: b.name, value: plainText(b.textLayer!) }));
}

/** Rewrites the texts that were changed; the others keep their own formatting. */
export function applyTexts(doc: ProjectDocument, values: Record<string, string>): ProjectDocument {
  const next = structuredClone(doc);
  for (const screen of next.screens) {
    for (const block of walkBlocks(screen.blocks)) {
      const value = values[block.id];
      if (value !== undefined && block.textLayer && value !== plainText(block.textLayer)) block.textLayer = textOf(value);
    }
  }
  return next;
}

export function firstImage(doc: ProjectDocument): Block | null {
  const screen = doc.screens[0];
  if (!screen) return null;
  for (const block of walkBlocks(screen.blocks)) if (block.type === 'image') return block;
  return null;
}

/** The picture goes into the first image of the document; when there is none, a new image block opens the first screen. */
export function applyPhoto(doc: ProjectDocument, mediaId: string): ProjectDocument {
  const next = structuredClone(doc);
  const existing = firstImage(next);
  if (existing && existing.type === 'image') {
    existing.props = { ...existing.props, media: { source: 'media', id: mediaId } };
    return next;
  }
  next.screens[0]?.blocks.unshift(createBlock('image', { frame: { x: 20, y: 30, w: 350, h: 250 }, props: { media: { source: 'media', id: mediaId } } }));
  return next;
}

/** A project from scratch: the heading and the text (and the picture) on the first screen. */
export function fillScratch(doc: ProjectDocument, input: { heading: string; text: string; mediaId?: string }): ProjectDocument {
  const next = structuredClone(doc);
  const top = input.mediaId ? 300 : 90;
  const blocks: Block[] = [];
  if (input.mediaId) blocks.push(createBlock('image', { frame: { x: 20, y: 30, w: 350, h: 250 }, props: { media: { source: 'media', id: input.mediaId } } }));
  blocks.push(
    createBlock('text', {
      name: 'Заголовок',
      frame: { x: 20, y: top, w: 350, h: 90 },
      textLayer: textOf(input.heading),
      style: { text: { size: 30, weight: 800, align: 'center', verticalAlign: 'middle', lineHeight: 1.2 } },
    }),
    createBlock('text', {
      name: 'Текст',
      frame: { x: 30, y: top + 100, w: 330, h: 160 },
      textLayer: textOf(input.text),
      style: { text: { size: 20, align: 'center', lineHeight: 1.4 } },
    }),
  );
  next.screens[0]!.blocks = blocks;
  return next;
}
