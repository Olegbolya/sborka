'use client';
import { type BlockType, type MediaRef } from '@blokum/schema';
import { useEffect, useState, useSyncExternalStore } from 'react';
import { addBlock } from '../../lib/editor/commands';
import { type ClipboardPayload, type PasteChoice, type PastePlan, copyBlocks, pasteBlocks, planPaste } from '../../lib/editor/clipboard';
import { type MediaKind } from '../../lib/editor/media';
import { CATALOG, GROUP_TITLES, type CatalogEntry } from '../../lib/editor/props-specs';
import { findBlock } from '../../lib/editor/tree';
import { api, errorText } from '../../lib/api-browser';
import { CoverThumb } from './CoverThumb';
import { MediaPicker } from './MediaPicker';
import { PasteVariablesDialog } from './PasteVariablesDialog';
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

/**
 * Adding to the screen: the container that is the only thing selected receives the new block, otherwise the screen does.
 * `addMedia` makes a ready block of the right kind and proportions for a file of the creator's library or of the platform's.
 */
export function useAddBlocks() {
  const { media } = useEnv();
  const apply = useEditor((s) => s.apply);
  const select = useEditor((s) => s.select);
  const doc = useEditor((s) => s.doc);
  const screenId = useEditor((s) => s.selection.screenId);
  const selected = useEditor((s) => s.selection.blockIds);
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
    const item = ref.source === 'media' ? media.items().find((m) => m.id === ref.id) : ref.source === 'library' ? media.libraryItem(ref.id) : undefined;
    const kind = item && 'kind' in item ? item.kind : null;
    const type = (kind && BLOCK_OF_MEDIA[kind]) ?? 'image';
    const ratio = item?.width && item.height ? item.height / item.width : 0.75;
    const w = type === 'audio' ? 200 : WIDTH_ON_SCREEN;
    const h = type === 'audio' ? 56 : Math.max(24, Math.min(600, Math.round(w * ratio)));
    add(type, { frame: { x: Math.round((390 - w) / 2), y: 100, w, h }, props: { media: ref } });
  };

  return { screen, selected, target, add, addMedia };
}

/** E-14 · «Добавить»: the kinds of blocks by group with a search, and a file from the media library as a ready block. */
export function AddPanel() {
  const { media } = useEnv();
  useSyncExternalStore(media.subscribe, media.getSnapshot, media.getSnapshot);
  const [query, setQuery] = useState('');
  const [picking, setPicking] = useState(false);

  const { screen, selected, target, add, addMedia: addPicked } = useAddBlocks();
  const addMedia = (ref: MediaRef) => {
    setPicking(false);
    addPicked(ref);
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
      <ElementsSection screenId={screen.id} selectedIds={selected} />
    </div>
  );
}

interface ElementSummary { id: string; name: string; coverMediaId: string | null }

