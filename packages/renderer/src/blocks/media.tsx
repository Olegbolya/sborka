'use client';

import { type Block } from '@blokum/schema';
import { type CSSProperties, type ReactNode, useEffect, useRef, useState } from 'react';
import { useRenderContext } from '../context.js';
import { loadDotLottie } from '../media/lottie.js';
import { type BlockCss, type MediaSource } from '../style/style-to-css.js';
import { u } from '../units.js';

type Of<T extends Block['type']> = Extract<Block, { type: T }>;
const fill: CSSProperties = { position: 'absolute', inset: 0, overflow: 'hidden' };

/** Editor placeholder for a media block without a file; the participant sees nothing. */
function NoFile({ label }: { label: string }): ReactNode {
  const ctx = useRenderContext();
  if (ctx.mode === 'player') return null;
  return (
    <div className="bk-no-file" style={{ ...fill, display: 'flex', alignItems: 'center', justifyContent: 'center', textAlign: 'center', fontSize: u(12), padding: u(6), border: `${u(1)} dashed currentColor`, opacity: 0.6 }}>
      {label}
    </div>
  );
}

/** TS-24: placeholder shown to participants when a media file is under review or unavailable. */
function MediaStub({ stub }: { stub: 'processing' | 'blocked' }): ReactNode {
  const label = stub === 'processing' ? 'Проверяем файл' : 'Файл недоступен';
  return (
    <div className="bk-media-stub" data-stub={stub} style={{ ...fill, display: 'flex', alignItems: 'center', justifyContent: 'center', textAlign: 'center', fontSize: u(12), padding: u(8), background: 'rgba(128,128,128,0.15)', color: 'currentColor', opacity: 0.7 }}>
      {label}
    </div>
  );
}

/** Applies the runtime's «проиграть / пауза / стоп / сначала» (AC-06) to a media element. */
function useMediaCommands(el: HTMLMediaElement | null, instanceId: string): void {
  const ctx = useRenderContext();
  const state = ctx.views?.get(instanceId)?.media ?? null;
  const last = useRef(state);
  useEffect(() => {
    if (!el || state === last.current) return;
    last.current = state;
    if (state === 'playing') void el.play().catch(() => undefined);
    else if (state === 'paused') el.pause();
    else if (state === 'stopped' && !el.ended) {
      el.pause();
      el.currentTime = 0;
    }
  }, [el, state]);
}

/** Как играет ролик: звук и повтор (B-04). GIF всегда без звука и по кругу. */
export interface Playback {
  muted: boolean;
  repeat: 'loop' | 'once' | 'button';
}

/** Звук и повтор ролика из медиа-настроек блока (S-11); «Дальше, когда ролик закончился» отменяет повтор по кругу и кнопку. */
function playbackOf(m: BlockCss['mediaSettings'], advances = false): Playback {
  const loop = m.loop && !advances;
  return { muted: m.muted, repeat: loop ? 'loop' : m.replayButton && !advances ? 'button' : 'once' };
}

const overlayButton: CSSProperties = {
  position: 'absolute',
  minHeight: u(44),
  minWidth: u(44),
  padding: `${u(8)} ${u(14)}`,
  border: 'none',
  borderRadius: u(22),
  background: 'rgba(0, 0, 0, 0.65)',
  color: '#FFFFFF',
  fontSize: u(14),
  fontWeight: 600,
  cursor: 'pointer',
};

