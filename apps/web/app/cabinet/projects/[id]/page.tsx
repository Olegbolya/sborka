'use client';
import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';

type Tab = 'responses' | 'access' | 'settings' | 'export' | 'operator';

interface ProjectDetail {
  id: string;
  title: string;
  slug: string;
  status: string;
  starts: number;
  completions: number;
  settings: ProjectSettings;
  updatedAt: string;
  createdAt: string;
}

interface ProjectSettings {
  maxCompletions?: number;
  scheduledOpenAt?: string;
  scheduledCloseAt?: string;
  password?: string;
  singleAttempt?: boolean;
  closedText?: string;
}

interface ResponseSummary {
  id: string;
  status: string;
  startedAt: string;
  completedAt: string | null;
  durationMs: number | null;
  deviceType: string;
  score: number | null;
  resultKey: string | null;
  accessPointId: string | null;
  viewedAt: string | null;
}

interface ResponsesPage {
  items: ResponseSummary[];
  nextCursor: string | null;
}

interface Answer {
  id: string;
  blockId: string | null;
  variableId: string | null;
  value: unknown;
  answeredAt: string;
}

interface ResponseDetail extends ResponseSummary {
  answers: Answer[];
}

interface AccessPoint {
  id: string;
  code: string;
  label: string | null;
  active: boolean;
  url: string;
  createdAt: string;
}

const CSRF = { 'X-Blokum-CSRF': '1', 'Content-Type': 'application/json' };
const CSRF_ONLY = { 'X-Blokum-CSRF': '1' };

async function apiFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`/api/v1${path}`, { credentials: 'include', ...init });
  if (res.status === 204) return undefined as T;
  if (!res.ok) {
    const body = await res.json().catch(() => ({ message: 'Ошибка сервера' })) as { message?: string };
    throw new Error(body.message ?? `Ошибка ${res.status}`);
  }
  return res.json() as Promise<T>;
}

