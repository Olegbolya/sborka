import { headers } from 'next/headers';
import { Suspense } from 'react';
import { AddonShop } from '../../../components/billing/AddonShop';
import { BillingSummary } from '../../../components/billing/BillingSummary';
import { PromoBar } from '../../../components/billing/PromoBar';
import { PlanCards } from '../../../components/landing/PlanCards';
import { SitePage } from '../../../components/landing/SiteChrome';
import { loadPlans } from '../../../lib/landing/plans';

export const metadata = { title: 'Тариф и оплата — Блоккер' };

export default async function BillingPage() {
  const h = await headers();
  const plans = await loadPlans(h.get('x-request-id'));
  return (
    <SitePage>
      <section className="lp-section">
        <div className="lp-wrap">
          <h1 className="lp-page-title">Тариф и оплата</h1>
          <Suspense fallback={<p className="lp-note">Загрузка…</p>}>
            <BillingSummary />
          </Suspense>
          <PromoBar />
          <AddonShop />
          <h2 className="lp-h2">Выбрать тариф</h2>
          <PlanCards plans={plans} titleLevel={3} />
          <p className="lp-note">Условия и порядок возврата — в <a href="/legal/offer">оферте</a>. Цены в рублях.</p>
        </div>
      </section>
    </SitePage>
  );
}
