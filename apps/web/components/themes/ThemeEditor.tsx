'use client';
import { Artboard, ScreenView } from '@blokum/renderer';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { errorText } from '../../lib/api-browser';
import { setThemeTokens } from '../../lib/editor/commands';
import { MediaCatalog } from '../../lib/editor/media';
import { createEditorStore, type EditorStore } from '../../lib/editor/store';
import { contrastChecks } from '../../lib/themes/contrast';
import { deleteTheme, duplicateTheme, getTheme, saveTheme, setDefaultTheme, type ThemeFull } from '../../lib/themes/api';
import { sampleDocument } from '../../lib/themes/sample';
import { THEME_SECTIONS } from '../../lib/themes/theme-specs';
import { Section } from '../editor/controls';
import { EditorProvider, useControlEnv, useEditor } from '../editor/context';
import { Fields, type Level } from '../editor/StylePanels';
import '../editor/editor.css';
import { BlockDefaultsEditor } from './BlockDefaultsEditor';
import { ColorsEditor } from './ColorsEditor';

type Save = 'saved' | 'saving' | 'error';

/** The sample screen with every block type, drawn with the tokens being edited (TH-02). */
function SamplePreview() {
  const doc = useEditor((s) => s.doc);
  const { media } = useControlEnv();
  const screen = doc.screens[0]!;
  return (
    <div className="ed-canvas" style={{ overflow: 'auto', padding: 16 }} data-testid="theme-sample">
      <div style={{ width: 390, margin: '0 auto', height: screen.height, position: 'relative' }}>
        <Artboard mode="editor" unit={1} tokens={doc.theme.tokens} media={media.resolver}>
          <ScreenView screen={screen} />
        </Artboard>
      </div>
    </div>
  );
}

/** Undo and redo of the changes made in this theme editor. */
function UndoRedo() {
  const undo = useEditor((s) => s.undo);
  const redo = useEditor((s) => s.redo);
  const canUndo = useEditor((s) => s.past.length > 0);
  const canRedo = useEditor((s) => s.future.length > 0);
  return (
    <>
      <button type="button" className="ed-btn" onClick={() => undo()} disabled={!canUndo} aria-label="Отменить">
        ↶ Отменить
      </button>
      <button type="button" className="ed-btn" onClick={() => redo()} disabled={!canRedo} aria-label="Повторить">
        ↷ Повторить
      </button>
    </>
  );
}

