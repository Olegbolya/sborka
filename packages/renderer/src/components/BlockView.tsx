'use client';

import { type Block, type BLOCK_STATES, type BlockStyle, resolveBlockStyle } from '@blokum/schema';
import { type CSSProperties, type PointerEvent, type ReactNode, useRef, useState } from 'react';
import { TINT_STYLE, animatedLayerStyle, useBlockAnimation, usesTint } from '../animation/useBlockAnimation.js';
import { prefersReducedMotion } from '../particles/ParticleLayer.js';
import { cssColor } from '../theme/color.js';
import { useRenderContext } from '../context.js';
import { applyRuntimeView } from '../style/apply-view.js';
import { type FillLayer, styleToCss } from '../style/style-to-css.js';
import { u } from '../units.js';
import { PathTextView, RichTextView } from './RichTextView.js';

/**
 * S-18 «наклон за пальцем/курсором»: the block turns towards the pointer by up to `strength` degrees.
 * Written straight into CSS variables of the element — no React re-render on every pointer move.
 */
function tiltTowards(e: PointerEvent<HTMLDivElement>, strength: number): void {
  const el = e.currentTarget;
  const r = el.getBoundingClientRect();
  const nx = r.width ? (e.clientX - r.left) / r.width - 0.5 : 0;
  const ny = r.height ? (e.clientY - r.top) / r.height - 0.5 : 0;
  el.style.setProperty('--bk-tilt-y', String(Math.round(nx * 2 * strength * 100) / 100));
  el.style.setProperty('--bk-tilt-x', String(Math.round(-ny * 2 * strength * 100) / 100));
}

function resetTilt(el: HTMLElement): void {
  el.style.setProperty('--bk-tilt-x', '0');
  el.style.setProperty('--bk-tilt-y', '0');
}

/** Id of the instance of a nested block: children of a copy «x~3» are «child~3» (engine P1.3). */
export function childInstanceId(parentInstanceId: string, child: Block): string {
  const tilde = parentInstanceId.indexOf('~');
  return tilde === -1 ? child.id : `${child.id}${parentInstanceId.slice(tilde)}`;
}

/**
 * One fill layer. A video fill plays by the block's media settings (S-11): for a block without media of its
 * own its video fill is its media, so autoplay, sound, loop, controls, cover and speed work on every type.
 */
function Layer({ layer, media, poster }: { layer: FillLayer; media: BlockStyle['media']; poster?: string }): ReactNode {
  const base: CSSProperties = { position: 'absolute', inset: 0 };
  if (layer.kind === 'video') {
    const rate = (el: HTMLVideoElement | null) => {
      if (el) el.playbackRate = media.speed;
    };
    return (
      <video
        ref={rate}
        className="bk-fill"
        src={layer.src}
        autoPlay={media.autoplay}
        muted={media.muted}
        loop={media.loop}
        controls={media.controls}
        {...(poster ? { poster } : {})}
        data-speed={media.speed}
        playsInline
        style={{ ...base, width: '100%', height: '100%', ...layer.style }}
      />
    );
  }
  return <div className="bk-fill" style={{ ...base, ...layer.style }} />;
}

export interface BlockViewProps {
  block: Block;
  /** Instance shown (a copy of the block has its own id, P1.3); the block id by default. */
  instanceId?: string;
  /** Visual state (S-15); in the player it follows the runtime («выбран») when not given. */
  state?: (typeof BLOCK_STATES)[number];
}

/**
 * One block of any type (E-03, S-00): absolute position in units, rotation and flips, the style through
 * `styleToCss`, animations (S-12…S-14), type-specific content, the text layer (any block can have text)
 * and nested blocks. Showing and hiding by a scenario with animation (AC-01) fades the block in and out.
 */
export function BlockView(props: BlockViewProps): ReactNode {
  const ctx = useRenderContext();
  const instanceId = props.instanceId ?? props.block.id;
  const view = ctx.views?.get(instanceId);
  const visible = ctx.mode === 'editor' ? !props.block.hiddenInEditor : view ? view.visible : !props.block.initiallyHidden;
  const [present, setPresent] = useState(visible);
  const [appear, setAppear] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const animated = ctx.mode === 'player' && (view?.animateVisibility ?? false);
  if (visible && (!present || leaving)) {
    setPresent(true);
    setLeaving(false);
    setAppear(animated);
  } else if (!visible && present && !leaving) {
    if (animated) setLeaving(true);
    else setPresent(false);
  }
  if (!present) return null;
  return <BlockBody {...props} instanceId={instanceId} appear={appear} leaving={leaving} onExited={() => setPresent(false)} />;
}