function Video({ src, css, instanceId, alt, gif, playback }: { src: MediaSource; css: BlockCss; instanceId: string; alt: string; gif: boolean; playback: Playback }): ReactNode {
  const ctx = useRenderContext();
  const [el, setEl] = useState<HTMLVideoElement | null>(null);
  // Браузер не даёт включить звук без касания участника: тогда ролик идёт без звука, пока он не нажмёт «Включить звук».
  const [soundBlocked, setSoundBlocked] = useState(false);
  const [ended, setEnded] = useState(false);
  const m = css.mediaSettings;
  const player = ctx.mode === 'player';
  const poster = (m.poster ? ctx.media(m.poster)?.url : undefined) ?? src.poster;
  const loop = gif || playback.repeat === 'loop';
  // Участник мог выключить звук во всей сборке; выбор создателя «без звука» сильнее.
  const silent = gif || playback.muted || ctx.sound?.isMuted === true || soundBlocked;
  useMediaCommands(el, instanceId);
  useEffect(() => {
    if (el) el.playbackRate = gif ? 1 : m.speed;
  }, [el, m.speed, gif]);
  useEffect(() => {
    if (el) el.muted = silent;
  }, [el, silent]);
  useEffect(() => {
    if (!el || !player || gif || !m.autoplay || playback.muted) return;
    el.play().catch(() => {
      setSoundBlocked(true);
      el.muted = true;
      void el.play().catch(() => undefined);
    });
  }, [el, player, gif, m.autoplay, playback.muted]);
  // GIF (B-03) always plays silently in a loop; a video (B-04) follows its media settings (S-11) and its own sound and repeat.
  const autoPlay = player && (gif || m.autoplay);
  const centre: CSSProperties = { left: '50%', top: '50%', transform: 'translate(-50%, -50%)' };
  return (
    <>
      <video
        ref={setEl}
        className="bk-media"
        src={src.url}
        {...(poster ? { poster } : {})}
        autoPlay={autoPlay}
        muted={silent}
        loop={loop}
        controls={!gif && m.controls && player}
        playsInline
        preload={player ? 'auto' : 'metadata'}
        aria-label={alt || undefined}
        onPlay={() => setEnded(false)}
        onEnded={() => {
          setEnded(true);
          ctx.dispatch?.({ type: 'mediaEnd', blockId: instanceId });
        }}
        style={css.media}
      />
      {player && !gif && soundBlocked && !playback.muted && (
        <button
          type="button"
          className="bk-video-sound"
          style={{ ...overlayButton, left: u(8), bottom: u(8) }}
          onClick={() => {
            if (el) el.muted = false;
            setSoundBlocked(false);
          }}
        >
          Включить звук
        </button>
      )}
      {player && !gif && playback.repeat === 'button' && ended && (
        <button
          type="button"
          className="bk-video-replay"
          style={{ ...overlayButton, ...centre }}
          onClick={() => {
            if (!el) return;
            el.currentTime = 0;
            setEnded(false);
            void el.play().catch(() => undefined);
          }}
        >
          Ещё раз
        </button>
      )}
    </>
  );
}

/** B-02 Изображение: the picture with its crop and focal point, alt text and an optional caption. */
export function ImageContent({ block, css }: { block: Of<'image'>; css: BlockCss }): ReactNode {
  const ctx = useRenderContext();
  const src = block.props.media ? ctx.media(block.props.media) : null;
  if (!src) return <NoFile label="Добавьте изображение" />;
  if (src.stub) return <MediaStub stub={src.stub} />;
  return (
    <>
      <div style={fill}>
        <img className="bk-media" src={src.url} alt={block.a11y.alt ?? ''} draggable={false} decoding="async" style={css.media} />
      </div>
      {block.props.caption && (
        <div className="bk-caption" style={{ position: 'absolute', left: 0, right: 0, bottom: 0, padding: `${u(4)} ${u(8)}`, fontSize: u(12), background: 'rgba(0, 0, 0, 0.55)', color: '#FFFFFF' }}>
          {block.props.caption}
        </div>
      )}
    </>
  );
}

/** B-03 GIF (stored as MP4/WebM with a poster) and B-04 Видео. */
export function VideoContent({ block, css, instanceId }: { block: Of<'gif'> | Of<'video'>; css: BlockCss; instanceId: string }): ReactNode {
  const ctx = useRenderContext();
  const src = block.props.media ? ctx.media(block.props.media) : null;
  const gif = block.type === 'gif';
  if (!src) return <NoFile label={gif ? 'Добавьте GIF' : 'Добавьте видео'} />;
  if (src.stub) return <MediaStub stub={src.stub} />;
  const alt = block.a11y.alt ?? '';
  // Ролик, после которого сборка идёт дальше, по кругу не повторяется: иначе он никогда не закончится.
  const playback = playbackOf(css.mediaSettings, block.type === 'video' && block.props.nextOnEnd);
  return <div style={fill}>{src.kind === 'image' ? <img className="bk-media" src={src.url} alt={alt} draggable={false} style={css.media} /> : <Video src={src} css={css} instanceId={instanceId} alt={alt} gif={gif} playback={playback} />}</div>;
}

/**
 * B-05 Аудио: a sound or music. It starts only after the first action of the participant (browsers forbid
 * sound before it), follows the participant's «выключить звук», and has a real button to play or pause.
 */
