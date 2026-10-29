import { SitePage } from '../../components/landing/SiteChrome';
import { Faq } from '../../components/landing/Faq';
import { HELP } from '../../lib/landing/content';

export const metadata = { title: 'Помощь — Блокум', description: 'Как собрать первую сборку, поделиться ею, оживить блоки и посмотреть ответы.' };

export default function HelpPage() {
  return (
    <SitePage>
      <section className="lp-section">
        <div className="lp-wrap lp-narrow">
          <h1 className="lp-page-title">Помощь</h1>
          <nav aria-label="Темы помощи" className="lp-toc">
            {HELP.map((t) => (
              <a key={t.id} href={`#${t.id}`}>
                {t.title}
              </a>
            ))}
          </nav>
          {HELP.map((t) => (
            <article key={t.id} id={t.id} className="lp-help">
              <h2>{t.title}</h2>
              <ol>
                {t.steps.map((s) => (
                  <li key={s}>{s}</li>
                ))}
              </ol>
            </article>
          ))}
          <h2>Частые вопросы</h2>
          <Faq />
          <p>
            Не нашли ответ? Контакты — в <a href="/legal/contacts">документе «Контакты и реквизиты»</a>.
          </p>
        </div>
      </section>
    </SitePage>
  );
}
