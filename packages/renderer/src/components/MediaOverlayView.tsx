'use client';

import { type MediaOverlay } from '@blokum/schema';
import { type ReactNode, useEffect, useRef } from 'react';
import { useRenderContext } from '../context.js';
import { cssColor } from '../theme/color.js';
import { cssFontFamily } from '../theme/fonts.js';
import { u } from '../units.js';

/**
 * Full-screen media insert (T-20 «мем-переход», T-21, AC-08): the creator's own photo, GIF, video or
 * animation over the column for N seconds, a caption in meme style (any font, colour, size, outline),
 * its own sound, and a tap to skip when allowed.
 */
export function MediaOverlayView({ overlay, onDone }: { overlay: MediaOverlay; onDone: () => void }): ReactNode {
  const ctx = useRenderContext();
  const src = ctx.media(overlay.media);
  // A new overlay restarts the timer; the callback and the sound manager are read through refs.
  const done = useRef(onDone);
  done.current = onDone;
  const sound = useRef(ctx.sound);
  sound.current = ctx.sound;
  useEffect(() => {
    sound.current?.play(overlay.sound);
    const timer = setTimeout(() => done.current(), overlay.seconds * 1000);
    return () => clearTimeout(timer);
  }, [overlay]);
  const caption = overlay.caption;
  return (
    <div
      className="bk-media-overlay"
      role="dialog"
      aria-label={caption?.text || 'Медиа-вставка'}
      onClick={overlay.skippable ? onDone : undefined}
      style={{ position: 'absolute', inset: 0, zIndex: 20, background: '#000000', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: overlay.skippable ? 'pointer' : 'default' }}
    >
      {src?.kind === 'video' ? (
        <video src={src.url} autoPlay muted loop playsInline style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
      ) : src ? (
        <img src={src.url} alt="" style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
      ) : null}
      {caption?.text && (
        <div
          className="bk-meme-caption"
          style={{
            position: 'absolute',
            left: u(16),
            right: u(16),
            [caption.position]: u(32),
            textAlign: 'center',
            fontFamily: cssFontFamily(caption.font, ctx.tokens),
            fontSize: u(caption.size),
            fontWeight: 900,
            lineHeight: 1.05,
            color: cssColor(caption.color, ctx.tokens),
            WebkitTextStroke: caption.outline > 0 ? `${u(caption.outline)} #000000` : undefined,
            paintOrder: 'stroke fill',
            overflowWrap: 'anywhere',
          }}
        >
          {caption.text}
        </div>
      )}
      {overlay.skippable && <span style={{ position: 'absolute', top: u(10), right: u(14), fontSize: u(13), color: 'rgba(255, 255, 255, 0.7)' }}>Нажмите, чтобы пропустить</span>}
    </div>
  );
}
