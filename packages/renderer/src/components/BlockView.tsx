'use client';

import { type Block, type BLOCK_STATES, resolveBlockStyle } from '@blokum/schema';
import { type CSSProperties, type ReactNode } from 'react';
import { useRenderContext } from '../context.js';
import { applyRuntimeView } from '../style/apply-view.js';
import { type FillLayer, styleToCss } from '../style/style-to-css.js';
import { u } from '../units.js';
import { PathTextView, RichTextView } from './RichTextView.js';

/** Id of the instance of a nested block: children of a copy «x~3» are «child~3» (engine P1.3). */
export function childInstanceId(parentInstanceId: string, child: Block): string {
  const tilde = parentInstanceId.indexOf('~');
  return tilde === -1 ? child.id : `${child.id}${parentInstanceId.slice(tilde)}`;
}

function Layer({ layer }: { layer: FillLayer }): ReactNode {
  const base: CSSProperties = { position: 'absolute', inset: 0 };
  if (layer.kind === 'video') return <video className="bk-fill" src={layer.src} autoPlay muted loop playsInline style={{ ...base, width: '100%', height: '100%', ...layer.style }} />;
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
 * `styleToCss`, type-specific content, the text layer (any block can have text) and nested blocks.
 */
export function BlockView({ block, instanceId = block.id, state }: BlockViewProps): ReactNode {
  const ctx = useRenderContext();
  const view = ctx.views?.get(instanceId);
  if (ctx.mode === 'editor' && block.hiddenInEditor) return null;
  if (ctx.mode !== 'editor' && view && !view.visible) return null;
  if (ctx.mode !== 'editor' && !view && block.initiallyHidden) return null;

  const activeState = state ?? (view?.selected ? 'selected' : view?.dragging ? 'dragging' : view?.zoneId ? 'overZone' : undefined);
  const style = applyRuntimeView(resolveBlockStyle(block, ctx.tokens, activeState), view);
  const css = styleToCss(style, { tokens: ctx.tokens, media: ctx.media });

  const x = view?.x ?? block.frame.x;
  const y = view?.y ?? block.frame.y;
  const w = view?.w ?? block.frame.w;
  const h = view?.h ?? block.frame.h;
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
  };

  const textLayer = (view?.overrides.textLayer as Block['textLayer']) ?? block.textLayer;
  const interactive = ctx.mode === 'player' && ctx.dispatch;
  const handlers = interactive
    ? {
        onClick: () => ctx.dispatch!({ type: 'tap', blockId: instanceId }),
        onDoubleClick: () => ctx.dispatch!({ type: 'doubleTap', blockId: instanceId }),
        onPointerEnter: (e: { pointerType: string }) => e.pointerType === 'mouse' && ctx.dispatch!({ type: 'hover', blockId: instanceId, phase: 'enter' }),
        onPointerLeave: (e: { pointerType: string }) => e.pointerType === 'mouse' && ctx.dispatch!({ type: 'hover', blockId: instanceId, phase: 'leave' }),
      }
    : {};

  return (
    <div
      className="bk-block"
      data-block-id={instanceId}
      data-type={block.type}
      data-state={activeState}
      aria-label={block.a11y.label ?? undefined}
      role={block.a11y.alt ? 'img' : undefined}
      style={root}
      {...handlers}
    >
      <div className="bk-surface" style={css.surface}>
        {css.layers.map((layer, i) => (
          <Layer key={i} layer={layer} />
        ))}
      </div>
      <div className="bk-content" style={css.content}>
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
    </div>
  );
}
