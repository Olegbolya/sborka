'use client';
import { useEffect, useState } from 'react';
import { errorText, isApiError } from '../../lib/api-browser';
import { type BillingState, createOrder, loadBilling, startTrial } from '../../lib/billing';
import { type PlanView } from '../../lib/landing/plans';

/**
 * P7.6 · кнопки на карточке тарифа. Не вошедшему человеку — вход; вошедшему — пробный период (если он есть и не использован)
 * и оплата за месяц или за год. «Праздник» включается на сборке: деньги за неё берутся там, где видно, для какой она.
 */
export function PlanActions({ plan }: { plan: PlanView }) {
  const [state, setState] = useState<BillingState | null | 'anonymous'>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    loadBilling()
      .then(setState)
      .catch((e: unknown) => setState(isApiError(e) && e.status === 401 ? 'anonymous' : null));
  }, []);

  const isFree = plan.priceMonthRub === 0;
  const isPass = plan.priceOnceRub !== null;

  if (isFree) {
    return (
      <a href={state && state !== 'anonymous' ? '/cabinet/projects' : '/login'} className="lp-btn lp-btn-ghost">
        {state && state !== 'anonymous' ? 'Открыть кабинет' : 'Начать бесплатно'}
      </a>
    );
  }
  if (isPass) {
    return (
      <a href={state && state !== 'anonymous' ? '/cabinet/projects' : '/login'} className="lp-btn lp-btn-ghost">
        {state && state !== 'anonymous' ? 'Включить для сборки' : 'Войти и выбрать'}
      </a>
    );
  }
  if (state === 'anonymous' || state === null) {
    return (
      <a href="/login" className="lp-btn lp-btn-ghost">
        {plan.limits.trialDays ? `Попробовать ${plan.limits.trialDays}\u00a0дня` : 'Войти и выбрать'}
      </a>
    );
  }

  const act = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(errorText(e));
      setBusy(false);
    }
  };
  const pay = (period: 'MONTH' | 'YEAR') =>
    act(async () => {
      const { confirmationUrl } = await createOrder({ kind: 'SUBSCRIPTION', planCode: plan.code, period });
      window.location.assign(confirmationUrl);
    });
  const trial = () =>
    act(async () => {
      await startTrial(plan.code);
      window.location.assign('/cabinet/billing');
    });
  const rubles = (n: number) => `${new Intl.NumberFormat('ru-RU').format(n).replace(/\u202f/g, '\u00a0')}\u00a0₽`;
  const current = state.plan.code === plan.code;

  return (
    <div className="lp-plan-actions">
      {current && <p className="lp-note">Это ваш текущий тариф.</p>}
      {plan.limits.trialDays && !state.trialUsed && state.plan.code === 'FREE' && (
        <button type="button" className="lp-btn" disabled={busy} onClick={() => void trial()}>
          Попробовать {plan.limits.trialDays}&nbsp;дня бесплатно
        </button>
      )}
      {plan.priceMonthRub ? (
        <button type="button" className="lp-btn lp-btn-ghost" disabled={busy} onClick={() => void pay('MONTH')}>
          Оплатить месяц — {rubles(plan.priceMonthRub)}
        </button>
      ) : null}
      {plan.priceYearRub ? (
        <button type="button" className="lp-btn lp-btn-ghost" disabled={busy} onClick={() => void pay('YEAR')}>
          Оплатить год — {rubles(plan.priceYearRub)}
        </button>
      ) : null}
      {error && (
        <p className="lp-note" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
