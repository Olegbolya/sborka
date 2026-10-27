'use client';
import { Artboard, ScreenView } from '@blokum/renderer';
import { type Block } from '@blokum/schema';
import { type KeyboardEvent, type PointerEvent, useEffect, useMemo, useRef, useState } from 'react';
import { drawOrder } from '../../lib/editor/tree';
import { useEditor } from './context';

const ARTBOARD = 390;

interface Hit {
  block: Block;
  x: number;
  y: number;
}

/** Hit areas of all blocks of a screen with their place on the artboard, in drawing order (containers' children above them). */
function hitsOf(blocks: readonly Block[]): Hit[] {
  const origins = new Map<string, { x: number; y: number }>();
  const place = (list: readonly Block[], ox: number, oy: number): void => {
    for (const b of list) {
      origins.set(b.id, { x: ox + b.frame.x, y: oy + b.frame.y });
      place(b.children, ox + b.frame.x, oy + b.frame.y);
    }
  };
  place(blocks, 0, 0);
  return drawOrder(blocks).map((block) => ({ block, ...origins.get(block.id)! }));
}

/**
 * E-01…E-03 · the working screen: drawn by the same renderer as the player (one render), with a layer of hit areas
 * above it. Taking blocks with the pointer is the start of P3.3; here a block is selected with a click or the keyboard.
 */
export function Canvas() {
  const doc = useEditor((s) => s.doc);
  const selection = useEditor((s) => s.selection);
  const select = useEditor((s) => s.select);
  const screen = doc.screens.find((s) => s.id === selection.screenId) ?? doc.screens[0]!;
  const wrap = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(ARTBOARD + 32);

  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setWidth(el.clientWidth));
    ro.observe(el);
    setWidth(el.clientWidth);
    return () => ro.disconnect();
  }, []);

  const unit = Math.min(1.5, Math.max(0.5, (width - 32) / ARTBOARD));
  const hits = useMemo(() => hitsOf(screen.blocks).filter((h) => !h.block.hiddenInEditor), [screen.blocks]);
  const selected = new Set(selection.blockIds);

  const pick = (block: Block, additive: boolean) => {
    const ids = additive ? (selected.has(block.id) ? selection.blockIds.filter((x) => x !== block.id) : [...selection.blockIds, block.id]) : [block.id];
    select(screen.id, ids);
  };
  const onKey = (e: KeyboardEvent, block: Block) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      pick(block, e.shiftKey);
    }
  };

  return (
    <div className="ed-canvas" ref={wrap} data-testid="canvas">
      <div
        className="ed-stage"
        data-testid="stage"
        data-screen-id={screen.id}
        style={{ width: ARTBOARD * unit, height: screen.height * unit }}
        onPointerDown={(e: PointerEvent<HTMLDivElement>) => {
          if (e.target === e.currentTarget) select(screen.id, []);
        }}
      >
        <Artboard mode="editor" unit={unit} tokens={doc.theme.tokens}>
          <ScreenView screen={screen} />
        </Artboard>
        {hits.map(({ block, x, y }) => (
          <button
            key={block.id}
            type="button"
            className="ed-hit"
            aria-label={block.name}
            aria-pressed={selected.has(block.id)}
            data-block-id={block.id}
            data-locked={block.locked}
            style={{ left: x * unit, top: y * unit, width: block.frame.w * unit, height: block.frame.h * unit }}
            onPointerDown={(e) => {
              e.stopPropagation();
              pick(block, e.shiftKey || e.metaKey || e.ctrlKey);
            }}
            onKeyDown={(e) => onKey(e, block)}
          />
        ))}
      </div>
    </div>
  );
}
