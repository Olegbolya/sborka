'use client';

import { createRuntime } from '@blokum/engine';
import { Artboard, DEV_THEMES, PlayerScreen, RuntimeStore, u } from '@blokum/renderer';
import { type CSSProperties, useState } from 'react';
import { devMedia } from '../../../lib/dev/dev-media';
import { type BehaviorScene } from '../../../lib/dev/behaviors-gallery';

const heading: CSSProperties = { fontSize: u(19), fontWeight: 800, margin: `${u(26)} ${u(15)} ${u(4)}` };
const hint: CSSProperties = { fontSize: u(13), margin: `0 ${u(15)} ${u(8)}` };

/** A scene on its own runtime: the outcome of the wheel comes from a random source as on the server (RN-01). */
function Scene({ scene, seed }: { scene: BehaviorScene; seed: number }) {
  const [store] = useState(() => new RuntimeStore(createRuntime(scene.doc, { seed, randomSource: { next: () => Math.random() } })));
  return <PlayerScreen screen={scene.doc.screens[0]!} store={store} />;
}

/** Service page of P1.9: every behavior BH-01…BH-08 alive, each as a small example of a reference game. */
export function DevBehaviors({ theme, scenes }: { theme: 'light' | 'dark'; scenes: BehaviorScene[] }) {
  const tokens = DEV_THEMES[theme];
  return (
    <Artboard mode="player" tokens={tokens} media={devMedia}>
      <div style={{ color: tokens.colors.text, fontFamily: 'system-ui, sans-serif' }}>
        <h1 style={{ ...heading, fontSize: u(24) }}>Галерея поведений</h1>
        {scenes.map((scene, i) => (
          <section key={scene.id} className="dev-behavior" data-scene={scene.id} aria-labelledby={`scena-${scene.id}`}>
            <h2 id={`scena-${scene.id}`} style={heading}>
              {scene.title}
            </h2>
            <p style={hint}>{scene.hint}</p>
            <Scene scene={scene} seed={i + 1} />
          </section>
        ))}
      </div>
    </Artboard>
  );
}
