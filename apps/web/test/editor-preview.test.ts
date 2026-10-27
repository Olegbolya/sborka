import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ProjectDocument, createBlock, createId, createScreen } from '@blokum/schema';
import { PreviewSession } from '../lib/editor/preview-session';

/** A frame loop that never runs by itself: the tests step the session by hand. */
const noFrames = { request: () => 1, cancel: () => undefined };

const button = (name = 'Дальше') => createBlock('button', { name });
const docOf = (screens: ReturnType<typeof createScreen>[], extra: Record<string, unknown> = {}): ProjectDocument =>
  ProjectDocument.parse({ schemaVersion: 1, screens, ...extra });
const open = (doc: ProjectDocument) => {
  const session = new PreviewSession(doc, { seed: 1, scheduler: noFrames });
  const show = () => session.store.enter(session.getSnapshot().screen!.id);
  show();
  return { session, show };
};

describe('E-20 · предпросмотр проходит сборку по правилам игрока', () => {
  it('E-20 · кнопка «дальше» ведёт на следующий экран, на последнем — конец', () => {
    const b1 = button();
    const b2 = button();
    const { session, show } = open(docOf([createScreen('Один', { blocks: [b1] }), createScreen('Два', { blocks: [b2] })]));
    expect(session.getSnapshot().screen!.name).toBe('Один');
    session.store.dispatch({ type: 'tap', blockId: b1.id });
    expect(session.getSnapshot().screen!.name).toBe('Два');
    expect(session.getSnapshot().canGoBack).toBe(true);
    show();
    session.store.dispatch({ type: 'tap', blockId: b2.id });
    expect(session.getSnapshot()).toMatchObject({ screen: null, ended: true });
  });

  it('E-20 · «назад» возвращает на прошлый экран; запрещён настройкой «разрешить назад»', () => {
    const b1 = button();
    const doc = docOf([createScreen('Один', { blocks: [b1] }), createScreen('Два')]);
    const { session } = open(doc);
    session.store.dispatch({ type: 'tap', blockId: b1.id });
    session.back();
    expect(session.getSnapshot().screen!.name).toBe('Один');
    expect(session.getSnapshot().canGoBack).toBe(false);
    session.back(); // first screen: nowhere to go
    expect(session.getSnapshot().message).toBe('Это первый экран');

    const strict = docOf([createScreen('Один', { blocks: [button()] }), createScreen('Два')], { settings: { allowBack: false } });
    const t = open(strict);
    t.session.store.dispatch({ type: 'tap', blockId: strict.screens[0]!.blocks[0]!.id });
    expect(t.session.getSnapshot().canGoBack).toBe(false);
  });

  it('E-20 · обязательный вопрос не пускает дальше, пока нет ответа; понятное сообщение по-русски', () => {
    const q = createBlock('singleChoice', { name: 'Вопрос' });
    (q.props as { required: boolean }).required = true;
    const b = button();
    const { session, show } = open(docOf([createScreen('Вопрос', { blocks: [q, b] }), createScreen('Итог')]));
    session.store.dispatch({ type: 'tap', blockId: b.id });
    expect(session.getSnapshot().screen!.name).toBe('Вопрос');
    expect(session.getSnapshot().message).toMatch(/[а-яё]/i);
    show();
    const option = (q.props as { options: Array<{ id: string }> }).options[0]!.id;
    session.store.dispatch({ type: 'answer', questionBlockId: q.id, answer: { kind: 'choice', optionIds: [option] } });
    session.store.dispatch({ type: 'tap', blockId: b.id });
    expect(session.getSnapshot()).toMatchObject({ message: null });
    expect(session.getSnapshot().screen!.name).toBe('Итог');
  });

  it('E-20 · после отказа «дальше» экран не замирает: ответ принимается, второе нажатие проходит', () => {
    const q = createBlock('singleChoice', { name: 'Вопрос' });
    (q.props as { required: boolean }).required = true;
    const b = button();
    const { session } = open(docOf([createScreen('Вопрос', { blocks: [q, b] }), createScreen('Итог')]));
    session.store.dispatch({ type: 'tap', blockId: b.id });
    expect(session.getSnapshot().message).not.toBeNull();
    const option = (q.props as { options: Array<{ id: string }> }).options[0]!.id;
    session.store.dispatch({ type: 'answer', questionBlockId: q.id, answer: { kind: 'choice', optionIds: [option] } });
    expect(session.runtime.currentAnswers[q.id]).toBeDefined();
    session.store.dispatch({ type: 'tap', blockId: b.id });
    expect(session.getSnapshot()).toMatchObject({ message: null });
    expect(session.getSnapshot().screen!.name).toBe('Итог');
  });

  it('E-20 · ответы и переменные сохраняются при переходе между экранами', () => {
    const q = createBlock('textInput', { name: 'Имя' });
    const b = button();
    const { session } = open(docOf([createScreen('Один', { blocks: [q, b] }), createScreen('Два')]));
    session.store.dispatch({ type: 'answer', questionBlockId: q.id, answer: { kind: 'text', value: 'Аня' } });
    session.store.dispatch({ type: 'tap', blockId: b.id });
    expect(session.runtime.currentAnswers[q.id]).toEqual({ kind: 'text', value: 'Аня' });
  });

  it('E-20 · показ прогресса «экран N из M» по настройке', () => {
    const doc = docOf([createScreen('Один'), createScreen('Два')], { settings: { showProgress: true } });
    expect(open(doc).session.getSnapshot().progress).toEqual({ index: 1, total: 2 });
    expect(open(docOf([createScreen('Один')])).session.getSnapshot().progress).toBeNull();
  });

  it('E-20 · ветвление по условию ведёт на нужный экран', () => {
    const q = createBlock('singleChoice', { name: 'Вопрос' });
    const opts = (q.props as { options: Array<{ id: string }> }).options;
    const b = button();
    b.rules = [{ id: createId(), when: { kind: 'tap', source: { kind: 'block', blockId: b.id } }, do: [{ kind: 'goTo', to: 'branch' }] }] as never;
    const target = createScreen('Особый');
    const doc = docOf([
      createScreen('Вопрос', {
        blocks: [q, b],
        branches: [{ id: createId(), if: { kind: 'answer', questionBlockId: q.id, op: 'selected', optionId: opts[1]!.id }, to: { kind: 'screen', screenId: target.id } }] as never,
      }),
      createScreen('Обычный'),
      target,
    ]);
    const { session } = open(doc);
    session.store.dispatch({ type: 'answer', questionBlockId: q.id, answer: { kind: 'choice', optionIds: [opts[1]!.id] } });
    session.store.dispatch({ type: 'tap', blockId: b.id });
    expect(session.getSnapshot().screen!.name).toBe('Особый');
  });

  it('SC-03 · перезапуск экрана меняет screenKey и оставляет ответы; смена подписчиков стабильна', () => {
    const { session } = open(docOf([createScreen('Один')]));
    const before = session.getSnapshot();
    expect(session.getSnapshot()).toBe(before);
    const seen = vi.fn();
    const off = session.subscribe(seen);
    session.restartScreen();
    expect(session.getSnapshot().screenKey).toBe(before.screenKey + 1);
    expect(seen).toHaveBeenCalledTimes(1);
    off();
    session.restartScreen();
    expect(seen).toHaveBeenCalledTimes(1);
  });

  it('SC-03 · переменная правится вручную: значение меняется, неверный тип отклоняется', () => {
    const v = { id: createId(), name: 'Очки', type: 'number', initial: 0, saveToAnswers: false };
    const { session } = open(docOf([createScreen('Один')], { variables: [v] }));
    expect(session.setVariable(v.id, 42)).toBe(true);
    expect(session.runtime.variables[v.id]).toBe(42);
    expect(session.setVariable(v.id, 'много')).toBe(false);
    expect(session.runtime.variables[v.id]).toBe(42);
  });

  it('E-20 · dispose останавливает цикл и снимает подписчиков', () => {
    const { session } = open(docOf([createScreen('Один')]));
    const seen = vi.fn();
    session.subscribe(seen);
    session.dispose();
    session.restartScreen();
    expect(seen).not.toHaveBeenCalled();
  });
});

