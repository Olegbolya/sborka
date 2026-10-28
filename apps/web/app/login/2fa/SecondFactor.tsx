'use client';
import { useEffect, useState } from 'react';
import { api, errorText, isApiError } from '../../../lib/api-browser';

interface Start {
  mode: 'verify' | 'enrol';
  totpUri?: string;
  qrSvg?: string;
  secret?: string;
}

const s = {
  main: { minHeight: '100dvh', display: 'grid', placeItems: 'center', padding: '32px 16px' },
  card: { maxWidth: 440, width: '100%', display: 'grid', gap: 14 },
  heading: { fontSize: 'clamp(24px, 6vw, 32px)', lineHeight: 1.15, margin: 0, letterSpacing: '-0.02em' },
  text: { fontSize: 15, color: 'var(--muted)', margin: 0, lineHeight: 1.5 },
  error: { margin: 0, padding: '12px 14px', borderRadius: 10, border: '1px solid #dc2626', color: '#b91c1c', fontSize: 14, lineHeight: 1.5 },
  input: { width: '100%', padding: '12px 14px', fontSize: 20, letterSpacing: '0.2em', borderRadius: 10, border: '1px solid var(--border, #ddd)', background: 'transparent', color: 'inherit', boxSizing: 'border-box' as const },
  btn: { padding: '14px 0', fontSize: 16, fontWeight: 600, borderRadius: 10, border: 0, background: '#e4572e', color: '#fff', cursor: 'pointer' },
  secret: { fontFamily: 'ui-monospace, monospace', fontSize: 15, wordBreak: 'break-all' as const, padding: '10px 12px', borderRadius: 10, background: 'rgb(0 0 0 / 0.05)' },
  codes: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6, fontFamily: 'ui-monospace, monospace', fontSize: 16, padding: 0, margin: 0, listStyle: 'none' },
};

/** AD-01 · the second step of the sign-in of an administrator or a moderator: the code of the authenticator (the first time — its setup). */
export function SecondFactor() {
  const [start, setStart] = useState<Start | null>(null);
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [expired, setExpired] = useState(false);
  const [busy, setBusy] = useState(false);
  const [backup, setBackup] = useState<string[] | null>(null);

  useEffect(() => {
    api<Start>('/auth/oauth/mfa/start', { method: 'POST' })
      .then(setStart)
      .catch((e: unknown) => (isApiError(e) && e.status === 401 ? setExpired(true) : setError(errorText(e))));
  }, []);

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await api<{ backupCodes?: string[] }>('/auth/oauth/mfa/verify', { method: 'POST', body: { code } });
      if (res.backupCodes) setBackup(res.backupCodes);
      else window.location.replace('/onboarding');
    } catch (e) {
      if (isApiError(e) && e.status === 401) setExpired(true);
      else setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  if (expired) {
    return (
      <main style={s.main}>
        <div style={s.card}>
          <h1 style={s.heading}>Вход устарел</h1>
          <p style={s.text}>Пройдите вход через VK ID или Яндекс ID ещё раз.</p>
          <a href="/login" style={{ ...s.btn, textAlign: 'center', textDecoration: 'none' }}>
            К странице входа
          </a>
        </div>
      </main>
    );
  }

  if (backup) {
    return (
      <main style={s.main}>
        <div style={s.card} data-testid="backup-codes">
          <h1 style={s.heading}>Резервные коды</h1>
          <p style={s.text}>Сохраните их в надёжном месте. Каждый код подходит один раз, если не будет доступа к приложению. Больше мы их не покажем.</p>
          <ul style={s.codes}>
            {backup.map((c) => (
              <li key={c}>{c}</li>
            ))}
          </ul>
          <button type="button" style={s.btn} onClick={() => window.location.replace('/onboarding')}>
            Я сохранил(а) коды
          </button>
        </div>
      </main>
    );
  }

  return (
    <main style={s.main}>
      <form
        style={s.card}
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <h1 style={s.heading}>{start?.mode === 'enrol' ? 'Настройте защиту входа' : 'Код из приложения'}</h1>
        {start?.mode === 'enrol' ? (
          <>
            <p style={s.text}>Для входа в служебные разделы нужен второй шаг. Откройте приложение-аутентификатор, добавьте аккаунт по QR-коду или по ключу и введите шесть цифр.</p>
            {start.qrSvg && <div aria-label="QR-код для приложения-аутентификатора" role="img" style={{ width: 200, maxWidth: '100%', background: '#fff', padding: 8, borderRadius: 10 }} dangerouslySetInnerHTML={{ __html: start.qrSvg }} />}
            <p style={s.text}>Или введите ключ вручную:</p>
            <p style={s.secret} data-testid="totp-secret">{start.secret}</p>
          </>
        ) : (
          <p style={s.text}>Введите шесть цифр из приложения-аутентификатора или резервный код.</p>
        )}
        <label style={s.text} htmlFor="code">
          Код
        </label>
        <input id="code" style={s.input} inputMode="numeric" autoComplete="one-time-code" maxLength={16} value={code} onChange={(e) => setCode(e.target.value)} disabled={!start} />
        {error && (
          <p role="alert" data-testid="mfa-error" style={s.error}>
            {error}
          </p>
        )}
        <button type="submit" style={s.btn} disabled={busy || !start || code.trim() === ''}>
          Подтвердить
        </button>
      </form>
    </main>
  );
}
