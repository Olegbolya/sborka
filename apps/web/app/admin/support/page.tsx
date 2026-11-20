'use client';
import Link from 'next/link';
import { useState } from 'react';
import { api } from '../../../lib/api-browser';
import { Badge, Field, Notice, css, useAction, useLoad } from '../../../components/admin/ui';
import { ChatMessages, type ChatThread } from '../../../components/landing/QuestionChat';
import { dateTime } from '../../../lib/admin/format';

interface Question {
  id: string;
  text: string;
  status: 'NEW' | 'ANSWERED' | 'CLOSED';
  createdAt: string;
  lastMessageAt: string;
  messages: number;
  userId: string;
  userName: string;
}

const STATUS: Record<Question['status'], [string, string]> = { NEW: ['Ждёт ответа', '#d97706'], ANSWERED: ['Отвечен', '#16a34a'], CLOSED: ['Закрыт', '#6b665d'] };

/** One question: the whole chat opens under it; support writes the next message or closes the chat. */
function QuestionCard({ q, onDone }: { q: Question; onDone: (message: string) => void }) {
  const [open, setOpen] = useState(q.status === 'NEW');
  const [answer, setAnswer] = useState('');
  const thread = useLoad(() => (open ? api<ChatThread>(`/admin/support/${q.id}`) : Promise.resolve(null)), [open, q.id, q.lastMessageAt]);
  const { busy, error, run } = useAction();
  const [label, color] = STATUS[q.status];
  return (
    <article style={css.card} data-testid="support-question">
      <div style={css.row}>
        <Link href={`/admin/users/${q.userId}`} style={{ color: 'var(--accent)', fontWeight: 600 }}>
          {q.userName}
        </Link>
        <Badge color={color}>{label}</Badge>
        <span style={css.muted}>
          {dateTime(q.lastMessageAt)} · сообщений: {q.messages}
        </span>
        <button type="button" style={css.btnLight} onClick={() => setOpen(!open)} data-testid="support-toggle">
          {open ? 'Свернуть' : 'Открыть переписку'}
        </button>
      </div>
      {!open ? <p style={{ whiteSpace: 'pre-wrap', margin: '8px 0 0' }}>{q.text}</p> : null}
      {open ? (
        <div style={{ marginTop: 12 }}>
          <Notice error={thread.error} />
          {thread.data ? <ChatMessages messages={thread.data.messages} mine="SUPPORT" /> : <p style={css.muted}>Загружаем…</p>}
          {q.status !== 'CLOSED' ? (
            <>
              <Notice error={error} />
              <Field label="Ответ — придёт человеку в кабинет и в переписку">
                <textarea style={{ ...css.input, minHeight: 90 }} value={answer} onChange={(e) => setAnswer(e.target.value)} maxLength={4000} data-testid="support-answer" />
              </Field>
              <div style={{ ...css.row, marginTop: 8 }}>
                <button
                  type="button"
                  style={css.btn}
                  disabled={busy || answer.trim().length < 2}
                  data-testid="support-send"
                  onClick={() =>
                    void run(() => api(`/admin/support/${q.id}/answer`, { method: 'POST', body: { answer } }), 'Ответ отправлен').then((ok) => {
                      if (!ok) return;
                      setAnswer('');
                      onDone('Ответ отправлен в кабинет пользователя');
                    })
                  }
                >
                  Ответить
                </button>
                <button type="button" style={css.btnLight} disabled={busy} onClick={() => void run(() => api(`/admin/support/${q.id}/close`, { method: 'POST' }), 'Закрыт').then((ok) => ok && onDone('Переписка закрыта'))}>
                  Закрыть переписку
                </button>
              </div>
            </>
          ) : (
            <p style={css.muted}>Переписка закрыта.</p>
          )}
        </div>
      ) : null}
    </article>
  );
}

/** AD-13 · вопросы пользователей со страницы «Помощь»: у каждого своя переписка, ответ уходит человеку в кабинет. */
export default function SupportPage() {
  const [filter, setFilter] = useState<'NEW' | 'ANSWERED' | 'CLOSED'>('NEW');
  const { data, error, reload } = useLoad(() => api<{ questions: Question[]; open: number }>(`/admin/support?status=${filter}`), [filter]);
  const [done, setDone] = useState('');
  return (
    <main style={css.page}>
      <h1 style={css.h1}>Вопросы пользователей</h1>
      <div style={{ ...css.row, marginBottom: 14 }}>
        <button type="button" style={filter === 'NEW' ? css.btn : css.btnLight} onClick={() => setFilter('NEW')}>
          Ждут ответа{data ? ` (${String(data.open)})` : ''}
        </button>
        <button type="button" style={filter === 'ANSWERED' ? css.btn : css.btnLight} onClick={() => setFilter('ANSWERED')}>
          Отвеченные
        </button>
        <button type="button" style={filter === 'CLOSED' ? css.btn : css.btnLight} onClick={() => setFilter('CLOSED')}>
          Закрытые
        </button>
      </div>
      <Notice error={error} ok={done} />
      {data && data.questions.length === 0 ? <p style={css.muted}>Вопросов нет.</p> : null}
      {data?.questions.map((q) => (
        <QuestionCard
          key={q.id}
          q={q}
          onDone={(m) => {
            setDone(m);
            reload();
          }}
        />
      ))}
    </main>
  );
}
