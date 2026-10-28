'use client';
import { useState } from 'react';
import { api } from '../../../lib/api-browser';
import { Badge, Field, Notice, css, useAction, useLoad } from '../../../components/admin/ui';
import { CASE_STATUS, CLAIM_STATUS, dateTime, remainingText } from '../../../lib/admin/format';

interface Claim {
  id: string;
  status: string;
  claimant: { name?: string };
  objectDescription: string;
  urls: string[];
  projectId: string | null;
  receivedAt: string;
  remainingMs: number;
  overdue: boolean;
  open: boolean;
  strikes: number;
  resolution: string | null;
  clarifyRequestedAt: string | null;
}

interface Authority {
  id: string;
  source: string;
  number: string;
  subject: string;
  receivedAt: string;
  status: string;
  remainingMs: number;
  overdue: boolean;
  actions: Array<{ at: string; action: string }>;
}

const toLocalInput = (d: Date) => new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);

function ClaimCard({ c, onDone }: { c: Claim; onDone: () => void }) {
  const [note, setNote] = useState('');
  const [mediaId, setMediaId] = useState('');
  const { busy, error, ok, run } = useAction(onDone);
  return (
    <article style={css.card} aria-label={`Заявление от ${c.claimant.name ?? ''}`} data-testid="claim">
      <div style={css.row}>
        <strong>{c.claimant.name}</strong>
        <Badge color={c.open ? (c.overdue ? '#dc2626' : '#d97706') : '#6b665d'}>{CLAIM_STATUS[c.status] ?? c.status}</Badge>
        {c.open ? <span style={{ color: c.overdue ? '#dc2626' : 'inherit', fontWeight: 600 }}>{remainingText(c.remainingMs)}</span> : null}
        {c.strikes > 0 ? <span style={css.muted}>снятий по этой сборке: {c.strikes}</span> : null}
      </div>
      <p style={{ margin: '6px 0' }}>{c.objectDescription}</p>
      <p style={css.muted}>{c.urls.join(' · ')}{c.projectId ? ` · сборка ${c.projectId}` : ''} · получено {dateTime(c.receivedAt)}</p>
      {c.resolution ? <p style={css.muted}>Ответ: {c.resolution}</p> : null}
      {c.open ? (
        <>
          <Notice error={error} ok={ok} />
          <Field label="Комментарий (обязателен для решения)">
            <textarea style={{ ...css.input, minHeight: 50 }} value={note} onChange={(e) => setNote(e.target.value)} />
          </Field>
          <Field label="Файл, который снимается (если снимается файл, а не вся сборка)">
            <input style={css.input} value={mediaId} onChange={(e) => setMediaId(e.target.value)} />
          </Field>
          <div style={{ ...css.row, marginTop: 8 }}>
            {c.status === 'NEW' && !c.clarifyRequestedAt ? (
              <button type="button" style={css.btnLight} disabled={busy} onClick={() => void run(() => api(`/admin/copyright-claims/${c.id}/clarify`, { method: 'POST' }), 'Уточнение запрошено')}>Запросить уточнение (один раз)</button>
            ) : null}
            <button type="button" style={css.btnDanger} disabled={busy} onClick={() => void run(() => api(`/admin/copyright-claims/${c.id}/resolve`, { method: 'POST', body: { outcome: 'REMOVED', note, ...(mediaId ? { mediaId } : {}) } }), 'Материал снят')}>Снять материал</button>
            <button type="button" style={css.btnLight} disabled={busy} onClick={() => void run(() => api(`/admin/copyright-claims/${c.id}/resolve`, { method: 'POST', body: { outcome: 'REJECTED_WITH_PROOF', note } }), 'Ответ с доказательствами записан')}>Ответить с доказательствами</button>
          </div>
        </>
      ) : null}
    </article>
  );
}

function AuthorityCard({ r, onDone }: { r: Authority; onDone: () => void }) {
  const [text, setText] = useState('');
  const { busy, error, ok, run } = useAction(onDone);
  return (
    <article style={css.card} aria-label={`Требование ${r.number}`} data-testid="authority">
      <div style={css.row}>
        <strong>{r.source} · № {r.number}</strong>
        <Badge color={r.status === 'CLOSED' ? '#6b665d' : r.overdue ? '#dc2626' : '#d97706'}>{CASE_STATUS[r.status] ?? r.status}</Badge>
        {r.status !== 'CLOSED' ? <span style={{ color: r.overdue ? '#dc2626' : 'inherit', fontWeight: 600 }}>{remainingText(r.remainingMs)}</span> : null}
      </div>
      <p style={{ margin: '6px 0' }}>{r.subject}</p>
      {r.actions.length > 0 ? <ul style={{ paddingLeft: 18 }}>{r.actions.map((a, i) => <li key={i}>{dateTime(a.at)} — {a.action}</li>)}</ul> : <p style={css.muted}>Действий пока нет.</p>}
      {r.status !== 'CLOSED' ? (
        <>
          <Notice error={error} ok={ok} />
          <div style={{ ...css.row, alignItems: 'flex-end' }}>
            <Field label="Что сделано">
              <input style={css.input} value={text} onChange={(e) => setText(e.target.value)} />
            </Field>
            <button type="button" style={css.btnLight} disabled={busy} onClick={() => void run(() => api(`/admin/authority-requests/${r.id}/actions`, { method: 'POST', body: { action: text } }), 'Записано').then((done) => done && setText(''))}>Записать действие</button>
            <button type="button" style={css.btn} disabled={busy} onClick={() => void run(() => api(`/admin/authority-requests/${r.id}/close`, { method: 'POST' }), 'Требование закрыто')}>Закрыть</button>
          </div>
        </>
      ) : null}
    </article>
  );
}

