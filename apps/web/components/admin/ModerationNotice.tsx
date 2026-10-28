'use client';
import { useState } from 'react';
import { api } from '../../lib/api-browser';
import { Badge, Field, Notice, css, useAction, useLoad } from './ui';
import { APPEAL_STATUS, dateTime } from '../../lib/admin/format';

interface View {
  moderated: boolean;
  status: string;
  canAppeal: boolean;
  resubmit: boolean;
  history: Array<{ action: string; actionLabel: string; reason: string; note: string; createdAt: string }>;
  appeals: Array<{ id: string; status: string; text: string; decisionNote: string | null; createdAt: string }>;
}

/**
 * docs/06-TRUST-SAFETY.md §5 · the creator's side of a moderation decision: why the project is closed, what to fix, and the way to
 * appeal or to ask for a new check («Исправил — проверить снова»). Nothing is shown for a project the moderators never touched.
 */
export function ModerationNotice({ projectId }: { projectId: string }) {
  const { data, reload } = useLoad(() => api<View>(`/projects/${projectId}/moderation`), [projectId]);
  const [text, setText] = useState('');
  const { busy, error, ok, run } = useAction(reload);
  if (!data) return null;
  const decision = data.history.find((h) => h.action === 'UNPUBLISH' || h.action === 'BLOCK_PROJECT');
  const lastAppeal = data.appeals[0];
  if (!data.moderated && !lastAppeal) return null;

  return (
    <section aria-label="Решение модераторов" style={{ ...css.card, borderColor: data.moderated ? '#dc2626' : 'var(--border, #ddd)' }}>
      {data.moderated && decision ? (
        <>
          <div style={css.row}>
            <strong>{decision.actionLabel}</strong>
            <Badge color="#dc2626">{data.status === 'BLOCKED' ? 'Заблокирована' : 'Снята с публикации'}</Badge>
            <span style={css.muted}>{dateTime(decision.createdAt)}</span>
          </div>
          <p style={{ margin: '8px 0' }}>{decision.reason}</p>
          {decision.note ? <p style={{ margin: '0 0 8px', color: 'var(--muted)' }}>Комментарий модератора: {decision.note}</p> : null}
        </>
      ) : null}
      {lastAppeal ? (
        <p style={{ margin: '8px 0' }} data-testid="appeal-state">
          Ваше обращение от {dateTime(lastAppeal.createdAt)}: <strong>{APPEAL_STATUS[lastAppeal.status] ?? lastAppeal.status}</strong>
          {lastAppeal.decisionNote ? <> — {lastAppeal.decisionNote}</> : null}
        </p>
      ) : null}
      {data.canAppeal ? (
        <form
          aria-label={data.resubmit ? 'Проверить снова' : 'Обжаловать'}
          onSubmit={(e) => {
            e.preventDefault();
            void run(() => api(`/projects/${projectId}/appeals`, { method: 'POST', body: { text } }), 'Обращение отправлено. Его рассмотрит модератор.').then((done) => done && setText(''));
          }}
        >
          <Notice error={error} ok={ok} />
          <Field label={data.resubmit ? 'Что вы исправили' : 'Почему решение стоит пересмотреть'}>
            <textarea style={{ ...css.input, minHeight: 70 }} value={text} onChange={(e) => setText(e.target.value)} minLength={10} maxLength={2000} required />
          </Field>
          <p><button type="submit" style={css.btn} disabled={busy}>{data.resubmit ? 'Исправил — проверить снова' : 'Обжаловать'}</button></p>
        </form>
      ) : null}
    </section>
  );
}
