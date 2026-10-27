'use client';
import { Artboard, ScreenView } from '@blokum/renderer';
import { type ProjectDocument } from '@blokum/schema';
import { useEffect, useState } from 'react';
import { api, errorText } from '../../lib/api-browser';
import { Dialog } from './Dialog';
import { useEnv } from './context';

interface VersionItem {
  id: string;
  number: number;
  kind: 'DRAFT_SNAPSHOT' | 'PUBLISHED';
  createdAt: string;
}

const KIND_TITLE: Record<VersionItem['kind'], string> = { DRAFT_SNAPSHOT: 'Снимок черновика', PUBLISHED: 'Опубликованная версия' };
const when = (iso: string) => new Date(iso).toLocaleString('ru-RU', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Europe/Moscow' });

/** E-19 · history of versions: snapshots, a look at each, restoring. The draft being replaced is kept as a snapshot. */
export function HistoryDialog({ onClose }: { onClose: () => void }) {
  const { projectId, saver, loadDocument, flash } = useEnv();
  const [versions, setVersions] = useState<VersionItem[] | null>(null);
  const [chosen, setChosen] = useState<{ item: VersionItem; document: ProjectDocument } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let live = true;
    api<VersionItem[]>(`/projects/${encodeURIComponent(projectId)}/versions`)
      .then((v) => live && setVersions(v))
      .catch((e: unknown) => live && setError(errorText(e)));
    return () => {
      live = false;
    };
  }, [projectId]);

  const look = async (item: VersionItem) => {
    setError(null);
    try {
      const v = await api<{ document: ProjectDocument }>(`/projects/${encodeURIComponent(projectId)}/versions/${item.id}`);
      setChosen({ item, document: v.document });
    } catch (e) {
      setError(errorText(e));
    }
  };

  const restore = async () => {
    if (!chosen) return;
    setBusy(true);
    setError(null);
    try {
      await saver.flush(); // what is on the screen goes to the server first, so it ends up in a snapshot
      const res = await api<{ revision: number; document: ProjectDocument }>(`/projects/${encodeURIComponent(projectId)}/restore/${chosen.item.id}`, { method: 'POST', body: {} });
      await saver.acceptServerVersion(res.revision);
      loadDocument(res.document);
      flash('Версия восстановлена. Прежний вариант остался в истории.', 'ok');
      onClose();
    } catch (e) {
      setError(errorText(e));
      setBusy(false);
    }
  };

  const first = chosen?.document.screens[0];
  return (
    <Dialog title="История версий" onClose={onClose} wide>
      {error && (
        <p role="alert" className="ed-banner" style={{ marginBottom: 10 }}>
          {error}
        </p>
      )}
      {versions === null && !error && <p className="ed-hint">Загружаем…</p>}
      {versions?.length === 0 && <p className="ed-hint">Пока нет сохранённых версий: первый снимок появится после первой правки.</p>}
      <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
        {versions && versions.length > 0 && (
          <ul className="ed-list" aria-label="Версии" style={{ flex: '1 1 260px' }}>
            {versions.map((v) => (
              <li key={v.id}>
                <button type="button" className="ed-item" aria-pressed={chosen?.item.id === v.id} onClick={() => void look(v)}>
                  <span className="name">
                    {KIND_TITLE[v.kind]} · {when(v.createdAt)}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
        {chosen && first && (
          <div style={{ flex: '0 0 auto' }} data-testid="version-preview">
            <p className="ed-hint" style={{ marginBottom: 8 }}>
              Первый экран версии «{chosen.document.meta.title}»
            </p>
            <div className="ed-thumb" style={{ width: 390 * 0.5, height: Math.min(first.height * 0.5, 420) }}>
              <Artboard mode="thumbnail" unit={0.5} tokens={chosen.document.theme.tokens}>
                <ScreenView screen={first} />
              </Artboard>
            </div>
          </div>
        )}
      </div>
      <div className="row">
        <button type="button" className="ed-btn primary" disabled={!chosen || busy} onClick={() => void restore()}>
          Восстановить эту версию
        </button>
        <button type="button" className="ed-btn" onClick={onClose}>
          Закрыть
        </button>
      </div>
    </Dialog>
  );
}
