'use client';
import { clearClipboard } from '../../lib/editor/clipboard';
import { useCallback, useEffect, useState } from 'react';
import { api, apiRaw, errorText, isApiError } from '../../lib/api-browser';

const s = {
  main: { minHeight: '100dvh', padding: '48px 16px', maxWidth: 640, margin: '0 auto' },
  heading: { fontSize: 'clamp(22px, 4vw, 30px)', lineHeight: 1.2, margin: '0 0 32px', letterSpacing: '-0.02em' },
  section: { marginBottom: 32 },
  sectionTitle: { fontSize: 14, fontWeight: 600, textTransform: 'uppercase' as const, letterSpacing: '0.08em', color: 'var(--muted)', marginBottom: 12 },
  row: { display: 'flex', alignItems: 'center', flexWrap: 'wrap' as const, gap: 12, marginBottom: 12 },
  label: { fontSize: 14, color: 'var(--muted)', minWidth: 48 },
  value: { fontSize: 15 },
  input: { flex: '1 1 180px', minWidth: 0, padding: '8px 12px', fontSize: 15, borderRadius: 8, border: '1px solid var(--border, #ddd)', background: 'transparent' },
  btn: { padding: '10px 20px', fontSize: 14, fontWeight: 600, borderRadius: 8, border: 'none', cursor: 'pointer', background: 'var(--accent)', color: '#fff' },
  btnDanger: { padding: '10px 20px', fontSize: 14, fontWeight: 600, borderRadius: 8, border: '1px solid #dc2626', cursor: 'pointer', background: 'transparent', color: '#dc2626' },
  btnSecondary: { padding: '8px 16px', fontSize: 13, borderRadius: 8, border: '1px solid var(--border, #ddd)', cursor: 'pointer', background: 'transparent' },
  divider: { borderTop: '1px solid var(--border, #eee)', margin: '24px 0' },
  notice: { fontSize: 13, color: 'var(--muted)', marginTop: 8 },
  error: { margin: '0 0 16px', padding: '12px 14px', borderRadius: 10, border: '1px solid #dc2626', color: '#b91c1c', fontSize: 14, lineHeight: 1.5 },
  ok: { margin: '0 0 16px', padding: '12px 14px', borderRadius: 10, border: '1px solid #15803d', color: '#166534', fontSize: 14, lineHeight: 1.5 },
  list: { listStyle: 'none', padding: 0, margin: '0 0 12px' },
  li: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap' as const, gap: 12, padding: '8px 0', fontSize: 14, borderBottom: '1px solid var(--border, #eee)' },
  confirmBox: { padding: 16, borderRadius: 10, border: '1px solid #dc2626', marginTop: 12, background: 'transparent' },
};

interface Profile {
  id: string;
  emailAvailable: boolean;
  displayName: string;
  email: string | null;
  emailVerifiedAt: string | null;
  status: string;
  deletedAt: string | null;
}

interface SessionRow {
  id: string;
  createdAt: string;
  lastSeenAt: string;
  uaFamily: string | null;
  isCurrent: boolean;
}

interface ConsentRow {
  id: string;
  kind: string;
  documentType: string | null;
  documentVersion: number | null;
  acceptedAt: string;
  withdrawnAt: string | null;
}

const DOCUMENT_TITLES: Record<string, string> = {
  TOS: 'Пользовательское соглашение',
  PD_CONSENT_USER: 'Согласие на обработку персональных данных',
  MARKETING: 'Рекламные сообщения',
};

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString('ru-RU', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Europe/Moscow' });
}

/** D-10, A-03, A-04, A-05: the account page. Every action goes to the API; nothing is kept only on the page. */
export default function AccountPage() {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [sessions, setSessions] = useState<SessionRow[]>([]);
  const [consents, setConsents] = useState<ConsentRow[]>([]);
  const [displayName, setDisplayName] = useState('');
  const [email, setEmail] = useState('');
  const [deleteConfirm, setDeleteConfirm] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [p, ss, cs] = await Promise.all([
        api<Profile>('/auth/account'),
        api<SessionRow[]>('/auth/account/sessions'),
        api<ConsentRow[]>('/auth/account/consents'),
      ]);
      setProfile(p);
      setDisplayName(p.displayName);
      setEmail((cur) => cur || p.email || '');
      setSessions(ss);
      setConsents(cs);
    } catch (e) {
      if (isApiError(e) && e.status === 401) {
        window.location.replace('/login');
        return;
      }
      setError(errorText(e));
    }
  }, []);

  useEffect(() => {
    void load();
    if (new URLSearchParams(window.location.search).get('emailVerified') === '1') setNotice('Почта подтверждена.');
  }, [load]);

  /** Runs one action, shows its result or error, and reloads the data. */
  async function act(done: string | null, run: () => Promise<unknown>, after: 'reload' | 'login' = 'reload') {
    setError(null);
    setNotice(null);
    try {
      await run();
      if (after === 'login') {
        clearClipboard();
        window.location.assign('/login');
        return;
      }
      if (done) setNotice(done);
      await load();
    } catch (e) {
      if (isApiError(e) && e.status === 401) {
        window.location.replace('/login');
        return;
      }
      setError(errorText(e));
    }
  }

  async function downloadExport() {
    await act('Файл с вашими данными сохранён.', async () => {
      const res = await apiRaw('/auth/account/export', { method: 'POST' });
      const url = URL.createObjectURL(await res.blob());
      const a = document.createElement('a');
      a.href = url;
      a.download = 'blokum-moi-dannye.json';
      a.click();
      URL.revokeObjectURL(url);
    });
  }

  if (!profile) {
    return (
      <main style={s.main}>
        <h1 style={s.heading}>Мой аккаунт</h1>
        {error ? <p role="alert" style={s.error}>{error}</p> : <p style={s.notice}>Загружаем…</p>}
      </main>
    );
  }

  const deleted = profile.status === 'DELETED';
  const activeMarketing = consents.some((c) => c.kind === 'marketing_consent' && !c.withdrawnAt);

  return (
    <main style={s.main}>
      <h1 style={s.heading}>Мой аккаунт</h1>
      {error && <p role="alert" style={s.error}>{error}</p>}
      {notice && <p role="status" style={s.ok}>{notice}</p>}

      {deleted && (
        <section style={s.section}>
          <p style={s.sectionTitle}>Аккаунт удалён</p>
          <p style={{ ...s.notice, marginBottom: 12 }}>
            Данные будут стёрты окончательно через 30 дней после удаления
            {profile.deletedAt ? ` (удалён ${formatDate(profile.deletedAt)})` : ''}. До этого аккаунт можно восстановить; сборки
            при этом остаются снятыми с публикации.
          </p>
          <button type="button" style={s.btn} onClick={() => void act('Аккаунт восстановлен.', () => api('/auth/account/restore', { method: 'POST' }))}>
            Восстановить аккаунт
          </button>
        </section>
      )}

      <section style={s.section}>
        <p style={s.sectionTitle}>Профиль</p>
        <div style={s.row}>
          <span style={s.label}>Имя</span>
          <input
            style={s.input}
            placeholder="Отображаемое имя"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            aria-label="Отображаемое имя"
          />
          <button
            type="button"
            style={s.btn}
            onClick={() => void act('Имя сохранено.', () => api('/auth/account', { method: 'PATCH', body: { displayName } }))}
          >
            Сохранить
          </button>
        </div>
      </section>

      <div style={s.divider} />

      <section style={s.section}>
        <p style={s.sectionTitle}>Email для уведомлений</p>
        {profile.emailVerifiedAt && profile.email && (
          <p style={s.notice}>Подтверждён адрес: {profile.email}</p>
        )}
        <div style={s.row}>
          <input
            type="email"
            style={s.input}
            placeholder="email@example.ru"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            aria-label="Email для уведомлений"
            disabled={!profile.emailAvailable}
          />
          <button
            type="button"
            style={profile.emailAvailable ? s.btn : { ...s.btn, opacity: 0.4, cursor: 'not-allowed' }}
            disabled={!profile.emailAvailable}
            onClick={() => void act('Письмо со ссылкой отправлено. Перейдите по ней, чтобы подтвердить адрес.', () => api('/auth/account/email', { method: 'POST', body: { email } }))}
          >
            Подтвердить
          </button>
        </div>
        <p style={s.notice}>
          {profile.emailAvailable
            ? 'На указанный адрес придёт письмо со ссылкой подтверждения. Email используется только для уведомлений, не для входа.'
            : 'Подтверждение почты пока недоступно: почтовый сервис ещё не подключён. Email используется только для уведомлений, не для входа.'}
        </p>
      </section>

      <div style={s.divider} />

      <section style={s.section}>
        <p style={s.sectionTitle}>Сеансы</p>
        <ul style={s.list} aria-label="Активные сеансы">
          {sessions.map((x) => (
            <li key={x.id} style={s.li}>
              <span>
                {x.uaFamily ?? 'Неизвестный браузер'} · был активен {formatDate(x.lastSeenAt)}
                {x.isCurrent ? ' · этот сеанс' : ''}
              </span>
              {!x.isCurrent && (
                <button type="button" style={s.btnSecondary} onClick={() => void act('Сеанс завершён.', () => api(`/auth/sessions/${x.id}`, { method: 'DELETE' }))}>
                  Завершить
                </button>
              )}
            </li>
          ))}
        </ul>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button type="button" style={s.btnSecondary} onClick={() => void act(null, () => api('/auth/sessions', { method: 'DELETE' }), 'login')}>
            Выйти везде
          </button>
          {sessions.find((x) => x.isCurrent) && (
            <button
              type="button"
              style={s.btnSecondary}
              onClick={() => void act(null, () => api(`/auth/sessions/${sessions.find((x) => x.isCurrent)?.id ?? ''}`, { method: 'DELETE' }), 'login')}
            >
              Выйти
            </button>
          )}
        </div>
      </section>

      <div style={s.divider} />

      <section style={s.section}>
        <p style={s.sectionTitle}>Согласия</p>
        {consents.length === 0 ? (
          <p style={s.notice}>Согласий пока нет.</p>
        ) : (
          <ul style={s.list} aria-label="История согласий">
            {consents.map((c) => (
              <li key={c.id} style={s.li}>
                <span>
                  {(c.documentType && DOCUMENT_TITLES[c.documentType]) || 'Согласие'}
                  {c.documentVersion ? `, версия ${c.documentVersion}` : ''} · дано {formatDate(c.acceptedAt)}
                  {c.withdrawnAt ? ` · отозвано ${formatDate(c.withdrawnAt)}` : ''}
                </span>
              </li>
            ))}
          </ul>
        )}
        {activeMarketing && (
          <button type="button" style={s.btnSecondary} onClick={() => void act('Согласие на рекламные сообщения отозвано.', () => api('/auth/account/consents/marketing', { method: 'DELETE' }))}>
            Отозвать согласие на рекламу
          </button>
        )}
      </section>

      <div style={s.divider} />

      <section style={s.section}>
        <p style={s.sectionTitle}>Мои данные</p>
        <button type="button" style={s.btnSecondary} onClick={() => void downloadExport()}>
          Выгрузить данные
        </button>
        <p style={s.notice}>Скачайте все свои данные в формате JSON.</p>
      </section>

      {!deleted && (
        <>
          <div style={s.divider} />
          <section style={s.section}>
            <p style={s.sectionTitle}>Удаление аккаунта</p>
            {!deleteConfirm ? (
              <>
                <button type="button" style={s.btnDanger} onClick={() => setDeleteConfirm(true)}>
                  Удалить аккаунт
                </button>
                <p style={s.notice}>Сборки будут сняты сразу. Данные удаляются через 30 дней — в течение этого срока можно восстановить аккаунт.</p>
              </>
            ) : (
              <div style={s.confirmBox}>
                <p style={{ margin: '0 0 12px', fontSize: 14, fontWeight: 600 }}>Вы уверены? Сборки будут сняты с публикации сразу, а данные сотрутся через 30 дней.</p>
                <div style={{ display: 'flex', gap: 8 }}>
                  <button
                    type="button"
                    style={s.btnDanger}
                    onClick={() => {
                      setDeleteConfirm(false);
                      void act('Аккаунт удалён.', () => api('/auth/account', { method: 'DELETE' }));
                    }}
                  >
                    Да, удалить
                  </button>
                  <button type="button" style={s.btnSecondary} onClick={() => setDeleteConfirm(false)}>Отмена</button>
                </div>
              </div>
            )}
          </section>
        </>
      )}
    </main>
  );
}
