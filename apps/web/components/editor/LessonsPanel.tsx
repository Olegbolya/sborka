'use client';
import { useEffect, useMemo, useState } from 'react';
import { LESSONS, completed, currentStep } from '../../lib/editor/lessons';
import { useEditor } from './context';

const KEY = 'bk:lesson';
const remembered = (): string | null => {
  try {
    return window.localStorage.getItem(KEY);
  } catch {
    return null;
  }
};
const remember = (id: string | null) => {
  try {
    if (id) window.localStorage.setItem(KEY, id);
    else window.localStorage.removeItem(KEY);
  } catch {
    // Память браузера может быть закрыта: урок просто не запомнится.
  }
};

/** P10.5 · урок внутри редактора: список уроков, шаги с галочками, подсветка нужного места. Не закрывает холст. */
export function LessonsPanel({ onClose }: { onClose: () => void }) {
  const doc = useEditor((s) => s.doc);
  const [lessonId, setLessonId] = useState<string | null>(() => LESSONS.find((l) => l.id === remembered())?.id ?? null);
  const [manual, setManual] = useState<ReadonlySet<number>>(new Set());
  const [folded, setFolded] = useState(false);
  const lesson = LESSONS.find((l) => l.id === lessonId) ?? null;
  const flags = useMemo(() => (lesson ? completed(lesson, doc, manual) : []), [lesson, doc, manual]);
  const now = currentStep(flags);
  const step = lesson?.steps[now];
  const target = step?.target;

  // Нужный элемент может появиться позже (вкладка открылась, окно построилось): подсветка следит за страницей.
  useEffect(() => {
    if (!target || folded) return;
    const mark = () => document.querySelectorAll(target).forEach((e) => e.setAttribute('data-lesson-glow', ''));
    mark();
    const watcher = new MutationObserver(mark);
    watcher.observe(document.body, { childList: true, subtree: true });
    return () => {
      watcher.disconnect();
      document.querySelectorAll('[data-lesson-glow]').forEach((e) => e.removeAttribute('data-lesson-glow'));
    };
  }, [target, folded]);

  const open = (id: string | null) => {
    setLessonId(id);
    setManual(new Set());
    remember(id);
  };

  return (
    <aside className="ed-lesson" role="complementary" aria-label="Урок" data-testid="lesson-panel">
      <div className="ed-row">
        <strong style={{ flex: 1 }}>{lesson ? lesson.title : 'Уроки'}</strong>
        <button type="button" className="ed-btn small" aria-expanded={!folded} onClick={() => setFolded(!folded)}>
          {folded ? 'Развернуть' : 'Свернуть'}
        </button>
        <button type="button" className="ed-btn small" aria-label="Закрыть уроки" onClick={onClose}>
          ✕
        </button>
      </div>
      {!folded && !lesson && (
        <>
          <p className="ed-hint">Выберите урок: подсказки идут по шагам и сами замечают, что вы сделали. Всё делается своими руками и своими материалами.</p>
          <ul className="ed-list" aria-label="Список уроков">
            {LESSONS.map((l) => (
              <li key={l.id}>
                <button type="button" className="ed-btn" style={{ width: '100%', textAlign: 'left' }} data-lesson-id={l.id} onClick={() => open(l.id)}>
                  <strong>{l.title}</strong>
                  <br />
                  <span className="ed-hint">{l.summary}</span>
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
      {!folded && lesson && (
        <>
          <p className="ed-hint" data-testid="lesson-progress">
            Шаг {Math.min(now + 1, lesson.steps.length)} из {lesson.steps.length}
          </p>
          <ol className="ed-lesson-steps" aria-label="Шаги урока">
            {lesson.steps.map((s, i) => (
              <li key={s.title} data-done={flags[i] ? 'true' : 'false'} aria-current={i === now ? 'step' : undefined}>
                <span aria-hidden>{flags[i] ? '✓ ' : i === now ? '→ ' : '○ '}</span>
                <span className="ed-sr">{flags[i] ? 'Сделано: ' : i === now ? 'Сейчас: ' : 'Дальше: '}</span>
                {s.title}
              </li>
            ))}
          </ol>
          {step ? (
            <div className="ed-lesson-now">
              <p>{step.text}</p>
              {!step.done && (
                <button type="button" className="ed-btn primary small" onClick={() => setManual(new Set([...manual, now]))}>
                  Готово
                </button>
              )}
            </div>
          ) : (
            <p role="status" className="ed-banner ok">
              Урок пройден. Сборку можно доработать и опубликовать.
            </p>
          )}
          <button type="button" className="ed-btn small" onClick={() => open(null)}>
            Все уроки
          </button>
        </>
      )}
    </aside>
  );
}