describe('E-20 · таймер экрана и результат', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('L-06 · время экрана вышло — переход туда, куда задал автор', () => {
    const doc = docOf([createScreen('На время', { timer: { seconds: 2, onExpire: { kind: 'finish' } } }), createScreen('Дальше')]);
    const { session } = open(doc);
    vi.advanceTimersByTime(1900);
    expect(session.getSnapshot().ended).toBe(false);
    vi.advanceTimersByTime(200);
    expect(session.getSnapshot().ended).toBe(true);
  });

  it('L-04 · действие «завершить» показывает экран результата по правилу баллов; без правила — конец', () => {
    const result = createScreen('Результат', { kind: 'result' });
    const finishBtn = createBlock('button', { name: 'Готово' });
    finishBtn.rules = [{ id: createId(), when: { kind: 'tap', source: { kind: 'block', blockId: finishBtn.id } }, do: [{ kind: 'finish' }] }] as never;
    const doc = docOf([createScreen('Игра', { blocks: [finishBtn] }), result], {
      results: [{ kind: 'scoreRange', id: createId(), key: 'otlichno', screenId: result.id, min: 0, max: 10 }],
    });
    const { session } = open(doc);
    session.store.dispatch({ type: 'tap', blockId: finishBtn.id });
    expect(session.getSnapshot().screen!.name).toBe('Результат');
    expect(session.getSnapshot().resultKey).toBe('otlichno');

    const bare = docOf([createScreen('Игра', { blocks: [finishBtn] })]);
    const t = open(bare);
    t.session.store.dispatch({ type: 'tap', blockId: finishBtn.id });
    expect(t.session.getSnapshot()).toMatchObject({ ended: true, screen: null, resultKey: null });
  });
});
