'use client';
import Link from 'next/link';
import { useState } from 'react';
import { api } from '../../../lib/api-browser';
import { Badge, css, useLoad } from '../../../components/admin/ui';
import { PRIORITY_COLOR, PRIORITY_NOTE, PROJECT_STATUS, REPORT_STATUS, dateTime, remainingText } from '../../../lib/admin/format';
import { type ReportPriority } from '@blokum/schema';

interface Item {
  id: string;
  priority: ReportPriority;
  category: string;
  categoryLabel: string;
  status: string;
  createdAt: string;
  slaDueAt: string;
  remainingMs: number;
  overdue: boolean;
  assigneeId: string | null;
  projectTitle: string | null;
  projectStatus: string | null;
  ownerName: string | null;
}

/** AD-03 · the queue of complaints: the most urgent first, with the time left. */
export default function QueuePage() {
  const [status, setStatus] = useState<'open' | 'closed'>('open');
  const [priority, setPriority] = useState('');
  const { data, error } = useLoad(() => api<Item[]>(`/admin/queue?status=${status}${priority ? `&priority=${priority}` : ''}`), [status, priority]);
  return (
    <main style={css.page}>
      <h1 style={css.h1}>Очередь жалоб</h1>
      <div style={{ ...css.row, marginBottom: 14 }}>
        <button type="button" style={status === 'open' ? css.btn : css.btnLight} onClick={() => setStatus('open')}>Открытые</button>
        <button type="button" style={status === 'closed' ? css.btn : css.btnLight} onClick={() => setStatus('closed')}>Закрытые</button>
        <select aria-label="Приоритет" style={css.input} value={priority} onChange={(e) => setPriority(e.target.value)}>
          <option value="">Любой приоритет</option>
          {(['P0', 'P1', 'P2'] as const).map((p) => (
            <option key={p} value={p}>{p} · {PRIORITY_NOTE[p]}</option>
          ))}
        </select>
      </div>
      {error ? <p role="alert" style={css.error}>{error}</p> : null}
      {data && data.length === 0 ? <p style={css.muted}>Жалоб нет.</p> : null}
      {data && data.length > 0 ? (
        <div style={{ overflowX: 'auto' }}>
          <table style={css.table} aria-label="Жалобы">
            <thead>
              <tr>
                <th style={css.th}>Приоритет</th>
                <th style={css.th}>Что не так</th>
                <th style={css.th}>Сборка</th>
                <th style={css.th}>Статус</th>
                <th style={css.th}>Срок</th>
              </tr>
            </thead>
            <tbody>
              {data.map((r) => (
                <tr key={r.id} data-testid="queue-row">
                  <td style={css.td}><Badge color={PRIORITY_COLOR[r.priority]}>{r.priority}</Badge></td>
                  <td style={css.td}><Link href={`/admin/cases/${r.id}`} style={{ color: 'var(--accent)' }}>{r.category} · {r.categoryLabel}</Link></td>
                  <td style={css.td}>
                    {r.projectTitle ?? '—'}
                    <div style={css.muted}>{r.ownerName ?? ''}{r.projectStatus ? ` · ${PROJECT_STATUS[r.projectStatus] ?? r.projectStatus}` : ''}</div>
                  </td>
                  <td style={css.td}>{REPORT_STATUS[r.status] ?? r.status}</td>
                  <td style={css.td}>
                    {status === 'open' ? <span style={{ color: r.overdue ? '#dc2626' : 'inherit', fontWeight: r.overdue ? 700 : 400 }}>{remainingText(r.remainingMs)}</span> : dateTime(r.createdAt)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </main>
  );
}
