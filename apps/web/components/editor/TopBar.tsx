'use client';
import Link from 'next/link';
import { useState, useSyncExternalStore } from 'react';
import { api, errorText, isApiError } from '../../lib/api-browser';
import { setTitle } from '../../lib/editor/commands';
import { useEditor, useEnv } from './context';

const STATUS_NAMES = { DRAFT: 'Черновик', PUBLISHED: 'Опубликована', CLOSED: 'Закрыта' } as const;

/** E-16 · the top bar: title, save status, undo/redo, history, preview, publish. */
export function TopBar({ status, onStatus, onPreview, onHistory, onLogic, onScenarios, onTheme, onLessons }: { status: keyof typeof STATUS_NAMES; onStatus: (s: keyof typeof STATUS_NAMES) => void; onPreview: () => void; onHistory: () => void; onLogic: () => void; onScenarios: () => void; onTheme: () => void; onLessons: () => void }) {
  const { saver, projectId, store, flash } = useEnv();
  const title = useEditor((s) => s.doc.meta.title);
  const apply = useEditor((s) => s.apply);
  const canUndo = useEditor((s) => s.past.length > 0 && s.gesture === null);
  const canRedo = useEditor((s) => s.future.length > 0 && s.gesture === null);
  const save = useSyncExternalStore(saver.subscribe, () => saver.state, () => saver.state);
  const [publishing, setPublishing] = useState(false);

  const publish = async () => {
    setPublishing(true);
    try {
      await saver.flush();
      if (saver.state.status === 'conflict' || saver.state.status === 'error') {
        flash('Сначала нужно сохранить правки — публикация остановлена.', 'error');
        return;
      }
      await api(`/projects/${encodeURIComponent(projectId)}/publish`, { method: 'POST' });
      onStatus('PUBLISHED');
      const { slug } = await api<{ slug: string }>(`/projects/${encodeURIComponent(projectId)}`);
      flash(`Сборка опубликована: ${window.location.origin}/s/${slug}. QR-код можно взять в кабинете.`, 'ok');
    } catch (e) {
      const issues = isApiError(e) ? (e.issues ?? []) : [];
      flash(issues.length > 0 ? `${errorText(e)} ${issues.slice(0, 3).map((i) => i.message).join('; ')}${issues.length > 3 ? '…' : ''} Полный список — «Логика» → «Проверка».` : errorText(e), 'error');
    } finally {
      setPublishing(false);
    }
  };

  return (
    <header className="ed-top" aria-label="Верхняя панель">
      <Link href="/cabinet/projects" className="ed-btn" style={{ textDecoration: 'none' }}>
        ← Мои сборки
      </Link>
      <input
        className="ed-title"
        aria-label="Название сборки"
        value={title}
        maxLength={120}
        onChange={(e) => apply(setTitle(e.target.value), { label: 'Название сборки', mergeKey: 'title' })}
        onBlur={(e) => {
          if (!e.target.value.trim()) flash('Название не может быть пустым.', 'error');
        }}
      />
      <span className="ed-status" role="status" aria-live="polite" data-testid="save-status" data-status={save.status}>
        {save.text}
      </span>
      <span className="ed-spacer" />
      <button type="button" className="ed-btn" onClick={() => store.getState().undo()} disabled={!canUndo} aria-label="Отменить" title="Отменить (Ctrl+Z)">
        ↶ Отменить
      </button>
      <button type="button" className="ed-btn" onClick={() => store.getState().redo()} disabled={!canRedo} aria-label="Повторить" title="Повторить (Ctrl+Shift+Z)">
        ↷ Повторить
      </button>
      <button type="button" className="ed-btn" onClick={onHistory}>
        История
      </button>
      <button type="button" className="ed-btn" data-lesson="theme" onClick={onTheme}>
        Тема
      </button>
      <button type="button" className="ed-btn" data-lesson="scenarios" onClick={onScenarios}>
        Сценарии
      </button>
      <button type="button" className="ed-btn" onClick={onLogic}>
        Логика
      </button>
      <button type="button" className="ed-btn" onClick={onLessons}>
        Уроки
      </button>
      <button type="button" className="ed-btn" data-lesson="preview" onClick={onPreview}>
        Предпросмотр
      </button>
      <span className="ed-hint" data-testid="project-status">
        {STATUS_NAMES[status]}
      </span>
      <button type="button" className="ed-btn primary" onClick={() => void publish()} disabled={publishing || status === 'PUBLISHED'}>
        {publishing ? 'Публикуем…' : 'Опубликовать'}
      </button>
    </header>
  );
}
