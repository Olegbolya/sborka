'use client';

import { type Screen } from '@blokum/schema';
import { type ReactNode, useEffect, useSyncExternalStore } from 'react';
import { RenderContext, useRenderContext } from '../context.js';
import { ScreenView } from '../components/ScreenView.js';
import { type RuntimeStore } from './runtime-store.js';

/**
 * A screen driven by the scenario runtime: enters the screen, runs the frame loop while mounted and
 * passes the live views and `dispatch` to every block. Used inside `<Artboard mode="player">`.
 */
export function PlayerScreen({ screen, store }: { screen: Screen; store: RuntimeStore }): ReactNode {
  const ctx = useRenderContext();
  useEffect(() => {
    store.enter(screen.id);
    store.start();
    return () => {
      store.leave();
      store.stop();
    };
  }, [screen.id, store]);
  useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => store.dispatch({ type: 'key', key: e.key });
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [store]);
  return (
    <RenderContext.Provider value={{ ...ctx, views: store.views, dispatch: store.dispatch }}>
      <ScreenView screen={screen} />
    </RenderContext.Provider>
  );
}
