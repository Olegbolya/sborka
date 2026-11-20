'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { api, errorText, isApiError } from '../../lib/api-browser';

export interface ChatMessage {
  id: string;
  author: 'USER' | 'SUPPORT';
  text: string;
  createdAt: string;
}
export interface ChatThread {
  question: { id: string; text: string; status: 'NEW' | 'ANSWERED' | 'CLOSED'; createdAt: string };
  messages: ChatMessage[];
}

const time = (iso: string): string => new Date(iso).toLocaleString('ru-RU', { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' });
const STATUS: Record<ChatThread['question']['status'], string> = { NEW: 'ждёт ответа поддержки', ANSWERED: 'поддержка ответила', CLOSED: 'переписка закрыта' };
const POLL_MS = 20_000;

/** Ленточка сообщений: свои справа, собеседника слева — так и в кабинете, и в админке. */
export function ChatMessages({ messages, mine }: { messages: ChatMessage[]; mine: ChatMessage['author'] }) {
  return (
    <ol data-testid="chat-messages" style={{ listStyle: 'none', padding: 0, margin: '0 0 16px', display: 'flex', flexDirection: 'column', gap: 10 }}>
      {messages.map((m) => {
        const own = m.author === mine;
        return (
          <li key={m.id} data-author={m.author} style={{ alignSelf: own ? 'flex-end' : 'flex-start', maxWidth: 'min(85%, 560px)' }}>
            <div style={{ padding: '10px 14px', borderRadius: 14, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', lineHeight: 1.5, background: own ? '#c23d17' : 'color-mix(in srgb, currentColor 10%, transparent)', color: own ? '#fff' : 'inherit' }}>{m.text}</div>
            <div style={{ fontSize: 12, opacity: 0.75, margin: '4px 6px 0', textAlign: own ? 'right' : 'left' }}>
              {m.author === 'SUPPORT' ? 'Поддержка Блоккера' : mine === 'USER' ? 'Вы' : 'Пользователь'} · {time(m.createdAt)}
            </div>
          </li>
        );
      })}
    </ol>
  );
}

/** AD-13 · переписка по одному вопросу: сообщения по очереди с поддержкой, новые ответы подгружаются сами. */
export function QuestionChat({ id }: { id: string }) {
  const [thread, setThread] = useState<ChatThread | null>(null);
  const [state, setState] = useState<'loading' | 'ok' | 'anonymous' | 'missing'>('loading');
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const end = useRef<HTMLDivElement>(null);

  const load = useCallback(
    () =>
      api<ChatThread>(`/support/questions/${encodeURIComponent(id)}`)
        .then((t) => {
          setThread(t);
          setState('ok');
        })
        .catch((e: unknown) => setState(isApiError(e) && e.status === 401 ? 'anonymous' : 'missing')),
    [id],
  );
  useEffect(() => {
    void load();
    const timer = window.setInterval(() => void load(), POLL_MS);
    return () => window.clearInterval(timer);
  }, [load]);
  const count = thread?.messages.length ?? 0;
  useEffect(() => {
    if (count > 1) end.current?.scrollIntoView({ block: 'nearest' });
  }, [count]);

  const send = async () => {
    setBusy(true);
    setError(null);
    try {
      setThread(await api<ChatThread>(`/support/questions/${encodeURIComponent(id)}/messages`, { method: 'POST', body: { text } }));
      setText('');
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  if (state === 'loading') return <p className="lp-note">Загружаем переписку…</p>;
  if (state === 'anonymous')
    return (
      <p>
        Чтобы открыть переписку, <a href="/login">войдите</a>.
      </p>
    );
  if (state === 'missing' || !thread)
    return (
      <p>
        Такого вопроса нет. <a href="/help#ask">Вернуться к вопросам</a>
      </p>
    );
  const closed = thread.question.status === 'CLOSED';
  return (
    <div data-testid="question-chat">
      <p className="lp-note" style={{ marginTop: 0 }}>
        <a href="/help#ask">← Все вопросы</a> · {STATUS[thread.question.status]}
      </p>
      <ChatMessages messages={thread.messages} mine="USER" />
      <div ref={end} />
      {closed ? (
        <p className="lp-note">
          Поддержка закрыла эту переписку. Если остался вопрос — <a href="/help#ask">задайте новый</a>.
        </p>
      ) : (
        <>
          <label htmlFor="chat-text" style={{ display: 'block', fontWeight: 600, margin: '0 0 8px' }}>
            Сообщение
          </label>
          <textarea
            id="chat-text"
            data-testid="chat-text"
            value={text}
            maxLength={4000}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.ctrlKey || e.metaKey) && text.trim()) void send();
            }}
            style={{ width: '100%', boxSizing: 'border-box', minHeight: 96, padding: '12px 14px', fontSize: 16, lineHeight: 1.5, borderRadius: 12, border: '1px solid currentColor', background: 'transparent', color: 'inherit', fontFamily: 'inherit', resize: 'vertical' }}
          />
          <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap', marginTop: 12 }}>
            <button type="button" className="lp-btn" data-testid="chat-send" disabled={busy || text.trim() === ''} onClick={() => void send()}>
              {busy ? 'Отправляем…' : 'Отправить'}
            </button>
            <span className="lp-note">Ответ поддержки появится здесь и придёт в кабинет.</span>
          </div>
          {error && (
            <p role="alert" style={{ color: '#ef4444' }}>
              {error}
            </p>
          )}
        </>
      )}
    </div>
  );
}
