'use client';
import { useState } from 'react';
import { ApiError } from '../../lib/api-browser';
import { loadProject } from '../../lib/editor/remote';
import { Dialog } from './Dialog';
import { useEnv } from './context';

/** E-18 · the server refused a stale save: take the fresh version or overwrite it with this one. */
export function ConflictDialog() {
  const { saver, projectId, loadDocument, flash } = useEnv();
  const [busy, setBusy] = useState(false);

  const fresh = async () => {
    setBusy(true);
    try {
      const p = await loadProject(projectId);
      if (!p.document || p.draftVersionNumber === null) throw new ApiError(500, 'NO_DRAFT', 'У сборки нет черновика');
      await saver.acceptServerVersion(p.draftVersionNumber);
      loadDocument(p.document);
      flash('Загружена свежая версия. Ваши правки с этой вкладки не сохранены.', 'ok');
    } catch {
      flash('Не удалось загрузить свежую версию. Проверьте соединение и повторите.', 'error');
      setBusy(false);
    }
  };

  const overwrite = async () => {
    setBusy(true);
    await saver.overwriteServer();
    setBusy(false);
  };

  return (
    <Dialog title="Сборку изменили в другом месте">
      <p className="ed-hint" style={{ margin: 0 }}>
        Пока вы работали, эту сборку сохранили в другой вкладке или на другом устройстве. Можно загрузить свежую версию (правки с этой
        вкладки пропадут) или перезаписать её тем, что открыто здесь (правки с другой вкладки пропадут).
      </p>
      <div className="row">
        <button type="button" className="ed-btn primary" disabled={busy} onClick={() => void fresh()}>
          Загрузить свежую
        </button>
        <button type="button" className="ed-btn danger" disabled={busy} onClick={() => void overwrite()}>
          Перезаписать
        </button>
      </div>
    </Dialog>
  );
}
