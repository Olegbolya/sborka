'use client';
import { ARTBOARD_WIDTH, Artboard, PlayerScreen } from '@blokum/renderer';
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { makeDemos } from '../../lib/landing/demos';
import { PassageSession } from '../../lib/play/passage-session';

const HEIGHT = 520;

/**
 * P10.1 · a live assembly on the page. The passage is played here, in the browser, by the same session as the player's;
 * nothing is sent anywhere (no answers, no analytics), so it needs neither an account nor the network.
 */
export function DemoPlayer({ demoId }: { demoId: string }) {
  const demo = makeDemos().find((d) => d.id === demoId);
  const [session, setSession] = useState(() => (demo ? new PassageSession(demo.doc) : null));
  const frame = useRef<HTMLDivElement>(null);
  const [unit, setUnit] = useState(1);
  useEffect(() => () => session?.dispose(), [session]);
  useEffect(() => {
    const el = frame.current;
    if (!el) return;
    const measure = () => setUnit(el.clientWidth / ARTBOARD_WIDTH);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  // The artboard of the player is a `main` element; on a page that has its own `main` it is a labelled group instead.
  useEffect(() => {
    const board = frame.current?.querySelector('main.bk-artboard');
    board?.setAttribute('role', 'group');
    board?.setAttribute('aria-label', 'Живая сборка');
  });
  const noop = () => () => undefined;
  const view = useSyncExternalStore(session?.subscribe ?? noop, session?.getSnapshot ?? (() => null), () => null);
  useSyncExternalStore(session?.store.subscribe ?? noop, session?.store.getSnapshot ?? (() => 0), () => 0);
  if (!demo || !session) return null;

  return (
    <div className="lp-demo">
      <div ref={frame} className="lp-frame" data-testid={`demo-${demo.id}`} style={{ height: HEIGHT * unit }}>
        {view?.screen && (
          <Artboard mode="player" unit={unit} tokens={demo.doc.theme.tokens} runText={session.textValue}>
            <PlayerScreen key={`${view.screen.id}:${view.screenKey}`} screen={view.screen} store={session.store} />
          </Artboard>
        )}
      </div>
      <button type="button" className="lp-again" onClick={() => setSession(new PassageSession(demo.doc))}>
        Начать заново
      </button>
    </div>
  );
}
