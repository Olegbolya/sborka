'use client';
import { useState } from 'react';

const s = {
  main: { minHeight: '100dvh', display: 'grid', placeItems: 'center', padding: '32px 16px' },
  card: { maxWidth: 480, width: '100%' },
  heading: { fontSize: 'clamp(24px, 5vw, 36px)', lineHeight: 1.2, margin: '0 0 8px', letterSpacing: '-0.02em' },
  sub: { fontSize: 15, color: 'var(--muted)', margin: '0 0 32px', lineHeight: 1.5 },
  list: { listStyle: 'none', padding: 0, margin: '0 0 28px', display: 'flex', flexDirection: 'column' as const, gap: 16 },
  item: { display: 'flex', alignItems: 'flex-start', gap: 12 },
  checkbox: { width: 20, height: 20, flexShrink: 0, marginTop: 2, cursor: 'pointer', accentColor: 'var(--accent)' },
  label: { fontSize: 15, lineHeight: 1.5, cursor: 'pointer' },
  link: { color: 'var(--accent)', textDecoration: 'underline' },
  optional: { fontSize: 13, color: 'var(--muted)' },
  btn: {
    display: 'block',
    width: '100%',
    padding: '14px 0',
    fontSize: 16,
    fontWeight: 600,
    borderRadius: 10,
    border: 'none',
    cursor: 'pointer',
    background: 'var(--accent)',
    color: '#fff',
    transition: 'opacity 0.15s',
  } as React.CSSProperties,
  btnDisabled: { opacity: 0.4, cursor: 'not-allowed' } as React.CSSProperties,
};

export default function OnboardingPage() {
  const [tos, setTos] = useState(false);
  const [pd, setPd] = useState(false);
  const [age, setAge] = useState(false);
  const [marketing, setMarketing] = useState(false);

  const canContinue = tos && pd && age;

  return (
    <main style={s.main}>
      <div style={s.card}>
        <h1 style={s.heading}>Перед началом</h1>
        <p style={s.sub}>Прочитайте и подтвердите условия использования сервиса.</p>
        <ul style={s.list}>
          <li style={s.item}>
            <input
              id="tos"
              type="checkbox"
              style={s.checkbox}
              checked={tos}
              onChange={(e) => setTos(e.target.checked)}
            />
            <label htmlFor="tos" style={s.label}>
              Принимаю{' '}
              <a href="/legal/terms" target="_blank" rel="noreferrer" style={s.link}>
                Пользовательское соглашение
              </a>
            </label>
          </li>
          <li style={s.item}>
            <input
              id="pd"
              type="checkbox"
              style={s.checkbox}
              checked={pd}
              onChange={(e) => setPd(e.target.checked)}
            />
            <label htmlFor="pd" style={s.label}>
              Согласен на{' '}
              <a href="/legal/pd-consent" target="_blank" rel="noreferrer" style={s.link}>
                обработку персональных данных
              </a>
            </label>
          </li>
          <li style={s.item}>
            <input
              id="age"
              type="checkbox"
              style={s.checkbox}
              checked={age}
              onChange={(e) => setAge(e.target.checked)}
            />
            <label htmlFor="age" style={s.label}>
              Подтверждаю, что мне исполнилось 18 лет
            </label>
          </li>
          <li style={s.item}>
            <input
              id="marketing"
              type="checkbox"
              style={s.checkbox}
              checked={marketing}
              onChange={(e) => setMarketing(e.target.checked)}
            />
            <label htmlFor="marketing" style={s.label}>
              Согласен на получение рекламных сообщений{' '}
              <span style={s.optional}>(необязательно)</span>
            </label>
          </li>
        </ul>
        <button
          style={canContinue ? s.btn : { ...s.btn, ...s.btnDisabled }}
          disabled={!canContinue}
          aria-disabled={!canContinue}
        >
          Продолжить
        </button>
      </div>
    </main>
  );
}
