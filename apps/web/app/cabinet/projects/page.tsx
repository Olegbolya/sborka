'use client';
import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';

type ProjectStatus = 'DRAFT' | 'PUBLISHED' | 'CLOSED';

interface Project {
  id: string;
  title: string;
  slug: string;
  status: ProjectStatus;
  starts: number;
  completions: number;
  updatedAt: string;
  createdAt: string;
}

const STATUS_LABEL: Record<ProjectStatus, string> = {
  DRAFT: 'Черновик',
  PUBLISHED: 'Опубликована',
  CLOSED: 'Закрыта',
};

const STATUS_COLOR: Record<ProjectStatus, string> = {
  DRAFT: 'var(--muted)',
  PUBLISHED: '#16a34a',
  CLOSED: '#dc2626',
};

const CSRF = { 'X-Blokum-CSRF': '1', 'Content-Type': 'application/json' };

async function apiFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`/api/v1${path}`, { credentials: 'include', ...init });
  if (res.status === 204) return undefined as T;
  if (!res.ok) {
    const body = await res.json().catch(() => ({ message: 'Ошибка сервера' })) as { message?: string };
    throw new Error(body.message ?? `Ошибка ${res.status}`);
  }
  return res.json() as Promise<T>;
}

const s = {
  wrap: { minHeight: '100dvh', padding: '48px 16px', maxWidth: 900, margin: '0 auto' },
  nav: { fontSize: 14, marginBottom: 32, display: 'flex', gap: 12, alignItems: 'center', color: 'var(--muted)' },
  heading: { fontSize: 'clamp(22px, 4vw, 30px)', lineHeight: 1.2, margin: '0 0 24px', letterSpacing: '-0.02em' },
  toolbar: { display: 'flex', gap: 10, marginBottom: 20, flexWrap: 'wrap' as const, alignItems: 'center' },
  input: { flex: '1 1 200px', padding: '8px 12px', fontSize: 14, borderRadius: 8, border: '1px solid var(--border, #ddd)', background: 'transparent', color: 'inherit' },
  select: { padding: '8px 12px', fontSize: 14, borderRadius: 8, border: '1px solid var(--border, #ddd)', background: 'transparent', color: 'inherit' },
  btn: { padding: '9px 18px', fontSize: 14, fontWeight: 600, borderRadius: 8, border: 'none', cursor: 'pointer', background: 'var(--accent)', color: '#fff', whiteSpace: 'nowrap' as const },
  btnSm: { padding: '6px 12px', fontSize: 12, fontWeight: 600, borderRadius: 6, border: 'none', cursor: 'pointer', background: 'var(--accent)', color: '#fff', whiteSpace: 'nowrap' as const },
  btnSecondary: { padding: '6px 12px', fontSize: 12, borderRadius: 6, border: '1px solid var(--border, #ddd)', cursor: 'pointer', background: 'transparent', color: 'inherit', whiteSpace: 'nowrap' as const },
  btnDanger: { padding: '6px 12px', fontSize: 12, borderRadius: 6, border: '1px solid #dc2626', cursor: 'pointer', background: 'transparent', color: '#dc2626', whiteSpace: 'nowrap' as const },
  card: { padding: '14px 18px', borderRadius: 10, border: '1px solid var(--border, #eee)', marginBottom: 10, display: 'flex', alignItems: 'flex-start', gap: 14, flexWrap: 'wrap' as const },
  cardInfo: { flex: '1 1 200px', minWidth: 0 },
  title: { fontSize: 15, fontWeight: 600, margin: '0 0 6px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' as const },
  meta: { fontSize: 12, color: 'var(--muted)', display: 'flex', gap: 10, flexWrap: 'wrap' as const, alignItems: 'center' },
  badge: (status: ProjectStatus) => ({
    fontSize: 11, fontWeight: 700, padding: '2px 7px', borderRadius: 999,
    background: STATUS_COLOR[status] + '22', color: STATUS_COLOR[status],
  }),
  actions: { display: 'flex', gap: 6, flexWrap: 'wrap' as const, alignItems: 'center' },
  empty: { textAlign: 'center' as const, padding: '48px 0', color: 'var(--muted)' },
  error: { padding: '10px 14px', borderRadius: 8, background: '#fff5f5', color: '#dc2626', fontSize: 14, marginBottom: 14, border: '1px solid #fca5a5' },
  sectionTitle: { fontSize: 12, fontWeight: 700, textTransform: 'uppercase' as const, letterSpacing: '0.08em', color: 'var(--muted)', margin: '32px 0 12px' },
  divider: { borderTop: '1px solid var(--border, #eee)', margin: '32px 0' },
  creativityRow: { display: 'flex', gap: 4, justifyContent: 'space-between', alignItems: 'center', padding: '8px 0', borderBottom: '1px solid var(--border, #eee)', fontSize: 14 },
  emptyHint: { fontSize: 13, color: 'var(--muted)', fontStyle: 'italic' },
};

const CREATIVITY_SECTIONS = ['Темы', 'Шаблоны', 'Элементы', 'Шрифты'] as const;

