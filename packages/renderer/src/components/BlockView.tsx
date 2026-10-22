'use client';

import { behaviorOf } from '@blokum/engine';
import { type Block, type BLOCK_STATES, type BlockStyle, resolveBlockStyle } from '@blokum/schema';
import { type CSSProperties, type PointerEvent, type ReactNode, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { TINT_STYLE, animatedLayerStyle, useBlockAnimation, usesTint } from '../animation/useBlockAnimation.js';
import { prefersReducedMotion } from '../particles/ParticleLayer.js';
import { cssColor } from '../theme/color.js';
import { useRenderContext } from '../context.js';
import { applyRuntimeView } from '../style/apply-view.js';
import { type FillLayer, styleToCss } from '../style/style-to-css.js';
import { u } from '../units.js';
import { PathTextView, RichTextView } from './RichTextView.js';
import { blockContent } from '../blocks/content.js';
import { mergeHandlers } from '../behaviors/pointer.js';
import { useDrag } from '../behaviors/useDrag.js';
import { useScratch } from '../behaviors/useScratch.js';

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
  /** The block is an answer option of a choice question (B-11, B-12): a radio button or a checkbox. */
  option?: { questionId: string; optionId: string; multi: boolean };
  /** The parent lays its nested blocks out (S-20 «в строку / в столбец / сетка»): the block is in the flow. */
  inFlow?: boolean;
  /** BH-07: the block is a side of a flip card; only the side facing the participant is shown. */
  face?: { side: 'front' | 'back'; shown: boolean };
}

const TAP_TRIGGERS = new Set(['tap', 'doubleTap', 'longPress']);
const MEDIA_TYPES = new Set(['image', 'gif', 'video', 'animation', 'audio']);
/** Behaviors that move a block every frame: such blocks get their own compositor layer. */
const MOVING = new Set(['drag', 'flee', 'move', 'follow']);

/** A block the participant presses: a button, or any block with its own «нажатие» rule (PL-21). */
export const isPressable = (block: Block): boolean =>
  block.type === 'button' || block.rules.some((r) => TAP_TRIGGERS.has(r.when.kind)) || block.behaviors.some((b) => b.kind === 'wheel' || (b.kind === 'flip' && b.on === 'tap'));

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

/**
 * Roles for screen readers and the keyboard (PL-21): options are radio buttons or checkboxes inside their
 * question's group, pressable blocks are buttons, a picture-like block with alt text is an image.
 */
function semantics(block: Block, o: { option: BlockViewProps['option']; chosen: boolean; pressable: boolean; waiting: boolean; player: boolean }): Record<string, string | number | boolean | undefined> {
  const label = block.a11y.label;
  if (o.option) return { role: o.option.multi ? 'checkbox' : 'radio', 'aria-checked': o.chosen, tabIndex: o.player ? 0 : -1, 'aria-label': label };
  if (block.type === 'singleChoice' || block.type === 'multiChoice') return { role: block.type === 'singleChoice' ? 'radiogroup' : 'group', 'aria-label': label ?? block.name, 'aria-required': block.props.required || undefined };
  if (o.pressable) return { role: 'button', tabIndex: 0, 'aria-label': label, 'aria-disabled': o.waiting || undefined };
  if (block.a11y.alt && !MEDIA_TYPES.has(block.type) && block.children.length === 0) return { role: 'img', 'aria-label': label ?? block.a11y.alt };
  // ARIA forbids a name on an element without a role: a labelled block becomes a named group.
  return label ? { role: 'group', 'aria-label': label } : {};
}

/** S-15: what changes smoothly when a block changes its state. */
export const STATE_TRANSITION = ['opacity', 'filter', 'background-color', 'border-radius', 'box-shadow', 'color'].map((p) => `${p} 160ms ease`).join(', ');

