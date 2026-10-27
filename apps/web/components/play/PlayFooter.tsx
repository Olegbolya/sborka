'use client';
import { REPORT_CATEGORIES } from '@blokum/schema';
import { useEffect, useRef, useState } from 'react';
import { api, errorText } from '../../lib/api-browser';
import { type PlayOpen } from '../../lib/play/api';

/** PL-18 · «Реклама», who advertises and the erid: shown on every screen of an advertising project. */
export function AdBanner({ ad }: { ad: NonNullable<PlayOpen['ad']> }) {
  return (
    <div className="pl-ad" role="note" data-testid="play-ad">
      Реклама · {ad.advertiser}
      {ad.inn ? ` · ИНН ${ad.inn}` : ''} · erid: {ad.erid}
    </div>
  );
}

/** TS-11 · the complaint form: what is wrong, a few words, a contact for the answer if wanted. */
function ReportDialog({ slug, onClose }: { slug: string; onClose: () => void }) {
  const [category, setCategory] = useState('');
  const [text, setText] = useState('');
  const [contact, setContact] = useState('');
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const first = useRef<HTMLSelectElement>(null);
  useEffect(() => first.current?.focus(), []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      await api('/reports', { method: 'POST', body: { slug, category, text, ...(contact.trim() ? { contact, consent } : {}) } });
      setSent(true);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="pl-modal" role="dialog" aria-modal="true" aria-label="Пожаловаться на сборку" data-testid="report-dialog">
      <form
        className="pl-modal-card"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        {sent ? (
          <>
            <strong>Спасибо, жалоба принята</strong>
            <p>Мы проверим сборку. Если вы оставили контакт, ответим на него.</p>
            <button type="button" onClick={onClose}>
              Закрыть
            </button>
          </>
        ) : (
          <>
            <strong>Пожаловаться на сборку</strong>
            <label>
              Что не так
              <select ref={first} value={category} onChange={(e) => setCategory(e.target.value)} required>
                <option value="">Выберите…</option>
                {REPORT_CATEGORIES.map((c) => (
                  <option key={c.code} value={c.code}>
                    {c.label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Опишите коротко
              <textarea value={text} onChange={(e) => setText(e.target.value)} rows={4} maxLength={4000} required />
            </label>
            <label>
              Как с вами связаться (необязательно)
              <input value={contact} onChange={(e) => setContact(e.target.value)} maxLength={200} autoComplete="off" />
            </label>
            {contact.trim() !== '' && (
              <label className="pl-check">
                <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} />
                Согласен на обработку контакта, чтобы мне ответили
              </label>
            )}
            {error && (
              <p role="alert" className="pl-error">
                {error}
              </p>
            )}
            <div className="pl-modal-actions">
              <button type="submit" disabled={busy || category === '' || text.trim().length < 5 || (contact.trim() !== '' && !consent)}>
                Отправить
              </button>
              <button type="button" className="secondary" onClick={onClose}>
                Отмена
              </button>
            </div>
          </>
        )}
      </form>
    </div>
  );
}

/** PL-16 · on every screen: «Создано пользователем · Пожаловаться» (on no tariff it goes away) and, on «Старт», the mark of the service. */
export function PlayFooter({ slug, watermark }: { slug: string; watermark: boolean }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <footer className="pl-footer" data-testid="play-footer">
        <span>
          Создано пользователем ·{' '}
          <button type="button" className="pl-link" onClick={() => setOpen(true)}>
            Пожаловаться
          </button>
        </span>
        {watermark && (
          <a className="pl-link" href="/" target="_blank" rel="noopener" data-testid="play-watermark">
            Сделано в Блокуме — создать свою
          </a>
        )}
      </footer>
      {open && <ReportDialog slug={slug} onClose={() => setOpen(false)} />}
    </>
  );
}
