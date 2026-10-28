'use client';
import { useState } from 'react';
import { api } from '../../../lib/api-browser';
import { Field, css, useLoad } from '../../../components/admin/ui';
import { dateTime } from '../../../lib/admin/format';

interface Entry {
  id: number;
  actorId: string | null;
  action: string;
  targetType: string;
  targetId: string;
  createdAt: string;
  meta: Record<string, unknown>;
}

/** AD-08 · the audit log: it only grows, nothing in it can be changed or deleted. */
export default function AuditPage() {
  const [action, setAction] = useState('');
  const [targetId, setTargetId] = useState('');
  const [applied, setApplied] = useState({ action: '', targetId: '' });
  const query = new URLSearchParams({ limit: '200', ...(applied.action ? { action: applied.action } : {}), ...(applied.targetId ? { targetId: applied.targetId } : {}) }).toString();
  const { data, error } = useLoad(() => api<Entry[]>(`/admin/audit?${query}`), [query]);
  return (
    <main style={css.page}>
      <h1 style={css.h1}>Журнал аудита</h1>
      <form style={{ ...css.row, alignItems: 'flex-end', marginBottom: 14 }} onSubmit={(e) => { e.preventDefault(); setApplied({ action, targetId }); }}>
        <Field label="Действие начинается с"><input style={css.input} value={action} onChange={(e) => setAction(e.target.value)} placeholder="MODERATION_" /></Field>
        <Field label="Идентификатор объекта"><input style={css.input} value={targetId} onChange={(e) => setTargetId(e.target.value)} /></Field>
        <button type="submit" style={css.btn}>Показать</button>
      </form>
      {error ? <p role="alert" style={css.error}>{error}</p> : null}
      {data ? (
        <div style={{ overflowX: 'auto' }}>
          <table style={css.table} aria-label="Журнал аудита">
            <thead>
              <tr><th style={css.th}>Когда</th><th style={css.th}>Действие</th><th style={css.th}>Объект</th><th style={css.th}>Кто</th></tr>
            </thead>
            <tbody>
              {data.map((r) => (
                <tr key={r.id} data-testid="audit-row">
                  <td style={css.td}>{dateTime(r.createdAt)}</td>
                  <td style={css.td}>{r.action}</td>
                  <td style={css.td}>{r.targetType} · {r.targetId}</td>
                  <td style={css.td}>{r.actorId ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </main>
  );
}
