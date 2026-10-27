'use client';
import { Artboard, ScreenView } from '@blokum/renderer';
import { type Block, type Screen } from '@blokum/schema';
import { type ReactNode, useState, useSyncExternalStore } from 'react';
import { withGroupMates } from '../../lib/editor/arrange';
import { stackOf } from '../../lib/editor/tree';
import {
  addScreen,
  deleteScreen,
  duplicateScreen,
  moveScreen,
  patchBlocks,
  renameScreen,
} from '../../lib/editor/commands';
import { AddPanel } from './AddPanel';
import { useEditor, useEnv } from './context';

const THUMB = 0.22;

function Thumbnail({ screen }: { screen: Screen }) {
  const { media } = useEnv();
  useSyncExternalStore(media.subscribe, media.getSnapshot, media.getSnapshot);
  const tokens = useEditor((s) => s.doc.theme.tokens);
  return (
    <span
      className="ed-thumb"
      aria-hidden="true"
      style={{ width: 390 * THUMB, height: screen.height * THUMB, maxHeight: 120 }}
    >
      <Artboard mode="thumbnail" unit={THUMB} tokens={tokens} media={media.resolver}>
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
    apply(
      make(current.id, (c) => (created = c.id)),
      { label },
    );
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
              <button
                type="button"
                className="ed-item"
                aria-current={s.id === current.id}
                data-screen-id={s.id}
                onClick={() => selectScreen(s.id)}
              >
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
        <button
          type="button"
          className="ed-btn small"
          onClick={() => createScreenWith(addScreen, 'Добавить экран')}
          disabled={doc.screens.length >= 50}
        >
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
        <button
          type="button"
          className="ed-btn small"
          onClick={() => createScreenWith(duplicateScreen, 'Дублировать экран')}
          disabled={doc.screens.length >= 50}
        >
          Дублировать
        </button>
        <button
          type="button"
          className="ed-btn small"
          aria-label="Экран выше"
          onClick={() => apply(moveScreen(current.id, index - 1), { label: 'Порядок экранов' })}
          disabled={index === 0}
        >
          ↑
        </button>
        <button
          type="button"
          className="ed-btn small"
          aria-label="Экран ниже"
          onClick={() => apply(moveScreen(current.id, index + 1), { label: 'Порядок экранов' })}
          disabled={index === doc.screens.length - 1}
        >
          ↓
        </button>
        <button
          type="button"
          className="ed-btn small danger"
          onClick={() => apply(deleteScreen(current.id), { label: 'Удалить экран' })}
          disabled={doc.screens.length <= 1}
        >
          Удалить
        </button>
      </div>
    </div>
  );
}

/** One row of the layers: the name, «скрыть в редакторе», «заблокировать». */
function LayerRow({
  block,
  depth,
  screenId,
  children,
}: {
  block: Block;
  depth: number;
  screenId: string;
  children?: ReactNode;
}) {
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
          onClick={(e) =>
            select(
              screenId,
              e.shiftKey ? (selected ? ids.filter((x) => x !== block.id) : [...ids, block.id]) : [block.id],
            )
          }
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
          onClick={() =>
            apply(
              patchBlocks([block.id], (b) => void (b.hiddenInEditor = !b.hiddenInEditor)),
              { label: 'Скрыть в редакторе' },
            )
          }
        >
          {block.hiddenInEditor ? '◌' : '●'}
        </button>
        <button
          type="button"
          className="ed-btn small"
          aria-pressed={block.locked}
          aria-label={`${block.locked ? 'Разблокировать' : 'Заблокировать'}: ${block.name}`}
          title="Заблокировать"
          onClick={() =>
            apply(
              patchBlocks([block.id], (b) => void (b.locked = !b.locked)),
              { label: 'Блокировка' },
            )
          }
        >
          {block.locked ? '🔒' : '🔓'}
        </button>
      </li>
      {children}
    </>
  );
}

/**
 * The blocks of one level from the top layer down. Blocks of a group are shown together under a row «Группа»;
 * a container's children are shown inside it (E-13).
 */
function LayerTree({ blocks, depth, screenId }: { blocks: readonly Block[]; depth: number; screenId: string }) {
  const select = useEditor((s) => s.select);
  const doc = useEditor((s) => s.doc);
  const groupSelected = useEditor((s) => s.selection.blockIds);
  const top = stackOf(blocks).reverse();
  const shown = new Set<string>();
  const rows: ReactNode[] = [];
  const row = (b: Block, d: number) => (
    <LayerRow key={b.id} block={b} depth={d} screenId={screenId}>
      {b.children.length > 0 && <LayerTree blocks={b.children} depth={d + 1} screenId={screenId} />}
    </LayerRow>
  );
  for (const b of top) {
    if (shown.has(b.id)) continue;
    if (!b.groupId) {
      rows.push(row(b, depth));
      continue;
    }
    const members = top.filter((m) => m.groupId === b.groupId);
    members.forEach((m) => shown.add(m.id));
    const ids = members.map((m) => m.id);
    const active = ids.every((id) => groupSelected.includes(id));
    rows.push(
      <li key={`group-${b.groupId}`} style={{ paddingLeft: depth * 14 }}>
        <button
          type="button"
          className="ed-item"
          aria-pressed={active}
          data-group-id={b.groupId}
          onClick={() => select(screenId, withGroupMates(doc, ids))}
        >
          <span className="name">Группа ({members.length})</span>
        </button>
      </li>,
      ...members.map((m) => row(m, depth + 1)),
    );
  }
  return <>{rows}</>;
}

/** E-13 · layers of the current screen: the tree with groups and containers, the top layer first. */
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
        <LayerTree blocks={screen.blocks} depth={0} screenId={screen.id} />
      </ul>
    </div>
  );
}

export function LeftPanel() {
  const [tab, setTab] = useState<'screens' | 'layers' | 'add'>('screens');
  return (
    <aside className="ed-panel left" aria-label="Экраны и слои">
      <div className="ed-tabs" role="tablist">
        <button
          type="button"
          role="tab"
          className="ed-tab"
          aria-selected={tab === 'screens'}
          onClick={() => setTab('screens')}
        >
          Экраны
        </button>
        <button
          type="button"
          role="tab"
          className="ed-tab"
          aria-selected={tab === 'layers'}
          onClick={() => setTab('layers')}
        >
          Слои
        </button>
        <button type="button" role="tab" className="ed-tab" aria-selected={tab === 'add'} onClick={() => setTab('add')}>
          Добавить
        </button>
      </div>
      {tab === 'screens' ? <ScreensList /> : tab === 'layers' ? <LayersList /> : <AddPanel />}
    </aside>
  );
}
