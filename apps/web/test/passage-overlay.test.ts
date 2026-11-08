import { describe, expect, it } from 'vitest';
import { type MediaOverlay, type ProjectDocument, createBlock, createDocument, createScreen } from '@blokum/schema';
import { setMediaByAnswer } from '../lib/editor/commands';
import { createEditorStore } from '../lib/editor/store';
import { PassageSession } from '../lib/play/passage-session';

const overlay = (id: string): MediaOverlay => ({ media: { source: 'media', id }, seconds: 1.5, skippable: true });

/** Screen 1: a question with two options and a «Дальше» button; screen 2: anything. */
function build(extra?: (d: ProjectDocument) => void) {
  const doc = createDocument();
  const question = createBlock('singleChoice');
  const next = createBlock('button');
  doc.screens[0]!.blocks.push(question, next);
  doc.screens.push(createScreen('Второй'));
  extra?.(doc);
  return { doc, question, next };
}
const options = (q: ReturnType<typeof createBlock>) => (q.props as { options: Array<{ id: string; blockId: string }> }).options;

describe('T-20, T-21 · мем между экранами в плеере', () => {
  it('T-21 · мем зависит от выбранного варианта: у первого свой, у второго — другой', () => {
    for (const [pick, expected] of [[0, 'mem-pervyj'], [1, 'mem-vtoroj']] as const) {
      const { doc, question, next } = build();
      const [o1, o2] = options(question);
      doc.screens[0]!.mediaByAnswer = {
        questionBlockId: question.id,
        cases: [
          { when: { kind: 'option', optionId: o1!.id }, overlay: overlay('mem-pervyj') },
          { when: { kind: 'option', optionId: o2!.id }, overlay: overlay('mem-vtoroj') },
        ],
      };
      const session = new PassageSession(doc, { seed: 1 });
      session.store.enter(doc.screens[0]!.id);
      session.store.dispatch({ type: 'answer', questionBlockId: question.id, answer: { kind: 'choice', optionIds: [[o1, o2][pick]!.id] } });
      expect(session.getSnapshot().entryOverlay).toBeNull();
      session.store.dispatch({ type: 'tap', blockId: next.id });
      expect(session.getSnapshot().screen?.name).toBe('Второй');
      expect(session.getSnapshot().entryOverlay?.media.id).toBe(expected);
      session.dispose();
    }
  });

  it('T-20 · мем в «переходе на этот экран» показывается на пути к нему, а «Назад» его не повторяет', () => {
    const { doc, next } = build((d) => {
      d.screens[1]!.transitionIn = { kind: 'media', overlay: overlay('mem-perehod') };
      d.settings.allowBack = true;
    });
    const session = new PassageSession(doc, { seed: 1 });
    session.store.enter(doc.screens[0]!.id);
    session.store.dispatch({ type: 'tap', blockId: next.id });
    expect(session.getSnapshot().entryOverlay?.media.id).toBe('mem-perehod');
    session.back();
    expect(session.getSnapshot().screen?.id).toBe(doc.screens[0]!.id);
    expect(session.getSnapshot().entryOverlay).toBeNull();
    session.dispose();
  });

  it('T-21 · без совпавшего случая показывается мем перехода, а без обоих — ничего', () => {
    const { doc, question, next } = build((d) => {
      d.screens[1]!.transitionIn = { kind: 'media', overlay: overlay('mem-perehod') };
    });
    doc.screens[0]!.mediaByAnswer = { questionBlockId: question.id, cases: [{ when: { kind: 'option', optionId: 'drugoj' }, overlay: overlay('mem-ne-tot') }] };
    const session = new PassageSession(doc, { seed: 1 });
    session.store.enter(doc.screens[0]!.id);
    session.store.dispatch({ type: 'tap', blockId: next.id });
    expect(session.getSnapshot().entryOverlay?.media.id).toBe('mem-perehod');
    session.dispose();
  });

  it('T-21 · команда редактора записывает правило, отвергает неверное и снимает его', () => {
    const { doc, question } = build();
    const store = createEditorStore(doc);
    const screenId = doc.screens[0]!.id;
    store.getState().apply(setMediaByAnswer(screenId, { questionBlockId: question.id, cases: [{ when: { kind: 'wrong' }, overlay: overlay('mem-ne') }] }), { label: 'Мем по ответу' });
    expect(store.getState().doc.screens[0]!.mediaByAnswer?.cases).toHaveLength(1);
    store.getState().apply(setMediaByAnswer(screenId, { questionBlockId: question.id, cases: [] }), { label: 'Мем по ответу' });
    expect(store.getState().doc.screens[0]!.mediaByAnswer?.cases).toHaveLength(1); // пустой список схема не принимает
    store.getState().apply(setMediaByAnswer(screenId, undefined), { label: 'Мем по ответу' });
    expect(store.getState().doc.screens[0]!.mediaByAnswer).toBeUndefined();
  });
});
