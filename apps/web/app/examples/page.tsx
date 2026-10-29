import { LazyDemo } from '../../components/landing/LazyDemo';
import { SitePage } from '../../components/landing/SiteChrome';
import { makeDemos } from '../../lib/landing/demos';

export const metadata = { title: 'Примеры — Блокум', description: 'Три маленькие живые сборки: их можно потрогать и увидеть, из чего они сделаны.' };

export default function ExamplesPage() {
  const demos = makeDemos();
  return (
    <SitePage>
      <section className="lp-section">
        <div className="lp-wrap">
          <h1 className="lp-page-title">Примеры</h1>
          <p className="lp-lead-small">Три маленькие сборки. Каждая собрана из обычных блоков, правил и поведений — теми же, что доступны вам в редакторе.</p>
          <ul className="lp-examples">
            {demos.map((d) => (
              <li key={d.id}>
                <h2>{d.title}</h2>
                <p>{d.about}</p>
                <LazyDemo demoId={d.id} label={`Поиграть: ${d.title}`} />
              </li>
            ))}
          </ul>
          <p className="lp-actions">
            <a href="/login" className="lp-btn">
              Собрать свою
            </a>
          </p>
        </div>
      </section>
    </SitePage>
  );
}
