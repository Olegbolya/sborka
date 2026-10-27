'use client';
import { type BlockType, type MediaRef } from '@blokum/schema';
import { useState, useSyncExternalStore } from 'react';
import { addBlock } from '../../lib/editor/commands';
import { type MediaKind } from '../../lib/editor/media';
import { CATALOG, GROUP_TITLES, type CatalogEntry } from '../../lib/editor/props-specs';
import { findBlock } from '../../lib/editor/tree';
import { MediaPicker } from './MediaPicker';
import { useEditor, useEnv } from './context';

const GROUPS = Object.keys(GROUP_TITLES) as CatalogEntry['group'][];
const BLOCK_OF_MEDIA: Partial<Record<MediaKind, BlockType>> = {
  IMAGE: 'image',
  GIF: 'gif',
  VIDEO: 'video',
  AUDIO: 'audio',
  LOTTIE: 'animation',
};
const WIDTH_ON_SCREEN = 300;

/** E-14 · «Добавить»: the kinds of blocks by group with a search, and a file from the media library as a ready block. */
export function AddPanel() {
  const { media } = useEnv();
  useSyncExternalStore(media.subscribe, media.getSnapshot, media.getSnapshot);
  const apply = useEditor((s) => s.apply);
  const select = useEditor((s) => s.select);
  const doc = useEditor((s) => s.doc);
  const screenId = useEditor((s) => s.selection.screenId);
  const selected = useEditor((s) => s.selection.blockIds);
  const [query, setQuery] = useState('');
  const [picking, setPicking] = useState(false);
  const screen = doc.screens.find((s) => s.id === screenId) ?? doc.screens[0]!;

  // A container that is the only thing selected receives the new block; otherwise the screen does.
  const target = (() => {
    if (selected.length !== 1) return null;
    const loc = findBlock(doc, selected[0]!);
    const block = loc?.siblings[loc.index];
    return block?.type === 'container' ? block.id : null;
  })();

  const add = (type: BlockType, overrides: Parameters<typeof addBlock>[4] = {}) => {
    let created: string[] = [];
    apply(
      addBlock(screen.id, type, target, (ids) => (created = ids), overrides),
      { label: 'Добавить блок' },
    );
    if (created[0]) select(screen.id, [created[0]]);
  };

  const addMedia = (ref: MediaRef) => {
    setPicking(false);
    const item = ref.source === 'media' ? media.items().find((m) => m.id === ref.id) : undefined;
    const type = (item && BLOCK_OF_MEDIA[item.kind]) ?? 'image';
    const ratio = item?.width && item.height ? item.height / item.width : 0.75;
    const w = type === 'audio' ? 200 : WIDTH_ON_SCREEN;
    const h = type === 'audio' ? 56 : Math.max(24, Math.min(600, Math.round(w * ratio)));
    add(type, { frame: { x: Math.round((390 - w) / 2), y: 100, w, h }, props: { media: ref } });
  };

  const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const matches = (e: CatalogEntry) => words.every((w) => `${e.title} ${e.hint}`.toLowerCase().includes(w));
  const shown = CATALOG.filter(matches);

  return (
    <div className="ed-section" data-testid="add-panel">
      <input
        type="search"
        className="ed-title"
        aria-label="Найти блок"
        placeholder="Найти блок"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />
      {target && <p className="ed-hint">Новый блок попадёт внутрь выбранного контейнера.</p>}
      <div className="ed-actions">
        <button type="button" className="ed-btn small" onClick={() => setPicking(true)}>
          Из медиатеки
        </button>
      </div>
      {shown.length === 0 && <p className="ed-hint">Такого блока нет. Попробуйте другое слово.</p>}
      {GROUPS.map((g) => {
        const entries = shown.filter((e) => e.group === g);
        if (entries.length === 0) return null;
        return (
          <section key={g} aria-label={GROUP_TITLES[g]}>
            <h3 className="ed-addgroup">{GROUP_TITLES[g]}</h3>
            <ul className="ed-list">
              {entries.map((e) => (
                <li key={e.type}>
                  <button type="button" className="ed-item" data-add-type={e.type} onClick={() => add(e.type)}>
                    <span className="name">
                      {e.title}
                      <br />
                      <small>{e.hint}</small>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </section>
        );
      })}
      {picking && (
        <MediaPicker
          kinds={['IMAGE', 'GIF', 'VIDEO', 'AUDIO', 'LOTTIE']}
          onClose={() => setPicking(false)}
          onPick={addMedia}
        />
      )}
    </div>
  );
}
