'use client';
import { useState } from 'react';
import { api } from '../../../lib/api-browser';
import { GrantForm } from '../../../components/admin/GrantForm';
import { Badge, Field, Notice, css, useAction, useLoad } from '../../../components/admin/ui';
import { dateTime, rubles } from '../../../lib/admin/format';

interface Income {
  year: number;
  limitKop: number;
  personKop: number;
  businessKop: number;
  totalKop: number;
  taxKop: number;
  percent: number;
  reached: number[];
}
interface AdminOrder {
  id: string;
  kind: string;
  status: string;
  amountKop: number;
  payerType: 'PERSON' | 'BUSINESS';
  payerInn: string | null;
  provider: string;
  createdAt: string;
  paidAt: string | null;
  refundedAt: string | null;
  item: Record<string, unknown>;
  user: { id: string; displayName: string | null } | null;
}

const STATUS: Record<string, { label: string; color: string }> = {
  PENDING: { label: 'Ждёт оплаты', color: '#d97706' },
  PAID: { label: 'Оплачен', color: '#16a34a' },
  CANCELED: { label: 'Отменён', color: '#6b665d' },
  REFUNDED: { label: 'Возвращён', color: '#dc2626' },
};
const KIND: Record<string, string> = { SUBSCRIPTION: 'Тариф', PASS: '«Праздник»', ADDON: 'Допродажа' };

function IncomeBlock({ view, onDone }: { view: Income; onDone: () => void }) {
  const [limit, setLimit] = useState(String(Math.round(view.limitKop / 100)));
  const { busy, error, ok, run } = useAction(onDone);
  const bar = Math.min(100, view.percent);
  const color = view.percent >= 95 ? '#dc2626' : view.percent >= 80 ? '#d97706' : '#16a34a';
  return (
    <section style={css.card} aria-label="Доход самозанятого" data-testid="income">
      <h2 style={{ ...css.h2, marginTop: 0 }}>Доход самозанятого с 1 января {view.year} года</h2>
      <div style={css.row}>
        <strong data-testid="income-total">{rubles(view.totalKop)}</strong>
        <span>из {rubles(view.limitKop)}</span>
        <Badge color={color}>{view.percent} % лимита</Badge>
      </div>
      <div role="progressbar" aria-label="Доход от годового лимита" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(bar)} style={{ height: 10, borderRadius: 999, background: 'var(--border, #ddd)', margin: '10px 0', overflow: 'hidden' }}>
        <div style={{ width: `${bar}%`, height: '100%', background: color }} />
      </div>
      <table style={css.table}>
        <thead>
          <tr><th style={css.th}>Кто платил</th><th style={css.th}>Сумма</th><th style={css.th}>Ставка</th><th style={css.th}>Налог</th></tr>
        </thead>
        <tbody>
          <tr><td style={css.td}>Физические лица</td><td style={css.td} data-testid="income-person">{rubles(view.personKop)}</td><td style={css.td}>4 %</td><td style={css.td}>{rubles(Math.round(view.personKop * 0.04))}</td></tr>
          <tr><td style={css.td}>Юрлица и ИП</td><td style={css.td} data-testid="income-business">{rubles(view.businessKop)}</td><td style={css.td}>6 %</td><td style={css.td}>{rubles(Math.round(view.businessKop * 0.06))}</td></tr>
          <tr><td style={css.td}><strong>Всего</strong></td><td style={css.td}><strong>{rubles(view.totalKop)}</strong></td><td style={css.td} /><td style={css.td}><strong>{rubles(view.taxKop)}</strong></td></tr>
        </tbody>
      </table>
      <p style={css.muted}>В доход входят только оплаченные заказы с ценой; возвраты, промокод «бесплатно» и ручные начисления не считаются. Предупреждение придёт в уведомления при 80 % и при 95 % лимита.</p>
      <Notice error={error} ok={ok} />
      <div style={{ ...css.row, alignItems: 'flex-end' }}>
        <Field label="Годовой лимит, ₽">
          <input style={css.input} inputMode="numeric" value={limit} onChange={(e) => setLimit(e.target.value)} data-testid="income-limit" />
        </Field>
        <button type="button" style={css.btnLight} disabled={busy} onClick={() => void run(() => api('/admin/payments/income-limit', { method: 'PUT', body: { rub: Number(limit) } }), 'Лимит сохранён')}>
          Сохранить лимит
        </button>
      </div>
    </section>
  );
}

