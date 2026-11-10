'use client';
import Link from 'next/link';
import { useEffect, useState, useSyncExternalStore } from 'react';
import { api, errorText, isApiError } from '../../lib/api-browser';
import { setTitle } from '../../lib/editor/commands';
import { PassDialog } from './PassDialog';
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
  // Опубликованная версия — копия черновика на момент публикации; правки после неё доходят до людей только новой публикацией.
  const doc = useEditor((s) => s.doc);
  const [publishedDoc, setPublishedDoc] = useState<unknown>(null);
  const hasUnpublished = status !== 'PUBLISHED' || publishedDoc === null || doc !== publishedDoc;
  const [savingTemplate, setSavingTemplate] = useState(false);
  const [passReasons, setPassReasons] = useState<string[] | null>(null);

  // Человек вернулся из ЮKassa: оплата подтверждается у провайдера не мгновенно, поэтому сразу говорим, что делать дальше.
  useEffect(() => {
    const url = new URL(window.location.href);
    if (!url.searchParams.has('paid')) return;
    url.searchParams.delete('paid');
    window.history.replaceState(null, '', url.pathname + url.search);
    flash('Спасибо! Как только платёж подтвердится, нажмите «Опубликовать» ещё раз.', 'ok');
  }, [flash]);

  const saveAsTemplate = async () => {
    setSavingTemplate(true);
    try {
      await saver.flush();
      await api(`/templates`, { method: 'POST', body: { projectId } });
      flash('Шаблон сохранён.', 'ok');
    } catch (e) {
      flash(errorText(e), 'error');
    } finally {
      setSavingTemplate(false);
    }
  };

  const publish = async () => {
    setPublishing(true);
    try {
      await saver.flush();
      if (saver.state.status === 'conflict' || saver.state.status === 'error') {
        flash('Сначала нужно сохранить правки — публикация остановлена.', 'error');
        return;
      }
      const sent = store.getState().doc;
      const result = await api<{ review?: boolean; warnings?: string[] } | null>(`/projects/${encodeURIComponent(projectId)}/publish`, { method: 'POST' });
      setPublishedDoc(sent);
      // P9.1 (TS-03): a new account that names a bank or a state body waits for a moderator — the link does not open yet.
      if (result?.review) {
        onStatus('CLOSED');
        flash('Сборка отправлена на проверку модератору: в ней названы организации или есть слова, которые мы смотрим вручную. Ссылка заработает, как только проверка закончится — обычно в течение суток. Мы напишем в уведомлениях.', 'ok');
        return;
      }
      onStatus('PUBLISHED');
      const { slug } = await api<{ slug: string }>(`/projects/${encodeURIComponent(projectId)}`);
      const warning = result?.warnings && result.warnings.length > 0 ? ` Обратите внимание: ${result.warnings[0]}` : '';
      flash(`Сборка опубликована: ${window.location.origin}/s/${slug}. QR-код можно взять в кабинете.${warning}`, 'ok');
    } catch (e) {
      const issues = isApiError(e) ? (e.issues ?? []) : [];
      if (isApiError(e) && e.status === 402 && e.code === 'PLAN_LIMIT') {
        setPassReasons(issues.length > 0 ? issues.map((i) => i.message) : [e.message]);
        return;
      }
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
      <button type="button" className="ed-btn" onClick={onHistory} title="Прошлые версии сборки: посмотреть и вернуться к любой">
        История
      </button>
      <button type="button" className="ed-btn" data-lesson="theme" onClick={onTheme} title="Цвета, шрифты и скругления всей сборки">
        Тема
      </button>
      <button type="button" className="ed-btn" data-lesson="scenarios" onClick={onScenarios} title="Что происходит по нажатию, таймеру и другим событиям: «Когда → Если → Сделать»">
        Сценарии
      </button>
      <button type="button" className="ed-btn" onClick={onLogic} title="Переменные, баллы и результаты теста">
        Логика
      </button>
      <button type="button" className="ed-btn" onClick={onLessons} title="Короткие уроки: как собрать сборку шаг за шагом">
        Уроки
      </button>
      <button type="button" className="ed-btn" data-testid="tool-template-save" onClick={() => void saveAsTemplate()} disabled={savingTemplate} title="Сохранить эту сборку как шаблон, чтобы начинать новые с неё">
        {savingTemplate ? 'Сохраняем…' : 'Шаблон'}
      </button>
      <button type="button" className="ed-btn" data-lesson="preview" onClick={onPreview} title="Пройти сборку так, как её увидят участники">
        Предпросмотр
      </button>
      <span className="ed-hint" data-testid="project-status">
        {STATUS_NAMES[status]}
      </span>
      <button type="button" className="ed-btn primary" onClick={() => void publish()} disabled={publishing || !hasUnpublished}>
        {publishing ? 'Публикуем…' : status === 'PUBLISHED' ? 'Опубликовать изменения' : 'Опубликовать'}
      </button>
      {passReasons && <PassDialog projectId={projectId} reasons={passReasons} onClose={() => setPassReasons(null)} />}
    </header>
  );
}
