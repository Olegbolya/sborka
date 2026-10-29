import { describe, expect, it } from 'vitest';
import { walkBlocks } from '@blokum/schema';
import { makeDemos } from '../lib/landing/demos';
import { PassageSession } from '../lib/play/passage-session';

describe('P10.1 · живые демо-сборки лендинга — обычные документы', () => {
  it('P10.1 · каждая демо-сборка проходит проверку схемы и запускается проигрывателем', () => {
    for (const demo of makeDemos()) {
      const session = new PassageSession(demo.doc, { seed: 1 });
      expect(session.getSnapshot().screen, demo.id).not.toBeNull();
      session.dispose();
    }
  });

  it('P10.1 · «Кликер»: пятое нажатие показывает финальную надпись правилом, а не особым кодом', () => {
    const demo = makeDemos().find((d) => d.id === 'clicker')!;
    const session = new PassageSession(demo.doc, { seed: 1 });
    session.store.enter(demo.doc.screens[0]!.id);
    const blocks = [...walkBlocks(demo.doc.screens[0]!.blocks)];
    const button = blocks.find((b) => b.type === 'button')!;
    const done = blocks.find((b) => b.name === 'Готово')!;
    expect(done.initiallyHidden).toBe(true);
    for (let i = 0; i < 4; i++) session.store.dispatch({ type: 'tap', blockId: button.id });
    expect(session.store.views.get(done.id)?.visible).toBe(false);
    for (let i = 0; i < 1; i++) session.store.dispatch({ type: 'tap', blockId: button.id });
    expect(session.store.views.get(done.id)?.visible).toBe(true);
    session.dispose();
  });
});
