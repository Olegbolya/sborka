'use client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import { errorText } from '../../lib/api-browser';
import { createTheme, deleteTheme, duplicateTheme, listThemes, setDefaultTheme, themeFromFile, type ThemeSummary } from '../../lib/themes/api';
import '../editor/editor.css';

const SWATCHES = ['background', 'surface', 'primary', 'accent', 'text'];

function Swatches({ colors }: { colors: Record<string, string> }) {
  return (
    <span className="ed-swatches" aria-hidden>
      {SWATCHES.map((k) => (
        <span key={k} style={{ background: colors[k] ?? 'transparent' }} />
      ))}
    </span>
  );
}

/** TH-02, TH-03 · «Мои темы»: create (from scratch, from a picture), copy, open, make the default, delete; system themes to start from. */
export function ThemesList() {
  const router = useRouter();
  const [mine, setMine] = useState<ThemeSummary[] | null>(null);
  const [system, setSystem] = useState<ThemeSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [name, setName] = useState('');
  const file = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    try {
      const [a, b] = await Promise.all([listThemes('mine'), listThemes('system')]);
      setMine(a);
      setSystem(b);
    } catch (e) {
      setError(errorText(e));
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  const run = async (job: () => Promise<{ id: string } | void>, thenOpen = false) => {
    setBusy(true);
    setError(null);
    try {
      const made = await job();
      if (thenOpen && made) router.push(`/app/themes/${made.id}/edit`);
      else await load();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <main style={{ maxWidth: 900, margin: '0 auto', padding: '32px 16px' }} data-testid="themes-page">
      <nav style={{ marginBottom: 16 }}>
        <Link href="/cabinet/projects">← Мои сборки</Link>
      </nav>
      <h1 style={{ fontSize: 28, margin: '0 0 8px' }}>Мои темы</h1>
      <p className="ed-hint">Тема — это цвета, шрифты, фон и стиль блоков. Применяйте её к сборкам и меняйте в одном месте.</p>
      {error && (
        <p role="alert" className="ed-banner">
          {error}
        </p>
      )}
      <div className="ed-actions" style={{ margin: '16px 0', alignItems: 'center' }}>
        <input type="text" aria-label="Название новой темы" placeholder="Название темы" value={name} maxLength={80} onChange={(e) => setName(e.target.value)} style={{ padding: '8px 10px', borderRadius: 8, border: '1px solid var(--line, #ccc)' }} />
        <button type="button" className="ed-btn primary" disabled={busy} onClick={() => void run(() => createTheme(name.trim() || 'Новая тема'), true)}>
          Новая тема
        </button>
        <button type="button" className="ed-btn" disabled={busy} onClick={() => file.current?.click()}>
          Из картинки
        </button>
        <input
          ref={file}
          type="file"
          aria-label="Картинка для темы"
          accept="image/*"
          hidden
          onChange={(e) => {
            const f = e.target.files?.[0];
            e.target.value = '';
            if (f) void run(() => themeFromFile(f, name.trim() || 'Тема из картинки'), true);
          }}
        />
      </div>
      {mine === null ? (
        <p>Загружаем…</p>
      ) : mine.length === 0 ? (
        <p data-testid="themes-empty">У вас пока нет своих тем. Создайте тему с нуля или из любимой картинки.</p>
      ) : (
        <ul className="ed-list" aria-label="Мои темы" data-testid="my-themes">
          {mine.map((t) => (
            <li key={t.id} data-theme-id={t.id} style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap', padding: '10px 0', borderBottom: '1px solid var(--line, #ddd)' }}>
              <Swatches colors={t.colors} />
              <strong style={{ flex: '1 1 160px' }}>
                {t.name}
                {t.isDefault && <span className="ed-own"> по умолчанию</span>}
              </strong>
              <Link href={`/app/themes/${t.id}/edit`} className="ed-btn small" style={{ textDecoration: 'none' }}>
                Открыть
              </Link>
              <button type="button" className="ed-btn small" disabled={busy} aria-label={`Сделать копию: ${t.name}`} onClick={() => void run(() => duplicateTheme(t.id))}>
                Копия
              </button>
              <button type="button" className="ed-btn small" disabled={busy} aria-pressed={t.isDefault} aria-label={`${t.isDefault ? 'Не использовать' : 'Использовать'} по умолчанию: ${t.name}`} onClick={() => void run(() => setDefaultTheme(t.id, !t.isDefault))}>
                {t.isDefault ? 'Не по умолчанию' : 'По умолчанию'}
              </button>
              <button
                type="button"
                className="ed-btn small danger"
                disabled={busy}
                aria-label={`Удалить: ${t.name}`}
                onClick={() => {
                  if (window.confirm(`Удалить тему «${t.name}»? В сборках, где она применена, останется её копия.`)) void run(() => deleteTheme(t.id));
                }}
              >
                Удалить
              </button>
            </li>
          ))}
        </ul>
      )}
      <h2 style={{ fontSize: 20, margin: '32px 0 8px' }}>Готовые темы</h2>
      {system === null ? null : system.length === 0 ? (
        <p className="ed-hint" data-testid="system-themes-empty">
          Готовых тем пока нет — начните со своей.
        </p>
      ) : (
        <ul className="ed-list" aria-label="Готовые темы">
          {system.map((t) => (
            <li key={t.id} style={{ display: 'flex', gap: 12, alignItems: 'center', padding: '10px 0' }}>
              <Swatches colors={t.colors} />
              <strong style={{ flex: 1 }}>{t.name}</strong>
              <button type="button" className="ed-btn small" disabled={busy} aria-label={`Взять за основу: ${t.name}`} onClick={() => void run(() => duplicateTheme(t.id), true)}>
                Взять за основу
              </button>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
