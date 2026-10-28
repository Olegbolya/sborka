'use client';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useState } from 'react';
import { api } from '../../../../lib/api-browser';
import { ActionForm } from '../../../../components/admin/ActionForm';
import { Badge, Field, Notice, css, useAction, useLoad } from '../../../../components/admin/ui';
import { PRIORITY_COLOR, PROJECT_STATUS, REPORT_STATUS, USER_STATUS, dateTime, remainingText } from '../../../../lib/admin/format';
import { type ReportPriority } from '@blokum/schema';

interface Detail {
  report: {
    id: string;
    category: string;
    categoryLabel: string;
    priority: ReportPriority;
    status: string;
    text: string;
    reporterContact: string | null;
    createdAt: string;
    slaDueAt: string;
    remainingMs: number;
    resolution: string | null;
    assigneeId: string | null;
  };
  project: { id: string; title: string; slug: string; status: string; moderationStatus: string; legalHold: boolean; ownerId: string; ownerName: string; ownerStatus: string } | null;
  snapshot: { screens: Array<{ name: string; texts: string[] }> } | null;
  otherReports: Array<{ id: string; category: string; priority: string; status: string; createdAt: string }>;
  history: Array<{ id: string; action: string; actionLabel: string; reasonLabel: string; note: string; actorId: string; createdAt: string }>;
}

/** AD-03 · a complaint: what was published when it came in, the history of decisions, and the decision form. */
export default function CasePage() {
  const { id } = useParams<{ id: string }>();
  const { data, error, reload } = useLoad(() => api<Detail>(`/admin/cases/${id}`), [id]);
  const [note, setNote] = useState('');
  const take = useAction(reload);
  const dismiss = useAction(reload);

  if (error) return <main style={css.page}><p role="alert" style={css.error}>{error}</p></main>;
  if (!data) return <main style={css.page}><p style={css.muted}>Загрузка…</p></main>;
  const { report, project } = data;
  const open = report.status === 'NEW' || report.status === 'IN_REVIEW';

  return (
    <main style={css.page}>
      <p style={css.muted}><Link href="/admin/queue" style={{ color: 'var(--accent)' }}>← Очередь жалоб</Link></p>
      <h1 style={css.h1}>
        <Badge color={PRIORITY_COLOR[report.priority]}>{report.priority}</Badge> {report.category} · {report.categoryLabel}
      </h1>
      <p>
        {REPORT_STATUS[report.status] ?? report.status} · получена {dateTime(report.createdAt)}
        {open ? <> · <strong style={{ color: report.remainingMs < 0 ? '#dc2626' : 'inherit' }} data-testid="sla">{remainingText(report.remainingMs)}</strong></> : null}
      </p>
      <section style={css.card} aria-label="Текст жалобы">
        <p style={{ margin: 0, whiteSpace: 'pre-wrap' }}>{report.text}</p>
        <p style={css.muted}>Контакт: {report.reporterContact ?? 'не указан'}</p>
        {report.resolution ? <p style={css.muted}>Решение: {report.resolution}</p> : null}
      </section>

      {project ? (
        <section aria-label="Сборка">
          <h2 style={css.h2}>Сборка «{project.title}»</h2>
          <p style={css.muted}>
            Автор: <Link href={`/admin/users/${project.ownerId}`} style={{ color: 'var(--accent)' }}>{project.ownerName}</Link> ({USER_STATUS[project.ownerStatus] ?? project.ownerStatus}) ·{' '}
            сейчас: <strong data-testid="project-status">{PROJECT_STATUS[project.status] ?? project.status}</strong>{project.legalHold ? ' · юридическое хранение' : ''}
          </p>
          {data.snapshot ? (
            <div style={css.card}>
              <strong>Тексты на момент жалобы</strong>
              {data.snapshot.screens.map((s, i) => (
                <div key={i} style={{ marginTop: 8 }}>
                  <div style={css.muted}>Экран {i + 1}: {s.name}</div>
                  {s.texts.length === 0 ? <div style={css.muted}>текстов нет</div> : s.texts.map((t, j) => <div key={j}>{t}</div>)}
                </div>
              ))}
            </div>
          ) : null}
        </section>
      ) : null}

      <h2 style={css.h2}>История решений</h2>
      {data.history.length === 0 ? <p style={css.muted}>Решений пока нет.</p> : (
        <ul style={{ paddingLeft: 18 }} aria-label="История решений">
          {data.history.map((h) => (
            <li key={h.id} data-testid="history-item">
              <strong>{h.actionLabel}</strong> · {h.reasonLabel} · {h.actorId === 'system' ? 'автоматически' : 'модератор'} · {dateTime(h.createdAt)}
              <div style={css.muted}>{h.note}</div>
            </li>
          ))}
        </ul>
      )}
      {data.otherReports.length > 0 ? <p style={css.muted}>Другие жалобы на эту сборку: {data.otherReports.length}</p> : null}

      {open ? (
        <>
          <h2 style={css.h2}>Решение</h2>
          <Notice error={take.error || dismiss.error} ok={take.ok || dismiss.ok} />
          {report.status === 'NEW' ? (
            <p><button type="button" style={css.btnLight} disabled={take.busy} onClick={() => void take.run(() => api(`/admin/cases/${id}/take`, { method: 'POST' }), 'Жалоба в работе')}>Взять в работу</button></p>
          ) : null}
          {project ? <ActionForm targetType="PROJECT" targetId={project.id} reportId={report.id} heading="Решение по сборке" onDone={reload} /> : null}
          {project ? <ActionForm targetType="USER" targetId={project.ownerId} reportId={report.id} heading="Решение по автору" onDone={reload} /> : null}
          <form
            aria-label="Отклонить жалобу"
            style={css.card}
            onSubmit={(e) => {
              e.preventDefault();
              void dismiss.run(() => api(`/admin/cases/${id}/dismiss`, { method: 'POST', body: { note } }), 'Жалоба отклонена').then((done) => done && setNote(''));
            }}
          >
            <strong>Жалоба не подтвердилась</strong>
            <Field label="Комментарий">
              <textarea style={{ ...css.input, minHeight: 60 }} value={note} onChange={(e) => setNote(e.target.value)} maxLength={2000} required />
            </Field>
            <p style={css.muted}>Если сборку снял автомат и других открытых жалоб нет, она вернётся в публикацию.</p>
            <button type="submit" style={css.btnLight} disabled={dismiss.busy}>Отклонить жалобу</button>
          </form>
        </>
      ) : null}
    </main>
  );
}