export default function ProjectsPage() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [creating, setCreating] = useState(false);
  const [version, setVersion] = useState(0);
  const [editId, setEditId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState('');
  const reload = useCallback(() => setVersion((v) => v + 1), []);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError('');
    const params = new URLSearchParams();
    if (search) params.set('search', search);
    if (statusFilter) params.set('status', statusFilter);
    apiFetch<Project[]>(`/projects?${params}`)
      .then((data) => { if (active) setProjects(data); })
      .catch((e: Error) => { if (active) setError(e.message); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [search, statusFilter, version]);

  async function createProject() {
    setCreating(true);
    try {
      await apiFetch<Project>('/projects', { method: 'POST', headers: CSRF, body: JSON.stringify({}) });
      reload();
    } catch (e) { setError((e as Error).message); }
    finally { setCreating(false); }
  }

  async function saveTitle(id: string) {
    if (!editTitle.trim()) return;
    try {
      await apiFetch(`/projects/${id}`, { method: 'PATCH', headers: CSRF, body: JSON.stringify({ title: editTitle }) });
      setEditId(null);
      reload();
    } catch (e) { setError((e as Error).message); }
  }

  async function deleteProject(id: string, title: string) {
    if (!confirm(`Удалить «${title}»? Восстановить можно в течение 30 дней.`)) return;
    try {
      await apiFetch(`/projects/${id}`, { method: 'DELETE', headers: { 'X-Blokum-CSRF': '1' } });
      reload();
    } catch (e) { setError((e as Error).message); }
  }

  async function duplicateProject(id: string) {
    try {
      await apiFetch(`/projects/${id}/duplicate`, { method: 'POST', headers: CSRF, body: '{}' });
      reload();
    } catch (e) { setError((e as Error).message); }
  }

  async function setStatus(id: string, status: ProjectStatus) {
    try {
      await apiFetch(`/projects/${id}/status`, { method: 'POST', headers: CSRF, body: JSON.stringify({ status }) });
      reload();
    } catch (e) { setError((e as Error).message); }
  }

  return (
    <main style={s.wrap}>
      <nav style={s.nav}>
        <Link href="/account" style={{ color: 'var(--muted)', textDecoration: 'none' }}>Аккаунт</Link>
        <span>/</span>
        <span style={{ color: 'var(--fg)' }}>Мои сборки</span>
      </nav>
      <h1 style={s.heading}>Мои сборки</h1>

      {error && <div style={s.error}>{error}</div>}

      <div style={s.toolbar}>
        <input
          style={s.input}
          type="search"
          placeholder="Поиск по названию"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          aria-label="Поиск по названию"
        />
        <select
          style={s.select}
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          aria-label="Фильтр по статусу"
        >
          <option value="">Все статусы</option>
          <option value="DRAFT">Черновики</option>
          <option value="PUBLISHED">Опубликованные</option>
          <option value="CLOSED">Закрытые</option>
        </select>
        <button style={s.btn} onClick={() => { void createProject(); }} disabled={creating}>
          {creating ? 'Создание...' : '+ Создать сборку'}
        </button>
      </div>

      {loading && <p style={s.empty}>Загрузка...</p>}
      {!loading && projects.length === 0 && (
        <p style={s.empty}>
          {search || statusFilter ? 'Ничего не найдено' : 'Сборок нет — создайте первую!'}
        </p>
      )}

      {projects.map((p) => (
        <div key={p.id} style={s.card}>
          <div style={s.cardInfo}>
            {editId === p.id ? (
              <div style={{ display: 'flex', gap: 6, marginBottom: 6 }}>
                <input
                  style={{ ...s.input, flex: 1, fontSize: 14 }}
                  value={editTitle}
                  onChange={(e) => setEditTitle(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && void saveTitle(p.id)}
                  aria-label="Название сборки"
                  autoFocus
                />
                <button style={s.btnSm} onClick={() => void saveTitle(p.id)}>Сохранить</button>
                <button style={s.btnSecondary} onClick={() => setEditId(null)}>Отмена</button>
              </div>
            ) : (
              <p style={s.title} title={p.title}>{p.title}</p>
            )}
            <div style={s.meta}>
              <span style={s.badge(p.status)}>{STATUS_LABEL[p.status]}</span>
              <span>Открытий: {p.starts}</span>
              <span>Прохождений: {p.completions}</span>
              <span>Обновлена: {new Date(p.updatedAt).toLocaleDateString('ru-RU')}</span>
            </div>
          </div>
          <div style={s.actions}>
            <Link href={`/app/projects/${p.id}/edit`} style={{ textDecoration: 'none' }}>
              <button style={s.btnSm}>Редактор</button>
            </Link>
            <Link href={`/cabinet/projects/${p.id}`} style={{ textDecoration: 'none' }}>
              <button style={s.btnSm}>Ответы и доступ</button>
            </Link>
            <button style={s.btnSecondary} onClick={() => { setEditId(p.id); setEditTitle(p.title); }}>
              Переименовать
            </button>
            <button style={s.btnSecondary} onClick={() => void duplicateProject(p.id)}>Дублировать</button>
            {p.status === 'DRAFT' && (
              <button style={s.btnSecondary} onClick={() => void setStatus(p.id, 'PUBLISHED')}>
                Опубликовать
              </button>
            )}
            {p.status === 'PUBLISHED' && (
              <button style={s.btnSecondary} onClick={() => void setStatus(p.id, 'CLOSED')}>
                Закрыть
              </button>
            )}
            {p.status === 'CLOSED' && (
              <button style={s.btnSecondary} onClick={() => void setStatus(p.id, 'PUBLISHED')}>
                Открыть снова
              </button>
            )}
            <button style={s.btnDanger} onClick={() => void deleteProject(p.id, p.title)}>
              Удалить
            </button>
          </div>
        </div>
      ))}

      <div style={s.divider} />

      <p style={s.sectionTitle}>Моё творчество</p>
      {CREATIVITY_SECTIONS.map((section) => (
        <div key={section} style={s.creativityRow}>
          <span>{section}</span>
          <span style={s.emptyHint}>Пусто</span>
        </div>
      ))}
    </main>
  );
}
