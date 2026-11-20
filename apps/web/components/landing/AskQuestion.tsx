'use client';
import { useEffect, useState } from 'react';
import { api, errorText, isApiError } from '../../lib/api-browser';
import { rememberAfterLogin } from '../../lib/after-login';
import { dateRu } from '../../lib/billing';

interface Question {
  id: string;
  text: string;
  status: 'NEW' | 'ANSWERED' | 'CLOSED';
  createdAt: string;
  lastMessageAt: string;
  messages: number;
}

const MAX = 2000;
const STATUS: Record<Question['status'], string> = { NEW: 'ждёт ответа поддержки', ANSWERED: 'поддержка ответила', CLOSED: 'закрыт' };

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
      const q = await api<Question>('/support/questions', { method: 'POST', body: { text } });
      setText('');
      setSent(true);
      // The question opens as its own chat: the answers of support come there.
      window.location.assign(`/help/questions/${encodeURIComponent(q.id)}`);
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
          <p className="lp-note">Опишите, что не получается. У каждого вопроса своя переписка с поддержкой: ответ придёт в кабинет (колокольчик уведомлений) и в переписку.</p>
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
                  <li key={q.id} style={{ borderTop: '1px solid currentColor', padding: 0 }}>
                    <a href={`/help/questions/${encodeURIComponent(q.id)}`} data-testid="ask-open" style={{ display: 'block', padding: '12px 0', color: 'inherit', textDecoration: 'none' }}>
                      <span style={{ display: 'block', fontSize: 14, opacity: 0.8 }}>
                        {dateRu(q.lastMessageAt)} · {STATUS[q.status]} · сообщений: {q.messages}
                      </span>
                      <span style={{ margin: '4px 0', whiteSpace: 'pre-wrap', overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' }}>{q.text}</span>
                      <span style={{ textDecoration: 'underline' }}>Открыть переписку →</span>
                    </a>
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
