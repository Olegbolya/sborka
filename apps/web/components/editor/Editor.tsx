'use client';
import { type ProjectDocument } from '@blokum/schema';
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { isApiError, errorText } from '../../lib/api-browser';
import { duplicateBlocks, removeBlocks } from '../../lib/editor/commands';
import { IdbQueue, browserSaverDeps, loadProject } from '../../lib/editor/remote';
import { Saver } from '../../lib/editor/saver';
import { type EditorStore, createEditorStore } from '../../lib/editor/store';
import './editor.css';
import { Canvas } from './Canvas';
import { ConflictDialog } from './ConflictDialog';
import { EditorProvider, type EditorEnv } from './context';
import { HistoryDialog } from './HistoryDialog';
import { Inspector } from './Inspector';
import { LeftPanel } from './LeftPanel';
import { PreviewDialog } from './PreviewDialog';
import { TopBar } from './TopBar';

type Loaded = { store: EditorStore; saver: Saver; status: 'DRAFT' | 'PUBLISHED' | 'CLOSED'; restored: boolean };

const isTyping = (t: EventTarget | null): boolean => {
  const el = t as HTMLElement | null;
  return !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable);
};

/** P3.1 · the editor of one project: loads the draft, owns the store and the saver, wires keys and the window events. */
export function Editor({ projectId }: { projectId: string }) {
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [status, setStatus] = useState<Loaded['status']>('DRAFT');
  const [dialog, setDialog] = useState<'preview' | 'history' | null>(null);
  const [message, setMessage] = useState<{ text: string; kind: 'ok' | 'error' } | null>(null);
  const suppress = useRef(false);

  useEffect(() => {
    let cancelled = false;
    let saverRef: Saver | null = null;
    void (async () => {
      try {
        const p = await loadProject(projectId);
        if (cancelled) return;
        if (!p.document || p.draftVersionNumber === null) {
          setFailure('У этой сборки нет черновика.');
          return;
        }
        const queue = new IdbQueue();
        const saver = new Saver(projectId, browserSaverDeps(() => window.location.assign('/login'), queue), p.draftVersionNumber);
        saverRef = saver;
        const store = createEditorStore(p.document);
        store.subscribe((s, prev) => {
          if (s.docVersion !== prev.docVersion && !suppress.current) saver.changed(s.doc);
        });
        // E-17: changes that were not sent last time (no network, page closed) are put back and sent.
        const queued = await queue.get(projectId);
        let restored = false;
        if (queued && JSON.stringify(queued.document) !== JSON.stringify(p.document)) {
          suppress.current = true;
          store.getState().replaceDocument(queued.document);
          suppress.current = false;
          saver.restore(queued);
          restored = true;
        } else if (queued) {
          await queue.remove(projectId);
        }
        if (cancelled) return;
        setStatus(p.status);
        setLoaded({ store, saver, status: p.status, restored });
      } catch (e) {
        if (cancelled) return;
        if (isApiError(e) && e.status === 401) {
          window.location.replace('/login');
          return;
        }
        setFailure(isApiError(e) && (e.status === 403 || e.status === 404) ? 'Такой сборки нет или она принадлежит другому человеку.' : errorText(e));
      }
    })();
    return () => {
      cancelled = true;
      saverRef?.dispose();
    };
  }, [projectId]);

  const saver = loaded?.saver;
  const store = loaded?.store;

  // E-17: network events and leaving the page.
  useEffect(() => {
    if (!saver) return;
    const onLine = () => saver.networkBack();
    const offLine = () => saver.networkLost();
    const hide = () => {
      if (document.visibilityState === 'hidden') saver.leaving();
    };
    const pagehide = () => saver.leaving();
    window.addEventListener('online', onLine);
    window.addEventListener('offline', offLine);
    document.addEventListener('visibilitychange', hide);
    window.addEventListener('pagehide', pagehide);
    return () => {
      window.removeEventListener('online', onLine);
      window.removeEventListener('offline', offLine);
      document.removeEventListener('visibilitychange', hide);
      window.removeEventListener('pagehide', pagehide);
    };
  }, [saver]);

  // E-11: keys. Text fields keep their own undo.
  useEffect(() => {
    if (!store || !saver) return;
    const onKey = (e: KeyboardEvent) => {
      if (document.querySelector('[role="dialog"]')) return;
      const mod = e.ctrlKey || e.metaKey;
      const s = store.getState();
      const key = e.key.toLowerCase();
      if (mod && key === 's') {
        e.preventDefault();
        void saver.flush();
        return;
      }
      if (isTyping(e.target)) return;
      if (mod && key === 'z' && !e.shiftKey) {
        e.preventDefault();
        s.undo();
      } else if (mod && (key === 'y' || (key === 'z' && e.shiftKey))) {
        e.preventDefault();
        s.redo();
      } else if (mod && key === 'd' && s.selection.blockIds.length > 0) {
        e.preventDefault();
        let created: string[] = [];
        s.apply(duplicateBlocks(s.selection.blockIds, (ids) => (created = ids)), { label: 'Дублировать блоки' });
        if (created.length) store.getState().select(s.selection.screenId, created);
      } else if ((key === 'delete' || key === 'backspace') && s.selection.blockIds.length > 0) {
        e.preventDefault();
        s.apply(removeBlocks(s.selection.blockIds), { label: 'Удалить блоки' });
      } else if (key === 'escape') {
        s.select(s.selection.screenId, []);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [store, saver]);

  useEffect(() => {
    if (!message) return;
    const t = setTimeout(() => setMessage(null), 8000);
    return () => clearTimeout(t);
  }, [message]);

  const flash = useCallback((text: string, kind: 'ok' | 'error' = 'ok') => setMessage({ text, kind }), []);
  const loadDocument = useCallback(
    (doc: ProjectDocument) => {
      suppress.current = true;
      store?.getState().replaceDocument(doc);
      suppress.current = false;
    },
    [store],
  );

  const env: EditorEnv | null = useMemo(() => (store && saver ? { store, saver, projectId, flash, loadDocument } : null), [store, saver, projectId, flash, loadDocument]);

  useEffect(() => {
    if (loaded?.restored) flash('Восстановлены несохранённые правки с прошлого раза — они сохраняются.', 'ok');
  }, [loaded, flash]);

  if (failure) {
    return (
      <main style={{ minHeight: '100dvh', display: 'grid', placeItems: 'center', padding: 24 }}>
        <div style={{ maxWidth: 460 }}>
          <h1 style={{ fontSize: 24 }}>Не удалось открыть редактор</h1>
          <p role="alert">{failure}</p>
          <a href="/cabinet/projects">Вернуться к сборкам</a>
        </div>
      </main>
    );
  }
  if (!env || !loaded) {
    return (
      <main style={{ minHeight: '100dvh', display: 'grid', placeItems: 'center' }}>
        <p style={{ color: 'var(--muted)' }}>Открываем редактор…</p>
      </main>
    );
  }

  return (
    <EditorProvider value={env}>
      <div className="ed-root" data-testid="editor">
        <TopBar status={status} onStatus={setStatus} onPreview={() => setDialog('preview')} onHistory={() => setDialog('history')} />
        <Body message={message} dialog={dialog} setDialog={setDialog} saver={env.saver} store={env.store} />
      </div>
    </EditorProvider>
  );
}

function Body({ message, dialog, setDialog, saver, store }: { message: { text: string; kind: 'ok' | 'error' } | null; dialog: 'preview' | 'history' | null; setDialog: (d: 'preview' | 'history' | null) => void; saver: Saver; store: EditorStore }) {
  const save = useSyncExternalStore(saver.subscribe, () => saver.state, () => saver.state);
  const doc = useSyncExternalStore(store.subscribe, () => store.getState().doc, () => store.getState().doc);
  return (
    <>
      {message && (
        <p role={message.kind === 'error' ? 'alert' : 'status'} className={`ed-banner ${message.kind === 'ok' ? 'ok' : ''}`} style={{ margin: 8 }}>
          {message.text}
        </p>
      )}
      <div className="ed-body">
        <LeftPanel />
        <Canvas />
        <Inspector />
      </div>
      {save.status === 'conflict' && <ConflictDialog />}
      {dialog === 'history' && <HistoryDialog onClose={() => setDialog(null)} />}
      {dialog === 'preview' && <PreviewDialog doc={doc} onClose={() => setDialog(null)} />}
    </>
  );
}
