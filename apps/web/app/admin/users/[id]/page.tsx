'use client';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { api } from '../../../../lib/api-browser';
import { ActionForm } from '../../../../components/admin/ActionForm';
import { useMe } from '../../../../components/admin/AdminShell';
import { Badge, Notice, css, useAction, useLoad } from '../../../../components/admin/ui';
import { ORDER_STATUS, PROJECT_STATUS, PROVIDER_LABEL, ROLE_LABEL, USER_STATUS, dateTime, rubles } from '../../../../lib/admin/format';

interface Profile {
  user: { id: string; displayName: string; role: string; status: string; email: string | null; emailVerifiedAt: string | null; phoneE164: string | null; legalHold: boolean; createdAt: string };
  identities: Array<{ provider: string; providerUserId: string }>;
  projects: Array<{ id: string; title: string; status: string; moderationStatus: string; legalHold: boolean; updatedAt: string }>;
  orders: Array<{ id: string; kind: string; amountKop: number; status: string; createdAt: string; paidAt: string | null }>;
  activeSessions: number;
  complaints: number;
  history: Array<{ id: string; targetType: string; action: string; actionLabel: string; reasonLabel: string; note: string; actorId: string; createdAt: string }>;
}

/** AD-02 · profile: accounts, projects, payments, the history of decisions, and the decision form. */
export default function UserPage() {
  const { id } = useParams<{ id: string }>();
  const me = useMe();
  const { data, error, reload } = useLoad(() => api<Profile>(`/admin/users/${id}`), [id]);
  const publish = useAction();
  if (error) return <main style={css.page}><p role="alert" style={css.error}>{error}</p></main>;
  if (!data) return <main style={css.page}><p style={css.muted}>Загрузка…</p></main>;
  const { user } = data;
  return (
    <main style={css.page}>
      <p style={css.muted}><Link href="/admin/users" style={{ color: 'var(--accent)' }}>← Поиск</Link></p>
      <h1 style={css.h1}>{user.displayName}</h1>
      <div style={{ ...css.row, marginBottom: 12 }}>
        <Badge color={user.status === 'ACTIVE' ? '#16a34a' : '#dc2626'}>{USER_STATUS[user.status] ?? user.status}</Badge>
        <span style={css.muted}>
          {ROLE_LABEL[user.role] ?? user.role} · с {dateTime(user.createdAt)} · входов открыто: {data.activeSessions} · жалоб на сборки: {data.complaints}
          {user.legalHold ? ' · юридическое хранение' : ''}
        </span>
      </div>
      <p style={css.muted}>
        Почта: {user.email ?? 'нет'}{user.email && !user.emailVerifiedAt ? ' (не подтверждена)' : ''} · телефон: {user.phoneE164 ?? 'нет'} ·{' '}
        Входы: {data.identities.length === 0 ? 'нет' : data.identities.map((i) => `${PROVIDER_LABEL[i.provider] ?? i.provider} ${i.providerUserId}`).join(', ')}
      </p>

      <h2 style={css.h2}>Сборки</h2>
      <Notice error={publish.error} ok={publish.ok} />
      {data.projects.length === 0 ? <p style={css.muted}>Сборок нет.</p> : data.projects.map((p) => (
        <div key={p.id} style={css.card}>
          <div style={css.row}>
            <strong>{p.title}</strong>
            <span style={css.muted}>{PROJECT_STATUS[p.status] ?? p.status}{p.legalHold ? ' · юридическое хранение' : ''} · {dateTime(p.updatedAt)} · {p.id}</span>
          </div>
          {me.role === 'ADMIN' ? (
            <div style={{ ...css.row, marginTop: 8 }}>
              <button type="button" style={css.btnLight} disabled={publish.busy} onClick={() => void publish.run(() => api('/admin/templates', { method: 'POST', body: { projectId: p.id } }), `«${p.title}» опубликована как системный шаблон`)}>Опубликовать как системный шаблон</button>
              <button type="button" style={css.btnLight} disabled={publish.busy} onClick={() => void publish.run(() => api('/admin/themes', { method: 'POST', body: { projectId: p.id } }), `Тема сборки «${p.title}» опубликована как системная`)}>Тему сборки — системной</button>
            </div>
          ) : null}
        </div>
      ))}

      <h2 style={css.h2}>Платежи</h2>
      {data.orders.length === 0 ? <p style={css.muted}>Платежей нет.</p> : (
        <table style={css.table} aria-label="Платежи">
          <tbody>
            {data.orders.map((o) => (
              <tr key={o.id}>
                <td style={css.td}>{dateTime(o.createdAt)}</td>
                <td style={css.td}>{rubles(o.amountKop)}</td>
                <td style={css.td}>{ORDER_STATUS[o.status] ?? o.status}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <h2 style={css.h2}>История решений</h2>
      {data.history.length === 0 ? <p style={css.muted}>Решений не было.</p> : (
        <ul style={{ paddingLeft: 18 }} aria-label="История решений">
          {data.history.map((h) => (
            <li key={h.id}><strong>{h.actionLabel}</strong> · {h.reasonLabel} · {dateTime(h.createdAt)}<div style={css.muted}>{h.note}</div></li>
          ))}
        </ul>
      )}

      <h2 style={css.h2}>Решение по пользователю</h2>
      <ActionForm targetType="USER" targetId={user.id} heading="Решение по аккаунту" onDone={reload} />
    </main>
  );
}
