'use client';
import { Artboard, PlayerScreen } from '@blokum/renderer';
import { type ProjectDocument } from '@blokum/schema';
import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { DebugLog, describeEntry, ruleIndex } from '../../lib/editor/debug-log';
import { PreviewSession } from '../../lib/editor/preview-session';
import { Dialog } from './Dialog';
import { useEnv } from './context';

type Frame = 'phone' | 'desktop';
const SIZES: Record<Frame, { w: number; h: number; unit: number }> = {
  phone: { w: 390, h: 844, unit: 1 },
  // E-02: on a computer the player is a column of 480 px in the middle of the window.
  desktop: { w: 1024, h: 600, unit: 480 / 390 },
};

/** The block that started a rule, as a frame on the screen of the preview: its own place plus the places of the containers around it. */
function sourceBox(session: PreviewSession, id: string, unit: number): { x: number; y: number; w: number; h: number } | null {
  const views = session.store.views;
  const v = views.get(id);
  if (!v || !v.visible) return null;
  let x = v.x;
  let y = v.y;
  for (let parent = v.parentId ? views.get(v.parentId) : undefined; parent; parent = parent.parentId ? views.get(parent.parentId) : undefined) {
    x += parent.x;
    y += parent.y;
  }
  return { x: x * unit, y: y * unit, w: v.w * unit, h: v.h * unit };
}

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
  const { media } = useEnv();
  const [frame, setFrame] = useState<Frame>('phone');
  const [log] = useState(() => new DebugLog());
  const [session, setSession] = useState(() => new PreviewSession(doc, { debug: log }));
  const [stepMode, setStepMode] = useState(false);
  const [focusId, setFocusId] = useState<string | null>(null);
  const entries = useSyncExternalStore(log.subscribe, log.getSnapshot, log.getSnapshot);
  const restart = () => {
    log.clear();
    setStepMode(false);
    setFocusId(null);
    setSession(new PreviewSession(doc, { debug: log }));
  };
  useEffect(() => () => session.dispose(), [session]);
  const view = useSyncExternalStore(session.subscribe, session.getSnapshot, session.getSnapshot);
  useSyncExternalStore(session.store.subscribe, session.store.getSnapshot, session.store.getSnapshot);
  const size = SIZES[frame];
  const rules = useMemo(() => ruleIndex(doc), [doc]);
  const last = entries[entries.length - 1];
  const highlighted = focusId ?? last?.event.self ?? null;
  const box = highlighted ? sourceBox(session, highlighted, size.unit) : null;

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
        <button type="button" className="ed-btn small" onClick={restart}>
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
              {box && <div className="ed-hl" data-testid="debug-highlight" aria-hidden style={{ left: box.x, top: box.y, width: box.w, height: box.h }} />}
              {view.screen ? (
                <Artboard mode="player" unit={size.unit} tokens={doc.theme.tokens} media={media.resolver} runText={session.textValue}>
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
          <div className="ed-field" style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <input
              id="debug-step"
              type="checkbox"
              checked={stepMode}
              onChange={(e) => {
                setStepMode(e.target.checked);
                session.store.setStepMode(e.target.checked);
              }}
            />
            <label htmlFor="debug-step">Пошагово: правила ждут перед каждым действием</label>
          </div>
          {stepMode && (
            <div className="ed-actions">
              <button type="button" className="ed-btn small" disabled={session.runtime.pausedRules === 0} onClick={() => session.store.stepOnce()}>
                Шаг
              </button>
              <span className="ed-hint" data-testid="debug-waiting">
                Ждёт: {session.runtime.pausedRules}
              </span>
            </div>
          )}
          <h3 style={{ margin: '12px 0 6px', fontSize: 14 }}>Журнал правил</h3>
          <ol className="ed-log" role="log" aria-label="Журнал правил" data-testid="debug-log">
            {entries.length === 0 && <li className="ed-hint">Пока ничего не сработало.</li>}
            {entries.map((entry) => {
              const line = describeEntry(entry, doc, rules);
              return (
                <li key={entry.n} data-kind={line.kind} data-rule={entry.event.ruleId}>
                  <button type="button" className="ed-link" disabled={!entry.event.self} onClick={() => setFocusId(entry.event.self ?? null)}>
                    <time>{line.time}</time> {line.text}
                  </button>
                </li>
              );
            })}
          </ol>
          <button type="button" className="ed-btn small" onClick={() => log.clear()} disabled={entries.length === 0}>
            Очистить журнал
          </button>
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
