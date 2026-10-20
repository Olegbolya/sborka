import { type MediaResolver } from '@blokum/renderer';

/** Service pictures of the /dev galleries, drawn by scripts/dev/generate-dev-media.py (not the media library). */
const DEV_MEDIA: Record<string, { url: string; kind: 'image' | 'video' }> = {
  'dev-foto-zima': { url: '/dev/zimnii-vecher.jpg', kind: 'image' },
  'dev-gif-sneg': { url: '/dev/snegopad.gif', kind: 'image' },
  'dev-maska-zvezda': { url: '/dev/maska-zvezda.png', kind: 'image' },
};

export const devMedia: MediaResolver = (ref) => DEV_MEDIA[ref.id] ?? null;
