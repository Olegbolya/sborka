'use client';
import { Artboard, PlayerScreen } from '@blokum/renderer';
import { type ProjectDocument } from '@blokum/schema';
import { useEffect, useState, useSyncExternalStore } from 'react';
import { PreviewSession } from '../../lib/editor/preview-session';
import { Dialog } from './Dialog';

type Frame = 'phone' | 'desktop';
const SIZES: Record<Frame, { w: number; h: number; unit: number }> = {
  phone: { w: 390, h: 844, unit: 1 },
  // E-02: on a computer the player is a column of 480 px in the middle of the window.
  desktop: { w: 1024, h: 600, unit: 480 / 390 },
};

function VariableEditor({ session, id, name, type }: { session: PreviewSession; id: string; name: string; type: string }) {
  const value = session.runtime.variables[id];
  const [text, setText] = useState('');
  const [editing, setEditing] = useState(false);
  const shown = Array.isArray(value) ? value.join(', ') : String(value ?? '');
  useEffect(() => {
    if (!editing) setText(shown);
  }, [shown, editing]);
  const label = `Переменная «${name}»`;
  if (type === 'bool') {
    return (
      <label className="ed-field" style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 0 }}>
        <input type="checkbox" checked={value === true} aria-label={label} onChange={(e) => session.setVariable(id, e.target.checked)} />
        <span>{name}</span>
      </label>
    );
  }
  return (
    <label className="ed-field" style={{ marginBottom: 0 }}>
      <span>{name}</span>
      <input
        type={type === 'number' ? 'number' : 'text'}
        aria-label={label}
        value={text}
        onFocus={() => setEditing(true)}
        onBlur={() => setEditing(false)}
        onChange={(e) => {
          setText(e.target.value);
          if (type === 'number') {
            if (Number.isFinite(e.target.valueAsNumber)) session.setVariable(id, e.target.valueAsNumber);
          } else if (type === 'list') {
            session.setVariable(
              id,
              e.target.value
                .split(',')
                .map((x) => x.trim())
                .filter(Boolean)
                .map((x) => (Number.isFinite(Number(x)) ? Number(x) : x)),
            );
          } else {
            session.setVariable(id, e.target.value);
          }
        }}
      />
    </label>
  );
}

/**
 * E-20 · preview: the whole passage in a phone or a computer frame with the real scenario runtime. Nothing is sent
 * to the server (isPreview): answers do not reach the cabinet, analytics or limits. The debugger (SC-03) shows
 * the variables and lets the author change them; the log of fired rules and step mode come with the scenario editor.
 */
export function PreviewDialog({ doc, onClose }: { doc: ProjectDocument; onClose: () => void }) {
  const [frame, setFrame] = useState<Frame>('phone');
  const [session, setSession] = useState(() => new PreviewSession(doc));
  useEffect(() => () => session.dispose(), [session]);
  const view = useSyncExternalStore(session.subscribe, session.getSnapshot, session.getSnapshot);
  useSyncExternalStore(session.store.subscribe, session.store.getSnapshot, session.store.getSnapshot);
  const size = SIZES[frame];

  return (
    <Dialog title="Предпросмотр" onClose={onClose} wide>
      <div className="ed-actions" style={{ marginTop: 0, marginBottom: 12, alignItems: 'center' }}>
        <div role="group" aria-label="Рамка" style={{ display: 'flex', gap: 4 }}>
          <button type="button" className="ed-btn small" aria-pressed={frame === 'phone'} onClick={() => setFrame('phone')}>
            Телефон 390×844
          </button>
          <button type="button" className="ed-btn small" aria-pressed={frame === 'desktop'} onClick={() => setFrame('desktop')}>
            Компьютер
          </button>
        </div>
        <button type="button" className="ed-btn small" onClick={() => session.back()} disabled={!view.canGoBack}>
          Назад
        </button>
        <button type="button" className="ed-btn small" onClick={() => setSession(new PreviewSession(doc))}>
          Начать заново
        </button>
        <span className="ed-hint" data-testid="preview-badge">
          Предпросмотр: ответы никуда не отправляются
        </span>
      </div>
      <div className="ed-preview-wrap">
        <div>
          <div
            className={`ed-frame ${frame === 'phone' ? 'ed-phone' : 'ed-desktop'}`}
            data-preview="true"
            data-frame={frame}
            style={{ width: size.w + 20, height: Math.min(size.h, 640) + 20 }}
          >
            <div style={{ width: size.w, height: Math.min(size.h, 640), overflow: 'auto', position: 'relative' }}>
              {view.screen ? (
                <Artboard mode="player" unit={size.unit} tokens={doc.theme.tokens}>
                  <PlayerScreen key={`${view.screen.id}:${view.screenKey}`} screen={view.screen} store={session.store} {...(view.progress ? { progress: view.progress } : {})} />
                </Artboard>
              ) : (
                <div className="ed-end" data-testid="preview-end">
                  <strong>Прохождение завершено</strong>
                  {view.resultKey && <span>Результат: {view.resultKey}</span>}
                </div>
              )}
            </div>
          </div>
          {view.message && (
            <p role="alert" className="ed-banner" style={{ marginTop: 8, maxWidth: size.w + 20 }}>
              {view.message}
            </p>
          )}
        </div>
        <section className="ed-debug" aria-label="Отладчик">
          <h3 style={{ margin: '0 0 8px', fontSize: 14 }}>Отладчик</h3>
          <div className="ed-vars">
            {doc.variables.length === 0 && <p className="ed-hint">В сборке нет переменных.</p>}
            {doc.variables.map((v) => (
              <VariableEditor key={v.id} session={session} id={v.id} name={v.name} type={v.type} />
            ))}
          </div>
          <div className="ed-actions">
            <button type="button" className="ed-btn small" onClick={() => session.restartScreen()} disabled={!view.screen}>
              Перезапустить экран
            </button>
          </div>
        </section>
      </div>
      <div className="row">
        <button type="button" className="ed-btn" onClick={onClose}>
          Закрыть
        </button>
      </div>
    </Dialog>
  );
}