function formatDuration(ms: number | null): string {
  if (ms === null) return '—';
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s} с`;
  return `${Math.floor(s / 60)} мин ${s % 60} с`;
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

const STATUS_RESPONSE: Record<string, string> = {
  IN_PROGRESS: 'В процессе',
  COMPLETED: 'Завершён',
  ABANDONED: 'Прерван',
};

const STATUS_PROJECT: Record<string, string> = {
  DRAFT: 'Черновик',
  PUBLISHED: 'Опубликована',
  CLOSED: 'Закрыта',
};

const s = {
  wrap: { minHeight: '100dvh', padding: '32px 16px', maxWidth: 1000, margin: '0 auto' },
  nav: { fontSize: 14, marginBottom: 24, display: 'flex', gap: 12, alignItems: 'center', color: 'var(--muted)' },
  heading: { fontSize: 'clamp(18px, 3vw, 26px)', lineHeight: 1.2, margin: '0 0 4px', letterSpacing: '-0.02em' },
  subHeading: { fontSize: 13, color: 'var(--muted)', margin: '0 0 24px' },
  tabs: { display: 'flex', gap: 2, marginBottom: 24, borderBottom: '2px solid var(--border, #eee)' },
  tab: (active: boolean) => ({
    padding: '10px 18px', fontSize: 14, fontWeight: active ? 600 : 400,
    border: 'none', cursor: 'pointer', background: 'transparent', color: active ? 'var(--accent)' : 'var(--muted)',
    borderBottom: active ? '2px solid var(--accent)' : '2px solid transparent', marginBottom: -2,
  }),
  btn: { padding: '9px 18px', fontSize: 14, fontWeight: 600, borderRadius: 8, border: 'none', cursor: 'pointer', background: 'var(--accent)', color: '#fff' },
  btnSm: { padding: '5px 10px', fontSize: 12, fontWeight: 600, borderRadius: 6, border: 'none', cursor: 'pointer', background: 'var(--accent)', color: '#fff' },
  btnSecondary: { padding: '5px 10px', fontSize: 12, borderRadius: 6, border: '1px solid var(--border, #ddd)', cursor: 'pointer', background: 'transparent', color: 'inherit' },
  btnDanger: { padding: '5px 10px', fontSize: 12, borderRadius: 6, border: '1px solid #dc2626', cursor: 'pointer', background: 'transparent', color: '#dc2626' },
  error: { padding: '10px 14px', borderRadius: 8, background: '#fff5f5', color: '#dc2626', fontSize: 14, marginBottom: 14 },
  empty: { textAlign: 'center' as const, padding: '32px 0', color: 'var(--muted)', fontSize: 14 },
  table: { width: '100%', borderCollapse: 'collapse' as const, fontSize: 13 },
  th: { textAlign: 'left' as const, padding: '8px 10px', fontWeight: 600, color: 'var(--muted)', fontSize: 11, textTransform: 'uppercase' as const, letterSpacing: '0.06em', borderBottom: '1px solid var(--border, #eee)' },
  td: { padding: '8px 10px', borderBottom: '1px solid var(--border, #f5f5f5)', verticalAlign: 'top' as const },
  form: { display: 'grid', gap: 16, maxWidth: 480 },
  label: { fontSize: 14, fontWeight: 600, display: 'block', marginBottom: 4 },
  inputFull: { width: '100%', padding: '8px 12px', fontSize: 14, borderRadius: 8, border: '1px solid var(--border, #ddd)', background: 'transparent', color: 'inherit', boxSizing: 'border-box' as const },
  textarea: { width: '100%', padding: '8px 12px', fontSize: 14, borderRadius: 8, border: '1px solid var(--border, #ddd)', background: 'transparent', color: 'inherit', resize: 'vertical' as const, minHeight: 80, boxSizing: 'border-box' as const },
  hint: { fontSize: 12, color: 'var(--muted)', marginTop: 4 },
  apCard: { padding: '12px 16px', borderRadius: 8, border: '1px solid var(--border, #eee)', marginBottom: 8 },
  apRow: { display: 'flex', gap: 10, alignItems: 'flex-start', flexWrap: 'wrap' as const },
  apInfo: { flex: '1 1 200px', minWidth: 0 },
  code: { fontFamily: 'monospace', fontSize: 13, background: 'var(--bg)', padding: '2px 6px', borderRadius: 4, border: '1px solid var(--border, #eee)' },
  exportBox: { display: 'flex', flexDirection: 'column' as const, gap: 12, maxWidth: 400 },
  exportBtn: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 18px', borderRadius: 10, border: '1px solid var(--border, #eee)', textDecoration: 'none', color: 'inherit', fontSize: 14, fontWeight: 600 },
  qrRow: { display: 'flex', gap: 6, flexWrap: 'wrap' as const, marginTop: 8 },
};

function ResponseCard({ detail }: { detail: ResponseDetail }) {
  return (
    <div style={{ fontSize: 13 }}>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '4px 24px', marginBottom: 12, color: 'var(--muted)' }}>
        <span>Начало: {formatDate(detail.startedAt)}</span>
        <span>Завершение: {detail.completedAt ? formatDate(detail.completedAt) : '—'}</span>
        <span>Длительность: {formatDuration(detail.durationMs)}</span>
        <span>Устройство: {detail.deviceType === 'desktop' ? 'ПК' : detail.deviceType === 'mobile' ? 'Телефон' : detail.deviceType}</span>
      </div>
      {detail.answers.length === 0 ? (
        <p style={{ margin: 0, color: 'var(--muted)', fontStyle: 'italic' }}>Ответов нет</p>
      ) : (
        <table style={{ width: '100%', borderCollapse: 'collapse' as const }}>
          <thead>
            <tr>
              <th style={{ ...s.th, fontSize: 11 }}>Блок / переменная</th>
              <th style={{ ...s.th, fontSize: 11 }}>Ответ</th>
              <th style={{ ...s.th, fontSize: 11 }}>Время</th>
            </tr>
          </thead>
          <tbody>
            {detail.answers.map((a) => (
              <tr key={a.id}>
                <td style={{ ...s.td, fontFamily: 'monospace', fontSize: 12 }}>{a.blockId ?? a.variableId ?? '—'}</td>
                <td style={{ ...s.td, maxWidth: 400, wordBreak: 'break-word' as const }}>{JSON.stringify(a.value)}</td>
                <td style={{ ...s.td, whiteSpace: 'nowrap' as const, color: 'var(--muted)' }}>{formatDate(a.answeredAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

function ResponsesTab({ projectId, setError }: { projectId: string; setError: (e: string) => void }) {
  const [responses, setResponses] = useState<ResponseSummary[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [statusFilter, setStatusFilter] = useState('');
  const [version, setVersion] = useState(0);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [details, setDetails] = useState<Map<string, ResponseDetail>>(new Map());

  useEffect(() => {
    let active = true;
    setLoading(true);
    const params = new URLSearchParams({ limit: '50' });
    if (statusFilter) params.set('status', statusFilter);
    apiFetch<ResponsesPage>(`/projects/${projectId}/responses?${params}`)
      .then((data) => {
        if (!active) return;
        setResponses(data.items);
        setNextCursor(data.nextCursor);
      })
      .catch((e: Error) => { if (active) setError(e.message); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [projectId, statusFilter, version, setError]);

  async function loadMore() {
    if (!nextCursor) return;
    setLoadingMore(true);
    try {
      const params = new URLSearchParams({ limit: '50', cursor: nextCursor });
      if (statusFilter) params.set('status', statusFilter);
      const data = await apiFetch<ResponsesPage>(`/projects/${projectId}/responses?${params}`);
      setResponses((prev) => [...prev, ...data.items]);
      setNextCursor(data.nextCursor);
    } catch (e) { setError((e as Error).message); }
    finally { setLoadingMore(false); }
  }

  async function deleteResponse(id: string) {
    if (!confirm('Удалить этот ответ?')) return;
    try {
      await apiFetch(`/projects/${projectId}/responses/${id}`, { method: 'DELETE', headers: CSRF_ONLY });
      setVersion((v) => v + 1);
    } catch (e) { setError((e as Error).message); }
  }

  async function markViewed(id: string) {
    try {
      await apiFetch(`/projects/${projectId}/responses/${id}/viewed`, { method: 'POST', headers: CSRF });
      setResponses((prev) => prev.map((r) => r.id === id ? { ...r, viewedAt: new Date().toISOString() } : r));
    } catch (e) { setError((e as Error).message); }
  }

  async function toggleCard(id: string) {
    if (expandedId === id) { setExpandedId(null); return; }
    setExpandedId(id);
    if (details.has(id)) return;
    try {
      const data = await apiFetch<ResponseDetail>(`/projects/${projectId}/responses/${id}`);
      setDetails((prev) => new Map(prev).set(id, data));
    } catch (e) { setError((e as Error).message); }
  }

  return (
    <div>
      <div style={{ display: 'flex', gap: 10, marginBottom: 16, alignItems: 'center' }}>
        <select
          style={{ padding: '7px 12px', fontSize: 13, borderRadius: 7, border: '1px solid var(--border, #ddd)', background: 'transparent', color: 'inherit' }}
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          aria-label="Фильтр по статусу"
        >
          <option value="">Все прохождения</option>
          <option value="COMPLETED">Завершённые</option>
          <option value="IN_PROGRESS">В процессе</option>
          <option value="ABANDONED">Прерванные</option>
        </select>
      </div>

      {loading && <p style={s.empty}>Загрузка...</p>}
      {!loading && responses.length === 0 && <p style={s.empty}>Ответов пока нет</p>}
      {!loading && responses.length > 0 && (
        <div style={{ overflowX: 'auto' }}>
          <table style={s.table}>
            <thead>
              <tr>
                <th style={s.th}>Статус</th>
                <th style={s.th}>Начало</th>
                <th style={s.th}>Длительность</th>
                <th style={s.th}>Устройство</th>
                <th style={s.th}>Баллы</th>
                <th style={s.th}>Результат</th>
                <th style={s.th}>Просмотрен</th>
                <th style={s.th}></th>
              </tr>
            </thead>
            <tbody>
              {responses.map((r) => (
                <>
                  <tr key={r.id} style={{ cursor: 'pointer' }}>
                    <td style={s.td}>{STATUS_RESPONSE[r.status] ?? r.status}</td>
                    <td style={s.td}>{formatDate(r.startedAt)}</td>
                    <td style={s.td}>{formatDuration(r.durationMs)}</td>
                    <td style={s.td}>{r.deviceType === 'desktop' ? 'ПК' : r.deviceType === 'mobile' ? 'Телефон' : r.deviceType}</td>
                    <td style={s.td}>{r.score !== null ? r.score : '—'}</td>
                    <td style={s.td}>{r.resultKey ?? '—'}</td>
                    <td style={s.td}>{r.viewedAt ? '✓' : '—'}</td>
                    <td style={{ ...s.td, whiteSpace: 'nowrap' as const }}>
                      <button style={{ ...s.btnSecondary, marginRight: 4 }} onClick={() => void toggleCard(r.id)}>
                        {expandedId === r.id ? 'Скрыть' : 'Карточка'}
                      </button>
                      {!r.viewedAt && (
                        <button style={{ ...s.btnSecondary, marginRight: 4 }} onClick={() => void markViewed(r.id)}>
                          Просмотрено
                        </button>
                      )}
                      <button style={s.btnDanger} onClick={() => void deleteResponse(r.id)}>
                        Удалить
                      </button>
                    </td>
                  </tr>
                  {expandedId === r.id && (
                    <tr key={`${r.id}-detail`}>
                      <td colSpan={8} style={{ ...s.td, background: 'var(--bg)', padding: '12px 16px' }}>
                        {!details.has(r.id) ? (
                          <span style={{ fontSize: 13, color: 'var(--muted)' }}>Загрузка...</span>
                        ) : (
                          <ResponseCard detail={details.get(r.id)!} />
                        )}
                      </td>
                    </tr>
                  )}
                </>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {nextCursor && (
        <div style={{ textAlign: 'center', marginTop: 16 }}>
          <button style={s.btnSecondary} onClick={() => void loadMore()} disabled={loadingMore}>
            {loadingMore ? 'Загрузка...' : 'Загрузить ещё'}
          </button>
        </div>
      )}
    </div>
  );
}

function AccessTab({ projectId, setError }: { projectId: string; setError: (e: string) => void }) {
  const [points, setPoints] = useState<AccessPoint[]>([]);
  const [loading, setLoading] = useState(true);
  const [newLabel, setNewLabel] = useState('');
  const [creating, setCreating] = useState(false);
  const [version, setVersion] = useState(0);
  const reload = useCallback(() => setVersion((v) => v + 1), []);

  useEffect(() => {
    let active = true;
    setLoading(true);
    apiFetch<AccessPoint[]>(`/projects/${projectId}/access-points`)
      .then((data) => { if (active) setPoints(data); })
      .catch((e: Error) => { if (active) setError(e.message); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [projectId, version, setError]);

  async function createPoint() {
    setCreating(true);
    try {
      await apiFetch(`/projects/${projectId}/access-points`, {
        method: 'POST', headers: CSRF,
        body: JSON.stringify({ label: newLabel.trim() || null }),
      });
      setNewLabel('');
      reload();
    } catch (e) { setError((e as Error).message); }
    finally { setCreating(false); }
  }

  async function toggleActive(pointId: string, active: boolean) {
    try {
      await apiFetch(`/projects/${projectId}/access-points/${pointId}/active`, {
        method: 'POST', headers: CSRF,
        body: JSON.stringify({ active }),
      });
      reload();
    } catch (e) { setError((e as Error).message); }
  }

  async function deletePoint(pointId: string) {
    if (!confirm('Удалить эту точку доступа?')) return;
    try {
      await apiFetch(`/projects/${projectId}/access-points/${pointId}`, { method: 'DELETE', headers: CSRF_ONLY });
      reload();
    } catch (e) { setError((e as Error).message); }
  }

  return (
    <div>
      {loading && <p style={s.empty}>Загрузка...</p>}
      {!loading && (
        <>
          {points.map((ap) => (
            <div key={ap.id} style={s.apCard}>
              <div style={s.apRow}>
                <div style={s.apInfo}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                    <span style={s.code}>/q/{ap.code}</span>
                    {ap.label && <span style={{ fontSize: 13 }}>{ap.label}</span>}
                    <span style={{ fontSize: 11, padding: '2px 7px', borderRadius: 999, background: ap.active ? '#dcfce7' : '#f5f5f5', color: ap.active ? '#16a34a' : 'var(--muted)' }}>
                      {ap.active ? 'Активна' : 'Отключена'}
                    </span>
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 8, wordBreak: 'break-all' as const }}>{ap.url}</div>
                  <div style={s.qrRow}>
                    <a href={`/api/v1/projects/${projectId}/access-points/${ap.id}/qr.png?size=1024`} download={`qr-${ap.code}-1024.png`} style={{ ...s.btnSecondary, textDecoration: 'none', fontSize: 11 }}>
                      QR PNG 1024
                    </a>
                    <a href={`/api/v1/projects/${projectId}/access-points/${ap.id}/qr.png?size=2048`} download={`qr-${ap.code}-2048.png`} style={{ ...s.btnSecondary, textDecoration: 'none', fontSize: 11 }}>
                      QR PNG 2048
                    </a>
                    <a href={`/api/v1/projects/${projectId}/access-points/${ap.id}/qr.png?size=4096`} download={`qr-${ap.code}-4096.png`} style={{ ...s.btnSecondary, textDecoration: 'none', fontSize: 11 }}>
                      QR PNG 4096
                    </a>
                    <a href={`/api/v1/projects/${projectId}/access-points/${ap.id}/qr.svg`} download={`qr-${ap.code}.svg`} style={{ ...s.btnSecondary, textDecoration: 'none', fontSize: 11 }}>
                      QR SVG
                    </a>
                    <button style={{ ...s.btnSecondary, fontSize: 11 }} onClick={() => void navigator.clipboard.writeText(ap.url)}>
                      Скопировать ссылку
                    </button>
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 6 }}>
                  <button style={s.btnSecondary} onClick={() => void toggleActive(ap.id, !ap.active)}>
                    {ap.active ? 'Отключить' : 'Включить'}
                  </button>
                  <button style={s.btnDanger} onClick={() => void deletePoint(ap.id)}>Удалить</button>
                </div>
              </div>
            </div>
          ))}

          <div style={{ display: 'flex', gap: 8, marginTop: 16, alignItems: 'center' }}>
            <input
              style={{ ...s.inputFull, maxWidth: 300 }}
              placeholder="Метка точки доступа (необязательно)"
              value={newLabel}
              onChange={(e) => setNewLabel(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && void createPoint()}
              aria-label="Метка новой точки доступа"
            />
            <button style={s.btn} onClick={() => void createPoint()} disabled={creating}>
              {creating ? 'Создание...' : '+ Добавить точку'}
            </button>
          </div>

          {(() => {
            const firstUrl = points[0]?.url;
            if (!firstUrl) return null;
            return (
              <div style={{ marginTop: 24, padding: '14px 16px', borderRadius: 8, border: '1px solid var(--border, #eee)', fontSize: 13, color: 'var(--muted)' }}>
                Поделиться в:{' '}
                <a href={`https://vk.com/share.php?url=${encodeURIComponent(firstUrl)}`} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--accent)', marginRight: 12 }}>VK</a>
                <a href={`https://t.me/share/url?url=${encodeURIComponent(firstUrl)}`} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--accent)', marginRight: 12 }}>Telegram</a>
                <a href={`https://wa.me/?text=${encodeURIComponent(firstUrl)}`} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--accent)', marginRight: 12 }}>WhatsApp</a>
                <a href={`mailto:?body=${encodeURIComponent(firstUrl)}`} style={{ color: 'var(--accent)' }}>Почта</a>
              </div>
            );
          })()}
        </>
      )}
    </div>
  );
}