function BlockBody({ block, instanceId, state, option, inFlow, face, appear, leaving, onExited }: BlockViewProps & { instanceId: string; appear: boolean; leaving: boolean; onExited: () => void }): ReactNode {
  const ctx = useRenderContext();
  const view = ctx.views?.get(instanceId);
  const animLayer = useRef<HTMLDivElement>(null);
  const rootEl = useRef<HTMLDivElement>(null);
  // SC-05: when the runtime only moves the block, the store shifts this element directly, without React.
  const register = ctx.registerPosition;
  const fx = block.frame.x;
  const fy = block.frame.y;
  useLayoutEffect(() => {
    if (!register || inFlow) return;
    return register(instanceId, (nx, ny) => {
      const el = rootEl.current;
      if (el) el.style.translate = nx !== fx || ny !== fy ? `${u(nx - fx)} ${u(ny - fy)}` : '';
    });
  }, [register, instanceId, inFlow, fx, fy]);
  const [reducedMotion] = useState(prefersReducedMotion);
  const animated = ctx.mode === 'player' && block.animation !== undefined;
  const { onPressStart, onPressEnd } = useBlockAnimation(animLayer, { animation: animated ? block.animation : undefined, tokens: ctx.tokens, reducedMotion, appear: ctx.mode === 'player' && appear, leaving, onExited });

  // S-15: hover and pressed come from the pointer, the rest from the runtime; only states the block styles are tracked.
  const states = ctx.mode === 'player' ? block.states : undefined;
  const [pointer, setPointer] = useState({ hover: false, pressed: false });
  const trackHover = states?.hover !== undefined;
  const trackPress = states?.pressed !== undefined;
  // An option is chosen when the runtime says so; without a runtime (gallery, preview of answers) — by the answers.
  const answer = option ? ctx.answers?.[option.questionId] : undefined;
  const chosen = view?.selected ?? (answer?.kind === 'choice' && option !== undefined && answer.optionIds.includes(option.optionId));
  const waiting = block.type === 'button' && block.props.requiresAnswers && ctx.requiredMissing === true;
  const activeState =
    state ??
    (((view && !view.interactive) || waiting) && states?.disabled
      ? 'disabled'
      : pointer.pressed && trackPress
        ? 'pressed'
        : view?.dragging
          ? 'dragging'
          : chosen
            ? 'selected'
            : view?.zoneId
              ? 'overZone'
              : pointer.hover && trackHover
                ? 'hover'
                : undefined);
  // Cached by reference: the runtime replaces `overrides` and `anim` only when they change, so a block that only
  // moves keeps its style and CSS (50 moving blocks at ≥ 50 fps on a slow phone, SC-05).
  const resolved = useMemo(() => resolveBlockStyle(block, ctx.tokens, activeState), [block, ctx.tokens, activeState]);
  const overrides = view?.overrides;
  const anim = view?.anim;
  const style = useMemo(() => applyRuntimeView(resolved, overrides && anim ? { overrides, anim } : undefined), [resolved, overrides, anim]);
  const x = view?.x ?? block.frame.x;
  const y = view?.y ?? block.frame.y;
  const w = view?.w ?? block.frame.w;
  const h = view?.h ?? block.frame.h;
  const css = useMemo(() => styleToCss(style, { tokens: ctx.tokens, media: ctx.media }, { w, h }), [style, ctx.tokens, ctx.media, w, h]);
  // BH-01, BH-03: dragging and scratching by the finger or the mouse (Pointer Events with capture).
  const live = ctx.mode === 'player' && view?.interactive !== false;
  const drag = live ? behaviorOf(block, 'drag') : undefined;
  const scratch = live ? behaviorOf(block, 'scratch') : undefined;
  const dragHandlers = useDrag({ enabled: drag !== undefined, instanceId, x, y, dispatch: ctx.dispatch });
  const scratching = useScratch({ enabled: scratch !== undefined, instanceId, w, h, brush: scratch?.brush ?? 40, threshold: scratch?.threshold ?? 60, dispatch: ctx.dispatch });
  const rotation = view?.rotation ?? block.frame.rotation;
  const flipX = (view?.overrides['frame.flipX'] as boolean | undefined) ?? block.frame.flipX;
  const flipY = (view?.overrides['frame.flipY'] as boolean | undefined) ?? block.frame.flipY;
  const scale = view?.anim.scale ?? 1;
  const transform = [
    face?.side === 'back' ? 'scaleX(-1)' : '',
    rotation !== 0 ? `rotate(${rotation}deg)` : '',
    flipX || flipY ? `scale(${flipX ? -1 : 1}, ${flipY ? -1 : 1})` : '',
    scale !== 1 ? `scale(${scale})` : '',
    css.transform3d,
  ]
    .filter(Boolean)
    .join(' ');

  const root: CSSProperties = {
    // The place from the document stays in left/top; movement by scenarios and behaviors is a `translate`, which
    // the browser composes without layout and repaint (SC-05: 50 moving blocks at ≥ 50 fps on a slow phone).
    ...(inFlow ? { position: 'relative', flex: 'none' } : { position: 'absolute', left: u(block.frame.x), top: u(block.frame.y) }),
    ...(x !== block.frame.x || y !== block.frame.y ? { translate: `${u(x - block.frame.x)} ${u(y - block.frame.y)}` } : {}),
    ...(view && (view.copy || block.behaviors.some((b) => MOVING.has(b.kind))) ? { willChange: 'translate' } : {}),
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
    ...(drag ? { touchAction: 'none', userSelect: 'none', WebkitUserSelect: 'none', cursor: view?.dragging ? 'grabbing' : 'grab' } : {}),
    ...scratching.style,
    // BH-07: the side turned away from the participant is not drawn and not announced.
    ...(face && !face.shown ? { visibility: 'hidden' } : {}),
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
  // B-11/B-12: choosing an option sends the new answer of its question; a single choice keeps one option.
  const toggleOption = () => {
    if (!option || !ctx.dispatch) return;
    const ids = answer?.kind === 'choice' ? answer.optionIds : [];
    const next = option.multi ? (ids.includes(option.optionId) ? ids.filter((id) => id !== option.optionId) : [...ids, option.optionId]) : [option.optionId];
    ctx.dispatch({ type: 'answer', questionBlockId: option.questionId, answer: next.length ? { kind: 'choice', optionIds: next } : null });
  };
  const pressable = ctx.mode === 'player' && !option && isPressable(block);
  const tap = () => {
    if (waiting) return;
    ctx.dispatch?.({ type: 'tap', blockId: instanceId });
  };
  const handlers = {
    ...(interactive
      ? {
          onClick: (e: { stopPropagation: () => void }) => {
            if (option) {
              e.stopPropagation();
              toggleOption();
            }
            tap();
          },
          onDoubleClick: () => ctx.dispatch!({ type: 'doubleTap', blockId: instanceId }),
          // Keyboard (PL-21): Enter and Space press buttons and choose options.
          ...(option || pressable
            ? {
                onKeyDown: (e: { key: string; target: unknown; currentTarget: unknown; preventDefault: () => void; stopPropagation: () => void }) => {
                  if (e.target !== e.currentTarget || (e.key !== 'Enter' && e.key !== ' ')) return;
                  e.preventDefault();
                  e.stopPropagation();
                  if (option) toggleOption();
                  tap();
                },
              }
            : {}),
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
  const choiceOptions = block.type === 'singleChoice' || block.type === 'multiChoice' ? new Map(block.props.options.map((o) => [o.blockId, o.id])) : null;
  // BH-07: past the edge (90°…270°) the card shows its back side.
  const flip = behaviorOf(block, 'flip');
  const turn = ((((view?.anim.rotateY ?? (view?.flipped ? 180 : 0)) % 360) + 360) % 360);
  const backShown = turn > 90 && turn < 270;
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
      <div className="bk-content" style={content}>
        {(ctx.renderContent ?? blockContent)(block, css, instanceId)}
        {textLayer &&
          (style.text.path.kind === 'none' ? (
            <RichTextView text={textLayer} style={css.text} />
          ) : (
            <PathTextView text={textLayer} typography={style.text} style={css.text} w={w} h={h} />
          ))}
        {block.children.map((child) => {
          const opt = choiceOptions?.get(child.id);
          const side = flip ? (child.id === flip.frontId ? 'front' : child.id === flip.backId ? 'back' : null) : null;
          return (
            <BlockView
              key={child.id}
              block={child}
              instanceId={childInstanceId(instanceId, child)}
              {...(opt ? { option: { questionId: instanceId, optionId: opt, multi: block.type === 'multiChoice' } } : {})}
              {...(style.layout.mode !== 'free' ? { inFlow: true } : {})}
              {...(side ? { face: { side, shown: side === 'back' ? backShown : !backShown } } : {})}
            />
          );
        })}
      </div>
      {/* The stroke is a frame: it lies over the content, so photos and video do not hide it (S-05, S-15). */}
      {css.stroke && <div className="bk-stroke" aria-hidden style={{ ...css.stroke, pointerEvents: 'none' }} />}
    </>
  );

  const inner =
    animated || appear || leaving ? (
      <div ref={animLayer} className="bk-anim" style={{ ...(block.animation ? animatedLayerStyle(block.animation, cssColor({ token: 'accent', alpha: 0.8 }, ctx.tokens)) : { position: 'absolute', inset: 0 }), ...(style.autoHeight ? { position: 'relative', inset: 'auto' } : {}) }}>
        {body}
      </div>
    ) : (
      body
    );
  return (
    <div
      ref={rootEl}
      className="bk-block"
      data-block-id={instanceId}
      data-type={block.type}
      data-state={activeState}
      data-leaving={leaving ? '' : undefined}
      {...semantics(block, { option, chosen, pressable, waiting, player: ctx.mode === 'player' })}
      style={root}
      {...mergeHandlers<Record<string, unknown>>(dragHandlers, scratching.handlers, handlers)}
    >
      {scratch ? (
        <div className="bk-scratch" style={{ position: style.autoHeight ? 'relative' : 'absolute', inset: style.autoHeight ? 'auto' : 0, ...scratching.mask }}>
          {inner}
        </div>
      ) : (
        inner
      )}
    </div>
  );
}
