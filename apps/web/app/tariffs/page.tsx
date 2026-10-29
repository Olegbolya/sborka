import { headers } from 'next/headers';
import { PlanCards } from '../../components/landing/PlanCards';
import { SitePage } from '../../components/landing/SiteChrome';
import { loadPlans } from '../../lib/landing/plans';

export const metadata = { title: 'Тарифы — Блокум', description: 'Бесплатный тариф без срока, разовый пропуск на праздник и подписки для тех, кто собирает регулярно.' };

export default async function TariffsPage() {
  const h = await headers();
  const plans = await loadPlans(h.get('x-request-id'));
  return (
    <SitePage>
      <section className="lp-section">
        <div className="lp-wrap">
          <h1 className="lp-page-title">Тарифы</h1>
          <p className="lp-lead-small">Тариф «Старт» бесплатен без срока. «Праздник» — разовый пропуск на одну сборку. Подписки — для тех, кто собирает регулярно.</p>
          <PlanCards plans={plans} titleLevel={2} />
          <p className="lp-note">Оплата подключается отдельно; условия и порядок возврата — в оферте. Цены указаны в рублях.</p>
          <p>
            <a href="/legal/offer">Оферта</a>
          </p>
        </div>
      </section>
    </SitePage>
  );
}
