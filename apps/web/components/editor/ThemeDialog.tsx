'use client';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { errorText } from '../../lib/api-browser';
import { applyTheme } from '../../lib/editor/commands';
import { createTheme, getTheme, listThemes, type ThemeSummary } from '../../lib/themes/api';
import { Dialog } from './Dialog';
import { useEditor, useEnv } from './context';

const KEYS = ['background', 'surface', 'primary', 'accent', 'text'];

function Row({ theme, current, busy, onApply }: { theme: ThemeSummary; current: boolean; busy: boolean; onApply: () => void }) {
  return (
    <li data-theme-id={theme.id} style={{ display: 'flex', gap: 10, alignItems: 'center', padding: '6px 0' }}>
      <span className="ed-swatches" aria-hidden>
        {KEYS.map((k) => (
          <span key={k} style={{ background: theme.colors[k] ?? 'transparent' }} />
        ))}
      </span>
      <span style={{ flex: 1 }}>
        {theme.name}
        {current && <span className="ed-own"> применена</span>}
      </span>
      <button type="button" className="ed-btn small" disabled={busy} aria-label={`Применить тему: ${theme.name}`} onClick={onApply}>
        Применить
      </button>
    </li>
  );
}

/** TH-02, TH-03 · the theme of this project: apply one of the creator's or a ready one, save the look as a theme. */
export function ThemeDialog({ onClose }: { onClose: () => void }) {
  const { flash, saver } = useEnv();
  const apply = useEditor((s) => s.apply);
  const doc = useEditor((s) => s.doc);
  const [mine, setMine] = useState<ThemeSummary[] | null>(null);
  const [system, setSystem] = useState<ThemeSummary[] | null>(null);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    Promise.all([listThemes('mine'), listThemes('system')]).then(
      ([a, b]) => {
        if (cancelled) return;
        setMine(a);
        setSystem(b);
      },
      (e: unknown) => !cancelled && setError(errorText(e)),
    );
    return () => {
      cancelled = true;
    };
  }, []);

  const use = async (t: ThemeSummary) => {
    setBusy(true);
    setError(null);
    try {
      const full = await getTheme(t.id);
      apply(applyTheme(full.id, full.tokens), { label: `Тема «${full.name}»` });
      flash(`Тема «${full.name}» применена. Ваши ручные правки блоков сохранились.`, 'ok');
      onClose();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  const saveLook = async () => {
    setBusy(true);
    setError(null);
    try {
      await saver.flush();
      const made = await createTheme(name.trim() || 'Оформление сборки', doc.theme.tokens);
      apply(applyTheme(made.id, made.tokens), { label: `Тема «${made.name}»` });
      setMine((m) => [{ id: made.id, name: made.name, isSystem: false, isDefault: false, colors: made.tokens.colors, updatedAt: made.updatedAt }, ...(m ?? [])]);
      setName('');
      flash(`Тема «${made.name}» сохранена в «Мои темы».`, 'ok');
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog title="Тема сборки" onClose={onClose} wide>
      {error && (
        <p role="alert" className="ed-banner">
          {error}
        </p>
      )}
      <p className="ed-hint" data-testid="theme-current">
        {doc.theme.themeId ? `Сейчас применена тема «${mine?.find((t) => t.id === doc.theme.themeId)?.name ?? system?.find((t) => t.id === doc.theme.themeId)?.name ?? 'из вашего списка'}».` : 'Сейчас у сборки своё оформление, не связанное с темой.'} Блоки с вашими
        собственными правками при смене темы не меняются; «Сбросить к теме» возвращает их к теме.
      </p>
      <h3 className="ed-addgroup">Мои темы</h3>
      {mine === null ? <p>Загружаем…</p> : mine.length === 0 ? <p className="ed-hint">Своих тем пока нет.</p> : <ul className="ed-list" aria-label="Мои темы">{mine.map((t) => <Row key={t.id} theme={t} current={doc.theme.themeId === t.id} busy={busy} onApply={() => void use(t)} />)}</ul>}
      {system && system.length > 0 && (
        <>
          <h3 className="ed-addgroup">Готовые темы</h3>
          <ul className="ed-list" aria-label="Готовые темы">
            {system.map((t) => (
              <Row key={t.id} theme={t} current={doc.theme.themeId === t.id} busy={busy} onApply={() => void use(t)} />
            ))}
          </ul>
        </>
      )}
      <h3 className="ed-addgroup">Сохранить оформление как тему</h3>
      <div className="ed-colorrow">
        <input type="text" aria-label="Название темы" placeholder="Название темы" value={name} maxLength={80} onChange={(e) => setName(e.target.value)} />
        <button type="button" className="ed-btn small" disabled={busy} onClick={() => void saveLook()}>
          Сохранить как тему
        </button>
      </div>
      <div className="ed-actions">
        <Link href="/app/themes" className="ed-btn" style={{ textDecoration: 'none' }}>
          Редактор тем
        </Link>
        <button type="button" className="ed-btn" onClick={onClose}>
          Закрыть
        </button>
      </div>
    </Dialog>
  );
}