/** TH-02 · warnings about contrast: not a ban, a hint. */
function ContrastPanel() {
  const colors = useEditor((s) => s.doc.theme.tokens.colors);
  const checks = contrastChecks({ colors });
  const bad = checks.filter((c) => !c.ok);
  return (
    <div data-testid="contrast-panel">
      <p role="status" data-testid="contrast-summary" className={bad.length > 0 ? 'ed-banner' : 'ed-hint'}>
        {bad.length === 0 ? 'Контраст в норме: текст читается (WCAG AA).' : `Плохо читается: ${bad.length}. Подберите цвета контрастнее — это совет, тему можно сохранить и так.`}
      </p>
      <ul className="ed-list">
        {checks.map((c) => (
          <li key={c.id} data-contrast={c.id} data-ok={c.ok} style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <span aria-hidden style={{ width: 28, height: 20, borderRadius: 4, background: c.background, color: c.foreground, border: '1px solid var(--line)', textAlign: 'center', lineHeight: '20px', fontWeight: 700 }}>
              А
            </span>
            <span style={{ flex: 1 }}>{c.title}</span>
            <span>
              {c.ratio.toFixed(1)} из {c.needed} {c.ok ? '✓' : '⚠'}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function Controls({ tokens }: { tokens: ReturnType<typeof useTokens> }) {
  const apply = useEditor((s) => s.apply);
  const level: Level = {
    values: [tokens],
    write: (change) => apply(setThemeTokens(change), { label: 'Тема', mergeKey: 'theme-field' }),
    tokens,
  };
  return (
    <>
      <Section id="colors" title="Цвета" open>
        <ColorsEditor />
      </Section>
      <Section id="contrast" title="Проверка контраста" open>
        <ContrastPanel />
      </Section>
      {THEME_SECTIONS.map((section) => (
        <Section key={section.id} id={`theme-${section.id}`} title={section.title}>
          <Fields fields={section.fields} level={level} prefix={`theme-${section.id}`} />
        </Section>
      ))}
      <Section id="block-defaults" title="Стиль блоков по умолчанию">
        <BlockDefaultsEditor />
      </Section>
    </>
  );
}

const useTokens = () => useEditor((s) => s.doc.theme.tokens);

function Body({ theme, store, onSave }: { theme: ThemeFull; store: EditorStore; onSave: (s: Save, message?: string) => void }) {
  const tokens = useTokens();
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latest = useRef(store);
  latest.current = store;

  // Every change of the sample document is sent to the server a moment after the last one.
  useEffect(() => {
    let sent = store.getState().docVersion;
    const unsubscribe = store.subscribe((s) => {
      if (s.docVersion === sent) return;
      sent = s.docVersion;
      onSave('saving');
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => {
        saveTheme(theme.id, { tokens: latest.current.getState().doc.theme.tokens }).then(
          () => onSave('saved'),
          (e: unknown) => onSave('error', errorText(e)),
        );
      }, 600);
    });
    return () => {
      unsubscribe();
      if (timer.current) clearTimeout(timer.current);
    };
  }, [store, theme.id, onSave]);

  return (
    <div className="ed-body ed-theme-body">
      <aside className="ed-panel left" aria-label="Настройки темы" data-testid="theme-controls">
        <Controls tokens={tokens} />
      </aside>
      <SamplePreview />
    </div>
  );
}

export function ThemeEditor({ themeId }: { themeId: string }) {
  const router = useRouter();
  const [theme, setTheme] = useState<ThemeFull | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [save, setSave] = useState<{ status: Save; message?: string }>({ status: 'saved' });
  const [name, setName] = useState('');
  const [isDefault, setIsDefault] = useState(false);

  useEffect(() => {
    let cancelled = false;
    getTheme(themeId).then(
      (t) => {
        if (cancelled) return;
        setTheme(t);
        setName(t.name);
        setIsDefault(t.isDefault);
      },
      (e: unknown) => !cancelled && setFailure(errorText(e)),
    );
    return () => {
      cancelled = true;
    };
  }, [themeId]);

  const env = useMemo(() => {
    if (!theme) return null;
    const media = new MediaCatalog();
    void media.load().catch(() => undefined);
    return { store: createEditorStore(sampleDocument(theme.tokens)), media };
  }, [theme]);

  const onSave = useCallback((status: Save, message?: string) => setSave({ status, ...(message ? { message } : {}) }), []);

  const rename = (value: string) => {
    setName(value);
    if (!theme || !value.trim()) return;
    setSave({ status: 'saving' });
    saveTheme(theme.id, { name: value.trim() }).then(
      () => setSave({ status: 'saved' }),
      (e: unknown) => setSave({ status: 'error', message: errorText(e) }),
    );
  };

  if (failure) {
    return (
      <main className="ed-root" style={{ padding: 24 }}>
        <p role="alert" className="ed-banner">
          {failure}
        </p>
        <Link href="/app/themes">← Мои темы</Link>
      </main>
    );
  }
  if (!theme || !env) return <main className="ed-root" style={{ padding: 24 }}>Загружаем тему…</main>;

  const readOnly = theme.isSystem;
  return (
    <EditorProvider value={env}>
      <div className="ed-root" data-testid="theme-editor">
        <header className="ed-top" aria-label="Верхняя панель темы">
          <Link href="/app/themes" className="ed-btn" style={{ textDecoration: 'none' }}>
            ← Мои темы
          </Link>
          <input className="ed-title" aria-label="Название темы" value={name} maxLength={80} disabled={readOnly} onChange={(e) => rename(e.target.value)} />
          <span className="ed-status" role="status" aria-live="polite" data-testid="theme-save-status" data-status={save.status}>
            {save.status === 'saved' ? 'Сохранено' : save.status === 'saving' ? 'Сохраняю…' : 'Не сохранено'}
          </span>
          <span className="ed-spacer" />
          {!readOnly && <UndoRedo />}
          {!readOnly && (
            <button
              type="button"
              className="ed-btn"
              aria-pressed={isDefault}
              onClick={() =>
                void setDefaultTheme(theme.id, !isDefault).then(
                  (t) => setIsDefault(t.isDefault),
                  (e: unknown) => setSave({ status: 'error', message: errorText(e) }),
                )
              }
            >
              {isDefault ? 'Тема по умолчанию ✓' : 'Сделать темой по умолчанию'}
            </button>
          )}
          <button
            type="button"
            className="ed-btn"
            onClick={() =>
              void duplicateTheme(theme.id).then(
                (t) => router.push(`/app/themes/${t.id}/edit`),
                (e: unknown) => setSave({ status: 'error', message: errorText(e) }),
              )
            }
          >
            Сделать копию
          </button>
          {!readOnly && (
            <button
              type="button"
              className="ed-btn danger"
              onClick={() => {
                if (window.confirm('Удалить тему? В сборках, где она применена, останется её копия.'))
                  void deleteTheme(theme.id).then(
                    () => router.push('/app/themes'),
                    (e: unknown) => setSave({ status: 'error', message: errorText(e) }),
                  );
              }}
            >
              Удалить
            </button>
          )}
        </header>
        {save.message && (
          <p role="alert" className="ed-banner" style={{ margin: 8 }}>
            {save.message}
          </p>
        )}
        {readOnly && (
          <p className="ed-banner" style={{ margin: 8 }} data-testid="system-theme-note">
            Это системная тема: её нельзя менять. Сделайте копию и правьте её.
          </p>
        )}
        <fieldset disabled={readOnly} style={{ border: 0, padding: 0, margin: 0, minHeight: 0, display: 'contents' }}>
          <Body theme={theme} store={env.store} onSave={onSave} />
        </fieldset>
      </div>
    </EditorProvider>
  );
}
