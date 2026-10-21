'use client';

import { Artboard, DEV_THEMES, ScreenView } from '@blokum/renderer';
import { type Screen } from '@blokum/schema';
import { devMedia } from '../../../lib/dev/dev-media';

/** Service page of P1.5: every block type with every key property, as the participant sees it. */
export function DevMatrix({ theme, screens }: { theme: 'light' | 'dark'; screens: Screen[] }) {
  return (
    <Artboard mode="player" tokens={DEV_THEMES[theme]} media={devMedia}>
      {screens.map((screen) => (
        <ScreenView key={screen.id} screen={screen} />
      ))}
    </Artboard>
  );
}