/** AD-04 · registers of the notices of copyright holders (24 hours) and of the requests of state bodies. */
export default function LegalPage() {
  const claims = useLoad(() => api<Claim[]>('/admin/copyright-claims'));
  const authority = useLoad(() => api<Authority[]>('/admin/authority-requests'));
  const [claim, setClaim] = useState({ claimant: '', objectDescription: '', urls: '', statement: '', projectId: '' });
  const [req, setReq] = useState({ source: '', number: '', subject: '', receivedAt: toLocalInput(new Date()), dueAt: toLocalInput(new Date(Date.now() + 24 * 3_600_000)) });
  const addClaim = useAction(claims.reload);
  const addReq = useAction(authority.reload);

  return (
    <main style={css.page}>
      <h1 style={css.h1}>Заявления правообладателей</h1>
      {claims.error ? <p role="alert" style={css.error}>{claims.error}</p> : null}
      {claims.data?.length === 0 ? <p style={css.muted}>Заявлений нет.</p> : null}
      {claims.data?.map((c) => <ClaimCard key={c.id} c={c} onDone={claims.reload} />)}
      <form
        aria-label="Записать заявление"
        style={css.card}
        onSubmit={(e) => {
          e.preventDefault();
          void addClaim.run(() => api('/admin/copyright-claims', { method: 'POST', body: { ...claim, urls: claim.urls.split('\n'), projectId: claim.projectId || undefined } }), 'Заявление записано, срок — 24 часа').then((done) => done && setClaim({ claimant: '', objectDescription: '', urls: '', statement: '', projectId: '' }));
        }}
      >
        <strong>Записать заявление</strong>
        <Notice error={addClaim.error} ok={addClaim.ok} />
        <div style={css.row}>
          <Field label="Кто обращается"><input style={css.input} value={claim.claimant} onChange={(e) => setClaim({ ...claim, claimant: e.target.value })} required /></Field>
          <Field label="Сборка (идентификатор)"><input style={css.input} value={claim.projectId} onChange={(e) => setClaim({ ...claim, projectId: e.target.value })} /></Field>
        </div>
        <Field label="Что защищается"><textarea style={{ ...css.input, minHeight: 50 }} value={claim.objectDescription} onChange={(e) => setClaim({ ...claim, objectDescription: e.target.value })} required /></Field>
        <Field label="Ссылки на спорный материал, по одной в строке"><textarea style={{ ...css.input, minHeight: 50 }} value={claim.urls} onChange={(e) => setClaim({ ...claim, urls: e.target.value })} required /></Field>
        <Field label="Заявление"><textarea style={{ ...css.input, minHeight: 50 }} value={claim.statement} onChange={(e) => setClaim({ ...claim, statement: e.target.value })} required /></Field>
        <p><button type="submit" style={css.btn} disabled={addClaim.busy}>Записать</button></p>
      </form>

      <h1 style={{ ...css.h1, marginTop: 36 }}>Требования государственных органов</h1>
      {authority.error ? <p role="alert" style={css.error}>{authority.error}</p> : null}
      {authority.data?.length === 0 ? <p style={css.muted}>Требований нет.</p> : null}
      {authority.data?.map((r) => <AuthorityCard key={r.id} r={r} onDone={authority.reload} />)}
      <form
        aria-label="Записать требование"
        style={css.card}
        onSubmit={(e) => {
          e.preventDefault();
          void addReq.run(() => api('/admin/authority-requests', { method: 'POST', body: { ...req, receivedAt: new Date(req.receivedAt).toISOString(), dueAt: new Date(req.dueAt).toISOString() } }), 'Требование записано').then((done) => done && setReq({ ...req, source: '', number: '', subject: '' }));
        }}
      >
        <strong>Записать требование</strong>
        <Notice error={addReq.error} ok={addReq.ok} />
        <div style={css.row}>
          <Field label="Кто обратился"><input style={css.input} value={req.source} onChange={(e) => setReq({ ...req, source: e.target.value })} required /></Field>
          <Field label="Номер"><input style={css.input} value={req.number} onChange={(e) => setReq({ ...req, number: e.target.value })} required /></Field>
        </div>
        <Field label="Суть требования"><textarea style={{ ...css.input, minHeight: 50 }} value={req.subject} onChange={(e) => setReq({ ...req, subject: e.target.value })} required /></Field>
        <div style={css.row}>
          <Field label="Получено"><input type="datetime-local" style={css.input} value={req.receivedAt} onChange={(e) => setReq({ ...req, receivedAt: e.target.value })} required /></Field>
          <Field label="Срок исполнения"><input type="datetime-local" style={css.input} value={req.dueAt} onChange={(e) => setReq({ ...req, dueAt: e.target.value })} required /></Field>
        </div>
        <p><button type="submit" style={css.btn} disabled={addReq.busy}>Записать</button></p>
      </form>
    </main>
  );
}
