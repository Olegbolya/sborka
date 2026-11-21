'use client';
import { useEffect, useState } from 'react';

/** D-07 · ADR-129 · the webhook of a project («Про»): where finished passages go, the secret of the signature, the last deliveries. */

interface Delivery {
  id: string;
  event: string;
  status: 'PENDING' | 'DELIVERED' | 'FAILED';
  attempts: number;
  lastResult: string | null;
  createdAt: string;
  nextAttemptAt: string | null;
}

interface WebhookState {
  allowed: boolean;
  planTitle: string;
  webhook: { url: string; secret: string; enabled: boolean } | null;
  deliveries: Delivery[];
}

const HEADERS = { 'X-Blokum-CSRF': '1', 'Content-Type': 'application/json' };

async function call<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`/api/v1${path}`, { credentials: 'include', ...init });
  if (res.status === 204) return undefined as T;
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: { message?: string } };
    throw new Error(body.error?.message ?? `Ошибка ${res.status}`);
  }
  return res.json() as Promise<T>;
}

const STATUS_TEXT: Record<Delivery['status'], string> = { DELIVERED: 'доставлено', PENDING: 'ждёт повтора', FAILED: 'не доставлено' };
const EVENT_TEXT: Record<string, string> = { 'passage.completed': 'Прохождение', ping: 'Проверка' };

const time = (iso: string): string => new Date(iso).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });

const st = {
  card: { border: '1px solid var(--border, #e5e2dc)', borderRadius: 12, padding: 16, display: 'grid', gap: 10 },
  title: { fontSize: 15, fontWeight: 600, margin: 0 },
  hint: { fontSize: 12, color: 'var(--muted)', margin: 0 },
  input: { width: '100%', padding: '8px 12px', fontSize: 14, borderRadius: 8, border: '1px solid var(--border, #ddd)', background: 'transparent', color: 'inherit', boxSizing: 'border-box' as const },
  row: { display: 'flex', gap: 8, flexWrap: 'wrap' as const, alignItems: 'center' },
  btn: { padding: '8px 14px', fontSize: 14, fontWeight: 600, borderRadius: 8, border: 'none', cursor: 'pointer', background: 'var(--accent)', color: '#fff' },
  btn2: { padding: '6px 12px', fontSize: 13, borderRadius: 8, border: '1px solid var(--border, #ddd)', cursor: 'pointer', background: 'transparent', color: 'inherit' },
  code: { fontFamily: 'monospace', fontSize: 13, padding: '6px 8px', borderRadius: 6, border: '1px solid var(--border, #eee)', wordBreak: 'break-all' as const, flex: '1 1 200px', minWidth: 0 },
  list: { listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 6 },
  item: { display: 'flex', gap: 8, flexWrap: 'wrap' as const, alignItems: 'center', fontSize: 13, padding: '6px 0', borderTop: '1px solid var(--border, #eee)' },
  status: (s: Delivery['status']) => ({ fontWeight: 600, color: s === 'DELIVERED' ? 'var(--success, #15803d)' : s === 'FAILED' ? '#dc2626' : 'var(--muted)' }),
};

