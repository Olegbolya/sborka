'use client';
import { Artboard, PlayerStage } from '@blokum/renderer';
import { walkBlocks } from '@blokum/schema';
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { api, isApiError } from '../../lib/api-browser';
import { type PlayOpen, playMediaResolver } from '../../lib/play/api';
import { type Proof, startSession } from '../../lib/play/client';
import { type PassageResume, PassageSession } from '../../lib/play/passage-session';
import { ServerDraws } from '../../lib/play/draws';
import { directHref, outHref } from '../../lib/play/out';
import { PlayClient, type PlayTransport } from '../../lib/play/play-client';
import { AdBanner, PlayFooter, boardHref, buildSimilarHref, copyHref } from './PlayFooter';
import './player.css';

const REFUSALS: Record<string, string> = { ALREADY_PLAYED: 'Вы уже проходили', TEMPORARILY_UNAVAILABLE: 'Временно недоступно', CLOSED: 'Сборка закрыта', NOT_OPEN: 'Пока закрыто', TOO_MANY_REQUESTS: 'Слишком часто' };

const sessionKey = (projectId: string) => `bk:session:${projectId}`;
const outboxKey = (sessionId: string) => `bk:outbox:${sessionId}`;

const transport: PlayTransport = {
  call: <T,>(method: 'POST' | 'PUT', path: string, body?: unknown) => api<T>(path, { method, ...(body === undefined ? {} : { body }) }),
};

/** Everything of one passage in the browser: the session of the flow, the channel to the server. */
interface Boot {
  view: PlayOpen;
  session: PassageSession;
  client: PlayClient;
  /** Where the queue is kept; known when the passage has a session on the server. */
  setSession: (id: string) => void;
  /** B-24, PL-25 · the places of limited options: kept here, refreshed from the server, read by the screen. */
  places: PlacesBox;
}

type Places = Record<string, { taken: boolean; left: number | null }>;

/** A small observable of the places; empty while the document has no limited options. */
class PlacesBox {
  value: Places = {};
  private subs = new Set<() => void>();
  private sessionId: string | null = null;
  private busy = false;
  subscribe = (fn: () => void): (() => void) => {
    this.subs.add(fn);
    return () => this.subs.delete(fn);
  };
  get = (): Places => this.value;
  attach(id: string): void {
    this.sessionId = id;
    void this.refresh();
  }
  get limited(): boolean {
    return Object.keys(this.value).length > 0;
  }
  async refresh(): Promise<void> {
    if (!this.sessionId || this.busy) return;
    this.busy = true;
    try {
      const r = await api<{ options: Places }>(`/play/sessions/${this.sessionId}/places`);
      if (JSON.stringify(r.options) !== JSON.stringify(this.value)) {
        this.value = r.options;
        this.subs.forEach((f) => f());
      }
    } catch {
      // The places are an addition: a lost call changes nothing, the server decides when an answer comes.
    } finally {
      this.busy = false;
    }
  }
}

function makeBoot(view: PlayOpen, resume?: PassageResume): Boot {
  let key: string | null = null;
  const holder: { session: PassageSession | null } = { session: null };
  const client = new PlayClient({
    transport,
    storage: {
      read: () => {
        try {
          return key ? window.localStorage.getItem(key) : null;
        } catch {
          return null;
        }
      },
      write: (v) => {
        try {
          if (key) window.localStorage.setItem(key, v);
        } catch {
          // The browser does not keep it.
        }
      },
    },
    instantFeedback: view.document.settings.feedbackMode === 'instant',
    onVerdict: (blockId, verdict) => holder.session?.setVerdict(blockId, verdict),
    onRejected: (message, info) => {
      if (info?.code === 'OPTION_TAKEN' && info.blockId) {
        holder.session?.takeBack(info.blockId, message);
        void places.refresh();
      } else holder.session?.say(message);
    },
  });
  const places = new PlacesBox();
  // RN-01: a draw that affects the result is made by the server; a wheel gets its sector from there, the results their numbers.
  const draws = new ServerDraws(transport, { main: 8, default: 1 }, () => client.values([{ label: 'Случайность на устройстве', value: true }]));
  draws.watch('main');
  for (const screen of view.document.screens) for (const block of walkBlocks(screen.blocks)) if (block.behaviors.some((b) => b.kind === 'wheel')) draws.watch(block.id);
  // The public document has no key and no result rules; for the flow it is a document like any other.
  const session = new PassageSession(view.document, {
    scoring: 'server',
    ...(resume ? { resume } : {}),
    hooks: {
      answer: (blockId, value, ms) => client.answer(blockId, value, ms),
      state: (s) => client.state(s),
      complete: () => client.complete(),
      branch: (screenId) => client.branch(screenId),
      values: (v) => client.values(v),
      random: { drawWheel: draws.drawWheel, next: draws.next },
      // AC-16: the rule was started by a gesture of the participant; the link goes through the page of the safe redirect (PL-22), on a tariff with direct links — at once.
      openLink: (url) => {
        const href = view.directLinks ? directHref(url) : outHref(url);
        if (href !== '#') window.open(href, '_blank', 'noopener,noreferrer');
      },
      copyText: (text) => void navigator.clipboard?.writeText(text).catch(() => undefined),
    },
  });
  holder.session = session;
  return { view, session, client, places, setSession: (id) => ((key = outboxKey(id)), client.attach(id), draws.attach(id), places.attach(id)) };
}

