'use client';

import { createRuntime } from '@blokum/engine';
import { Artboard, BlockView, DEV_THEMES, PlayerScreen, RuntimeStore, SoundManager, u } from '@blokum/renderer';
import { BLOCK_STATES } from '@blokum/schema';
import { type CSSProperties, useState } from 'react';
import { devMedia } from '../../../lib/dev/dev-media';
import { type GallerySection, STATE_GRID_CELL, STATE_LABELS } from '../../../lib/dev/render-gallery';

const STATES = ['normal', ...BLOCK_STATES] as const;
const heading: CSSProperties = { fontSize: u(20), fontWeight: 800, margin: `${u(28)} ${u(15)} ${u(4)}` };
const caption: CSSProperties = { fontSize: u(12), margin: `${u(8)} ${u(15)} ${u(6)}` };

/** A live block on the real runtime: answers, timers, variables and rules work as for a participant. */
function LiveSection({ section, index, total }: { section: GallerySection; index: number; total: number }) {
  const [store] = useState(() => new RuntimeStore(createRuntime(section.doc, { seed: index + 1 })));
  return <PlayerScreen screen={section.doc.screens[0]!} store={store} progress={{ index, total }} />;
}

/**
 * Service page of P1.8: every block type B-01…B-23 alive in the player and in all states of S-15. The grid
 * of states is a picture (inert): its copies of the blocks are not focusable and not announced.
 */
export function DevRenderGallery({ theme, sections }: { theme: 'light' | 'dark'; sections: GallerySection[] }) {
  const tokens = DEV_THEMES[theme];
  const [sound] = useState(() => new SoundManager(devMedia));
  return (
    <Artboard mode="player" tokens={tokens} media={devMedia} sound={sound} consentUrl="#tekst-soglasiya" variables={{ 'zhizni-galerei': 3 }} linkHref={(url) => `/out?url=${encodeURIComponent(url)}`}>
      <div style={{ color: tokens.colors.text, fontFamily: 'system-ui, sans-serif' }}>
        <h1 style={{ ...heading, fontSize: u(24) }}>Галерея блоков</h1>
        {sections.map((section, i) => (
          <section key={section.type} className="dev-block-section" data-type={section.type} aria-labelledby={`zagolovok-${section.type}`}>
            <h2 id={`zagolovok-${section.type}`} style={heading}>
              {section.id} · {section.label}
            </h2>
            <LiveSection section={section} index={i} total={sections.length} />
            <p style={caption}>Состояния (S-15)</p>
            <div className="dev-states" inert style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: u(8), padding: `0 ${u(15)}` }}>
              {STATES.map((state) => (
                <figure key={state} style={{ margin: 0 }}>
                  <div style={{ position: 'relative', width: u(STATE_GRID_CELL.w), height: u(STATE_GRID_CELL.h), overflow: 'hidden' }}>
                    <BlockView block={section.stateBlock} {...(state === 'normal' ? {} : { state })} />
                  </div>
                  <figcaption style={{ fontSize: u(11), marginTop: u(3) }}>{STATE_LABELS[state]}</figcaption>
                </figure>
              ))}
            </div>
          </section>
        ))}
        <p id="tekst-soglasiya" style={{ ...caption, marginTop: u(32), marginBottom: u(32) }}>
          Текст согласия на обработку персональных данных: в опубликованной сборке он собирается из реквизитов создателя (PL-23).
        </p>
      </div>
    </Artboard>
  );
}
