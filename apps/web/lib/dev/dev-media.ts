import { type MediaResolver, type MediaSource } from '@blokum/renderer';

/** Service media of the /dev galleries, drawn by scripts/dev/generate-dev-media.py (not the media library). */
const DEV_MEDIA: Record<string, MediaSource> = {
  'dev-foto-zima': { url: '/dev/zimnii-vecher.jpg', kind: 'image' },
  'dev-gif-sneg': { url: '/dev/snegopad.gif', kind: 'image' },
  'dev-maska-zvezda': { url: '/dev/maska-zvezda.png', kind: 'image' },
  'dev-video-sneg': { url: '/dev/snegopad.mp4', kind: 'video', poster: '/dev/snegopad-video.jpg' },
  'dev-zvuk-bubency': { url: '/dev/bubency.wav', kind: 'audio' },
  'dev-lottie-snezhok': { url: '/dev/snezhok.json', kind: 'lottie' },
};

export const devMedia: MediaResolver = (ref) => DEV_MEDIA[ref.id] ?? null;
