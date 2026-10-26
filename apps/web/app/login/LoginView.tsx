'use client';
import { useEffect } from 'react';
import { api } from '../../lib/api-browser';

const s = {
  main: { minHeight: '100dvh', display: 'grid', placeItems: 'center', padding: '32px 16px' },
  card: { maxWidth: 420, width: '100%' },
  heading: { fontSize: 'clamp(26px, 6vw, 36px)', lineHeight: 1.15, margin: '0 0 8px', letterSpacing: '-0.02em' },
  sub: { fontSize: 15, color: 'var(--muted)', margin: '0 0 28px', lineHeight: 1.5 },
  error: { margin: '0 0 20px', padding: '12px 14px', borderRadius: 10, border: '1px solid #dc2626', color: '#b91c1c', fontSize: 14, lineHeight: 1.5 },
  btn: {
    display: 'block',
    width: '100%',
    padding: '14px 0',
    marginBottom: 12,
    fontSize: 16,
    fontWeight: 600,
    textAlign: 'center' as const,
    textDecoration: 'none',
    borderRadius: 10,
    color: '#fff',
  },
  vk: { background: '#0077ff' },
  yandex: { background: '#1d1b18' },
  note: { fontSize: 13, color: 'var(--muted)', margin: '16px 0 0', lineHeight: 1.5 },
};

/** A-01: sign-in is only through VK ID or Яндекс ID (ADR-033); both buttons start the server-side flow. */
export function LoginView({ failed }: { failed: boolean }) {
  useEffect(() => {
    // A person who is already signed in does not need this page.
    api('/auth/me')
      .then(() => window.location.replace('/onboarding'))
      .catch(() => undefined);
  }, []);

  return (
    <main style={s.main}>
      <div style={s.card}>
        <h1 style={s.heading}>Вход в Блокум</h1>
        <p style={s.sub}>Войдите через аккаунт, который у вас уже есть. Пароль придумывать не нужно.</p>
        {failed && (
          <p role="alert" style={s.error}>
            Не получилось войти. Вход был отменён или устарел — попробуйте ещё раз.
          </p>
        )}
        <a href="/api/v1/auth/oauth/vk/init" style={{ ...s.btn, ...s.vk }}>
          Войти через VK ID
        </a>
        <a href="/api/v1/auth/oauth/yandex/init" style={{ ...s.btn, ...s.yandex }}>
          Войти через Яндекс ID
        </a>
        <p style={s.note}>
          Нажимая кнопку, вы переходите к сервису входа. Условия и согласия мы покажем на следующем шаге.
        </p>
      </div>
    </main>
  );
}