export function AudioContent({ block, css, instanceId }: { block: Of<'audio'>; css: BlockCss; instanceId: string }): ReactNode {
  const ctx = useRenderContext();
  const src = block.props.media ? ctx.media(block.props.media) : null;
  const [el, setEl] = useState<HTMLAudioElement | null>(null);
  const [playing, setPlaying] = useState(false);
  const m = css.mediaSettings;
  const player = ctx.mode === 'player';
  useMediaCommands(el, instanceId);
  useEffect(() => {
    if (!el) return;
    el.volume = block.props.volume;
    el.playbackRate = m.speed;
  }, [el, block.props.volume, m.speed]);
  useEffect(() => {
    if (!el || !player || !m.autoplay) return;
    const start = () => {
      if (!ctx.sound?.isMuted) void el.play().catch(() => undefined);
    };
    // After the first gesture of the participant (or right away if it already happened).
    if (ctx.sound?.isUnlocked) start();
    window.addEventListener('pointerdown', start, { once: true });
    window.addEventListener('keydown', start, { once: true });
    return () => {
      window.removeEventListener('pointerdown', start);
      window.removeEventListener('keydown', start);
    };
  }, [el, player, m.autoplay, ctx.sound]);
  if (!src) return <NoFile label="Добавьте звук" />;
  if (src.stub) return <MediaStub stub={src.stub} />;
  return (
    <>
      <audio
        ref={setEl}
        src={src.url}
        loop={m.loop}
        preload={player ? 'auto' : 'none'}
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => {
          setPlaying(false);
          ctx.dispatch?.({ type: 'mediaEnd', blockId: instanceId });
        }}
      />
      <button
        type="button"
        className="bk-audio-toggle"
        aria-pressed={playing}
        aria-label={playing ? `Пауза: ${block.name}` : `Включить звук: ${block.name}`}
        disabled={!player}
        onClick={(e) => {
          e.stopPropagation();
          ctx.sound?.unlock();
          if (!el) return;
          if (el.paused) void el.play().catch(() => undefined);
          else el.pause();
        }}
        style={{ ...fill, display: 'flex', alignItems: 'center', justifyContent: 'center', border: 'none', background: 'transparent', color: 'inherit', font: 'inherit', fontSize: u(24), cursor: player ? 'pointer' : 'default' }}
      >
        <span aria-hidden>{playing ? '❚❚' : '▶'}</span>
      </button>
    </>
  );
}

function Lottie({ src, css, frame }: { src: MediaSource; css: BlockCss; frame: number | undefined }): ReactNode {
  const ctx = useRenderContext();
  const canvas = useRef<HTMLCanvasElement>(null);
  const m = css.mediaSettings;
  const play = ctx.mode === 'player' && m.autoplay && frame === undefined;
  useEffect(() => {
    const el = canvas.current;
    if (!el) return;
    let player: { destroy(): void } | null = null;
    let cancelled = false;
    void loadDotLottie().then((DotLottie) => {
      if (cancelled) return;
      const p = new DotLottie({ canvas: el, src: src.url, autoplay: play, loop: m.loop, speed: m.speed, layout: { fit: m.fit === 'fill' ? 'fill' : m.fit, align: [m.focal.x, m.focal.y] } });
      if (frame !== undefined) p.addEventListener('load', () => p.setFrame(frame));
      player = p;
    });
    return () => {
      cancelled = true;
      player?.destroy();
    };
  }, [src.url, play, m.loop, m.speed, m.fit, m.focal.x, m.focal.y, frame]);
  return <canvas ref={canvas} className="bk-media bk-lottie" style={{ width: '100%', height: '100%', display: 'block' }} />;
}

/** B-07 Анимация / стикер: Lottie (through dotlottie-web), animated WebP/APNG or WebM with transparency. */
export function AnimationContent({ block, css, instanceId }: { block: Of<'animation'>; css: BlockCss; instanceId: string }): ReactNode {
  const ctx = useRenderContext();
  const src = block.props.media ? ctx.media(block.props.media) : null;
  if (!src) return <NoFile label="Добавьте анимацию" />;
  if (src.stub) return <MediaStub stub={src.stub} />;
  const alt = block.a11y.alt ?? '';
  return (
    <div style={fill} role={alt ? 'img' : undefined} aria-label={alt || undefined}>
      {src.kind === 'lottie' ? (
        <Lottie src={src} css={css} frame={block.props.frame} />
      ) : src.kind === 'video' ? (
        <Video src={src} css={css} instanceId={instanceId} alt={alt} gif={false} playback={playbackOf(css.mediaSettings)} />
      ) : (
        <img className="bk-media" src={src.url} alt={alt} draggable={false} style={css.media} />
      )}
    </div>
  );
}

