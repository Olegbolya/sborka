'use client';

import { useEffect, useRef, useState } from 'react';
import { isApiError } from '../../lib/api-browser';
import { FONT_LICENSE_LABELS, type FontLicense } from '../../lib/fonts/api';
import { addMyFont, loadEditorFonts, removeMyFont, useEditorFonts } from '../../lib/editor/fonts';

const LICENSES = Object.entries(FONT_LICENSE_LABELS) as Array<[FontLicense, string]>;

/** TH-04, LB-02 · the choice of an uploaded or library font by name; «Мои шрифты» are added here with a file. */
export function FontPicker({ control, label, value, onChange }: { control: string; label: string; value: string | null; onChange: (id: string) => void }) {
  const { loaded, mine, library } = useEditorFonts();
  const file = useRef<HTMLInputElement>(null);
  const [license, setLicense] = useState<FontLicense>('OFL');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sure, setSure] = useState(false);
  useEffect(() => {
    if (!loaded) void loadEditorFonts();
  }, [loaded]);
  const all = [...mine, ...library];
  const current = all.find((f) => f.id === value) ?? null;
  const unknown = loaded && value !== null && value !== 'font_unset' && !current;

  const upload = async (picked: File | undefined): Promise<void> => {
    if (!picked) return;
    setBusy(true);
    setError(null);
    try {
      const font = await addMyFont(picked, license);
      onChange(font.id);
    } catch (e) {
      setError(isApiError(e) ? e.message : 'Не удалось загрузить шрифт. Попробуйте ещё раз.');
    } finally {
      setBusy(false);
      if (file.current) file.current.value = '';
    }
  };

  return (
    <div className="ed-field" data-control={control}>
      <span>{label}</span>
      <select aria-label={label} value={current ? current.id : ''} onChange={(e) => e.target.value && onChange(e.target.value)}>
        <option value="" disabled>
          {unknown ? 'Шрифт недоступен — выберите другой' : 'Выберите шрифт'}
        </option>
        {mine.length > 0 && (
          <optgroup label="Мои шрифты">
            {mine.map((f) => (
              <option key={f.id} value={f.id}>
                {f.family}
              </option>
            ))}
          </optgroup>
        )}
        {library.length > 0 && (
          <optgroup label="Из библиотеки">
            {library.map((f) => (
              <option key={f.id} value={f.id}>
                {f.family}
              </option>
            ))}
          </optgroup>
        )}
      </select>
      {current && (
        <p className="ed-hint" style={{ fontFamily: `"bk-font-${current.id}", sans-serif` }} data-testid="font-sample">
          Съешь ещё этих мягких французских булок
        </p>
      )}
      {current && !current.hasCyrillic && (
        <p className="ed-warn" role="alert">
          В этом шрифте нет русских букв: русский текст покажется другим шрифтом. Выберите шрифт с кириллицей.
        </p>
      )}
      {unknown && (
        <p className="ed-warn" role="alert">
          Этого шрифта больше нет (удалён или снят с библиотеки): текст показывается системным шрифтом.
        </p>
      )}
      <label className="ed-field">
        <span>Основание для своего файла</span>
        <select aria-label="Основание использования шрифта" value={license} onChange={(e) => setLicense(e.target.value as FontLicense)}>
          {LICENSES.map(([v, t]) => (
            <option key={v} value={v}>
              {t}
            </option>
          ))}
        </select>
      </label>
      <input ref={file} type="file" accept=".woff2,.woff,.ttf,.otf" hidden aria-label="Файл шрифта" onChange={(e) => void upload(e.target.files?.[0])} />
      <div className="ed-actions">
        <button type="button" className="ed-btn small" disabled={busy} onClick={() => file.current?.click()}>
          {busy ? 'Загружаем…' : 'Загрузить свой шрифт'}
        </button>
        {current?.source === 'mine' &&
          (sure ? (
            <button
              type="button"
              className="ed-btn small danger"
              onClick={() => {
                setSure(false);
                void removeMyFont(current.id).catch((e) => setError(isApiError(e) ? e.message : 'Не удалось удалить шрифт.'));
              }}
            >
              Точно удалить
            </button>
          ) : (
            <button type="button" className="ed-btn small" onClick={() => setSure(true)}>
              Удалить из «Моих шрифтов»
            </button>
          ))}
      </div>
      <p className="ed-hint">Файлы TTF, OTF, WOFF и WOFF2 до 10 МБ. Загружая шрифт, вы подтверждаете право его использовать.</p>
      {error && (
        <p className="ed-warn" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
