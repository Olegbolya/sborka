'use client';
import Link from 'next/link';
import { useState } from 'react';
import { api, errorText } from '../../../lib/api-browser';
import { Badge, Field, css } from '../../../components/admin/ui';
import { ROLE_LABEL, USER_STATUS, dateTime } from '../../../lib/admin/format';

interface Found {
  id: string;
  displayName: string;
  role: string;
  status: string;
  email: string | null;
  createdAt: string;
  legalHold: boolean;
}

/** AD-02 · search of users by name, address, phone, identifier or the number in VK ID / Яндекс ID. */
export default function UsersPage() {
  const [q, setQ] = useState('');
  const [rows, setRows] = useState<Found[] | null>(null);
  const [error, setError] = useState('');
  return (
    <main style={css.page}>
      <h1 style={css.h1}>Пользователи</h1>
      <form
        style={{ ...css.row, alignItems: 'flex-end', marginBottom: 16 }}
        onSubmit={(e) => {
          e.preventDefault();
          setError('');
          api<Found[]>(`/admin/users?q=${encodeURIComponent(q)}`)
            .then(setRows)
            .catch((err: unknown) => {
              setRows(null);
              setError(errorText(err));
            });
        }}
      >
        <Field label="Имя, почта, телефон, номер в VK ID / Яндекс ID или идентификатор">
          <input style={css.input} value={q} onChange={(e) => setQ(e.target.value)} />
        </Field>
        <button type="submit" style={css.btn}>Найти</button>
      </form>
      {error ? <p role="alert" style={css.error}>{error}</p> : null}
      {rows && rows.length === 0 ? <p style={css.muted}>Никого не нашли.</p> : null}
      {rows?.map((u) => (
        <div key={u.id} style={css.card} data-testid="user-row">
          <div style={css.row}>
            <Link href={`/admin/users/${u.id}`} style={{ color: 'var(--accent)', fontWeight: 600 }}>{u.displayName}</Link>
            <Badge color={u.status === 'ACTIVE' ? '#16a34a' : '#dc2626'}>{USER_STATUS[u.status] ?? u.status}</Badge>
            <span style={css.muted}>{ROLE_LABEL[u.role] ?? u.role} · с {dateTime(u.createdAt)}{u.email ? ` · ${u.email}` : ''}{u.legalHold ? ' · юридическое хранение' : ''}</span>
          </div>
        </div>
      ))}
    </main>
  );
}
