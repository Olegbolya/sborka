import { describe, expect, it } from 'vitest';
import { ProjectDocument } from '@blokum/schema';
import { STARTER_TEMPLATES } from '@blokum/themes';
import { PreviewSession } from '../lib/editor/preview-session';

/* TPL-03 · P10.4: четыре шаблона-«формы» проходятся на настоящем рантайме от первого экрана до финала, как в предпросмотре. */
function open(name: string) {
  const tpl = STARTER_TEMPLATES.find((t) => t.name === name)!;
  const doc = ProjectDocument.parse(tpl.document);
  const session = new PreviewSession(doc, { seed: 1, scheduler: { request: () => 1, cancel: () => undefined } });
  let entered: string | null = null;
  const sync = () => {
    const screen = session.getSnapshot().screen;
    if (screen && screen.id !== entered) {
      entered = screen.id;
      session.store.stop();
      session.store.enter(screen.id);
    }
  };
  sync();
  const optionOf = (questionId: string, index: number) => {
    const q = doc.screens.flatMap((s) => s.blocks).find((b) => b.id === questionId)!;
    return (q.props as { options: Array<{ id: string }> }).options[index]!.id;
  };
  return {
    doc,
    session,
    screen: () => session.getSnapshot().screen?.id ?? null,
    ended: () => session.getSnapshot().ended,
    tap: (blockId: string) => {
      session.store.dispatch({ type: 'tap', blockId });
      sync();
    },
    text: (questionBlockId: string, value: string) => session.store.dispatch({ type: 'answer', questionBlockId, answer: { kind: 'text', value } }),
    choose: (questionBlockId: string, index: number) => session.store.dispatch({ type: 'answer', questionBlockId, answer: { kind: 'choice', optionIds: [optionOf(questionBlockId, index)] } }),
  };
}

describe('TPL-03 · «Письмо Деду Морозу»', () => {
  it('TPL-03 · без ответов дальше не пускает; три ответа — письмо отправлено, игра заканчивается', () => {
    const g = open('Письмо Деду Морозу');
    g.tap('dmoroz_start');
    expect(g.screen()).toBe('dmoroz_pismo');
    g.tap('dmoroz_send');
    expect(g.screen()).toBe('dmoroz_pismo');
    g.text('dmoroz_imya', 'Маша');
    g.text('dmoroz_god', 'Я хорошо училась и помогала дома');
    g.text('dmoroz_mechta', 'Хочу собаку');
    g.tap('dmoroz_send');
    expect(g.screen()).toBe('dmoroz_final');
    g.tap('dmoroz_konec');
    expect(g.ended()).toBe(true);
  });
});

describe('TPL-03 · «Викторина с баллами»', () => {
  it('TPL-03 · три правильных ответа — тридцать баллов, и участник доходит до финала', () => {
    const g = open('Викторина с баллами');
    g.tap('viktor_start');
    const right = [1, 2, 0];
    right.forEach((o, i) => {
      expect(g.screen()).toBe(`viktor_ekran_q${i}`);
      g.tap(`viktor_n${i}`);
      expect(g.screen()).toBe(`viktor_ekran_q${i}`);
      g.choose(`viktor_q${i}`, o);
      g.tap(`viktor_n${i}`);
    });
    expect(g.session.textValue({ sys: 'баллы' })).toBe('30');
    expect(g.session.textValue({ sys: 'максимум' })).toBe('30');
    expect(g.screen()).toBe('viktor_r2');
  });
});

describe('TPL-03 · «Анонимный опрос»', () => {
  it('TPL-03 · оценка и выбор обязательны, пожелание — по желанию; в опросе нет полей с именем и контактами', () => {
    const g = open('Анонимный опрос');
    expect(JSON.stringify(g.doc)).not.toMatch(/"semantic":"(name|phone|email|city)"|"type":"contacts"/);
    g.tap('oprosn_start');
    g.tap('oprosn_n0');
    expect(g.screen()).toBe('oprosn_ekran_q0');
    g.session.store.dispatch({ type: 'answer', questionBlockId: 'oprosn_ocenka', answer: { kind: 'number', value: 5 } });
    g.tap('oprosn_n0');
    g.tap('oprosn_n1');
    expect(g.screen()).toBe('oprosn_ekran_q1');
    g.choose('oprosn_q1', 0);
    g.tap('oprosn_n1');
    g.tap('oprosn_n2');
    expect(g.screen()).toBe('oprosn_final');
    g.tap('oprosn_konec');
    expect(g.ended()).toBe(true);
  });
});

describe('TPL-03 · «Приглашение с ответом»', () => {
  it('TPL-03 · ответ и имя обязательны; после отправки — финал', () => {
    const g = open('Приглашение с ответом');
    g.tap('rsvpok_start');
    g.tap('rsvpok_send');
    expect(g.screen()).toBe('rsvpok_otvet');
    g.choose('rsvpok_q', 1);
    g.text('rsvpok_imya', 'Семья Ивановых');
    g.text('rsvpok_kolvo', '3');
    g.tap('rsvpok_send');
    expect(g.screen()).toBe('rsvpok_final');
    g.tap('rsvpok_konec');
    expect(g.ended()).toBe(true);
  });
});