export function WebhookCard({ projectId, setError }: { projectId: string; setError: (e: string) => void }) {
  const [state, setState] = useState<WebhookState | null>(null);
  const [url, setUrl] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [showSecret, setShowSecret] = useState(false);

  useEffect(() => {
    call<WebhookState>(`/projects/${projectId}/webhook`)
      .then((r) => { setState(r); setUrl(r.webhook?.url ?? ''); })
      .catch((e: Error) => setError(e.message));
  }, [projectId, setError]);
  if (!state) return null;

  const run = async (action: () => Promise<void>): Promise<void> => {
    setBusy(true);
    setMessage('');
    try { await action(); } catch (e) { setMessage((e as Error).message); } finally { setBusy(false); }
  };
  const reload = async (): Promise<void> => { setState(await call<WebhookState>(`/projects/${projectId}/webhook`)); };
  const save = (enabled: boolean) => run(async () => {
    const next = await call<WebhookState>(`/projects/${projectId}/webhook`, { method: 'PUT', headers: HEADERS, body: JSON.stringify({ url, enabled }) });
    setState(next);
    setUrl(next.webhook?.url ?? url);
    setMessage(enabled ? 'Адрес сохранён. Каждое завершённое прохождение будет отправляться на него.' : 'Вебхук выключен: прохождения не отправляются.');
  });
  const test = () => run(async () => {
    const d = await call<Delivery>(`/projects/${projectId}/webhook/test`, { method: 'POST', headers: HEADERS });
    await reload();
    setMessage(d.status === 'DELIVERED' ? `Проверка доставлена: ${d.lastResult ?? ''}.` : `Проверка не доставлена: ${d.lastResult ?? 'нет ответа'}.`);
  });
  const rotate = () => run(async () => {
    if (!window.confirm('Сделать новый секрет? Старый сразу перестанет подходить — замените его в своей системе.')) return;
    setState(await call<WebhookState>(`/projects/${projectId}/webhook/secret`, { method: 'POST', headers: HEADERS }));
    setShowSecret(true);
    setMessage('Секрет заменён.');
  });
  const remove = () => run(async () => {
    if (!window.confirm('Удалить вебхук? Прохождения перестанут отправляться.')) return;
    await call(`/projects/${projectId}/webhook`, { method: 'DELETE', headers: HEADERS });
    await reload();
    setUrl('');
    setMessage('Вебхук удалён.');
  });
  const retry = (id: string) => run(async () => {
    const d = await call<Delivery>(`/projects/${projectId}/webhook/deliveries/${id}/retry`, { method: 'POST', headers: HEADERS });
    await reload();
    setMessage(d.status === 'DELIVERED' ? 'Отправлено.' : `Снова не доставлено: ${d.lastResult ?? 'нет ответа'}.`);
  });
  const copy = () => void navigator.clipboard?.writeText(state.webhook?.secret ?? '').then(() => setMessage('Секрет скопирован.'), () => setMessage('Не удалось скопировать — выделите секрет и скопируйте вручную.'));

  const hook = state.webhook;
  return (
    <section style={st.card} data-testid="webhook-card" aria-labelledby="webhook-title">
      <h3 id="webhook-title" style={st.title}>Вебхук {state.allowed ? '' : '🔒'}</h3>
      {!state.allowed ? (
        <p style={st.hint}>Отправка прохождений в вашу систему (учёт клиентов, таблицу, бота) есть на тарифе «Про». Сейчас тариф «{state.planTitle}».</p>
      ) : (
        <>
          <p style={st.hint}>
            Каждое завершённое прохождение — ответы, результат, баллы и контакты, если вы их собираете, — уходит на ваш адрес запросом с данными в формате JSON.
            Если ваш сервер не ответил кодом 200–299, отправка повторится через 1 мин, 5 мин, 30 мин, 2 ч и 6 ч.
          </p>
          <p style={st.hint}>
            Как проверить, что запрос от Блоккера: в заголовке <code>X-Blokker-Timestamp</code> — время, в <code>X-Blokker-Signature</code> — подпись{' '}
            {/* ui-language-ok: название алгоритма подписи нужно программисту создателя как есть */}
            <code>sha256=</code> и код HMAC-SHA256 от строки «время.тело запроса» с секретом ниже.
          </p>
          <label htmlFor="webhookUrl" style={{ fontSize: 14, fontWeight: 600 }}>Адрес</label>
          <input id="webhookUrl" style={st.input} value={url} placeholder="https://example.ru/blokker" maxLength={500} inputMode="url" disabled={busy} onChange={(e) => setUrl(e.target.value)} aria-label="Адрес вебхука" />
          <div style={st.row}>
            <button type="button" style={st.btn} disabled={busy || url.trim() === ''} onClick={() => void save(true)}>{hook ? 'Сохранить адрес' : 'Подключить'}</button>
            {hook ? <button type="button" style={st.btn2} disabled={busy} onClick={() => void test()}>Отправить проверку</button> : null}
            {hook ? (
              <label style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 13 }}>
                <input type="checkbox" checked={hook.enabled} disabled={busy} onChange={(e) => void save(e.target.checked)} aria-label="Вебхук включён" />
                Включён
              </label>
            ) : null}
          </div>
          {hook ? (
            <>
              <span style={{ fontSize: 14, fontWeight: 600 }}>Секрет подписи</span>
              <div style={st.row}>
                <span style={st.code} data-testid="webhook-secret">{showSecret ? hook.secret : '•'.repeat(24)}</span>
                <button type="button" style={st.btn2} onClick={() => setShowSecret((v) => !v)}>{showSecret ? 'Скрыть' : 'Показать'}</button>
                <button type="button" style={st.btn2} onClick={copy}>Скопировать</button>
                <button type="button" style={st.btn2} disabled={busy} onClick={() => void rotate()}>Новый секрет</button>
              </div>
              <span style={{ fontSize: 14, fontWeight: 600 }}>Последние отправки</span>
              {state.deliveries.length === 0 ? (
                <p style={st.hint}>Пока ничего не отправлялось. Нажмите «Отправить проверку».</p>
              ) : (
                <ul style={st.list} aria-label="Последние отправки вебхука">
                  {state.deliveries.map((d) => (
                    <li key={d.id} style={st.item}>
                      <span>{time(d.createdAt)}</span>
                      <span>{EVENT_TEXT[d.event] ?? d.event}</span>
                      <span style={st.status(d.status)}>{STATUS_TEXT[d.status]}</span>
                      <span style={{ color: 'var(--muted)' }}>{d.lastResult ?? ''}{d.attempts > 1 ? ` · попыток: ${d.attempts}` : ''}{d.nextAttemptAt ? ` · повтор в ${time(d.nextAttemptAt)}` : ''}</span>
                      {d.status === 'FAILED' ? <button type="button" style={st.btn2} disabled={busy} onClick={() => void retry(d.id)}>Отправить ещё раз</button> : null}
                    </li>
                  ))}
                </ul>
              )}
              <div><button type="button" style={{ ...st.btn2, color: '#dc2626', borderColor: '#dc2626' }} disabled={busy} onClick={() => void remove()}>Удалить вебхук</button></div>
            </>
          ) : null}
        </>
      )}
      {message ? <p role="status" style={st.hint}>{message}</p> : null}
    </section>
  );
}
