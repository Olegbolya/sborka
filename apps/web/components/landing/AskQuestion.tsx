'use client';
import { useEffect, useState } from 'react';
import { api, errorText, isApiError } from '../../lib/api-browser';
import { rememberAfterLogin } from '../../lib/after-login';
import { dateRu } from '../../lib/billing';

interface Question {
  id: string;
  text: string;
  status: 'NEW' | 'ANSWERED' | 'CLOSED';
  answer: string | null;
  createdAt: string;
}

const MAX = 2000;
const STATUS: Record<Question['status'], string> = { NEW: 'ждёт ответа', ANSWERED: 'есть ответ', CLOSED: 'закрыт' };

/**
 * AD-13 · «Задать вопрос» на странице «Помощь»: вопрос уходит администратору в админку, ответ придёт в кабинет (уведомление)
 * и появится здесь же, под формой. Писать может только вошедший — так есть кому ответить.
 */
export function AskQuestion() {
  const [mine, setMine] = useState<Question[] | null | 'anonymous'>(null);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  const load = () =>
    api<{ questions: Question[] }>('/support/questions')
      .then((r) => setMine(r.questions))
      .catch((e: unknown) => setMine(isApiError(e) && e.status === 401 ? 'anonymous' : []));
  useEffect(() => {
    void load();
  }, []);

  const send = async () => {
    setBusy(true);
    setError(null);
    setSent(false);
    try {
      await api('/support/questions', { method: 'POST', body: { text } });
      setText('');
      setSent(true);
      await load();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  const field = { width: '100%', boxSizing: 'border-box' as const, minHeight: 140, padding: '12px 14px', fontSize: 16, lineHeight: 1.5, borderRadius: 12, border: '1px solid var(--muted)', background: 'transparent', color: 'inherit', fontFamily: 'inherit', resize: 'vertical' as const };

  return (
    <section id="ask" className="lp-help" data-testid="ask-question">
      <h2>Задать вопрос</h2>
      {mine === 'anonymous' ? (
        <p>
          Чтобы задать вопрос,{' '}
          <a href="/login" onClick={() => rememberAfterLogin('/help#ask')}>
            войдите
          </a>{' '}
          — ответ придёт в ваш кабинет.
        </p>
      ) : (
        <>
          <p className="lp-note">Опишите, что не получается. Ответ придёт в кабинет (колокольчик уведомлений) и появится здесь, под формой.</p>
          <label htmlFor="ask-text" style={{ display: 'block', fontWeight: 600, margin: '12px 0 8px' }}>
            Ваш вопрос
          </label>
          <textarea id="ask-text" data-testid="ask-text" value={text} maxLength={MAX} onChange={(e) => setText(e.target.value)} style={field} placeholder="Например: как поставить видео на фон экрана?" />
          <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap', marginTop: 12 }}>
            <button type="button" className="lp-btn" data-testid="ask-send" disabled={busy || mine === null || text.trim().length < 10} onClick={() => void send()}>
              {busy ? 'Отправляем…' : 'Отправить вопрос'}
            </button>
            <span className="lp-note">
              {text.trim().length < 10 ? 'Не меньше 10 знаков' : `${String(text.length)} из ${String(MAX)}`}
            </span>
          </div>
          {sent && (
            <p role="status" data-testid="ask-sent">
              Вопрос отправлен. Мы ответим в кабинет — обычно в течение суток.
            </p>
          )}
          {error && (
            <p role="alert" data-testid="ask-error" style={{ color: '#dc2626' }}>
              {error}
            </p>
          )}
          {Array.isArray(mine) && mine.length > 0 && (
            <>
              <h3 style={{ margin: '24px 0 8px' }}>Ваши вопросы</h3>
              <ul data-testid="ask-mine" style={{ listStyle: 'none', padding: 0, margin: 0 }}>
                {mine.map((q) => (
                  <li key={q.id} style={{ borderTop: '1px solid var(--muted)', padding: '12px 0' }}>
                    <p className="lp-note" style={{ margin: 0 }}>
                      {dateRu(q.createdAt)} · {STATUS[q.status]}
                    </p>
                    <p style={{ margin: '4px 0', whiteSpace: 'pre-wrap' }}>{q.text}</p>
                    {q.answer && (
                      <p style={{ margin: '8px 0 0', whiteSpace: 'pre-wrap' }}>
                        <strong>Ответ:</strong> {q.answer}
                      </p>
                    )}
                  </li>
                ))}
              </ul>
            </>
          )}
        </>
      )}
    </section>
  );
}
