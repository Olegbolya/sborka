import { describe, expect, it } from 'vitest';
import { ProjectDocument, createBlock, createDocument, plainText, textOf, walkBlocks } from '@blokum/schema';
import { OCCASIONS, applyPhoto, applyTexts, editableTexts, fillScratch, firstImage } from '../lib/wizard/wizard';

const MEDIA = 'a'.repeat(21);

describe('P10.2 · мастер первой сборки собирает обычный документ', () => {
  it('P10.2 · с нуля: заголовок и текст на первом экране, документ проходит проверку схемы', () => {
    const doc = fillScratch(createDocument({ title: 'Открытка' }), { heading: 'Привет!', text: 'Как дела?' });
    expect(() => ProjectDocument.parse(doc)).not.toThrow();
    const texts = editableTexts(doc);
    expect(texts.map((t) => t.value)).toEqual(['Привет!', 'Как дела?']);
    expect(firstImage(doc)).toBeNull();
  });

  it('P10.2 · с нуля и с фото: картинка сверху, тексты ниже', () => {
    const doc = fillScratch(createDocument({ title: 'Открытка' }), { heading: 'Привет!', text: 'Как дела?', mediaId: MEDIA });
    const blocks = [...walkBlocks(doc.screens[0]!.blocks)];
    expect(blocks.map((b) => b.type)).toEqual(['image', 'text', 'text']);
    expect(blocks[0]!.type === 'image' && blocks[0]!.props.media).toEqual({ source: 'media', id: MEDIA });
    expect(blocks[1]!.frame.y).toBeGreaterThan(blocks[0]!.frame.y + blocks[0]!.frame.h - 1);
  });

  it('P10.2 · шаблон: меняются только изменённые тексты, у остальных остаётся оформление', () => {
    const doc = createDocument({ title: 'Шаблон' });
    const a = createBlock('text', { name: 'Верх', frame: { x: 20, y: 40, w: 300, h: 60 }, textLayer: { paragraphs: [{ kind: 'p', runs: [{ t: 'Старый', b: true }] }] } });
    const b = createBlock('text', { name: 'Низ', frame: { x: 20, y: 200, w: 300, h: 60 }, textLayer: textOf('Низ') });
    doc.screens[0]!.blocks.push(b, a);
    expect(editableTexts(doc).map((t) => t.name)).toEqual(['Верх', 'Низ']);
    const next = applyTexts(doc, { [a.id]: 'Новый', [b.id]: 'Низ' });
    const na = [...walkBlocks(next.screens[0]!.blocks)].find((x) => x.id === a.id)!;
    expect(plainText(na.textLayer!)).toBe('Новый');
    const nb = [...walkBlocks(next.screens[0]!.blocks)].find((x) => x.id === b.id)!;
    expect(nb.textLayer).toEqual(b.textLayer);
    expect(plainText(a.textLayer!)).toBe('Старый');
  });

  it('P10.2 · фото попадает в первую картинку шаблона, а без картинки в шаблоне добавляется новая сверху', () => {
    const withImage = createDocument({ title: 'С картинкой' });
    withImage.screens[0]!.blocks.push(createBlock('image', { props: { media: { source: 'media', id: 'b'.repeat(21) } } }));
    const replaced = applyPhoto(withImage, MEDIA);
    const img = firstImage(replaced)!;
    expect(img.type === 'image' && img.props.media).toEqual({ source: 'media', id: MEDIA });
    expect(replaced.screens[0]!.blocks).toHaveLength(1);
    const plain = applyPhoto(createDocument({ title: 'Без' }), MEDIA);
    expect(plain.screens[0]!.blocks[0]!.type).toBe('image');
    expect(() => ProjectDocument.parse(plain)).not.toThrow();
  });

  it('P10.2 · поводы: у каждого есть название и подсказки, «Другое» не сужает галерею', () => {
    for (const o of OCCASIONS) expect([o.label, o.title, o.heading, o.text].every((x) => x.length > 0), o.id).toBe(true);
    expect(OCCASIONS.find((o) => o.id === 'other')!.category).toBe('');
  });
});
