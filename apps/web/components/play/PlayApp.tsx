'use client';
import { useEffect, useState } from 'react';
import { errorText, isApiError } from '../../lib/api-browser';
import { type PlayBlocked, type PlayView } from '../../lib/play/api';
import { type Proof, enter, fetchView, readProof, saveProof } from '../../lib/play/client';
import { Player } from './Player';
import { StateScreen } from './StateScreen';
import './player.css';

type Gate = PlayBlocked & { state: 'password' | 'age18' };
const isGate = (v: PlayView): v is Gate => v.state === 'password' || v.state === 'age18';

/** PL-08, PL-09 · a gate of the project: the password or the question about age; the document comes only after it. */
function GateScreen({ view, onOpen }: { view: Gate; onOpen: (next: PlayView & { unlock?: string }, proof: Proof) => void }) {
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [declined, setDeclined] = useState(false);
  const theme = view.theme;
  const screen = theme.systemScreens[view.state === 'password' ? 'password' : 'age18'];

  const submit = async (body: { password?: string; age18?: boolean }) => {
    setBusy(true);
    setError(null);
    try {
      const next = await enter(view.slug, body);
      onOpen(next, { ...(next.unlock ? { unlock: next.unlock } : {}), ...(body.age18 ? { age18: true } : {}) });
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <StateScreen theme={theme} title={screen.title || (view.state === 'password' ? 'Нужен пароль' : 'Вам есть 18 лет?')} text={view.text}>
      {view.state === 'password' ? (
        <form
          className="pl-form"
          onSubmit={(e) => {
            e.preventDefault();
            void submit({ password });
          }}
        >
          <input type="password" aria-label="Пароль" autoComplete="off" value={password} maxLength={100} onChange={(e) => setPassword(e.target.value)} />
          <button type="submit" disabled={busy || password === ''}>
            Открыть
          </button>
        </form>
      ) : declined ? (
        <p>Доступ закрыт.</p>
      ) : (
        <div className="pl-form">
          <button type="button" disabled={busy} onClick={() => void submit({ age18: true })}>
            Мне есть 18
          </button>
          <button type="button" className="secondary" onClick={() => setDeclined(true)}>
            Мне нет 18
          </button>
        </div>
      )}
      {error && (
        <p role="alert" className="pl-error">
          {error}
        </p>
      )}
    </StateScreen>
  );
}

/** The page of a published project in the browser: the gate (if any), then the passage. */
export function PlayApp({ initial, source }: { initial: PlayView; source: string | null }) {
  const [view, setView] = useState<PlayView>(initial);
  const [proof, setProof] = useState<Proof>({});
  const [blocked, setBlocked] = useState<{ title: string; text: string } | null>(null);

  // A tab that has passed a gate earlier does not ask again.
  useEffect(() => {
    if (!isGate(initial)) return;
    const kept = readProof(initial.slug);
    if (!kept.unlock && !kept.age18) return;
    let cancelled = false;
    fetchView(initial.slug, kept).then(
      (next) => {
        if (cancelled) return;
        setProof(kept);
        setView(next);
      },
      (e: unknown) => {
        if (!isApiError(e)) throw e;
      },
    );
    return () => {
      cancelled = true;
    };
  }, [initial]);

  if (blocked) return <StateScreen theme={view.state === 'ok' ? view.document.theme.tokens : view.theme} title={blocked.title} text={blocked.text} />;
  if (isGate(view)) {
    return (
      <GateScreen
        view={view}
        onOpen={(next, got) => {
          const merged = { ...proof, ...got };
          saveProof(view.slug, merged);
          setProof(merged);
          setView(next);
        }}
      />
    );
  }
  if (view.state !== 'ok') return <StateScreen theme={view.theme} title={view.title} text={view.text} />;
  return <Player view={view} proof={proof} source={source} onBlocked={setBlocked} />;
}
