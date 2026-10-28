'use client';
import { api } from '../../../lib/api-browser';
import { Badge, css, useLoad } from '../../../components/admin/ui';
import { dateTime } from '../../../lib/admin/format';

interface State {
  version: string;
  uptimeSeconds: number;
  checks: { database: boolean; redis: boolean; diskUsedPct: number | null };
  diskWarning: boolean;
  queues: { mediaWaiting: number; mediaStuck: number; mediaRejected24h: number };
  failedAdminLogins24h: number;
  backups: { configured: boolean; newest: { name: string; sizeBytes: number; at: string } | null };
  work: { P0: number; P1: number; P2: number; overdue: number; appeals: number; legalOverdue: number };
}

const yes = (ok: boolean) => <Badge color={ok ? '#16a34a' : '#dc2626'}>{ok ? 'работает' : 'не отвечает'}</Badge>;

/** AD-09 · the state of the system: dependencies, disk, queues, backups. */
export default function SystemPage() {
  const { data: s, error } = useLoad(() => api<State>('/admin/system'));
  return (
    <main style={css.page}>
      <h1 style={css.h1}>Состояние системы</h1>
      {error ? <p role="alert" style={css.error}>{error}</p> : null}
      {s ? (
        <>
          <div style={css.card} aria-label="Службы">
            <div style={css.row}><strong>База данных</strong>{yes(s.checks.database)}</div>
            <div style={{ ...css.row, marginTop: 6 }}><strong>Redis</strong>{yes(s.checks.redis)}</div>
            <div style={{ ...css.row, marginTop: 6 }}>
              <strong>Диск</strong>
              {s.checks.diskUsedPct === null ? <span style={css.muted}>нет данных</span> : <Badge color={s.diskWarning ? '#dc2626' : '#16a34a'}>занято {s.checks.diskUsedPct} %</Badge>}
            </div>
            <p style={css.muted}>Версия {s.version} · работает {Math.round(s.uptimeSeconds / 60)} мин</p>
          </div>
          <div style={css.card} aria-label="Очереди">
            <strong>Обработка файлов</strong>
            <p style={{ margin: '6px 0 0' }}>В очереди: {s.queues.mediaWaiting} · застряли дольше 10 минут: <span style={{ color: s.queues.mediaStuck > 0 ? '#dc2626' : 'inherit' }}>{s.queues.mediaStuck}</span> · отклонено за сутки: {s.queues.mediaRejected24h}</p>
          </div>
          <div style={css.card} aria-label="Резервные копии">
            <strong>Резервные копии</strong>
            {!s.backups.configured ? <p style={css.muted}>Папка копий не задана (переменная BACKUP_DIR). Копии появятся с задачей P9.5.</p> : s.backups.newest ? <p style={{ margin: '6px 0 0' }}>Последняя: {s.backups.newest.name} · {dateTime(s.backups.newest.at)} · {(s.backups.newest.sizeBytes / 1_048_576).toFixed(1)} МБ</p> : <p style={{ color: '#dc2626' }}>В папке копий пусто.</p>}
          </div>
          <div style={css.card} aria-label="Работа для людей">
            <strong>Ждёт решения</strong>
            <p style={{ margin: '6px 0 0' }}>Жалобы: P0 — {s.work.P0}, P1 — {s.work.P1}, P2 — {s.work.P2}, просрочено — {s.work.overdue} · обжалования: {s.work.appeals} · заявления и требования с просроченным сроком: {s.work.legalOverdue}</p>
            <p style={css.muted}>Неудачных входов в админку за сутки: {s.failedAdminLogins24h}</p>
          </div>
        </>
      ) : null}
    </main>
  );
}
