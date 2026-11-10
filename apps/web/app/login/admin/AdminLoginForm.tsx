'use client';
import { useState } from 'react';
import { api, errorText } from '../../../lib/api-browser';

const s = {
  main: { minHeight: '100dvh', display: 'grid', placeItems: 'center', padding: '32px 16px' },
  card: { maxWidth: 420, width: '100%', display: 'grid', gap: 14 },
  heading: { fontSize: 'clamp(24px, 6vw, 32px)', lineHeight: 1.15, margin: 0, letterSpacing: '-0.02em' },
  text: { fontSize: 15, color: 'var(--muted)', margin: 0, lineHeight: 1.5 },
  label: { display: 'grid', gap: 6, fontSize: 14, fontWeight: 600 },
  input: { width: '100%', padding: '12px 14px', fontSize: 17, borderRadius: 10, border: '1px solid var(--border, #ddd)', background: 'transparent', color: 'inherit', boxSizing: 'border-box' as const },
  error: { margin: 0, padding: '12px 14px', borderRadius: 10, border: '1px solid #dc2626', color: '#b91c1c', fontSize: 14, lineHeight: 1.5 },
  btn: { padding: '14px 0', fontSize: 16, fontWeight: 600, borderRadius: 10, border: 0, background: '#e4572e', color: '#fff', cursor: 'pointer' },
};

/** AD-01 · sign-in of an administrator or a moderator: login and password, then the code of the authenticator. */
export function AdminLoginForm() {
  const [login, setLogin] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      const res = await api<{ next: string }>('/auth/admin/login', { method: 'POST', body: { login, password } });
      window.location.replace(res.next);
    } catch (e) {
      setPassword('');
      setError(errorText(e));
      setBusy(false);
    }
  };

  return (
    <main style={s.main}>
      <form
        style={s.card}
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <h1 style={s.heading}>Вход в админку</h1>
        <p style={s.text}>Введите логин и пароль. Дальше понадобится код из приложения-аутентификатора.</p>
        {error && (
          <p role="alert" data-testid="login-error" style={s.error}>
            {error}
          </p>
        )}
        <label style={s.label}>
          Логин
          <input style={s.input} name="login" autoComplete="username" autoCapitalize="none" spellCheck={false} maxLength={100} value={login} onChange={(e) => setLogin(e.target.value)} />
        </label>
        <label style={s.label}>
          Пароль
          <input style={s.input} name="password" type="password" autoComplete="current-password" maxLength={200} value={password} onChange={(e) => setPassword(e.target.value)} />
        </label>
        <button type="submit" style={{ ...s.btn, opacity: busy || login.trim() === '' || password === '' ? 0.6 : 1 }} disabled={busy || login.trim() === '' || password === ''}>
          {busy ? 'Проверяем…' : 'Войти'}
        </button>
        <p style={s.text}>
          <a href="/login" style={{ color: 'var(--accent, #e4572e)' }}>Обычный вход через VK ID или Яндекс ID</a>
        </p>
      </form>
    </main>
  );
}
