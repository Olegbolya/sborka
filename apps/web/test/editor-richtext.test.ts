import { describe, expect, it } from 'vitest';
import { RichText } from '@blokum/schema';
import { fromEditorDoc, toEditorDoc } from '../lib/editor/rich-text';

const sample: RichText = {
  paragraphs: [
    { kind: 'p', runs: [{ t: 'Привет, ' }, { t: 'мир', b: true, i: true }, { t: ' ' }, { v: 'abcdef' }, { t: ' ссылка', u: true, s: true, href: 'https://example.ru/a' }] },
    { kind: 'bullet', runs: [{ t: 'раз' }] },
    { kind: 'bullet', runs: [{ t: 'два' }, { sys: 'баллы' }] },
    { kind: 'ordered', runs: [{ t: 'первый' }, { answer: 'qwerty' }] },
    { kind: 'p', runs: [] },
  ],
};

describe('B-01 · текст блока между документом и редактором', () => {
  it('B-01 · абзацы, отметки, ссылка, списки и подстановки проходят туда и обратно без потерь', () => {
    const doc = toEditorDoc(sample);
    expect(doc.content?.map((n) => n.type)).toEqual(['paragraph', 'bulletList', 'orderedList', 'paragraph']);
    expect(doc.content?.[1]?.content).toHaveLength(2);
    expect(fromEditorDoc(doc)).toEqual(sample);
    expect(RichText.safeParse(fromEditorDoc(doc)).success).toBe(true);
  });

  it('B-01 · пустой текст — один пустой абзац; обратно получается абзац без фрагментов', () => {
    expect(toEditorDoc(undefined).content).toEqual([{ type: 'paragraph' }]);
    expect(fromEditorDoc(toEditorDoc(undefined))).toEqual({ paragraphs: [{ kind: 'p', runs: [] }] });
  });

  it('B-01 · отметки, которых нет в документе, отбрасываются', () => {
    const out = fromEditorDoc({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'код', marks: [{ type: 'code' }, { type: 'bold' }] }] }] });
    expect(out.paragraphs[0]!.runs).toEqual([{ t: 'код', b: true }]);
  });
});
