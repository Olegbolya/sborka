'use client';
import { Artboard, ScreenView } from '@blokum/renderer';
import { type Block, type Screen } from '@blokum/schema';
import { useState } from 'react';
import { addScreen, deleteScreen, duplicateScreen, moveScreen, patchBlocks, renameScreen } from '../../lib/editor/commands';
import { useEditor } from './context';

const THUMB = 0.22;

function Thumbnail({ screen }: { screen: Screen }) {
  const tokens = useEditor((s) => s.doc.theme.tokens);
  return (
    <span className="ed-thumb" aria-hidden="true" style={{ width: 390 * THUMB, height: screen.height * THUMB, maxHeight: 120 }}>
      <Artboard mode="thumbnail" unit={THUMB} tokens={tokens}>
        <ScreenView screen={screen} />
      </Artboard>
    </span>
  );
}

/** E-13 · the screens of the document: thumbnails, order, duplicate, delete, rename. */
function ScreensList() {
  const doc = useEditor((s) => s.doc);
  const currentId = useEditor((s) => s.selection.screenId);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [name, setName] = useState('');
  const apply = useEditor((s) => s.apply);
  const selectScreen = useEditor((s) => s.selectScreen);
  const current = doc.screens.find((s) => s.id === currentId) ?? doc.screens[0]!;
  const index = doc.screens.findIndex((s) => s.id === current.id);

  /** Adds or copies a screen after the current one and goes to it (the new screen's id is known once the change is made). */
  const createScreenWith = (make: typeof addScreen | typeof duplicateScreen, label: string) => {
    let created = '';
    apply(make(current.id, (c) => (created = c.id)), { label });
    if (created) selectScreen(created);
  };

  const commitName = () => {
    if (renaming) apply(renameScreen(renaming, name), { label: 'Переименовать экран' });
    setRenaming(null);
  };

  return (
    <div className="ed-section">
      <ul className="ed-list" aria-label="Экраны">
        {doc.screens.map((s, i) => (
          <li key={s.id}>
            {renaming === s.id ? (
              <input
                className="ed-title"
                aria-label="Новое название экрана"
                value={name}
                autoFocus
                onChange={(e) => setName(e.target.value)}
                onBlur={commitName}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') commitName();
                  if (e.key === 'Escape') setRenaming(null);
                }}
              />
            ) : (
              <button type="button" className="ed-item" aria-current={s.id === current.id} data-screen-id={s.id} onClick={() => selectScreen(s.id)}>
                <Thumbnail screen={s} />
                <span className="name">
                  {i + 1}. {s.name}
                </span>
              </button>
            )}
          </li>
        ))}
      </ul>
      <div className="ed-actions" role="group" aria-label="Действия с экраном">
        <button type="button" className="ed-btn small" onClick={() => createScreenWith(addScreen, 'Добавить экран')} disabled={doc.screens.length >= 50}>
          Добавить экран
        </button>
        <button
          type="button"
          className="ed-btn small"
          onClick={() => {
            setName(current.name);
            setRenaming(current.id);
          }}
        >
          Переименовать
        </button>
        <button type="button" className="ed-btn small" onClick={() => createScreenWith(duplicateScreen, 'Дублировать экран')} disabled={doc.screens.length >= 50}>
          Дублировать
        </button>
        <button type="button" className="ed-btn small" aria-label="Экран выше" onClick={() => apply(moveScreen(current.id, index - 1), { label: 'Порядок экранов' })} disabled={index === 0}>
          ↑
        </button>
        <button type="button" className="ed-btn small" aria-label="Экран ниже" onClick={() => apply(moveScreen(current.id, index + 1), { label: 'Порядок экранов' })} disabled={index === doc.screens.length - 1}>
          ↓
        </button>
        <button type="button" className="ed-btn small danger" onClick={() => apply(deleteScreen(current.id), { label: 'Удалить экран' })} disabled={doc.screens.length <= 1}>
          Удалить
        </button>
      </div>
    </div>
  );
}

function LayerRow({ block, depth, screenId }: { block: Block; depth: number; screenId: string }) {
  const selected = useEditor((s) => s.selection.blockIds.includes(block.id));
  const select = useEditor((s) => s.select);
  const apply = useEditor((s) => s.apply);
  const ids = useEditor((s) => s.selection.blockIds);
  return (
    <>
      <li style={{ display: 'flex', alignItems: 'center', gap: 4, paddingLeft: depth * 14 }}>
        <button
          type="button"
          className="ed-item"
          aria-pressed={selected}
          data-layer-id={block.id}
          onClick={(e) => select(screenId, e.shiftKey ? (selected ? ids.filter((x) => x !== block.id) : [...ids, block.id]) : [block.id])}
        >
          <span className="name" style={block.hiddenInEditor ? { opacity: 0.5 } : undefined}>
            {block.name}
          </span>
        </button>
        <button
          type="button"
          className="ed-btn small"
          aria-pressed={block.hiddenInEditor}
          aria-label={`${block.hiddenInEditor ? 'Показать' : 'Скрыть'} в редакторе: ${block.name}`}
          title="Скрыть в редакторе"
          onClick={() => apply(patchBlocks([block.id], (b) => void (b.hiddenInEditor = !b.hiddenInEditor)), { label: 'Скрыть в редакторе' })}
        >
          {block.hiddenInEditor ? '◌' : '●'}
        </button>
        <button
          type="button"
          className="ed-btn small"
          aria-pressed={block.locked}
          aria-label={`${block.locked ? 'Разблокировать' : 'Заблокировать'}: ${block.name}`}
          title="Заблокировать"
          onClick={() => apply(patchBlocks([block.id], (b) => void (b.locked = !b.locked)), { label: 'Блокировка' })}
        >
          {block.locked ? '🔒' : '🔓'}
        </button>
      </li>
      {[...block.children].sort((a, b) => b.z - a.z).map((c) => (
        <LayerRow key={c.id} block={c} depth={depth + 1} screenId={screenId} />
      ))}
    </>
  );
}

/** E-13 · layers of the current screen: the tree with containers, the top layer first. */
function LayersList() {
  const doc = useEditor((s) => s.doc);
  const screenId = useEditor((s) => s.selection.screenId);
  const screen = doc.screens.find((s) => s.id === screenId) ?? doc.screens[0]!;
  if (screen.blocks.length === 0) {
    return (
      <div className="ed-section">
        <p className="ed-hint">На этом экране пока нет блоков.</p>
      </div>
    );
  }
  return (
    <div className="ed-section">
      <ul className="ed-list" aria-label="Слои">
        {[...screen.blocks].sort((a, b) => b.z - a.z).map((b) => (
          <LayerRow key={b.id} block={b} depth={0} screenId={screen.id} />
        ))}
      </ul>
    </div>
  );
}

export function LeftPanel() {
  const [tab, setTab] = useState<'screens' | 'layers'>('screens');
  return (
    <aside className="ed-panel left" aria-label="Экраны и слои">
      <div className="ed-tabs" role="tablist">
        <button type="button" role="tab" className="ed-tab" aria-selected={tab === 'screens'} onClick={() => setTab('screens')}>
          Экраны
        </button>
        <button type="button" role="tab" className="ed-tab" aria-selected={tab === 'layers'} onClick={() => setTab('layers')}>
          Слои
        </button>
      </div>
      {tab === 'screens' ? <ScreensList /> : <LayersList />}
    </aside>
  );
}
