'use client';
import { copyScreen, pasteScreen, readScreenClipboard, writeScreenClipboard } from '../../lib/editor/clipboard';
import { Artboard, ScreenView } from '@blokum/renderer';
import { type Block, type Screen, type Variable } from '@blokum/schema';
import { type ReactNode, useEffect, useRef, useState, useSyncExternalStore } from 'react';
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
import { api, errorText } from '../../lib/api-browser';
import { AddPanel } from './AddPanel';
import { LibraryPanel } from './LibraryPanel';
import { CoverThumb } from './CoverThumb';
import { MediaPicker } from './MediaPicker';
import { useEditor, useEnv } from './context';

const THUMB = 0.22;

/** A thumbnail draws the blocks of its screen only once it has come near the visible part of the list (a document of 50 screens opens without drawing all of them). */
function useNearViewport(): [(node: HTMLElement | null) => void, boolean] {
  const [near, setNear] = useState(false);
  const watcher = useRef<IntersectionObserver | null>(null);
  const ref = (node: HTMLElement | null): void => {
    watcher.current?.disconnect();
    watcher.current = null;
    if (!node || near) return;
    if (typeof IntersectionObserver === 'undefined') {
      setNear(true);
      return;
    }
    watcher.current = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setNear(true);
          watcher.current?.disconnect();
        }
      },
      { rootMargin: '300px' },
    );
    watcher.current.observe(node);
  };
  return [ref, near];
}

function Thumbnail({ screen }: { screen: Screen }) {
  const { media } = useEnv();
  useSyncExternalStore(media.subscribe, media.getSnapshot, media.getSnapshot);
  const tokens = useEditor((s) => s.doc.theme.tokens);
  const [ref, near] = useNearViewport();
  return (
    <span
      ref={ref}
      className="ed-thumb"
      aria-hidden="true"
      style={{ width: 390 * THUMB, height: screen.height * THUMB, maxHeight: 120 }}
    >
      {near && (
        <Artboard mode="thumbnail" unit={THUMB} tokens={tokens} media={media.resolver}>
          <ScreenView screen={screen} />
        </Artboard>
      )}
    </span>
  );
}

