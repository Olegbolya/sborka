'use client';

import { Artboard, DEV_THEMES, ScreenView } from '@blokum/renderer';
import { devMedia } from '../../../lib/dev/dev-media';
import { SHAPES_GALLERY } from '../../../lib/dev/shapes-gallery';

/** Service page of P1.6: the gallery screens one under another, in the player (tilt follows the pointer). */
export function DevShapes({ theme }: { theme: 'light' | 'dark' }) {
  return (
    <Artboard mode="player" tokens={DEV_THEMES[theme]} media={devMedia}>
      {SHAPES_GALLERY.screens.map((screen) => (
        <ScreenView key={screen.id} screen={screen} />
      ))}
    </Artboard>
  );
}
