'use client';
import { type CSSProperties, useEffect, useState } from 'react';
import { errorText } from '../../lib/api-browser';
import { type BillingState, dateRu, loadBilling } from '../../lib/billing';

const DAY = 86_400_000;

function plural(n: number, one: string, few: string, many: string): string {
  const m10 = n % 10;
  const m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return one;
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few;
  return many;
}

/** Whole days left until `end`: a part of a day counts as a day, so on the last day it says «остался 1 день», not 0. */
export function daysLeft(end: string, now: Date = new Date()): number {
  return Math.max(0, Math.ceil((new Date(end).getTime() - now.getTime()) / DAY));
}

export function daysLeftText(n: number): string {
  return `${plural(n, 'остался', 'осталось', 'осталось')} ${n} ${plural(n, 'день', 'дня', 'дней')}`;
}

/** D-09 · in the account: the current plan and how many days are left; «Старт» has no end. */
export function PlanStatus({ titleStyle, textStyle }: { titleStyle: CSSProperties; textStyle: CSSProperties }) {
  const [state, setState] = useState<BillingState | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    loadBilling()
      .then(setState)
      .catch((e: unknown) => setError(errorText(e)));
  }, []);

  const sub = state?.subscription;
  const active = sub && (sub.status === 'ACTIVE' || sub.status === 'TRIAL') && new Date(sub.currentPeriodEnd) > new Date();

  return (
    <section style={{ marginBottom: 32 }} data-testid="account-plan">
      <p style={titleStyle}>Тариф</p>
      {error && <p role="alert" style={textStyle}>{error}</p>}
      {!state && !error && <p style={textStyle}>Загружаем…</p>}
      {state && (
        <p style={{ fontSize: 15, margin: '0 0 8px' }}>
          <strong data-testid="account-plan-title">«{state.plan.title}»</strong>
          {active && sub ? (
            <>
              {' '}— <span data-testid="account-plan-days">{daysLeftText(daysLeft(sub.currentPeriodEnd))}</span>, до {dateRu(sub.currentPeriodEnd)}
              {sub.trial ? ' (пробный период, ничего не списывается)' : ''}
            </>
          ) : (
            ' — бесплатный, без срока'
          )}
        </p>
      )}
      {state && state.passes.length > 0 && (
        <p style={textStyle}>
          Пропуск «Праздник»:{' '}
          {state.passes.map((p, i) => (
            <span key={p.projectId}>
              {i > 0 ? '; ' : ''}«{p.title}» — {daysLeftText(daysLeft(p.validTo))}
            </span>
          ))}
        </p>
      )}
      <a href="/cabinet/billing" style={{ fontSize: 14 }}>
        Тариф и оплата →
      </a>
    </section>
  );
}