/** E-13 · the screens of the document: thumbnails, order, duplicate, delete, rename. */
function ScreensList() {
  const doc = useEditor((s) => s.doc);
  const currentId = useEditor((s) => s.selection.screenId);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
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
          title="Копирует экран со всем содержимым — его можно вставить и в другую сборку"
          onClick={() => {
            const payload = copyScreen(doc, current.id);
            if (payload) writeScreenClipboard(payload);
            setCopied(true);
          }}
        >
          Копировать экран
        </button>
        <button
          type="button"
          className="ed-btn small"
          title="Вставляет скопированный экран после текущего"
          disabled={doc.screens.length >= 50 || (!copied && readScreenClipboard() === null)}
          onClick={() => {
            const payload = readScreenClipboard();
            if (!payload) return;
            let created = '';
            apply(pasteScreen(payload, current.id, (c) => (created = c.id)), { label: 'Вставить экран' });
            if (created) selectScreen(created);
          }}
        >
          Вставить экран
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
        <p className="ed-hint">На этом экране пока нет блоков. Слои появятся, когда вы добавите первый блок — на вкладке «Добавить» или кнопкой на самом экране.</p>
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

interface TemplateItem { id: string; name: string; category: string | null; coverMediaId: string | null; isSystem: boolean }
interface TemplateContent { id: string; name: string; screens: Screen[]; variables: Variable[] }

/**
 * TPL-02/TPL-03 · вкладка «Шаблоны»: системная галерея (категории, поиск, пустое состояние) и «Мои шаблоны»
 * (создать сборку, вставить отдельный экран, переименовать, обложка, удалить). Создание сборки из шаблона —
 * новая вкладка браузера (TPL-04).
 */
function TemplatesPanel() {
  const { flash } = useEnv();
  const apply = useEditor((s) => s.apply);
  const selectScreen = useEditor((s) => s.selectScreen);
  const screenId = useEditor((s) => s.selection.screenId);
  const doc = useEditor((s) => s.doc);
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('');
  const [system, setSystem] = useState<TemplateItem[]>([]);
  const [mine, setMine] = useState<TemplateItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState<string | null>(null);
  const [opened, setOpened] = useState<TemplateContent | null>(null);
  const [renaming, setRenaming] = useState<{ id: string; name: string } | null>(null);
  const [coverFor, setCoverFor] = useState<string | null>(null);
  const mineRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let active = true;
    setLoading(true);
    Promise.all([api<{ templates: TemplateItem[] }>('/templates'), api<{ templates: TemplateItem[] }>('/templates/mine')])
      .then(([sys, own]) => {
        if (!active) return;
        setSystem(sys.templates);
        setMine(own.templates);
      })
      .catch(() => {
        if (active) flash('Не удалось загрузить шаблоны.', 'error');
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [flash]);

  const createFrom = async (templateId: string) => {
    setCreating(templateId);
    try {
      const res = await api<{ id: string }>('/projects', { method: 'POST', body: { templateId } });
      window.open(`/app/projects/${res.id}/edit`, '_blank');
    } catch (e) {
      flash(errorText(e), 'error');
    } finally {
      setCreating(null);
    }
  };

  /** TPL-02 · show the screens of a template: any of them can be put into this assembly. */
  const openScreens = async (templateId: string) => {
    if (opened?.id === templateId) {
      setOpened(null);
      return;
    }
    try {
      setOpened(await api<TemplateContent>(`/templates/${templateId}`));
    } catch (e) {
      flash(errorText(e), 'error');
    }
  };

  const insertScreen = (content: TemplateContent, fromScreenId: string) => {
    const payload = copyScreen({ ...doc, screens: content.screens, variables: content.variables }, fromScreenId);
    if (!payload) return;
    let created = '';
    apply(pasteScreen(payload, screenId, (c) => (created = c.id)), { label: 'Вставить экран из шаблона' });
    if (created) {
      selectScreen(created);
      flash('Экран вставлен после текущего.', 'ok');
    } else flash('Не удалось вставить: в сборке уже 50 экранов или слишком много переменных.', 'error');
  };

  const rename = async () => {
    if (!renaming || !renaming.name.trim()) return;
    try {
      await api(`/templates/${renaming.id}`, { method: 'PATCH', body: { name: renaming.name.trim() } });
      setMine((prev) => prev.map((t) => (t.id === renaming.id ? { ...t, name: renaming.name.trim() } : t)));
      setRenaming(null);
    } catch (e) {
      flash(errorText(e), 'error');
    }
  };

  const setCover = async (templateId: string, coverMediaId: string | null) => {
    try {
      await api(`/templates/${templateId}`, { method: 'PATCH', body: { coverMediaId } });
      setMine((prev) => prev.map((t) => (t.id === templateId ? { ...t, coverMediaId } : t)));
    } catch (e) {
      flash(errorText(e), 'error');
    }
  };

  const remove = async (t: TemplateItem) => {
    if (!confirm(`Удалить шаблон «${t.name}»? Сборки, созданные из него, останутся.`)) return;
    try {
      await api(`/templates/${t.id}`, { method: 'DELETE' });
      setMine((prev) => prev.filter((x) => x.id !== t.id));
      if (opened?.id === t.id) setOpened(null);
    } catch (e) {
      flash(errorText(e), 'error');
    }
  };

  const q = search.trim().toLowerCase();
  const categoriesAll = Array.from(new Set(system.map((t) => t.category).filter((c): c is string => Boolean(c))));
  const filteredSystem = system.filter((t) => (!q || t.name.toLowerCase().includes(q)) && (!category || t.category === category));
  const categories = Array.from(new Set(filteredSystem.map((t) => t.category).filter((c): c is string => Boolean(c))));
  const uncategorized = filteredSystem.filter((t) => !t.category);

  const screensOf = (t: TemplateItem): ReactNode =>
    opened?.id === t.id ? (
      <ul className="ed-list" aria-label={`Экраны шаблона «${t.name}»`} data-testid="template-screens">
        {opened.screens.map((sc) => (
          <li key={sc.id}>
            <button type="button" className="ed-item" data-testid={`template-screen-${sc.id}`} onClick={() => insertScreen(opened, sc.id)} title="Вставить экран после текущего">
              <span className="name">Вставить экран «{sc.name}»</span>
            </button>
          </li>
        ))}
      </ul>
    ) : null;

  const row = (t: TemplateItem, own: boolean): ReactNode => (
    <li key={t.id} data-testid={`template-row-${t.id}`} style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      {renaming?.id === t.id ? (
        <div className="ed-actions">
          <input
            className="ed-title"
            aria-label="Название шаблона"
            value={renaming.name}
            autoFocus
            onChange={(e) => setRenaming({ id: t.id, name: e.target.value })}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void rename();
              if (e.key === 'Escape') setRenaming(null);
            }}
          />
          <button type="button" className="ed-btn small" onClick={() => void rename()} disabled={!renaming.name.trim()}>
            Сохранить
          </button>
          <button type="button" className="ed-btn small" onClick={() => setRenaming(null)}>
            Отмена
          </button>
        </div>
      ) : (
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <CoverThumb id={t.coverMediaId} />
          <span className="name" style={{ flex: 1, minWidth: 0 }}>
            {t.name}
          </span>
        </div>
      )}
      <div className="ed-actions">
        <button type="button" className="ed-btn small" data-testid={`template-item-${t.id}`} disabled={creating === t.id} onClick={() => void createFrom(t.id)} title={`Создать сборку «${t.name}»`}>
          Создать сборку
        </button>
        <button type="button" className="ed-btn small" data-testid={`template-screens-${t.id}`} aria-expanded={opened?.id === t.id} onClick={() => void openScreens(t.id)}>
          Вставить экран…
        </button>
        {own && (
          <>
            <button type="button" className="ed-btn small" onClick={() => setRenaming({ id: t.id, name: t.name })} aria-label={`Переименовать «${t.name}»`}>
              Переименовать
            </button>
            <button type="button" className="ed-btn small" onClick={() => setCoverFor(t.id)} aria-label={`Обложка «${t.name}»`}>
              Обложка
            </button>
            {t.coverMediaId && (
              <button type="button" className="ed-btn small" onClick={() => void setCover(t.id, null)} aria-label={`Убрать обложку «${t.name}»`}>
                Убрать обложку
              </button>
            )}
            <button type="button" className="ed-btn small danger" onClick={() => void remove(t)} aria-label={`Удалить шаблон «${t.name}»`}>
              Удалить
            </button>
          </>
        )}
      </div>
      {screensOf(t)}
    </li>
  );

  return (
    <div className="ed-section" data-testid="templates-panel">
      <input type="search" className="ed-title" aria-label="Поиск шаблонов" placeholder="Поиск шаблонов" value={search} onChange={(e) => setSearch(e.target.value)} />
      {categoriesAll.length > 0 && (
        <select className="ed-title" aria-label="Категория шаблонов" value={category} onChange={(e) => setCategory(e.target.value)}>
          <option value="">Все категории</option>
          {categoriesAll.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
      )}
      {loading ? (
        <p className="ed-hint">Загрузка…</p>
      ) : system.length === 0 ? (
        // TPL-03: the gallery works with no system template at all: it says so and points to the creator's own.
        <div data-testid="template-empty-state">
          <p className="ed-hint">Системных шаблонов пока нет.</p>
          {mine.length > 0 ? (
            <button type="button" className="ed-btn small" data-testid="template-open-mine" onClick={() => mineRef.current?.scrollIntoView({ block: 'start' })}>
              Открыть «Мои шаблоны»
            </button>
          ) : (
            <p className="ed-hint">Сохраните свою сборку кнопкой «Шаблон» вверху — она появится в разделе «Мои шаблоны».</p>
          )}
        </div>
      ) : filteredSystem.length === 0 ? (
        <p className="ed-hint" data-testid="template-no-match">Ничего не найдено.</p>
      ) : (
        <>
          {categories.map((cat) => (
            <div key={cat} data-testid="template-category">
              <p className="ed-hint" style={{ fontWeight: 600 }}>
                {cat}
              </p>
              <ul className="ed-list">{filteredSystem.filter((t) => t.category === cat).map((t) => row(t, false))}</ul>
            </div>
          ))}
          {uncategorized.length > 0 && <ul className="ed-list">{uncategorized.map((t) => row(t, false))}</ul>}
        </>
      )}
      <div ref={mineRef} data-testid="templates-mine-section">
        <p className="ed-hint" style={{ fontWeight: 600 }}>
          Мои шаблоны
        </p>
        {mine.length === 0 ? <p className="ed-hint" data-testid="templates-mine-empty">Своих шаблонов пока нет: кнопка «Шаблон» вверху сохранит текущую сборку.</p> : <ul className="ed-list">{mine.map((t) => row(t, true))}</ul>}
      </div>
      {coverFor && (
        <MediaPicker
          kinds={['IMAGE']}
          onClose={() => setCoverFor(null)}
          onPick={(ref) => {
            const id = coverFor;
            setCoverFor(null);
            if (ref.source === 'media') void setCover(id, ref.id);
          }}
        />
      )}
    </div>
  );
}

export function LeftPanel() {
  const [tab, setTab] = useState<'screens' | 'layers' | 'add' | 'templates' | 'library'>('screens');
  return (
    <aside className="ed-panel left" aria-label="Экраны и слои">
      <div className="ed-tabs" role="tablist">
        <button type="button" role="tab" className="ed-tab" aria-selected={tab === 'screens'} onClick={() => setTab('screens')}>
          Экраны
        </button>
        <button type="button" role="tab" className="ed-tab" aria-selected={tab === 'layers'} onClick={() => setTab('layers')}>
          Слои
        </button>
        <button type="button" role="tab" className="ed-tab" aria-selected={tab === 'add'} onClick={() => setTab('add')}>
          Добавить
        </button>
        <button type="button" role="tab" className="ed-tab" data-testid="tab-templates" aria-selected={tab === 'templates'} onClick={() => setTab('templates')}>
          Шаблоны
        </button>
        <button type="button" role="tab" className="ed-tab" aria-selected={tab === 'library'} onClick={() => setTab('library')}>
          Библиотека
        </button>
      </div>
      {tab === 'screens' ? <ScreensList /> : tab === 'layers' ? <LayersList /> : tab === 'add' ? <AddPanel /> : tab === 'templates' ? <TemplatesPanel /> : <LibraryPanel />}
    </aside>
  );
}