function SettingsTab({ projectId, settings: initialSettings, setError }: { projectId: string; settings: ProjectSettings; setError: (e: string) => void }) {
  const [settings, setSettings] = useState<ProjectSettings>(initialSettings);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  async function save() {
    setSaving(true);
    setSaved(false);
    try {
      const updated = await apiFetch<ProjectSettings>(`/projects/${projectId}/access-settings`, {
        method: 'PATCH', headers: CSRF,
        body: JSON.stringify(settings),
      });
      setSettings(updated);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (e) { setError((e as Error).message); }
    finally { setSaving(false); }
  }

  function update(key: keyof ProjectSettings, value: unknown) {
    setSettings((prev) => ({ ...prev, [key]: value }));
  }

  return (
    <div style={s.form}>
      <div>
        <label style={s.label} htmlFor="maxCompletions">Максимум прохождений</label>
        <input
          id="maxCompletions"
          type="number"
          min={1}
          style={s.inputFull}
          placeholder="Без ограничений"
          value={settings.maxCompletions ?? ''}
          onChange={(e) => update('maxCompletions', e.target.value ? Number(e.target.value) : undefined)}
          aria-label="Максимум прохождений"
        />
        <p style={s.hint}>Сборка автоматически закроется при достижении лимита</p>
      </div>

      <div>
        <label style={s.label} htmlFor="scheduledOpenAt">Открыть по расписанию</label>
        <input
          id="scheduledOpenAt"
          type="datetime-local"
          style={s.inputFull}
          value={settings.scheduledOpenAt ? settings.scheduledOpenAt.slice(0, 16) : ''}
          onChange={(e) => update('scheduledOpenAt', e.target.value ? new Date(e.target.value).toISOString() : undefined)}
          aria-label="Дата и время открытия"
        />
      </div>

      <div>
        <label style={s.label} htmlFor="scheduledCloseAt">Закрыть по расписанию</label>
        <input
          id="scheduledCloseAt"
          type="datetime-local"
          style={s.inputFull}
          value={settings.scheduledCloseAt ? settings.scheduledCloseAt.slice(0, 16) : ''}
          onChange={(e) => update('scheduledCloseAt', e.target.value ? new Date(e.target.value).toISOString() : undefined)}
          aria-label="Дата и время закрытия"
        />
      </div>

      <div>
        <label style={s.label} htmlFor="password">Пароль для входа</label>
        <input
          id="password"
          type="text"
          style={s.inputFull}
          placeholder="Без пароля"
          value={settings.password ?? ''}
          onChange={(e) => update('password', e.target.value || undefined)}
          aria-label="Пароль для входа"
        />
      </div>

      <div>
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: 14 }}>
          <input
            type="checkbox"
            checked={settings.singleAttempt ?? false}
            onChange={(e) => update('singleAttempt', e.target.checked || undefined)}
            aria-label="Одна попытка"
          />
          Одна попытка на участника
        </label>
        <p style={s.hint}>Участник не сможет пройти повторно с того же устройства</p>
      </div>

      <div>
        <label style={s.label} htmlFor="closedText">Текст экрана «Закрыто»</label>
        <textarea
          id="closedText"
          style={s.textarea}
          placeholder="Сборка временно недоступна"
          value={settings.closedText ?? ''}
          onChange={(e) => update('closedText', e.target.value || undefined)}
          aria-label="Текст экрана закрыто"
        />
      </div>

      <div>
        <button style={s.btn} onClick={() => void save()} disabled={saving}>
          {saving ? 'Сохранение...' : saved ? 'Сохранено!' : 'Сохранить настройки'}
        </button>
      </div>
    </div>
  );
}