/** ME-01/ME-02 · «Мои элементы»: список сохранённых элементов и кнопка «Сохранить как элемент». */
function ElementsSection({ screenId, selectedIds }: { screenId: string; selectedIds: readonly string[] }) {
  const { flash } = useEnv();
  const apply = useEditor((s) => s.apply);
  const select = useEditor((s) => s.select);
  const doc = useEditor((s) => s.doc);
  const [elements, setElements] = useState<ElementSummary[]>([]);
  const [saving, setSaving] = useState(false);
  const [namePrompt, setNamePrompt] = useState(false);
  const [eName, setEName] = useState('');
  const [renaming, setRenaming] = useState<{ id: string; name: string } | null>(null);
  const [coverFor, setCoverFor] = useState<string | null>(null);
  // ME-02: the element's variables share names with the ones of this assembly — the creator chooses (as in SC-06).
  const [conflict, setConflict] = useState<{ payload: ClipboardPayload; plan: PastePlan } | null>(null);

  useEffect(() => {
    let active = true;
    api<{ elements: ElementSummary[] }>('/elements').then((r) => { if (active) setElements(r.elements); }).catch(() => {});
    return () => { active = false; };
  }, []);

  const saveElement = async () => {
    if (!eName.trim()) return;
    setSaving(true);
    setNamePrompt(false);
    try {
      const payload = copyBlocks(doc, selectedIds);
      if (!payload) { flash('Выберите блоки для сохранения.', 'error'); return; }
      const res = await api<{ id: string }>('/elements', { method: 'POST', body: { name: eName.trim(), fragment: payload } });
      setElements((prev) => [{ id: res.id, name: eName.trim(), coverMediaId: null }, ...prev]);
      flash('Элемент сохранён.', 'ok');
      setEName('');
    } catch (e) {
      flash(errorText(e), 'error');
    } finally {
      setSaving(false);
    }
  };

  const doInsert = (payload: ClipboardPayload, choices: Record<string, PasteChoice>) => {
    let created: string[] = [];
    apply(pasteBlocks(payload, screenId, 12, (made) => (created = made), choices), { label: 'Вставить элемент' });
    if (created.length) select(screenId, created);
    else flash('Не удалось вставить — на экране уже 100 блоков.', 'error');
  };

  const insertElement = async (id: string) => {
    try {
      const data = await api<{ fragment: ClipboardPayload }>(`/elements/${id}`);
      const payload = data.fragment;
      const plan = planPaste(doc, payload);
      if (plan.conflicts.length > 0) setConflict({ payload, plan });
      else doInsert(payload, {});
    } catch (e) {
      flash(errorText(e), 'error');
    }
  };

  const renameElement = async () => {
    if (!renaming || !renaming.name.trim()) return;
    try {
      await api(`/elements/${renaming.id}`, { method: 'PATCH', body: { name: renaming.name.trim() } });
      setElements((prev) => prev.map((e) => (e.id === renaming.id ? { ...e, name: renaming.name.trim() } : e)));
      setRenaming(null);
    } catch (e) {
      flash(errorText(e), 'error');
    }
  };

  const setCover = async (id: string, coverMediaId: string | null) => {
    try {
      await api(`/elements/${id}`, { method: 'PATCH', body: { coverMediaId } });
      setElements((prev) => prev.map((e) => (e.id === id ? { ...e, coverMediaId } : e)));
    } catch (e) {
      flash(errorText(e), 'error');
    }
  };

  const deleteElement = async (id: string, name: string) => {
    if (!confirm(`Удалить элемент «${name}»?`)) return;
    try {
      await api(`/elements/${id}`, { method: 'DELETE' });
      setElements((prev) => prev.filter((e) => e.id !== id));
    } catch (e) {
      flash(errorText(e), 'error');
    }
  };

  return (
    <section aria-label="Мои элементы" data-testid="elements-panel">
      <h3 className="ed-addgroup">Мои элементы</h3>
      {selectedIds.length > 0 && !namePrompt && (
        <div className="ed-actions">
          <button type="button" className="ed-btn small" data-testid="element-save" disabled={saving} onClick={() => setNamePrompt(true)}>
            Сохранить как элемент
          </button>
        </div>
      )}
      {namePrompt && (
        <div className="ed-actions">
          <input
            className="ed-title"
            aria-label="Название элемента"
            placeholder="Название"
            value={eName}
            autoFocus
            onChange={(e) => setEName(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') void saveElement(); if (e.key === 'Escape') setNamePrompt(false); }}
          />
          <button type="button" className="ed-btn small" onClick={() => void saveElement()} disabled={!eName.trim()}>
            Сохранить
          </button>
          <button type="button" className="ed-btn small" onClick={() => setNamePrompt(false)}>
            Отмена
          </button>
        </div>
      )}
      {elements.length === 0 ? (
        <p className="ed-hint">Выделите блоки и нажмите «Сохранить как элемент».</p>
      ) : (
        <ul className="ed-list">
          {elements.map((el) => (
            <li key={el.id} data-testid={`element-row-${el.id}`} style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              {renaming?.id === el.id ? (
                <div className="ed-actions">
                  <input
                    className="ed-title"
                    aria-label="Новое название элемента"
                    value={renaming.name}
                    autoFocus
                    onChange={(e) => setRenaming({ id: el.id, name: e.target.value })}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') void renameElement();
                      if (e.key === 'Escape') setRenaming(null);
                    }}
                  />
                  <button type="button" className="ed-btn small" onClick={() => void renameElement()} disabled={!renaming.name.trim()}>
                    Сохранить
                  </button>
                  <button type="button" className="ed-btn small" onClick={() => setRenaming(null)}>
                    Отмена
                  </button>
                </div>
              ) : (
                <>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                    <CoverThumb id={el.coverMediaId} />
                    <button type="button" className="ed-item" data-testid={`element-insert-${el.id}`} onClick={() => void insertElement(el.id)} title={`Вставить «${el.name}»`} style={{ flex: 1 }}>
                      <span className="name">{el.name}</span>
                    </button>
                  </div>
                  <div className="ed-actions">
                    <button type="button" className="ed-btn small" onClick={() => setRenaming({ id: el.id, name: el.name })} aria-label={`Переименовать «${el.name}»`}>
                      Переименовать
                    </button>
                    <button type="button" className="ed-btn small" onClick={() => setCoverFor(el.id)} aria-label={`Обложка «${el.name}»`}>
                      Обложка
                    </button>
                    {el.coverMediaId && (
                      <button type="button" className="ed-btn small" onClick={() => void setCover(el.id, null)} aria-label={`Убрать обложку «${el.name}»`}>
                        Убрать обложку
                      </button>
                    )}
                    <button type="button" className="ed-btn small danger" onClick={() => void deleteElement(el.id, el.name)} aria-label={`Удалить «${el.name}»`}>
                      Удалить
                    </button>
                  </div>
                </>
              )}
            </li>
          ))}
        </ul>
      )}
      {conflict && (
        <PasteVariablesDialog
          payload={conflict.payload}
          plan={conflict.plan}
          onCancel={() => setConflict(null)}
          onPaste={(choices) => {
            doInsert(conflict.payload, choices);
            setConflict(null);
          }}
        />
      )}
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
    </section>
  );
}