/**
 * PL-03, PL-11, PL-12 · the player: the first screen comes from the server as markup and comes alive in the browser, the next
 * screens are drawn without a reload. The passage lives on the server: it begins there, goes on after a reload, and the answers
 * reach it through a queue that survives a lost network. Scoring is the server's (PL-15): the player works out no result.
 */
export function Player({ view, proof, source, onBlocked }: { view: PlayOpen; proof: Proof; source: string | null; onBlocked: (b: { title: string; text: string }) => void }) {
  const [boot, setBoot] = useState<Boot>(() => makeBoot(view));
  const passage = useSyncExternalStore(boot.session.subscribe, boot.session.getSnapshot, boot.session.getSnapshot);
  const media = useMemo(() => playMediaResolver(boot.view), [boot.view]);
  const places = useSyncExternalStore(boot.places.subscribe, boot.places.get, boot.places.get);
  // PL-25: the places are asked again on every screen and every few seconds while the passage has limited options.
  const screenId = passage.screen?.id;
  useEffect(() => {
    void boot.places.refresh();
  }, [boot, screenId]);
  useEffect(() => {
    const timer = window.setInterval(() => {
      if (boot.places.limited && document.visibilityState === 'visible') void boot.places.refresh();
    }, 5000);
    return () => window.clearInterval(timer);
  }, [boot]);
  const bootRef = useRef(boot);
  bootRef.current = boot;
  const latest = useRef({ source, proof, onBlocked });
  latest.current = { source, proof, onBlocked };

  // PL-11: begin the passage on the server, or go on with the one this browser has begun (a reload, a closed tab).
  const started = useRef(false);
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    void (async () => {
      const kept = (() => {
        try {
          return window.localStorage.getItem(sessionKey(view.projectId));
        } catch {
          return null;
        }
      })();
      if (kept) {
        try {
          const saved = await api<{ status: string; runtimeState: { screenId?: string; history?: string[]; variables?: Record<string, unknown> } | null; answers: PassageResume['answers']; singleAttempt: boolean; restartOnReload?: boolean; view: PlayOpen }>(`/play/sessions/${encodeURIComponent(kept)}`);
          // PL-10: with «одна попытка» a finished passage is not shown again, it is told that it was taken.
          if (saved.status === 'COMPLETED' && saved.singleAttempt) {
            latest.current.onBlocked({ title: REFUSALS.ALREADY_PLAYED!, text: 'Вы уже проходили эту сборку.' });
            return;
          }
          // PL-11: the author asked to begin from the first screen after a reload: the kept passage is left, a new one begins below.
          // The creator published again since this browser began: whoever comes back (a QR code a day later) sees the new version, not the old one kept in the browser.
          const outdated = Boolean(view.versionId) && Boolean(saved.view?.versionId) && saved.view.versionId !== view.versionId;
          if (outdated || (saved.restartOnReload && saved.status === 'IN_PROGRESS')) {
            try {
              window.localStorage.removeItem(sessionKey(view.projectId));
            } catch {
              // Nothing to remove.
            }
          } else if (saved.status === 'IN_PROGRESS' || saved.status === 'COMPLETED') {
            const next = makeBoot(saved.view, { ...(saved.runtimeState ?? {}), ...(saved.answers ? { answers: saved.answers } : {}) });
            next.setSession(kept);
            bootRef.current.session.dispose();
            bootRef.current.client.dispose();
            bootRef.current = next;
            setBoot(next);
            if (saved.status === 'COMPLETED') next.session.finishAgain();
            return;
          }
        } catch (e) {
          if (!isApiError(e)) throw e;
        }
      }
      const res = await startSession(view.projectId, { source: latest.current.source, proof: latest.current.proof });
      if (!res.ok) {
        latest.current.onBlocked({ title: REFUSALS[res.code] ?? 'Недоступно', text: res.message });
        return;
      }
      try {
        window.localStorage.setItem(sessionKey(view.projectId), res.session.sessionId);
      } catch {
        // The browser does not keep it: a reload starts anew.
      }
      bootRef.current.setSession(res.session.sessionId);
    })();
  }, [view.projectId, view.versionId]);

  // The variables of scenarios change without a change of screen: the place is saved a moment after they settle.
  useEffect(() => {
    let last = JSON.stringify(boot.session.stateSnapshot());
    let timer: ReturnType<typeof setTimeout> | null = null;
    const unsubscribe = boot.session.store.subscribe(() => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        const now = JSON.stringify(boot.session.stateSnapshot());
        if (now === last) return;
        last = now;
        boot.client.state(boot.session.stateSnapshot());
      }, 800);
    });
    return () => {
      unsubscribe();
      if (timer) clearTimeout(timer);
    };
  }, [boot]);

  useEffect(() => {
    const online = () => void boot.client.flush();
    window.addEventListener('online', online);
    return () => window.removeEventListener('online', online);
  }, [boot]);

  const again = () => {
    try {
      window.localStorage.removeItem(sessionKey(view.projectId));
    } catch {
      // Nothing was kept.
    }
    window.location.reload();
  };

  return (
    <Artboard mode="player" {...(passage.screen ? { coverHeight: passage.screen.height } : {})} tokens={boot.view.document.theme.tokens} media={media} runText={boot.session.textValue} consentUrl={`/legal/consent/${view.projectId}`} linkHref={view.directLinks ? directHref : outHref}>
      {boot.view.ad && <AdBanner ad={boot.view.ad} />}
      {passage.screen ? (
        <PlayerStage screenKey={passage.screenKey} transition={passage.transition} screen={passage.screen} store={boot.session.store} {...(passage.progress ? { progress: passage.progress } : {})} entryOverlay={passage.entryOverlay} places={places} />
      ) : (
        <div className="pl-end" data-testid="play-end" role="status">
          <strong>{passage.completing ? 'Считаем результат…' : 'Спасибо! Прохождение завершено.'}</strong>
          {!passage.completing && (
            <button type="button" className="pl-again" onClick={again}>
              Пройти заново
            </button>
          )}
          {!passage.completing && boot.view.board && (
            <a className="pl-again" href={boardHref(boot.view.board.code)} target="_blank" rel="noopener" data-testid="play-end-board">
              Открыть табло
            </a>
          )}
          {!passage.completing && boot.view.copyable === true && (
            <a className="pl-again" href={copyHref(boot.view.slug)} target="_blank" rel="noopener" data-testid="play-end-copy">
              Скопировать себе
            </a>
          )}
          {!passage.completing && boot.view.buildSimilar && (
            <a className="pl-again" href={buildSimilarHref(boot.view.buildSimilar.slug)} data-testid="play-end-build-similar">
              Собрать такую же
            </a>
          )}
        </div>
      )}
      {passage.message && (
        <p role="alert" className="pl-message" data-testid="play-message">
          {passage.message}
        </p>
      )}
      {passage.canGoBack && boot.view.showBack === true && (
        <button type="button" className="pl-back" onClick={() => boot.session.back()}>
          ← Назад
        </button>
      )}
      <PlayFooter slug={boot.view.slug} watermark={boot.view.watermark} ageRating={boot.view.ageRating ?? null} buildSimilar={boot.view.buildSimilar ?? null} copyable={boot.view.copyable === true} board={!passage.completing && (!passage.screen || passage.screen.kind === 'result') ? (boot.view.board ?? null) : null} />
    </Artboard>
  );
}
