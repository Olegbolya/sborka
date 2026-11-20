import { SitePage } from '../../../../components/landing/SiteChrome';
import { QuestionChat } from '../../../../components/landing/QuestionChat';

export const metadata = { title: 'Вопрос в поддержку — Блоккер', robots: { index: false } };

/** AD-13 · отдельная переписка по одному вопросу. */
export default async function QuestionPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <SitePage>
      <section className="lp-section">
        <div className="lp-wrap lp-narrow">
          <h1 className="lp-page-title">Вопрос в поддержку</h1>
          <QuestionChat id={id} />
        </div>
      </section>
    </SitePage>
  );
}
