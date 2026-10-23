'use client';
import { useState } from 'react';

const s = {
  main: { minHeight: '100dvh', padding: '48px 16px', maxWidth: 640, margin: '0 auto' },
  heading: { fontSize: 'clamp(22px, 4vw, 30px)', lineHeight: 1.2, margin: '0 0 32px', letterSpacing: '-0.02em' },
  section: { marginBottom: 32 },
  sectionTitle: { fontSize: 14, fontWeight: 600, textTransform: 'uppercase' as const, letterSpacing: '0.08em', color: 'var(--muted)', marginBottom: 12 },
  row: { display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 },
  label: { fontSize: 14, color: 'var(--muted)', minWidth: 120 },
  value: { fontSize: 15 },
  input: { flex: 1, padding: '8px 12px', fontSize: 15, borderRadius: 8, border: '1px solid var(--border, #ddd)', background: 'transparent' },
  btn: { padding: '10px 20px', fontSize: 14, fontWeight: 600, borderRadius: 8, border: 'none', cursor: 'pointer', background: 'var(--accent)', color: '#fff' },
  btnDanger: { padding: '10px 20px', fontSize: 14, fontWeight: 600, borderRadius: 8, border: '1px solid #dc2626', cursor: 'pointer', background: 'transparent', color: '#dc2626' },
  btnSecondary: { padding: '8px 16px', fontSize: 13, borderRadius: 8, border: '1px solid var(--border, #ddd)', cursor: 'pointer', background: 'transparent' },
  divider: { borderTop: '1px solid var(--border, #eee)', margin: '24px 0' },
  notice: { fontSize: 13, color: 'var(--muted)', marginTop: 8 },
  confirmBox: { padding: 16, borderRadius: 10, border: '1px solid #dc2626', marginTop: 12, background: '#fff5f5' },
};

export default function AccountPage() {
  const [displayName, setDisplayName] = useState('');
  const [email, setEmail] = useState('');
  const [deleteConfirm, setDeleteConfirm] = useState(false);

  return (
    <main style={s.main}>
      <h1 style={s.heading}>Мой аккаунт</h1>

      {/* Profile */}
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
          <button style={s.btn} onClick={() => undefined}>Сохранить</button>
        </div>
      </section>

      <div style={s.divider} />

      {/* Email */}
      <section style={s.section}>
        <p style={s.sectionTitle}>Email для уведомлений</p>
        <div style={s.row}>
          <input
            type="email"
            style={s.input}
            placeholder="email@example.ru"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            aria-label="Email для уведомлений"
          />
          <button style={s.btn} onClick={() => undefined}>Подтвердить</button>
        </div>
        <p style={s.notice}>На указанный адрес придёт письмо со ссылкой подтверждения. Email используется только для уведомлений, не для входа.</p>
      </section>

      <div style={s.divider} />

      {/* Sessions */}
      <section style={s.section}>
        <p style={s.sectionTitle}>Сеансы</p>
        <p style={s.notice}>Управление активными сеансами доступно через API.</p>
      </section>

      <div style={s.divider} />

      {/* Consent history */}
      <section style={s.section}>
        <p style={s.sectionTitle}>Согласия</p>
        <p style={s.notice}>История ваших согласий и отзывов доступна через API.</p>
      </section>

      <div style={s.divider} />

      {/* Data export */}
      <section style={s.section}>
        <p style={s.sectionTitle}>Мои данные</p>
        <button style={s.btnSecondary}>Выгрузить данные</button>
        <p style={s.notice}>Скачайте все свои данные в формате JSON.</p>
      </section>

      <div style={s.divider} />

      {/* Account deletion */}
      <section style={s.section}>
        <p style={s.sectionTitle}>Удаление аккаунта</p>
        {!deleteConfirm ? (
          <>
            <button style={s.btnDanger} onClick={() => setDeleteConfirm(true)}>
              Удалить аккаунт
            </button>
            <p style={s.notice}>Сборки будут сняты сразу. Данные удаляются через 30 дней — в течение этого срока можно восстановить аккаунт.</p>
          </>
        ) : (
          <div style={s.confirmBox}>
            <p style={{ margin: '0 0 12px', fontSize: 14, fontWeight: 600 }}>Вы уверены? Это действие нельзя отменить до истечения 30 дней.</p>
            <div style={{ display: 'flex', gap: 8 }}>
              <button style={s.btnDanger} onClick={() => undefined}>Да, удалить</button>
              <button style={s.btnSecondary} onClick={() => setDeleteConfirm(false)}>Отмена</button>
            </div>
          </div>
        )}
      </section>
    </main>
  );
}
