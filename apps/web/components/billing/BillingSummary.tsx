'use client';
import { useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { errorText, isApiError } from '../../lib/api-browser';
import { type AddonRow, type BillingState, type OrderRow, ORDER_STATUS_LABEL, dateRu, loadAddons, loadBilling, loadOrders, rub } from '../../lib/billing';

const planName = (o: OrderRow, addons: AddonRow[]): string =>
  o.kind === 'PASS' ? 'Пропуск «Праздник»' : o.kind === 'ADDON' ? (addons.find((a) => a.code === o.item.addon)?.title ?? 'Дополнительная покупка') : `Подписка ${o.item.period === 'YEAR' ? 'на год' : 'на месяц'}`;

/** P7.6 · «Тариф и оплата»: что действует сейчас, до какого числа, заказы; после возврата с оплаты ждёт подтверждения от платёжного сервиса. */
export function BillingSummary() {
  const params = useSearchParams();
  const returned = params.get('order');
  const [state, setState] = useState<BillingState | null>(null);
  const [orders, setOrders] = useState<OrderRow[]>([]);
  const [addons, setAddons] = useState<AddonRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [anonymous, setAnonymous] = useState(false);

  useEffect(() => {
    let stop = false;
    let tries = 0;
    const load = async () => {
      try {
        const [s, o, a] = await Promise.all([loadBilling(), loadOrders(), loadAddons().catch(() => [] as AddonRow[])]);
        if (stop) return;
        setState(s);
        setOrders(o);
        setAddons(a);
        // Платёжный сервис сообщает об оплате с задержкой: после возврата с оплаты ещё несколько раз перечитываем.
        const waiting = returned && o.find((x) => x.id === returned)?.status === 'PENDING';
        if (waiting && tries++ < 10) setTimeout(() => void load(), 3000);
      } catch (e) {
        if (isApiError(e) && e.status === 401) setAnonymous(true);
        else setError(errorText(e));
      }
    };
    void load();
    return () => {
      stop = true;
    };
  }, [returned]);

  if (anonymous) {
    return (
      <p className="lp-note">
        Чтобы увидеть тариф и заказы, <a href="/login">войдите</a>.
      </p>
    );
  }
  if (error) return <p className="lp-note" role="alert">{error}</p>;
  if (!state) return <p className="lp-note" role="status">Загрузка…</p>;

  const sub = state.subscription;
  const active = sub && (sub.status === 'ACTIVE' || sub.status === 'TRIAL') && new Date(sub.currentPeriodEnd) > new Date();
  const returnedOrder = returned ? orders.find((o) => o.id === returned) : undefined;

  return (
    <div data-testid="billing-summary">
      {returnedOrder?.status === 'PAID' && <p className="lp-note" role="status">Оплата прошла, спасибо! Тариф уже включён.</p>}
      {returnedOrder?.status === 'PENDING' && <p className="lp-note" role="status">Ждём подтверждения оплаты от платёжного сервиса — обычно это несколько секунд.</p>}
      {returnedOrder?.status === 'CANCELED' && <p className="lp-note" role="status">Оплата не прошла. Деньги не списаны — можно попробовать ещё раз.</p>}
      <p>
        Сейчас у вас тариф <strong>«{state.plan.title}»</strong>
        {active && sub ? (
          <>
            {' '}
            до {dateRu(sub.currentPeriodEnd)}
            {sub.trial ? ' (пробный период, ничего не списывается)' : ''}.
          </>
        ) : (
          '.'
        )}
      </p>
      {active && sub && !sub.trial && <p className="lp-note">Продление — вручную: когда срок подойдёт к концу, мы напомним, а вы нажмёте «Оплатить» на карточке тарифа. Автоматических списаний нет.</p>}
      {orders.length > 0 && (
        <>
          <h2 className="lp-h2">Заказы</h2>
          <ul className="lp-plan-list">
            {orders.map((o) => (
              <li key={o.id}>
                {dateRu(o.createdAt)} — {planName(o, addons)}, {rub(o.amountKop)}: {ORDER_STATUS_LABEL[o.status]}
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
