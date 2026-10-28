'use client';
import { useState } from 'react';
import { api } from '../../../lib/api-browser';
import { Badge, Field, Notice, css, useAction, useLoad } from '../../../components/admin/ui';
import { dateTime } from '../../../lib/admin/format';

interface Flag {
  key: string;
  label: string;
  enabled: boolean;
  note: string;
  updatedAt: string | null;
}

function FlagRow({ f, onDone }: { f: Flag; onDone: () => void }) {
  const [note, setNote] = useState('');
  const { busy, error, ok, run } = useAction(onDone);
  const set = (enabled: boolean) => run(() => api(`/admin/flags/${f.key}`, { method: 'PUT', body: { enabled, note } }), enabled ? 'Включено' : 'Выключено');
  return (
    <article style={css.card} aria-label={f.label} data-testid={`flag-${f.key}`}>
      <div style={css.row}>
        <strong>{f.label}</strong>
        <Badge color={f.enabled ? '#16a34a' : '#dc2626'}>{f.enabled ? 'Включено' : 'Выключено'}</Badge>
        {f.updatedAt ? <span style={css.muted}>{dateTime(f.updatedAt)}{f.note ? ` · ${f.note}` : ''}</span> : null}
      </div>
      <Notice error={error} ok={ok} />
      <div style={{ ...css.row, alignItems: 'flex-end', marginTop: 8 }}>
        {f.enabled ? <Field label="Почему выключаете"><input style={css.input} value={note} onChange={(e) => setNote(e.target.value)} /></Field> : null}
        {f.enabled ? <button type="button" style={css.btnDanger} disabled={busy} onClick={() => void set(false)}>Выключить</button> : <button type="button" style={css.btn} disabled={busy} onClick={() => void set(true)}>Включить</button>}
      </div>
    </article>
  );
}

/** AD-07 · emergency switches: they work at once (the server reads them at most every 30 seconds), each change goes to the audit log and to the owner. */
export default function FlagsPage() {
  const { data, error, reload } = useLoad(() => api<Flag[]>('/admin/flags'));
  return (
    <main style={css.page}>
      <h1 style={css.h1}>Аварийные выключатели</h1>
      <p style={css.muted}>Действуют без перезапуска, в пределах 30 секунд. Каждое переключение попадает в журнал аудита и в тревогу владельцу.</p>
      {error ? <p role="alert" style={css.error}>{error}</p> : null}
      {data?.map((f) => <FlagRow key={f.key} f={f} onDone={reload} />)}
    </main>
  );
}
