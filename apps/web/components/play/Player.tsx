'use client';
import { Artboard, PlayerScreen } from '@blokum/renderer';
import { type ProjectDocument } from '@blokum/schema';
import { useEffect, useMemo, useRef, useSyncExternalStore } from 'react';
import { PassageSession } from '../../lib/play/passage-session';
import { type PlayOpen, playMediaResolver } from '../../lib/play/api';
import { type Proof, startSession } from '../../lib/play/client';
import './player.css';

/**
 * PL-03 · the player: the first screen comes from the server as markup and comes alive in the browser, the next screens
 * are drawn without a reload. Scoring is the server's (PL-15): the player has no key and works out no result.
 */
const REFUSALS: Record<string, string> = { ALREADY_PLAYED: 'Вы уже проходили', TEMPORARILY_UNAVAILABLE: 'Временно недоступно', CLOSED: 'Сборка закрыта', NOT_OPEN: 'Пока закрыто' };

export function Player({ view, proof, source, onBlocked }: { view: PlayOpen; proof: Proof; source: string | null; onBlocked: (b: { title: string; text: string }) => void }) {
  // The public document has no key and no result rules; for the flow it is a document like any other.
  const session = useMemo(() => new PassageSession(view.document as unknown as ProjectDocument, { scoring: 'server' }), [view.document]);
  const passage = useSyncExternalStore(session.subscribe, session.getSnapshot, session.getSnapshot);
  const media = useMemo(() => playMediaResolver(view), [view]);

  // PL-11: the passage starts on the server; a refusal (limit, one attempt, month) is shown as a screen of the theme.
  // What the start needs is read from a ref: the passage starts once for a mounted player, whatever re-renders happen.
  const latest = useRef({ source, proof, onBlocked });
  latest.current = { source, proof, onBlocked };
  const started = useRef(false);
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    void startSession(view.projectId, { source: latest.current.source, proof: latest.current.proof }).then((res) => {
      if (!res.ok) latest.current.onBlocked({ title: REFUSALS[res.code] ?? 'Недоступно', text: res.message });
    });
  }, [view.projectId]);

  return (
    <Artboard mode="player" tokens={view.document.theme.tokens} media={media} runText={session.textValue}>
      {passage.screen ? (
        <PlayerScreen key={`${passage.screen.id}:${passage.screenKey}`} screen={passage.screen} store={session.store} {...(passage.progress ? { progress: passage.progress } : {})} />
      ) : (
        <div className="pl-end" data-testid="play-end" role="status">
          <strong>Спасибо! Прохождение завершено.</strong>
        </div>
      )}
      {passage.message && (
        <p role="alert" className="pl-message" data-testid="play-message">
          {passage.message}
        </p>
      )}
      {passage.canGoBack && (
        <button type="button" className="pl-back" onClick={() => session.back()}>
          ← Назад
        </button>
      )}
    </Artboard>
  );
}
