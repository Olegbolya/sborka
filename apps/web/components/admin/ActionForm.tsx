'use client';
import { useState } from 'react';
import { ACTIONS_BY_TARGET, MODERATION_ACTION_LABELS, MODERATION_REASONS, type ModerationActionKind, type ModerationTargetKind } from '@blokum/schema';
import { api } from '../../lib/api-browser';
import { Field, Notice, css, useAction } from './ui';

/**
 * AD-03 · a decision of a moderator on a project, a file or a user: the action, the reason from the list (the text the creator
 * gets) and a comment. Each decision is kept in the history and in the audit log by the server.
 */
export function ActionForm({
  targetType,
  targetId,
  heading,
  reportId,
  only,
  onDone,
}: {
  targetType: ModerationTargetKind;
  targetId: string;
  heading: string;
  reportId?: string;
  only?: readonly ModerationActionKind[];
  onDone: () => void;
}) {
  const actions = ACTIONS_BY_TARGET[targetType].filter((a) => !only || only.includes(a));
  const [action, setAction] = useState<ModerationActionKind>(actions[0]!);
  const [reasonCode, setReasonCode] = useState('');
  const [note, setNote] = useState('');
  const { busy, error, ok, run } = useAction(onDone);
  const reason = MODERATION_REASONS.find((r) => r.code === reasonCode);

  return (
    <form
      aria-label={heading}
      style={css.card}
      onSubmit={(e) => {
        e.preventDefault();
        void run(() => api('/admin/actions', { method: 'POST', body: { targetType, targetId, action, reasonCode, note, ...(reportId ? { reportId } : {}) } }), 'Решение записано').then((done) => {
          if (done) setNote('');
        });
      }}
    >
      <strong>{heading}</strong>
      <Notice error={error} ok={ok} />
      <div style={{ ...css.row, alignItems: 'flex-end', marginTop: 8 }}>
        <Field label="Решение">
          <select style={css.input} value={action} onChange={(e) => setAction(e.target.value as ModerationActionKind)}>
            {actions.map((a) => (
              <option key={a} value={a}>{MODERATION_ACTION_LABELS[a]}</option>
            ))}
          </select>
        </Field>
        <Field label="Причина">
          <select style={css.input} value={reasonCode} onChange={(e) => setReasonCode(e.target.value)} required>
            <option value="">Выберите причину</option>
            {MODERATION_REASONS.map((r) => (
              <option key={r.code} value={r.code}>{r.label}</option>
            ))}
          </select>
        </Field>
      </div>
      {reason ? <p style={css.muted}>Создатель получит: «{reason.message}»</p> : null}
      <Field label="Комментарий для создателя и для журнала">
        <textarea style={{ ...css.input, minHeight: 70 }} value={note} onChange={(e) => setNote(e.target.value)} maxLength={2000} required />
      </Field>
      <div style={{ ...css.row, marginTop: 10 }}>
        <button type="submit" style={action === 'BLOCK_PROJECT' || action === 'BLOCK_USER' || action === 'BLOCK_MEDIA' ? css.btnDanger : css.btn} disabled={busy}>
          {MODERATION_ACTION_LABELS[action]}
        </button>
      </div>
    </form>
  );
}