function OrderRow({ o, onDone }: { o: AdminOrder; onDone: () => void }) {
  const [open, setOpen] = useState<'' | 'refund' | 'payer'>('');
  const [reason, setReason] = useState('');
  const [payerType, setPayerType] = useState<'PERSON' | 'BUSINESS'>(o.payerType);
  const [inn, setInn] = useState(o.payerInn ?? '');
  const { busy, error, ok, run } = useAction(() => {
    setOpen('');
    onDone();
  });
  const st = STATUS[o.status] ?? { label: o.status, color: '#6b665d' };
  return (
    <>
      <tr data-testid={`order-${o.id}`}>
        <td style={css.td}>{dateTime(o.paidAt ?? o.createdAt)}</td>
        <td style={css.td}>{o.user?.displayName ?? '—'}</td>
        <td style={css.td}>{KIND[o.kind] ?? o.kind}{typeof o.item.planCode === 'string' ? ` · ${o.item.planCode}` : ''}</td>
        <td style={css.td}>{rubles(o.amountKop)}</td>
        <td style={css.td}><Badge color={st.color}>{st.label}</Badge></td>
        <td style={css.td}>{o.provider === 'manual' ? 'вручную' : o.provider === 'promo' ? 'по промокоду' : o.payerType === 'BUSINESS' ? `юрлицо/ИП${o.payerInn ? `, ИНН ${o.payerInn}` : ''}` : 'физлицо'}</td>
        <td style={css.td}>
          {o.provider !== 'manual' && o.provider !== 'promo' && o.status === 'PAID' ? (
            <div style={css.row}>
              <button type="button" style={css.btnLight} onClick={() => setOpen(open === 'payer' ? '' : 'payer')}>Плательщик</button>
              <button type="button" style={css.btnDanger} onClick={() => setOpen(open === 'refund' ? '' : 'refund')}>Вернуть деньги</button>
            </div>
          ) : null}
        </td>
      </tr>
      {open ? (
        <tr>
          <td style={css.td} colSpan={7}>
            <Notice error={error} ok={ok} />
            {open === 'refund' ? (
              <div style={{ ...css.row, alignItems: 'flex-end' }}>
                <Field label={`Причина возврата ${rubles(o.amountKop)} (от 3 знаков)`}>
                  <input style={{ ...css.input, minWidth: 280 }} value={reason} onChange={(e) => setReason(e.target.value)} maxLength={300} />
                </Field>
                <button type="button" style={css.btnDanger} disabled={busy || reason.trim().length < 3} onClick={() => void run(() => api(`/admin/payments/orders/${o.id}/refund`, { method: 'POST', body: { reason } }), 'Запрос на возврат отправлен: заказ станет «Возвращён», когда платёжный сервис подтвердит')}>
                  Подтвердить возврат
                </button>
              </div>
            ) : (
              <div style={{ ...css.row, alignItems: 'flex-end' }}>
                <Field label="Кто платил">
                  <select style={css.input} value={payerType} onChange={(e) => setPayerType(e.target.value as 'PERSON' | 'BUSINESS')}>
                    <option value="PERSON">Физическое лицо (4 %)</option>
                    <option value="BUSINESS">Юрлицо или ИП (6 %)</option>
                  </select>
                </Field>
                {payerType === 'BUSINESS' ? (
                  <Field label="ИНН (10 или 12 цифр)">
                    <input style={css.input} inputMode="numeric" value={inn} onChange={(e) => setInn(e.target.value)} maxLength={12} />
                  </Field>
                ) : null}
                <button type="button" style={css.btn} disabled={busy} onClick={() => void run(() => api(`/admin/payments/orders/${o.id}/payer`, { method: 'PATCH', body: { payerType, ...(payerType === 'BUSINESS' ? { payerInn: inn } : {}) } }), 'Плательщик сохранён')}>
                  Сохранить
                </button>
              </div>
            )}
          </td>
        </tr>
      ) : null}
    </>
  );
}

/** AD-05, AD-12 · платежи в админке: доход самозанятого, заказы с возвратом, ручные начисления. Только администратор. */
export default function PaymentsPage() {
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(0);
  const incomeLoad = useLoad(() => api<Income>('/admin/payments/income'));
  const ordersLoad = useLoad(() => api<{ orders: AdminOrder[]; total: number }>(`/admin/payments/orders?page=${page}${status ? `&status=${status}` : ''}`), [status, page]);
  const reload = () => {
    incomeLoad.reload();
    ordersLoad.reload();
  };
  return (
    <main style={css.page}>
      <h1 style={css.h1}>Платежи и доход</h1>
      {incomeLoad.error ? <p role="alert" style={css.error}>{incomeLoad.error}</p> : null}
      {incomeLoad.data ? <IncomeBlock view={incomeLoad.data} onDone={reload} /> : null}
      <GrantForm onDone={reload} />
      <h2 style={css.h2}>Заказы</h2>
      <div style={{ ...css.row, marginBottom: 10 }}>
        <Field label="Показать">
          <select style={css.input} value={status} onChange={(e) => { setStatus(e.target.value); setPage(0); }} data-testid="orders-status">
            <option value="">Все заказы</option>
            {Object.entries(STATUS).map(([k, v]) => (
              <option key={k} value={k}>{v.label}</option>
            ))}
          </select>
        </Field>
      </div>
      {ordersLoad.error ? <p role="alert" style={css.error}>{ordersLoad.error}</p> : null}
      {ordersLoad.data && ordersLoad.data.orders.length === 0 ? <p style={css.muted}>Заказов нет.</p> : null}
      {ordersLoad.data && ordersLoad.data.orders.length > 0 ? (
        <div style={{ overflowX: 'auto' }}>
          <table style={css.table}>
            <thead>
              <tr><th style={css.th}>Дата</th><th style={css.th}>Кто</th><th style={css.th}>Что</th><th style={css.th}>Сумма</th><th style={css.th}>Статус</th><th style={css.th}>Плательщик</th><th style={css.th}>Действия</th></tr>
            </thead>
            <tbody>
              {ordersLoad.data.orders.map((o) => <OrderRow key={o.id} o={o} onDone={reload} />)}
            </tbody>
          </table>
        </div>
      ) : null}
      <div style={{ ...css.row, marginTop: 12 }}>
        <button type="button" style={css.btnLight} disabled={page === 0} onClick={() => setPage(page - 1)}>Назад</button>
        <span style={css.muted}>Всего заказов: {ordersLoad.data?.total ?? 0}</span>
        <button type="button" style={css.btnLight} disabled={!ordersLoad.data || (page + 1) * 50 >= ordersLoad.data.total} onClick={() => setPage(page + 1)}>Дальше</button>
      </div>
    </main>
  );
}
