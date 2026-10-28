'use client';
import { api } from '../../lib/api-browser';
import { Badge, css, useLoad } from './ui';
import { dateTime } from '../../lib/admin/format';

interface Note {
  id: string;
  title: string;
  body: string;
  projectId: string | null;
  createdAt: string;
  read: boolean;
}

/** Messages of the moderators and about appeals: new ones are on top of the cabinet until they are read. */
export function Notifications() {
  const { data, reload } = useLoad(() => api<Note[]>('/notifications'));
  const fresh = (data ?? []).filter((n) => !n.read);
  if (fresh.length === 0) return null;
  return (
    <section aria-label="Сообщения" style={{ marginBottom: 20 }}>
      {fresh.map((n) => (
        <article key={n.id} style={{ ...css.card, borderColor: '#d97706' }} data-testid="notification">
          <div style={css.row}>
            <strong>{n.title}</strong>
            <Badge color="#d97706">Новое</Badge>
            <span style={css.muted}>{dateTime(n.createdAt)}</span>
          </div>
          <p style={{ whiteSpace: 'pre-wrap', margin: '8px 0' }}>{n.body}</p>
          <div style={css.row}>
            {n.projectId ? <a href={`/cabinet/projects/${n.projectId}`} style={{ color: 'var(--accent)' }}>Открыть сборку</a> : null}
            <button type="button" style={css.btnLight} onClick={() => void api(`/notifications/${n.id}/read`, { method: 'POST' }).then(reload)}>Прочитано</button>
          </div>
        </article>
      ))}
    </section>
  );
}
