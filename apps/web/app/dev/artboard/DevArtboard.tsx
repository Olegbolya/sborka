'use client';

import { createRuntime } from '@blokum/engine';
import { Artboard, DEV_THEMES, PlayerScreen, RuntimeStore } from '@blokum/renderer';
import { useState } from 'react';
import { SAMPLE_DOCUMENT } from '../../../lib/dev/sample-document';

/** Service page of P1.4: the sample screen in the player with a live scenario runtime. */
export function DevArtboard({ theme }: { theme: 'light' | 'dark' }) {
  const [store] = useState(() => new RuntimeStore(createRuntime(SAMPLE_DOCUMENT, { seed: 2026 })));
  return (
    <Artboard mode="player" tokens={DEV_THEMES[theme]}>
      <PlayerScreen screen={SAMPLE_DOCUMENT.screens[0]!} store={store} />
    </Artboard>
  );
}