interface OperatorInfo {
  name: string;
  email: string;
  inn?: string;
  purpose: string;
  retentionPeriod: string;
}

function OperatorTab({ projectId, setError }: { projectId: string; setError: (e: string) => void }) {
  const [info, setInfo] = useState<OperatorInfo | null>(null);
  const [dpaAcceptedAt, setDpaAcceptedAt] = useState<string | null>(null);
  const [form, setForm] = useState<OperatorInfo>({ name: '', email: '', inn: '', purpose: '', retentionPeriod: '' });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    apiFetch<{ operatorInfo: OperatorInfo | null; dpaAcceptedAt: string | null }>(`/projects/${projectId}/operator-info`)
      .then((res) => {
        if (res.operatorInfo) {
          setInfo(res.operatorInfo);
          setForm(res.operatorInfo);
        }
        setDpaAcceptedAt(res.dpaAcceptedAt);
      })
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  }, [projectId, setError]);

  async function saveInfo() {
    setSaving(true);
    try {
      const updated = await apiFetch<OperatorInfo>(`/projects/${projectId}/operator-info`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', 'X-Blokum-CSRF': '1' },
        body: JSON.stringify(form),
      });
      setInfo(updated);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  async function acceptDpa() {
    setSaving(true);
    try {
      const res = await apiFetch<{ acceptedAt: string }>(`/projects/${projectId}/dpa-accept`, {
        method: 'POST',
        headers: { 'X-Blokum-CSRF': '1' },
      });
      setDpaAcceptedAt(res.acceptedAt);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <p style={{ fontSize: 14, color: 'var(--muted)' }}>Загрузка...</p>;

  return (
    <div style={{ maxWidth: 540 }}>
      <p style={{ fontSize: 14, color: 'var(--muted)', marginBottom: 24 }}>
        Если в сборке есть блок «Контакты» (сбор имени, телефона, email), заполните сведения об операторе персональных данных и примите условия поручения обработки. Без этого публикация сборки невозможна.
      </p>

      <div style={{ display: 'flex', flexDirection: 'column' as const, gap: 12, marginBottom: 24 }}>
        {([
          { key: 'name', label: 'Имя или название организации *', type: 'text' },
          { key: 'email', label: 'Email для обращений по ПД *', type: 'email' },
          { key: 'inn', label: 'ИНН (для ИП и юрлиц)', type: 'text' },
          { key: 'purpose', label: 'Цель обработки *', type: 'text' },
          { key: 'retentionPeriod', label: 'Срок хранения данных *', type: 'text' },
        ] as Array<{ key: keyof OperatorInfo; label: string; type: string }>).map(({ key, label, type }) => (
          <label key={key} style={{ display: 'flex', flexDirection: 'column' as const, gap: 4, fontSize: 13 }}>
            <span style={{ color: 'var(--muted)' }}>{label}</span>
            <input
              type={type}
              value={form[key] ?? ''}
              onChange={(e) => setForm((f) => ({ ...f, [key]: e.target.value }))}
              style={{ padding: '8px 10px', borderRadius: 6, border: '1px solid var(--border, #ddd)', fontSize: 14 }}
            />
          </label>
        ))}
      </div>

      <button
        onClick={() => void saveInfo()}
        disabled={saving || !form.name || !form.email || !form.purpose || !form.retentionPeriod}
        style={{ padding: '10px 20px', borderRadius: 8, border: 'none', background: 'var(--accent, #0066ff)', color: '#fff', cursor: 'pointer', fontSize: 14, marginBottom: 24 }}
      >
        {saving ? 'Сохранение...' : 'Сохранить сведения об операторе'}
      </button>

      {info && (
        <div style={{ padding: 16, background: 'var(--surface, #f8f9fa)', borderRadius: 8, marginBottom: 24 }}>
          <p style={{ margin: '0 0 8px', fontSize: 13, fontWeight: 600 }}>
            {dpaAcceptedAt ? '✓ Условия поручения обработки ПД приняты' : 'Условия поручения обработки ПД не приняты'}
          </p>
          {dpaAcceptedAt && <p style={{ margin: 0, fontSize: 12, color: 'var(--muted)' }}>Принято: {new Date(dpaAcceptedAt).toLocaleString('ru')}</p>}
          {!dpaAcceptedAt && (
            <>
              <p style={{ fontSize: 13, color: 'var(--muted)', marginBottom: 12 }}>
                Ознакомьтесь с{' '}
                <a href="/legal/dpa" target="_blank" style={{ color: 'var(--accent, #0066ff)' }}>
                  условиями поручения обработки ПД (D6)
                </a>{' '}
                и примите их для возможности публикации сборки.
              </p>
              <button
                onClick={() => void acceptDpa()}
                disabled={saving}
                style={{ padding: '8px 16px', borderRadius: 6, border: '1px solid var(--accent, #0066ff)', background: '#fff', color: 'var(--accent, #0066ff)', cursor: 'pointer', fontSize: 13 }}
              >
                Принять условия поручения обработки ПД
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}

function ExportTab({ projectId }: { projectId: string }) {
  return (
    <div style={s.exportBox}>
      <p style={{ margin: '0 0 16px', fontSize: 14, color: 'var(--muted)' }}>
        Скачайте все ответы на сборку в удобном формате. Файл включает дату, длительность, баллы, результат и ответы на каждый вопрос отдельными колонками.
      </p>
      <a
        href={`/api/v1/projects/${projectId}/responses/export.csv`}
        download={`responses-${projectId}.csv`}
        style={s.exportBtn}
      >
        <span>CSV (UTF-8, с BOM)</span>
        <span style={{ fontSize: 12, color: 'var(--muted)' }}>Excel, Google Таблицы</span>
      </a>
      <a
        href={`/api/v1/projects/${projectId}/responses/export.xlsx`}
        download={`responses-${projectId}.xlsx`}
        style={s.exportBtn}
      >
        <span>XLSX</span>
        <span style={{ fontSize: 12, color: 'var(--muted)' }}>Microsoft Excel</span>
      </a>
    </div>
  );
}

export default function ProjectDetailPage() {
  const params = useParams<{ id: string }>();
  const projectId = params.id;
  const [project, setProject] = useState<ProjectDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [tab, setTab] = useState<Tab>('responses');

  useEffect(() => {
    apiFetch<ProjectDetail>(`/projects/${projectId}`)
      .then(setProject)
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  }, [projectId]);

  if (loading) {
    return <main style={s.wrap}><p style={s.empty}>Загрузка...</p></main>;
  }

  if (error || !project) {
    return (
      <main style={s.wrap}>
        <div style={s.error}>{error || 'Сборка не найдена'}</div>
        <Link href="/cabinet/projects" style={{ fontSize: 14, color: 'var(--accent)' }}>← Вернуться к списку</Link>
      </main>
    );
  }

  const tabs: { key: Tab; label: string }[] = [
    { key: 'responses', label: `Ответы (${project.completions})` },
    { key: 'access', label: 'Точки доступа' },
    { key: 'settings', label: 'Настройки доступа' },
    { key: 'operator', label: 'Оператор ПД' },
    { key: 'export', label: 'Экспорт' },
  ];

  return (
    <main style={s.wrap}>
      <nav style={s.nav}>
        <Link href="/account" style={{ color: 'var(--muted)', textDecoration: 'none' }}>Аккаунт</Link>
        <span>/</span>
        <Link href="/cabinet/projects" style={{ color: 'var(--muted)', textDecoration: 'none' }}>Мои сборки</Link>
        <span>/</span>
        <span style={{ color: 'var(--fg)' }}>{project.title}</span>
      </nav>
      <h1 style={s.heading}>{project.title}</h1>
      <p style={s.subHeading}>
        {STATUS_PROJECT[project.status] ?? project.status}
        {' · '}Открытий: {project.starts}
        {' · '}Прохождений: {project.completions}
      </p>

      {error && <div style={s.error}>{error}</div>}

      <div style={s.tabs}>
        {tabs.map(({ key, label }) => (
          <button key={key} style={s.tab(tab === key)} onClick={() => setTab(key)}>
            {label}
          </button>
        ))}
      </div>

      {tab === 'responses' && <ResponsesTab projectId={projectId} setError={setError} />}
      {tab === 'access' && <AccessTab projectId={projectId} setError={setError} />}
      {tab === 'settings' && <SettingsTab projectId={projectId} settings={project.settings} setError={setError} />}
      {tab === 'operator' && <OperatorTab projectId={projectId} setError={setError} />}
      {tab === 'export' && <ExportTab projectId={projectId} />}
    </main>
  );
}
