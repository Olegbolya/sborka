'use client';
import Link from 'next/link';
import { useState } from 'react';
import { api } from '../../../lib/api-browser';
import { Badge, Field, Notice, css, useAction, useLoad } from '../../../components/admin/ui';
import { APPEAL_STATUS, dateTime } from '../../../lib/admin/format';

interface Appeal {
  id: string;
  status: string;
  text: string;
  createdAt: string;
  decidedAt: string | null;
  decisionNote: string | null;
  projectId: string | null;
  projectTitle: string | null;
  userId: string;
  userName: string;
  actionLabel: string;
  reasonLabel: string;
  note: string;
  actorId: string;
  actionAt: string;
}

function AppealCard({ a, onDone }: { a: Appeal; onDone: (message: string) => void }) {
  const [note, setNote] = useState('');
  const { busy, error, run } = useAction();
  const decide = async (decision: 'GRANT' | 'DENY') => {
    const message = decision === 'GRANT' ? 'Обращение удовлетворено, сборка восстановлена' : 'Обращение отклонено';
    if (await run(() => api(`/admin/appeals/${a.id}/decide`, { method: 'POST', body: { decision, note } }), message)) onDone(message);
  };
  return (
    <article style={css.card} aria-label={`Обращение по сборке ${a.projectTitle ?? ''}`} data-testid="appeal">
      <div style={css.row}>
        <strong>{a.projectTitle ?? 'Сборка удалена'}</strong>
        <Badge color={a.status === 'NEW' ? '#d97706' : a.status === 'GRANTED' ? '#16a34a' : '#6b665d'}>{APPEAL_STATUS[a.status] ?? a.status}</Badge>
        <span style={css.muted}>{dateTime(a.createdAt)}</span>
      </div>
      <p style={css.muted}>
        Автор: <Link href={`/admin/users/${a.userId}`} style={{ color: 'var(--accent)' }}>{a.userName}</Link> · решение, которое оспаривают: {a.actionLabel} · {a.reasonLabel} ({a.actorId === 'system' ? 'автоматически' : 'модератор'}, {dateTime(a.actionAt)})
      </p>
      <p style={{ margin: '4px 0', color: 'var(--muted)' }}>Комментарий к решению: {a.note}</p>
      <p style={{ whiteSpace: 'pre-wrap' }}><strong>Обращение:</strong> {a.text}</p>
      {a.status === 'NEW' ? (
        <>
          <Notice error={error} />
          <Field label="Комментарий к решению по обращению">
            <textarea style={{ ...css.input, minHeight: 60 }} value={note} onChange={(e) => setNote(e.target.value)} maxLength={2000} />
          </Field>
          <div style={{ ...css.row, marginTop: 8 }}>
            <button type="button" style={css.btn} disabled={busy} onClick={() => void decide('GRANT')}>Удовлетворить и восстановить</button>
            <button type="button" style={css.btnLight} disabled={busy} onClick={() => void decide('DENY')}>Отклонить</button>
          </div>
        </>
      ) : (
        <p style={css.muted}>Решение: {a.decisionNote} · {dateTime(a.decidedAt)}</p>
      )}
    </article>
  );
}

/** Appeals against decisions (docs/06-TRUST-SAFETY.md §5): another moderator decides. */
export default function AppealsPage() {
  const [filter, setFilter] = useState<'NEW' | 'decided'>('NEW');
  const { data, error, reload } = useLoad(() => api<Appeal[]>(`/admin/appeals?status=${filter}`), [filter]);
  const [done, setDone] = useState('');
  return (
    <main style={css.page}>
      <h1 style={css.h1}>Обжалования</h1>
      <div style={{ ...css.row, marginBottom: 14 }}>
        <button type="button" style={filter === 'NEW' ? css.btn : css.btnLight} onClick={() => setFilter('NEW')}>Ждут решения</button>
        <button type="button" style={filter === 'decided' ? css.btn : css.btnLight} onClick={() => setFilter('decided')}>Рассмотренные</button>
      </div>
      <Notice error={error} ok={done} />
      {data && data.length === 0 ? <p style={css.muted}>Обращений нет.</p> : null}
      {data?.map((a) => (
        <AppealCard
          key={a.id}
          a={a}
          onDone={(message) => {
            setDone(message);
            reload();
          }}
        />
      ))}
    </main>
  );
}
