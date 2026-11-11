'use client';
import { useState } from 'react';
import { api } from '../../lib/api-browser';
import { Field, Notice, css, useAction } from './ui';

/** Начислить или продлить вручную. С `userId` форма стоит на странице пользователя и номер не спрашивает. */
export function GrantForm({ onDone, userId: fixedUser }: { onDone: () => void; userId?: string }) {
  const [kind, setKind] = useState<'SUBSCRIPTION' | 'PASS'>('SUBSCRIPTION');
  const [typedUser, setUserId] = useState('');
  const userId = fixedUser ?? typedUser;
  const [planCode, setPlanCode] = useState('PLUS');
  const [months, setMonths] = useState('1');
  const [projectId, setProjectId] = useState('');
  const [reason, setReason] = useState('');
  const { busy, error, ok, run } = useAction(onDone);
  const submit = async () => {
    const done = await run(
      () => api('/admin/payments/grants', { method: 'POST', body: { kind, userId: userId.trim(), reason, ...(kind === 'SUBSCRIPTION' ? { planCode, months: Number(months) } : { projectId: projectId.trim() }) } }),
      'Начислено',
    );
    if (done) setReason('');
  };
  return (
    <section style={css.card} aria-label="Начислить вручную" data-testid="grant-form">
      <h2 style={{ ...css.h2, marginTop: 0 }}>{fixedUser ? 'Выдать или продлить тариф' : 'Начислить вручную'}</h2>
      <p style={css.muted}>Подарок или компенсация: человек получает тариф или «Праздник» без оплаты. Если такой же тариф ещё действует, новые месяцы добавляются после его конца. Начисление видно в списке заказов с пометкой «вручную» и пишется в журнал; доходом оно не считается.</p>
      <Notice error={error} ok={ok} />
      <div style={css.row}>
        <Field label="Что начислить">
          <select style={css.input} value={kind} onChange={(e) => setKind(e.target.value as 'SUBSCRIPTION' | 'PASS')} data-testid="grant-kind">
            <option value="SUBSCRIPTION">Тариф на несколько месяцев</option>
            <option value="PASS">«Праздник» для сборки</option>
          </select>
        </Field>
        {fixedUser ? null : (
          <Field label="Телефон или номер пользователя (из раздела «Пользователи»)">
            <input style={{ ...css.input, minWidth: 280 }} value={userId} onChange={(e) => setUserId(e.target.value)} data-testid="grant-user" />
          </Field>
        )}
        {kind === 'SUBSCRIPTION' ? (
          <>
            <Field label="Тариф">
              <select style={css.input} value={planCode} onChange={(e) => setPlanCode(e.target.value)}>
                <option value="AUTHOR">Автор</option>
                <option value="PLUS">Плюс</option>
                <option value="PRO">Про</option>
              </select>
            </Field>
            <Field label="Месяцев (1–36)">
              <input style={{ ...css.input, width: 90 }} inputMode="numeric" value={months} onChange={(e) => setMonths(e.target.value)} />
            </Field>
          </>
        ) : (
          <Field label="Номер сборки этого пользователя">
            <input style={{ ...css.input, minWidth: 280 }} value={projectId} onChange={(e) => setProjectId(e.target.value)} />
          </Field>
        )}
        <Field label="Причина (от 3 знаков)">
          <input style={{ ...css.input, minWidth: 240 }} value={reason} onChange={(e) => setReason(e.target.value)} maxLength={300} data-testid="grant-reason" />
        </Field>
      </div>
      <button type="button" style={{ ...css.btn, marginTop: 10 }} disabled={busy || userId.trim() === '' || reason.trim().length < 3} onClick={() => void submit()} data-testid="grant-submit">
        Начислить
      </button>
    </section>
  );
}
