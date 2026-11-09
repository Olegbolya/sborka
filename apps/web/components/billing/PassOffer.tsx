'use client';
import { useEffect, useState } from 'react';
import { api, errorText } from '../../lib/api-browser';
import { createPassOrder, rub } from '../../lib/billing';

interface PassPlan {
  priceOnceRub: number;
  days: number;
  screens: number;
  completions: number;
}

/**
 * P7.1 · предложение «Праздник» для одной сборки: цена и срок берутся из таблицы тарифов, оплата идёт в ЮKassa,
 * после неё человек возвращается в редактор этой сборки. Один блок и для окна в редакторе, и для настроек в кабинете.
 */
const CABINET_PRIMARY = { padding: '9px 18px', fontSize: 14, fontWeight: 600, borderRadius: 8, border: 'none', cursor: 'pointer', background: 'var(--accent)', color: '#fff' } as const;
const CABINET_SECONDARY = { padding: '9px 18px', fontSize: 14, borderRadius: 8, border: '1px solid var(--border, #ddd)', color: 'inherit', textDecoration: 'none', display: 'inline-block' } as const;

export function PassOffer({ projectId, reasons = [], where = 'editor' }: { projectId: string; reasons?: string[]; where?: 'editor' | 'cabinet' }) {
  const inEditor = where === 'editor';
  const [plan, setPlan] = useState<PassPlan | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api<{ plans: Array<{ code: string; priceOnceRub: number | null; limits: { passDays?: number; screensPerProject: number; completionsPerMonth: number } }> }>('/plans')
      .then(({ plans }) => {
        const pass = plans.find((p) => p.code === 'PASS');
        if (pass?.priceOnceRub) setPlan({ priceOnceRub: pass.priceOnceRub, days: pass.limits.passDays ?? 30, screens: pass.limits.screensPerProject, completions: pass.limits.completionsPerMonth });
      })
      .catch(() => setPlan(null));
  }, []);

  const pay = async () => {
    setBusy(true);
    setError(null);
    try {
      const { confirmationUrl } = await createPassOrder(projectId);
      window.location.assign(confirmationUrl);
    } catch (e) {
      setError(errorText(e));
      setBusy(false);
    }
  };

  return (
    <div data-testid="pass-offer">
      {reasons.length > 0 && (
        <ul style={{ margin: '0 0 12px', paddingLeft: 20 }} data-testid="pass-reasons">
          {reasons.map((r, i) => (
            <li key={i}>{r}</li>
          ))}
        </ul>
      )}
      <p style={{ margin: '0 0 12px' }} data-testid="pass-terms">
        Пропуск «Праздник» включает возможности платного тарифа для этой одной сборки на {plan?.days ?? 30}&nbsp;дней: до {plan?.screens ?? '…'} экранов, свой адрес,
        красивый QR-код, все поведения, до {plan?.completions ?? '…'} прохождений, без отметки «Блоккер». Подписка не нужна, деньги списываются один раз.
      </p>
      <button type="button" className={inEditor ? 'ed-btn primary' : undefined} style={inEditor ? undefined : CABINET_PRIMARY} data-testid="pass-pay" disabled={busy || !plan} onClick={() => void pay()}>
        {busy ? 'Переходим к оплате…' : plan ? `Включить за ${rub(plan.priceOnceRub * 100)}` : 'Включить'}
      </button>{' '}
      <a href="/tariffs" className={inEditor ? 'ed-btn' : undefined} style={inEditor ? { textDecoration: 'none', color: 'inherit' } : CABINET_SECONDARY}>
        Посмотреть все тарифы
      </a>
      {error && (
        <p role="alert" style={{ color: '#dc2626', margin: '12px 0 0' }}>
          {error}
        </p>
      )}
    </div>
  );
}
