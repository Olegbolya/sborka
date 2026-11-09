import { type PlanView, describePlan, priceLine } from '../../lib/landing/plans';
import { PlanActions } from '../billing/PlanActions';

/** P10.1 · the plans of the site: everything on a card is read from the table of plans. */
export function PlanCards({ plans, titleLevel = 3 }: { plans: PlanView[] | null; titleLevel?: 2 | 3 }) {
  const Title = titleLevel === 2 ? 'h2' : 'h3';
  if (!plans || plans.length === 0) {
    return (
      <p className="lp-note" role="status">
        Тарифы сейчас не загрузились. Обновите страницу чуть позже — цены мы не показываем по памяти.
      </p>
    );
  }
  return (
    <ul className="lp-plans">
      {plans.map((p) => {
        const price = priceLine(p);
        return (
          <li key={p.code} className="lp-plan" data-plan={p.code}>
            <Title>{p.title}</Title>
            <p className="lp-price">
              <strong>{price.main}</strong>
              {price.extra && <span>{price.extra}</span>}
            </p>
            <ul className="lp-plan-list">
              {describePlan(p).map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
            <PlanActions plan={p} />
          </li>
        );
      })}
    </ul>
  );
}