/** S-15: what changes smoothly when a block changes its state. */
export const STATE_TRANSITION = ['opacity', 'filter', 'background-color', 'border-radius', 'box-shadow', 'color'].map((p) => `${p} 160ms ease`).join(', ');

function BlockBody({ block, instanceId, state, appear, leaving, onExited }: BlockViewProps & { instanceId: string; appear: boolean; leaving: boolean; onExited: () => void }): ReactNode {
  const ctx = useRenderContext();
  const view = ctx.views?.get(instanceId);
  const animLayer = useRef<HTMLDivElement>(null);
  const [reducedMotion] = useState(prefersReducedMotion);
  const animated = ctx.mode === 'player' && block.animation !== undefined;
  const { onPressStart, onPressEnd } = useBlockAnimation(animLayer, { animation: animated ? block.animation : undefined, tokens: ctx.tokens, reducedMotion, appear: ctx.mode === 'player' && appear, leaving, onExited });

  // S-15: hover and pressed come from the pointer, the rest from the runtime; only states the block styles are tracked.
  const states = ctx.mode === 'player' ? block.states : undefined;
  const [pointer, setPointer] = useState({ hover: false, pressed: false });
  const trackHover = states?.hover !== undefined;
  const trackPress = states?.pressed !== undefined;
  const activeState =
    state ??
    (view && !view.interactive && states?.disabled
      ? 'disabled'
      : pointer.pressed && trackPress
        ? 'pressed'
        : view?.dragging
          ? 'dragging'
          : view?.selected
            ? 'selected'
            : view?.zoneId
              ? 'overZone'
              : pointer.hover && trackHover
                ? 'hover'
                : undefined);
  const style = applyRuntimeView(resolveBlockStyle(block, ctx.tokens, activeState), view);
  const x = view?.x ?? block.frame.x;
  const y = view?.y ?? block.frame.y;
  const w = view?.w ?? block.frame.w;
  const h = view?.h ?? block.frame.h;
  const css = styleToCss(style, { tokens: ctx.tokens, media: ctx.media }, { w, h });
  const rotation = view?.rotation ?? block.frame.rotation;
  const flipX = (view?.overrides['frame.flipX'] as boolean | undefined) ?? block.frame.flipX;
  const flipY = (view?.overrides['frame.flipY'] as boolean | undefined) ?? block.frame.flipY;
  const scale = view?.anim.scale ?? 1;
  const transform = [
    rotation !== 0 ? `rotate(${rotation}deg)` : '',
    flipX || flipY ? `scale(${flipX ? -1 : 1}, ${flipY ? -1 : 1})` : '',
    scale !== 1 ? `scale(${scale})` : '',
    css.transform3d,
  ]
    .filter(Boolean)
    .join(' ');

  const root: CSSProperties = {
    position: 'absolute',
    left: u(x),
    top: u(y),
    width: u(w),
    ...(style.autoHeight ? { minHeight: u(h) } : { height: u(h) }),
    zIndex: block.z,
    ...(transform ? { transform, transformOrigin: css.transformOrigin } : {}),
    ...css.root,
    ...(ctx.mode === 'editor' && block.initiallyHidden ? { opacity: (typeof css.root.opacity === 'number' ? css.root.opacity : 1) * 0.35 } : {}),
    ...(ctx.mode === 'thumbnail' ? { pointerEvents: 'none' } : {}),
    ...(view && !view.interactive ? { pointerEvents: 'none' } : {}),
    // S-15: switching between states is smooth (transforms stay instant — the runtime drives them by frames).
    ...(states && !reducedMotion ? { transition: STATE_TRANSITION } : {}),
  };
  const surface: CSSProperties = states && !reducedMotion ? { ...css.surface, transition: STATE_TRANSITION } : css.surface;
  const tilt = ctx.mode === 'player' && style.transform3d.tiltFollow ? style.transform3d.tiltStrength : 0;
  // A finger over a «наклон за пальцем» block tilts it instead of scrolling the page (S-18).
  if (tilt) root.touchAction = 'none';
  // Auto height (S-01): the content stays in the flow, so the block grows with its text.
  const content: CSSProperties = style.autoHeight ? { ...css.content, position: 'relative', inset: 'auto', minHeight: u(h) } : css.content;

  const textLayer = (view?.overrides.textLayer as Block['textLayer']) ?? block.textLayer;
  const interactive = ctx.mode === 'player' && ctx.dispatch;
  const press = animated && block.animation?.press !== undefined;
  const setHover = (hover: boolean) => trackHover && setPointer((p) => (p.hover === hover ? p : { ...p, hover }));
  const setPressed = (pressed: boolean) => trackPress && setPointer((p) => (p.pressed === pressed ? p : { ...p, pressed }));
  const pressStart = () => {
    if (press) onPressStart();
    setPressed(true);
  };
  const pressEnd = () => {
    if (press) onPressEnd();
    setPressed(false);
  };
  const handlers = {
    ...(interactive
      ? {
          onClick: () => ctx.dispatch!({ type: 'tap', blockId: instanceId }),
          onDoubleClick: () => ctx.dispatch!({ type: 'doubleTap', blockId: instanceId }),
        }
      : {}),
    ...(press || trackPress ? { onPointerDown: pressStart, onPointerUp: pressEnd, onPointerCancel: pressEnd } : {}),
    ...(interactive || tilt || press || trackHover || trackPress
      ? {
          onPointerMove: tilt ? (e: PointerEvent<HTMLDivElement>) => tiltTowards(e, tilt) : undefined,
          onPointerEnter: (e: PointerEvent<HTMLDivElement>) => {
            if (e.pointerType !== 'mouse') return;
            if (press) onPressStart();
            setHover(true);
            if (interactive) ctx.dispatch!({ type: 'hover', blockId: instanceId, phase: 'enter' });
          },
          onPointerLeave: (e: PointerEvent<HTMLDivElement>) => {
            if (tilt) resetTilt(e.currentTarget);
            if (press) onPressEnd();
            setHover(false);
            setPressed(false);
            if (interactive && e.pointerType === 'mouse') ctx.dispatch!({ type: 'hover', blockId: instanceId, phase: 'leave' });
          },
        }
      : {}),
  };

  const tint = animated && block.animation && usesTint(block.animation);
  const poster = style.media.poster ? ctx.media(style.media.poster)?.url : undefined;
  const body = (
    <>
      {css.shadowLayers.map((layer, i) => (
        <div key={`shadow-${i}`} className="bk-shadow" aria-hidden style={layer} />
      ))}
      <div className="bk-surface" style={surface}>
        {css.layers.map((layer, i) => (
          <Layer key={i} layer={layer} media={style.media} {...(poster ? { poster } : {})} />
        ))}
        {tint && <div className="bk-tint" aria-hidden style={TINT_STYLE} />}
        {css.innerLayers.map((layer, i) => (
          <div key={`inner-${i}`} className="bk-inner-shadow" aria-hidden style={layer} />
        ))}
      </div>
      {css.stroke && <div className="bk-stroke" aria-hidden style={css.stroke} />}
      <div className="bk-content" style={content}>
        {ctx.renderContent?.(block, css, instanceId)}
        {textLayer &&
          (style.text.path.kind === 'none' ? (
            <RichTextView text={textLayer} style={css.text} />
          ) : (
            <PathTextView text={textLayer} typography={style.text} style={css.text} w={w} h={h} />
          ))}
        {block.children.map((child) => (
          <BlockView key={child.id} block={child} instanceId={childInstanceId(instanceId, child)} />
        ))}
      </div>
    </>
  );

  return (
    <div
      className="bk-block"
      data-block-id={instanceId}
      data-type={block.type}
      data-state={activeState}
      data-leaving={leaving ? '' : undefined}
      aria-label={block.a11y.label ?? undefined}
      role={block.a11y.alt ? 'img' : undefined}
      style={root}
      {...handlers}
    >
      {animated || appear || leaving ? (
        <div ref={animLayer} className="bk-anim" style={{ ...(block.animation ? animatedLayerStyle(block.animation, cssColor({ token: 'accent', alpha: 0.8 }, ctx.tokens)) : { position: 'absolute', inset: 0 }), ...(style.autoHeight ? { position: 'relative', inset: 'auto' } : {}) }}>
          {body}
        </div>
      ) : (
        body
      )}
    </div>
  );
}
