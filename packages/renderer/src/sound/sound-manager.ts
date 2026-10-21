import { type MediaRef } from '@blokum/schema';
import { type MediaResolver } from '../style/style-to-css.js';

/** The part of HTMLAudioElement the manager uses (lets tests and SSR pass their own). */
export interface AudioLike {
  play(): Promise<void>;
  pause(): void;
  loop: boolean;
  volume: number;
  currentTime: number;
}

export type AudioFactory = (src: string) => AudioLike;

/**
 * Sounds of the player (TH-01 theme sounds, AC-06, T-20): browsers forbid sound before the first action of
 * the participant, so nothing plays until `unlock()` is called from a tap or a key press («звуки после
 * первого действия»). The participant can mute everything; sound is on by default as the creator set.
 */
export class SoundManager {
  private unlocked = false;
  private muted: boolean;
  private bg: AudioLike | null = null;
  private bgRef: MediaRef | null = null;
  private readonly cache = new Map<string, AudioLike>();

  constructor(
    private readonly media: MediaResolver,
    enabledByDefault = true,
    private readonly create: AudioFactory = (src) => new Audio(src),
  ) {
    this.muted = !enabledByDefault;
  }

  get isUnlocked(): boolean {
    return this.unlocked;
  }

  get isMuted(): boolean {
    return this.muted;
  }

  /** Called from the first gesture of the participant; starts the background sound if there is one. */
  unlock(): void {
    if (this.unlocked) return;
    this.unlocked = true;
    if (this.bgRef) this.background(this.bgRef);
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
    if (muted) this.bg?.pause();
    else if (this.bg && this.unlocked) void this.bg.play().catch(() => undefined);
  }

  /** Plays a sound once; false when it cannot play yet (locked, muted or no file). */
  play(ref: MediaRef | undefined, volume = 1): boolean {
    if (!ref || !this.unlocked || this.muted) return false;
    const src = this.media(ref);
    if (!src) return false;
    let audio = this.cache.get(src.url);
    if (!audio) {
      audio = this.create(src.url);
      this.cache.set(src.url, audio);
    }
    audio.volume = Math.max(0, Math.min(1, volume));
    audio.currentTime = 0;
    void audio.play().catch(() => undefined);
    return true;
  }

  /** Background sound of the theme or screen, looped; null stops it. */
  background(ref: MediaRef | null): void {
    if (this.bgRef && ref && this.bgRef.id === ref.id && this.bg) return;
    this.bg?.pause();
    this.bg = null;
    this.bgRef = ref;
    if (!ref || !this.unlocked) return;
    const src = this.media(ref);
    if (!src) return;
    this.bg = this.create(src.url);
    this.bg.loop = true;
    this.bg.volume = 0.5;
    if (!this.muted) void this.bg.play().catch(() => undefined);
  }

  /** Stops everything (leaving the player). */
  stop(): void {
    this.bg?.pause();
    for (const a of this.cache.values()) a.pause();
  }
}
