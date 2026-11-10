'use client';
import { useState } from 'react';
import { api, errorText } from '../../../lib/api-browser';
import { css } from '../../../components/admin/ui';

/** AD-01 · the administrator changes the password: the current one is asked again. */
export default function SecurityPage() {
  const [oldPassword, setOld] = useState('');
  const [newPassword, setNew] = useState('');
  const [again, setAgain] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);

  const mismatch = again !== '' && again !== newPassword;
  const submit = async (): Promise<void> => {
    setBusy(true);
    setMessage(null);
    try {
      await api('/auth/admin/password', { method: 'POST', body: { oldPassword, newPassword } });
      setOld('');
      setNew('');
      setAgain('');
      setMessage({ kind: 'ok', text: 'Пароль изменён. В следующий раз входите с новым.' });
    } catch (e) {
      setMessage({ kind: 'error', text: errorText(e) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <main style={{ ...css.page, maxWidth: 520 }}>
      <h1 style={css.h1}>Безопасность</h1>
      <section style={css.card} aria-label="Смена пароля">
        <h2 style={{ ...css.h2, marginTop: 0 }}>Сменить пароль</h2>
        <p style={css.muted}>Пароль не короче 12 знаков, с буквами и цифрами. Работает только для входа по логину и паролю.</p>
        {message && (
          <p role={message.kind === 'error' ? 'alert' : 'status'} style={message.kind === 'error' ? css.error : css.ok}>
            {message.text}
          </p>
        )}
        <label style={{ display: 'grid', gap: 4, marginBottom: 10, fontSize: 14 }}>
          Текущий пароль
          <input style={css.input} type="password" autoComplete="current-password" maxLength={200} value={oldPassword} onChange={(e) => setOld(e.target.value)} />
        </label>
        <label style={{ display: 'grid', gap: 4, marginBottom: 10, fontSize: 14 }}>
          Новый пароль
          <input style={css.input} type="password" autoComplete="new-password" maxLength={200} value={newPassword} onChange={(e) => setNew(e.target.value)} />
        </label>
        <label style={{ display: 'grid', gap: 4, marginBottom: 10, fontSize: 14 }}>
          Новый пароль ещё раз
          <input style={css.input} type="password" autoComplete="new-password" maxLength={200} value={again} onChange={(e) => setAgain(e.target.value)} />
        </label>
        {mismatch && <p role="alert" style={css.error}>Пароли не совпадают.</p>}
        <button type="button" style={css.btn} disabled={busy || mismatch || oldPassword === '' || newPassword === ''} onClick={() => void submit()} data-testid="password-submit">
          Сохранить пароль
        </button>
      </section>
    </main>
  );
}
