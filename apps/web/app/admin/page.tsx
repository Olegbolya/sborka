'use client';
import Link from 'next/link';
import { api } from '../../lib/api-browser';
import { css, Badge, useLoad } from '../../components/admin/ui';
import { useMe } from '../../components/admin/AdminShell';
import { PRIORITY_COLOR } from '../../lib/admin/format';

interface Work {
  P0: number;
  P1: number;
  P2: number;
  overdue: number;
  appeals: number;
  legalOverdue: number;
}

/** AD-03, AD-09 · the front page: what waits for people. */
export default function AdminHome() {
  const me = useMe();
  const { data, error } = useLoad(() => api<Work>('/admin/work'));
  return (
    <main style={css.page}>
      <h1 style={css.h1}>Что ждёт решения</h1>
      {error ? <p role="alert" style={css.error}>{error}</p> : null}
      {data ? (
        <div style={css.row}>
          <Link href="/admin/queue" style={{ ...css.card, textDecoration: 'none', color: 'inherit', flex: '1 1 260px' }}>
            <strong>Очередь жалоб</strong>
            <div style={{ ...css.row, marginTop: 8 }}>
              {(['P0', 'P1', 'P2'] as const).map((p) => (
                <Badge key={p} color={PRIORITY_COLOR[p]}>{p}: {data[p]}</Badge>
              ))}
            </div>
            <p style={css.muted}>Просрочено: <span data-testid="overdue">{data.overdue}</span></p>
          </Link>
          <Link href="/admin/appeals" style={{ ...css.card, textDecoration: 'none', color: 'inherit', flex: '1 1 260px' }}>
            <strong>Обжалования</strong>
            <p style={{ margin: '8px 0 0', fontSize: 22 }} data-testid="appeals-count">{data.appeals}</p>
            <p style={css.muted}>ждут решения</p>
          </Link>
          <Link href="/admin/legal" style={{ ...css.card, textDecoration: 'none', color: 'inherit', flex: '1 1 260px' }}>
            <strong>Заявления и требования</strong>
            <p style={{ margin: '8px 0 0', fontSize: 22 }}>{data.legalOverdue}</p>
            <p style={css.muted}>просрочено</p>
          </Link>
        </div>
      ) : null}
      {me.role === 'ADMIN' ? (
        <p style={css.muted}>
          Администратору также доступны <Link href="/admin/system" style={{ color: 'var(--accent)' }}>состояние системы</Link>, <Link href="/admin/flags" style={{ color: 'var(--accent)' }}>аварийные выключатели</Link>, <Link href="/admin/content" style={{ color: 'var(--accent)' }}>системные шаблоны и темы</Link> и <Link href="/admin/audit" style={{ color: 'var(--accent)' }}>журнал аудита</Link>.
        </p>
      ) : null}
    </main>
  );
}
