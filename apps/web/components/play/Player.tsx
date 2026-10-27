'use client';
import { Artboard, PlayerScreen } from '@blokum/renderer';
import { type ProjectDocument } from '@blokum/schema';
import { useMemo, useSyncExternalStore } from 'react';
import { PassageSession } from '../../lib/play/passage-session';
import { type PlayOpen, playMediaResolver } from '../../lib/play/api';
import './player.css';

/**
 * PL-03 · the player: the first screen comes from the server as markup and comes alive in the browser, the next screens
 * are drawn without a reload. Scoring is the server's (PL-15): the player has no key and works out no result.
 */
export function Player({ view }: { view: PlayOpen }) {
  // The public document has no key and no result rules; for the flow it is a document like any other.
  const session = useMemo(() => new PassageSession(view.document as unknown as ProjectDocument, { scoring: 'server' }), [view.document]);
  const passage = useSyncExternalStore(session.subscribe, session.getSnapshot, session.getSnapshot);
  const media = useMemo(() => playMediaResolver(view), [view]);

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
