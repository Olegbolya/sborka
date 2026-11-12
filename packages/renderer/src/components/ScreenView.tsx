'use client';

import { type Block, type Screen, walkBlocks } from '@blokum/schema';
import { type CSSProperties, type ReactNode } from 'react';
import { useRenderContext } from '../context.js';
import { fillLayers } from '../style/style-to-css.js';
import { ARTBOARD_WIDTH, u } from '../units.js';
import { BlockView } from './BlockView.js';

/**
 * One screen of the project on the artboard (E-01): 390 units wide, its own height (long screens scroll
 * in the player), the screen background or the theme background, blocks by layer, then the copies
 * created by scenarios (P1.3) on top.
 */
export function ScreenView({ screen }: { screen: Screen }): ReactNode {
  const ctx = useRenderContext();
  const fills = screen.background.length ? screen.background : ctx.tokens.background;
  const layers = fillLayers(fills, { tokens: ctx.tokens, media: ctx.media });
  const blocks = [...screen.blocks].sort((a, b) => a.z - b.z);
  const copies: Array<{ id: string; block: Block }> = [];
  if (ctx.views) {
    const byId = new Map([...walkBlocks(screen.blocks)].map((b) => [b.id, b]));
    for (const v of [...ctx.views.values()].sort((a, b) => a.z - b.z)) {
      const proto = byId.get(v.protoId);
      if (v.copy && v.parentId === null && proto) copies.push({ id: v.id, block: proto });
    }
  }
  const style: CSSProperties = { position: 'relative', width: u(ARTBOARD_WIDTH), height: u(screen.height), overflow: 'hidden', isolation: 'isolate' };
  return (
    <section className="bk-screen" data-screen-id={screen.id} aria-label={screen.name} style={style}>
      {layers.map((layer, i) =>
        layer.kind === 'video' ? (
          <video key={i} src={layer.src} autoPlay muted loop playsInline style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', ...layer.style }} />
        ) : (
          <div key={i} className="bk-screen-bg" style={{ position: 'absolute', inset: 0, ...layer.style }} />
        ),
      )}
      {blocks.map((b) => (
        <BlockView key={b.id} block={b} />
      ))}
      {copies.map((c) => (
        <BlockView key={c.id} block={c.block} instanceId={c.id} />
      ))}
    </section>
  );
}
